import type { Command } from "commander";
import { basename } from "node:path";
import { lstat, readFile } from "node:fs/promises";
import {
  createFriendsSdk,
  FriendsError,
  FriendsErrorCode,
  type CourseMaterialUpload,
} from "../index.js";
import {
  loadSession,
  prepareCourseOfferingInEgo,
  type StoredSession,
  type VerifiedEgoSession,
} from "../node.js";
import { resolveQuerySession } from "./session.js";
import { readJsonInput } from "./json-input.js";

const applicationFields = {
  schemaVersion: 1,
  kind: "course-offering",
  binding: { accountUserNo: "current school account", levelNo: "current role", unitNo: "current identity unit", organizationId: "UUID returned by the course organization drop-down" },
  uuid: "null for a new first step; school application UUID for update/final submission",
  firstStep: {
    curriculumName: "non-empty string, up to 32 characters", curriculumType: "current KCLX code", curriculumLevel: "current QNZYZXNHDJB code",
    curriculumPlace: "non-empty string, up to 32 characters", curriculumContent: "non-empty string, up to 100 characters",
    beginTime: "YYYY-MM-DD HH:mm[:ss]", endTime: "YYYY-MM-DD HH:mm[:ss], later than beginTime",
    role: { roleName: "non-empty string", integral: "number 0..9999.9", classHour: "number 0..9999" },
    attestationType: "AUTO|MAN", isOpenSign: "boolean", signNumber: "number 1..100 when isOpenSign; otherwise null", isEnroll: "boolean", isAppraise: "boolean",
  },
  reportSet: {
    openType: "NOW|AUTO", openTime: "YYYY-MM-DD HH:mm[:ss]", finishType: "NOW|AUTO", deadline: "after openTime and before course endTime",
    isEnrollExamine: "boolean", isHideList: "boolean", isDraft: false, isOrgMember: "boolean",
    limitCollegeNo: [], limitGrade: [], limitSpecialtyTypeOne: [], questionnaires: [], posts: [],
  },
  materials: { attachmentGroupUuid: "null or an uploaded group UUID", publicityPicturesGroupUuid: "null or an uploaded image group UUID" },
  additionalFields: "rejected; non-empty audiences, questionnaires, and posts are unsupported",
} as const;

