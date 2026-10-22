import type { Command } from "commander";
import { basename, dirname, resolve } from "node:path";
import { lstat, readFile } from "node:fs/promises";
import {
  createVolunteerOfferingClient,
  FriendsError,
  FriendsErrorCode,
  type PreparedVolunteerOffering,
  type VolunteerOfferingSession,
} from "../index.js";
import { prepareVolunteerOfferingInEgo } from "../volunteer-offering-ego.js";
import { loadSession } from "../node.js";
import { resolveQuerySession } from "./session.js";
import { readJsonInput } from "./json-input.js";

export const offeringSchemas = {
  "offerings.prepare": {
    operation: "offerings.prepare",
    permission: "volunteer organization returned for the verified account",
    phases: ["query", "validate", inputPhase()],
    input: {
      input: { type: "JSON file or -", required: true, materials: "local file references are loaded as File objects" },
      via: { type: "api or ego", default: "api", ego: "visible preparation and human handoff only" },
      egoTaskSpace: { type: "integer", required: "with --via ego" },
      egoPage: { type: "string", default: "p1" },
    },
    output: "validated first-page payload, registration payload, material plan, and missing stages",
    readonly: true,
    remoteReadonly: true,
    supportedVia: ["api", "ego-visible-prepare"],
    verifiedWith: "public-source; controlled-api; controlled-ego",
  },
  "offerings.materials": {
    operation: "offerings.materials",
    permission: "volunteer offering manager; independent API intent",
    phases: ["validate", "upload", "readback"],
    input: {
      input: { type: "JSON file or -", required: true },
      via: { type: "api", required: true },
      confirm: { type: "boolean", required: "unless --dry-run" },
      dryRun: { type: "boolean" },
    },
    output: "completed group UUIDs and resources; partial failures retain completed work",
    readonly: false,
    remoteReadonly: false,
    supportedVia: ["api"],
    verifiedWith: "public-source; controlled-api",
  },
  "offerings.submit": {
    operation: "offerings.submit",
    permission: "volunteer offering manager; independent API intent",
    phases: ["validate", "upload-readback", "submit", "status-readback"],
    input: {
      input: { type: "JSON file or -", required: true },
      via: { type: "api", required: true },
      confirm: { type: "boolean", required: "unless --dry-run" },
      dryRun: { type: "boolean" },
      publicityGroupUuid: { type: "32-hex group UUID returned by offerings materials", required: "for confirmed submission" },
      attachmentGroupUuid: { type: "32-hex group UUID returned by offerings materials", required: "when attachments exist" },
    },
    output: "submission acknowledgement and readback; UNKNOWN_OUTCOME never automatically retries",
    readonly: false,
    remoteReadonly: false,
    supportedVia: ["api"],
    submittedViaEgo: "never",
    verifiedWith: "public-source; controlled-api",
  },
  "offerings.status": {
    operation: "offerings.status",
    permission: "volunteer offering manager",
    phases: ["query"],
    input: {
      offeringId: { type: "offering application UUID", required: true },
      via: { type: "api or ego", default: "api" },
      egoTaskSpace: { type: "integer", required: "with --via ego" },
    },
    output: "raw school approval detail; unknown flow values remain verbatim",
    readonly: true,
    remoteReadonly: true,
    requestMode: "direct-api",
    supportedVia: ["api", "ego"],
    verifiedWith: "public-source; controlled-api",
  },
} as const;

function inputPhase() {
  return "local-input";
}