export const courseOfferingSchemas = {
  "course-offering.prepare": {
    operation: "course-offering.prepare",
    readonly: true,
    remoteReadonly: true,
    permission: "course organization returned for the verified context",
    phases: ["validate", "source-read"],
    input: { input: "course application JSON file or -", application: applicationFields },
    output: "validated application, current term, school-verified type/level/organization, and fresh material groups",
    supportedVia: ["api"],
    verifiedWith: "public-source; controlled-sdk-cli",
  },
  "course-offering.materials": {
    operation: "course-offering.materials",
    readonly: false,
    remoteReadonly: false,
    permission: "course organization returned for the verified context; explicit API intent",
    phases: ["validate", "upload", "readback-on-unknown"],
    input: {
      input: "application JSON with optional existing group UUIDs",
      application: applicationFields,
      files: "materials.files: non-empty array of {kind: attachment|publicity, path: regular file}; other commands reject files",
      via: "api (required)",
      confirm: "required except --dry-run",
      dryRun: "extension, MIME, and size validation with zero uploads",
    },
    materials: "attachments use protected-file-upload; publicity uses the same protected endpoint with image-only validation",
    unknownOutcome: "exit 7; retain group UUIDs and uploaded-file facts; never automatically retry",
    supportedVia: ["api"],
    verifiedWith: "public-source; controlled-sdk-cli",
  },
  "course-offering.next-step": {
    operation: "course-offering.next-step",
    readonly: false,
    remoteReadonly: false,
    permission: "course organization returned for the verified context; explicit API intent",
    phases: ["validate", "source-read", "material-read", "intermediate-write"],
    input: { input: "course application JSON file or -", application: applicationFields, via: "api (required)", confirm: "required except --dry-run" },
    output: "intermediate course UUID; finalSubmission is always false",
    unknownOutcome: "exit 7; inspect status without resubmitting",
    supportedVia: ["api"],
    verifiedWith: "public-source; controlled-sdk-cli",
  },
  "course-offering.submit": {
    operation: "course-offering.submit",
    readonly: false,
    remoteReadonly: false,
    permission: "course organization returned for the verified context; explicit API intent",
    phases: ["validate", "material-read", "status-read", "final-write", "readback"],
    input: { input: "course application JSON file or -", application: applicationFields, via: "api (required)", confirm: "required except --dry-run" },
    output: "school-acknowledged submission and read-only approval status",
    unknownOutcome: "exit 7; even a matching readback stays UNKNOWN_OUTCOME",
    supportedVia: ["api"],
    verifiedWith: "public-source; controlled-sdk-cli",
  },
  "course-offering.status": {
    operation: "course-offering.status",
    readonly: true,
    remoteReadonly: true,
    permission: "course context; upstream enforces access",
    phases: ["query"],
    input: { courseId: "course application UUID", via: "api or ego" },
    output: "necessary approval status projection with unknown state labels",
    supportedVia: ["api", "ego"],
    requestMode: "direct-api",
    verifiedWith: "public-source; controlled-sdk-cli",
  },
  "course-offering.prepare-ego": {
    operation: "course-offering.prepare-ego",
    readonly: false,
    remoteReadonly: true,
    permission: "verified course organization and matching visible Ego page",
    phases: ["validate", "source-read", "visible-prepare", "human-handoff"],
    input: { input: "course application JSON file or -", application: applicationFields, via: "ego", egoTaskSpace: "existing task space" },
    output: "open editable first-step page, missing fields, preserved human values and executionError; submitted is always false",
    finalSubmission: "user-only; --yes and --confirm are rejected",
    dryRun: "source checks and verified session only; no navigation, fill, picker or handoff",
    sideEffect: "visible local fills only; no final click or hidden API",
    supportedVia: ["ego-visible-prepare"],
    verifiedWith: "public-source; controlled-ego",
  },
} as const;

function invalid(message: string): never {
  throw new FriendsError({ code: FriendsErrorCode.InvalidInput, message });
}