const mimeTypes = new Map([
  ["jpg", "image/jpg"], ["jpeg", "image/jpeg"], ["png", "image/png"], ["gif", "image/gif"], ["bmp", "image/bmp"],
  ["pdf", "application/pdf"], ["doc", "application/msword"], ["docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ["xls", "application/vnd.ms-excel"], ["xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ["ppt", "application/vnd.ms-powerpoint"], ["pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  ["txt", "text/plain"], ["zip", "application/zip"], ["rar", "application/vnd.rar"], ["7z", "application/x-7z-compressed"],
  ["mp3", "audio/mpeg"], ["avi", "video/x-msvideo"], ["wmv", "video/x-ms-wmv"], ["mpeg", "video/mpeg"], ["mp4", "video/mp4"],
]);

function invalid(message: string): never {
  throw new FriendsError({ code: FriendsErrorCode.InvalidInput, message });
}

function output(data: unknown, meta: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify({ schemaVersion: 1, ok: true, data, meta })}\n`);
}

function reference(item: unknown): { path: string; name?: string } {
  if (typeof item !== "object" || item === null) invalid("Each material must be {path[,name]}");
  const raw = item as Record<string, unknown>;
  if (Object.keys(raw).some((key) => !["path", "name"].includes(key))) invalid("Material supports only path and name");
  if (typeof raw.path !== "string" || raw.path === "") invalid("Material path is required");
  if (raw.name !== undefined && (typeof raw.name !== "string" || /[\\/]/.test(raw.name) || raw.name === "")) invalid("Material name must be a filename");
  return { path: raw.path, name: raw.name as string | undefined };
}

async function material(item: unknown, baseDirectory: string): Promise<File> {
  const requested = reference(item);
  const path = resolve(baseDirectory, requested.path);
  const stat = await lstat(path).catch(() => null);
  if (stat === null || !stat.isFile() || stat.isSymbolicLink()) invalid(`Material is not a regular file: ${path}`);
  const bytes = await readFile(path);
  const name = requested.name ?? basename(path);
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  return new File([bytes], name, { type: mimeTypes.get(extension) ?? "application/octet-stream" });
}

async function offeringInput(source: string): Promise<{ value: unknown; baseDirectory: string }> {
  const baseDirectory = source === "-" ? process.cwd() : dirname(resolve(source));
  const value = await readJsonInput(source);
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid("Offering input must be a JSON object");
  const raw = structuredClone(value) as {
    materials?: { publicityPictures?: unknown[]; attachments?: unknown[] };
  };
  if (raw.materials?.publicityPictures !== undefined && Array.isArray(raw.materials.publicityPictures)) {
    raw.materials.publicityPictures = await Promise.all(raw.materials.publicityPictures.map((item) => material(item, baseDirectory)));
  }
  if (raw.materials?.attachments !== undefined && Array.isArray(raw.materials.attachments)) {
    raw.materials.attachments = await Promise.all(raw.materials.attachments.map((item) => material(item, baseDirectory)));
  }
  return { value: raw, baseDirectory };
}

function sessionFor(stored: Awaited<ReturnType<typeof loadSession>>): VolunteerOfferingSession {
  return stored;
}

function adoptGroups(prepared: PreparedVolunteerOffering, publicityGroupUuid: string, attachmentGroupUuid?: string): void {
  if (!/^[0-9a-f]{32}$/.test(publicityGroupUuid)) invalid("--publicity-group-uuid must be the 32-hex value returned by offerings materials");
  if (attachmentGroupUuid !== undefined && !/^[0-9a-f]{32}$/.test(attachmentGroupUuid)) invalid("--attachment-group-uuid must be the 32-hex value returned by offerings materials");
  if (prepared.materials.attachmentGroupUuid !== null && attachmentGroupUuid === undefined) {
    invalid("This offering has attachments; pass --attachment-group-uuid after uploading them");
  }
  prepared.materials.publicityGroupUuid = publicityGroupUuid;
  prepared.materials.attachmentGroupUuid = attachmentGroupUuid ?? null;
}

function plan(prepared: PreparedVolunteerOffering) {
  return {
    status: prepared.status,
    submitted: prepared.submitted,
    activityCategory: prepared.activityCategory,
    payload: prepared.payload,
    registration: prepared.registration,
    materials: {
      publicityGroupUuid: prepared.materials.publicityGroupUuid,
      attachmentGroupUuid: prepared.materials.attachmentGroupUuid,
      publicityPictureCount: prepared.materials.publicityPictures.length,
      attachmentCount: prepared.materials.attachments.length,
    },
    missing: prepared.missing,
  };
}

function positiveTaskSpace(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) invalid("--ego-task-space must be a positive integer");
  return parsed;
}

export function registerOfferingCommands(program: Command, options: { baseUrl: string }): void {
  const offerings = program.command("offerings").description("Volunteer offering applications");

  offerings.command("prepare")
    .description("Validate an offering against fresh school context; Ego mode visibly fills the first page and hands it off")
    .requiredOption("--input <file|->", "offering JSON file or stdin")
    .requiredOption("--via <api|ego>", "preparation path")
    .option("--ego-task-space <number>", "existing Ego task space required by --via ego")
    .option("--ego-page <label>", "existing Ego page label", "p1")
    .option("--level-no <value>", "select an available school role")
    .option("--unit-no <value>", "select an available identity unit")
    .option("--dry-run", "inspect the visible Ego page without filling it")
    .option("--json", "stable JSON", true)
    .action(async (commandOptions: Record<string, string | boolean | undefined>) => {
      const input = await offeringInput(commandOptions.input as string);
      if (commandOptions.via === "api") {
        const stored = await loadSession();
        const client = createVolunteerOfferingClient({ baseUrl: options.baseUrl, session: sessionFor(stored) });
        const prepared = await client.prepare(input.value);
        output(plan(prepared), { operation: "offerings.prepare", via: "api", requestMode: "direct-api", remoteWrites: 0 });
        return;
      }
      if (commandOptions.via !== "ego") invalid("--via must be api or ego");
      const dryRun = commandOptions.dryRun === true;
      const egoOptions = commandOptions as Record<string, string | undefined>;
      const taskSpaceId = positiveTaskSpace(egoOptions.egoTaskSpace);
      const prepared = await prepareVolunteerOfferingInEgo({
        value: input.value,
        taskSpaceId,
        page: egoOptions.egoPage,
        levelNo: egoOptions.levelNo,
        unitNo: egoOptions.unitNo,
        baseUrl: options.baseUrl,
        dryRun,
      });
      output(prepared, {
        operation: "offerings.prepare",
        via: "ego-visible-prepare",
        requestMode: "visible-ego-prepare",
        remoteWrites: 0,
      });
    });

  offerings.command("materials")
    .description("Upload validated offering materials through the protected-file API")
    .requiredOption("--input <file|->", "offering JSON file or stdin")
    .requiredOption("--via <path>", "explicit API path", "api")
    .option("--confirm", "confirm material upload")
    .option("--dry-run", "validate and read back without uploading")
    .option("--json", "stable JSON", true)
    .action(async (commandOptions: { input: string; via: string; confirm?: boolean; dryRun?: boolean }) => {
      if (commandOptions.via !== "api") invalid("Offering material upload requires --via api; Ego material upload is manual");
      if (!commandOptions.dryRun && commandOptions.confirm !== true) invalid("--confirm is required for material upload");
      const stored = await loadSession();
      const client = createVolunteerOfferingClient({ baseUrl: options.baseUrl, session: sessionFor(stored) });
      const prepared = await client.prepare((await offeringInput(commandOptions.input)).value);
      const result = await client.uploadMaterials(prepared, {
        via: "api", intent: "upload-volunteer-offering-materials", confirm: commandOptions.confirm, dryRun: commandOptions.dryRun,
      });
      output(result, { operation: "offerings.materials", via: "api", requestMode: "api-write", dryRun: commandOptions.dryRun === true });
    });

  offerings.command("submit")
    .description("Submit a complete offering through the independent API path; Ego submission is never authorized here")
    .requiredOption("--input <file|->", "offering JSON file or stdin")
    .requiredOption("--via <path>", "explicit API path", "api")
    .option("--publicity-group-uuid <uuid>", "uploaded publicity group UUID")
    .option("--attachment-group-uuid <uuid>", "uploaded attachment group UUID")
    .option("--confirm", "confirm final submission")
    .option("--dry-run", "validate and read back without submission")
    .option("--json", "stable JSON", true)
    .action(async (commandOptions: {
      input: string; via: string; publicityGroupUuid?: string; attachmentGroupUuid?: string; confirm?: boolean; dryRun?: boolean;
    }) => {
      if (commandOptions.via !== "api") invalid("Only independent --via api submission is allowed; Ego requires human final submission");
      if (!commandOptions.dryRun && commandOptions.confirm !== true) invalid("--confirm is required for API submission");
      const stored = await loadSession();
      const client = createVolunteerOfferingClient({ baseUrl: options.baseUrl, session: sessionFor(stored) });
      const prepared = await client.prepare((await offeringInput(commandOptions.input)).value);
      if (commandOptions.publicityGroupUuid !== undefined || !commandOptions.dryRun) {
        adoptGroups(prepared, commandOptions.publicityGroupUuid ?? "", commandOptions.attachmentGroupUuid);
      }
      const result = await client.submit(prepared, {
        via: "api", intent: "submit-volunteer-offering", confirm: commandOptions.confirm, dryRun: commandOptions.dryRun,
      });
      output(result, { operation: "offerings.submit", via: "api", requestMode: "api-write", dryRun: commandOptions.dryRun === true });
    });

  offerings.command("status")
    .description("Read raw school approval detail for an offering application")
    .argument("<offeringId>", "offering application UUID")
    .option("--via <source>", "query session source", "api")
    .option("--ego-task-space <number>", "existing Ego task space")
    .option("--ego-page <label>", "existing Ego page label")
    .option("--level-no <value>", "select an available school role")
    .option("--unit-no <value>", "select an available identity unit")
    .option("--json", "stable JSON", true)
    .action(async (offeringId: string, commandOptions: Record<string, string | undefined>) => {
      const source = await resolveQuerySession(commandOptions, options.baseUrl);
      const client = createVolunteerOfferingClient({ baseUrl: options.baseUrl, session: source.session });
      output(await client.status(offeringId), {
        operation: "offerings.status", via: source.entry, selectedEntry: source.entry, requestMode: "direct-api",
      });
    });
}