function output(data: unknown, meta: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify({ schemaVersion: 1, ok: true, data, meta }, null, 2)}\n`);
}

async function localFiles(input: { materials?: { files?: unknown } }): Promise<CourseMaterialUpload[]> {
  const files = input.materials?.files;
  if (!Array.isArray(files) || files.length === 0) invalid("materials.files must be a non-empty array");
  const result: CourseMaterialUpload[] = [];
  for (const value of files) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) invalid("Each materials.files item must be an object");
    const item = value as { kind?: unknown; path?: unknown };
    if (Object.keys(value).some(key => key !== "kind" && key !== "path")) invalid("Unknown course material file field");
    if ((item.kind !== "attachment" && item.kind !== "publicity") || typeof item.path !== "string" || item.path === "") {
      invalid("Each materials.files item requires kind attachment|publicity and path");
    }
    const stat = await lstat(item.path).catch(() => null);
    if (stat === null || !stat.isFile() || stat.isSymbolicLink()) invalid(`Material must be a regular file: ${item.path}`);
    const maximumSize = item.kind === "publicity" || !/\.(avi|wmv|mpeg|mp4)$/i.test(item.path) ? 20 * 1024 * 1024 : 200 * 1024 * 1024;
    if (stat.size <= 0 || stat.size > maximumSize) invalid("Material is empty or exceeds the course file size limit");
    const buffer = await readFile(item.path);
    const name = basename(item.path);
    const extension = name.split(".").pop()?.toLowerCase() ?? "";
    const type = item.kind === "publicity"
      ? extension === "png" ? "image/png"
        : extension === "jpg" ? "image/jpg"
        : extension === "jpeg" ? "image/jpeg"
        : extension === "gif" ? "image/gif"
        : extension === "bmp" ? "image/bmp"
        : ""
      : extension === "pdf" ? "application/pdf"
      : extension === "txt" ? "text/plain"
      : extension === "png" ? "image/png"
      : extension === "jpg" || extension === "jpeg" ? "image/jpeg"
      : extension === "gif" ? "image/gif"
      : extension === "bmp" ? "image/bmp"
      : "application/octet-stream";
    result.push({ kind: item.kind, file: new File([buffer], name, { type }) });
  }
  return result;
}

async function parseInput(source: string | undefined, materialMode = false) {
  const value = await readJsonInput(source === undefined ? "-" : source);
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid("Course offering input must be an object");
  const input = { ...(value as Record<string, unknown>) };
  const materials = input.materials as { files?: unknown } | undefined;
  const files = materialMode ? await localFiles({ materials }) : undefined;
  if (materials?.files !== undefined) {
    if (!materialMode) invalid("materials.files is accepted only by the explicit materials command; stage files separately");
    const { files: _files, ...groups } = materials;
    input.materials = groups;
  }
  return { input, files };
}

function assertIntent(via: string | undefined, confirm: boolean | undefined, dryRun: boolean | undefined, operation: string) {
  if (via !== "api") invalid(`${operation} requires independent --via api`);
  if (!dryRun && confirm !== true) invalid(`${operation} requires --confirm`);
}

export function registerCourseOfferingCommands(program: Command, options: { baseUrl: string }): void {
  const command = program.command("course-offering").description("Course offering application source checks, controlled writes, status, and visible Ego preparation");
  const sdk = createFriendsSdk({ baseUrl: options.baseUrl });

  async function client(session: StoredSession | VerifiedEgoSession | Promise<StoredSession | VerifiedEgoSession> = loadSession()) {
    return sdk.createCourseOfferingClient(await session);
  }

  command.command("prepare")
    .description("Validate an application against current school source data without a business write")
    .requiredOption("--input <file|->", "application JSON file or stdin")
    .option("--json", "stable JSON", true)
    .action(async (commandOptions: { input: string }) => {
      const { input } = await parseInput(commandOptions.input);
      const prepared = await (await client()).prepare(input);
      output(prepared, { operation: "course-offering.prepare", via: "api", requestMode: "direct-api" });
    });

  command.command("materials")
    .description("Stage attachment and publicity files into their protected upload groups")
    .requiredOption("--input <file|->", "application JSON with materials.files paths")
    .requiredOption("--via <source>", "independent API write intent")
    .option("--confirm", "confirm each staged upload")
    .option("--dry-run", "validate local files without uploading")
    .option("--json", "stable JSON", true)
    .action(async (commandOptions: { input: string; via: string; confirm?: boolean; dryRun?: boolean }) => {
      assertIntent(commandOptions.via, commandOptions.confirm, commandOptions.dryRun, "Course material upload");
      const { input, files } = await parseInput(commandOptions.input, true);
      const courseClient = await client();
      const prepared = await courseClient.prepare(input);
      const result = await courseClient.stageMaterials(prepared, files!, {
        via: "api", intent: "stage-course-materials", confirm: true, dryRun: commandOptions.dryRun,
      });
      output(result, { operation: "course-offering.materials", via: "api", requestMode: "api-upload" });
    });

  command.command("next-step")
    .description("Save the independently confirmed first step and return an intermediate UUID")
    .requiredOption("--input <file|->", "application JSON file or stdin")
    .requiredOption("--via <source>", "independent API write intent")
    .option("--confirm", "confirm one intermediate write")
    .option("--dry-run", "validate without the intermediate write")
    .option("--json", "stable JSON", true)
    .action(async (commandOptions: { input: string; via: string; confirm?: boolean; dryRun?: boolean }) => {
      assertIntent(commandOptions.via, commandOptions.confirm, commandOptions.dryRun, "Course first-step save");
      const { input } = await parseInput(commandOptions.input);
      const courseClient = await client();
      const prepared = await courseClient.prepare(input);
      const result = await courseClient.saveFirstStep(prepared, {
        via: "api", intent: "save-course-first-step", confirm: true, dryRun: commandOptions.dryRun,
      });
      output(result, { operation: "course-offering.next-step", via: "api", requestMode: "api-write" });
    });

  command.command("submit")
    .description("Confirm the separate final course offering submission and read back status")
    .requiredOption("--input <file|->", "application JSON file or stdin")
    .requiredOption("--via <source>", "independent API write intent")
    .option("--confirm", "confirm one final submission")
    .option("--dry-run", "validate and read status without final submission")
    .option("--json", "stable JSON", true)
    .action(async (commandOptions: { input: string; via: string; confirm?: boolean; dryRun?: boolean }) => {
      assertIntent(commandOptions.via, commandOptions.confirm, commandOptions.dryRun, "Course offering submission");
      const { input } = await parseInput(commandOptions.input);
      const courseClient = await client();
      const prepared = await courseClient.prepare(input);
      const result = await courseClient.submitFinal(prepared, {
        via: "api", intent: "submit-course-offering", confirm: true, dryRun: commandOptions.dryRun,
      });
      output(result, { operation: "course-offering.submit", via: "api", requestMode: "api-write" });
    });

  command.command("status")
    .description("Read course application approval status")
    .argument("<courseId>", "course application UUID")
    .option("--via <source>", "query session source", "api")
    .option("--ego-task-space <number>", "existing Ego task space required by --via ego")
    .option("--ego-page <label>", "existing Ego page label")
    .option("--level-no <value>", "select an available school role")
    .option("--unit-no <value>", "select an available identity unit")
    .option("--json", "stable JSON", true)
    .action(async (courseId: string, commandOptions: Record<string, string | undefined>) => {
      const source = await resolveQuerySession(commandOptions, options.baseUrl);
      const result = await (await client(Promise.resolve(source.session))).status(courseId);
      output(result, {
        operation: "course-offering.status",
        via: source.entry,
        selectedEntry: source.entry,
        requestMode: "direct-api",
      });
    });

  command.command("prepare-ego")
    .description("Fill visible course fields in Ego and hand the editable page to the human")
    .requiredOption("--input <file|->", "application JSON file or stdin")
    .requiredOption("--via <source>", "visible preparation source", "ego")
    .requiredOption("--ego-task-space <number>", "existing Ego task space")
    .option("--ego-page <label>", "existing school page label")
    .option("--level-no <value>", "select an available school role")
    .option("--unit-no <value>", "select an available identity unit")
    .option("--dry-run", "source validation only; open no browser page")
    .option("--json", "stable JSON", true)
    .action(async (commandOptions: Record<string, string | boolean | undefined>) => {
      if (commandOptions.via !== "ego") invalid("Course offering preparation requires --via ego");
      if (commandOptions.confirm === true) invalid("Ego preparation cannot be confirmed into a submission");
      const taskSpaceId = Number(commandOptions.egoTaskSpace);
      if (!Number.isSafeInteger(taskSpaceId) || taskSpaceId < 1) invalid("--ego-task-space must be a positive integer");
      const { input } = await parseInput(commandOptions.input as string);
      const source = await resolveQuerySession(commandOptions as Record<string, string | undefined>, options.baseUrl);
      const result = await prepareCourseOfferingInEgo({
        application: input,
        session: source.session,
        taskSpaceId,
        page: commandOptions.egoPage as string | undefined,
        baseUrl: options.baseUrl,
        dryRun: commandOptions.dryRun === true,
      });
      output(result, {
        operation: "course-offering.prepare-ego",
        via: "ego-visible-prepare",
        requestMode: "visible-ego-prepare",
        verification: { finalSubmission: "user-only" },
      });
    });
}
