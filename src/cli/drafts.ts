import { readJsonInput } from "./json-input.js";
import type { Command } from "commander";
import { resolveQuerySession } from "./session.js";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat } from "node:fs/promises";
import { resolve } from "node:path";
import {
  createFriendsSdk,
  createPartialVolunteerCertificationDraft,
  createVolunteerCertificationClient,
  FriendsError,
  FriendsErrorCode,
  updateVolunteerCertificationDraft,
  validateVolunteerCertificationDraft,
  type CertificationDraftMaterial,
  type VolunteerCertificationDraftPatch,
} from "../index.js";
import {
  createCertificationDraftStore,
  prepareVolunteerCertificationInEgo,
  rejectVolunteerCertificationEgoSubmitInEgo,
} from "../node.js";

export const draftSchemas = {
  "drafts.activities": {
    operation: "drafts.activities", permission: "volunteer manager context", phases: ["query"],
    input: {via:"api|ego",egoTaskSpace:"required with ego",egoPage:"p1"}, output: "manageable volunteer activities", readonly: true, remoteReadonly: true,
    supportedVia: ["api", "ego"], verifiedWith: "public-source; controlled-api; live-manager-read-only",
  },
  "drafts.create": {
    operation: "drafts.create", permission: "verified local session and manageable volunteer activity",
    phases: ["query", "local-create"], input: {
      via: {type:"api|ego",default:"api"}, egoTaskSpace: {type:"integer",required:"with ego"},
      activityId: { type: "volunteer activity UUID", required: true },
      materials: { type: "JSON file or stdin: {materials:[{kind:'local-file',path}|{kind:'web-unrecoverable'}]}" },
    }, output: "a new local certification draft and its private path", readonly: false,
    remoteReadonly: true, localWrite: true, sideEffect: "writes one draft outside Git repositories; never uploads or submits",
    supportedVia: ["api-query+local-store", "ego-query+local-store"], verifiedWith: "public-source; controlled-api; live-manager-read-only",
  },
  "drafts.edit": {
    operation: "drafts.edit", permission: "local draft access", phases: ["local-edit"],
    input: {
      draftId: { type: "draft ID", required: true },
      via: {type:"api|ego",default:"api",when:"adding student numbers requires a school query"},
      expectedRevision: { type: "non-negative integer", required: true },
      input: { type: "JSON file or stdin", required: true, patch: ["addStudentNos", "includedStudentNos", "postIds", "durations", "materials"] },
    }, output: "the next draft revision", readonly: false, remoteReadonly: true, localWrite: true,
    sideEffect: "atomic local draft replacement; stale revision is preserved in a conflict file",
    supportedVia: ["local-store"], verifiedWith: "controlled-node",
  },
  "drafts.show": {
    operation: "drafts.show", permission: "local draft access", phases: ["local-read"],
    input: { draftId: { type: "draft ID", required: true } }, output: "the stored draft",
    readonly: true, remoteReadonly: true, supportedVia: ["local-store"], verifiedWith: "controlled-node",
  },
  "drafts.validate": {
    operation: "drafts.validate", permission: "local draft access", phases: ["validate"],
    input: { draftId: { type: "draft ID", required: true }, mode: { type: "structure|complete", default: "structure" } },
    output: "structure validity and completeness issues", readonly: true, remoteReadonly: true,
    supportedVia: ["local-store"], verifiedWith: "controlled-node",
  },
  "drafts.check": {
    operation: "drafts.check", permission: "local draft and material read access", phases: ["validate"],
    input: { draftId: { type: "draft ID", required: true } }, output: "material existence, type, and SHA-256 status",
    readonly: true, remoteReadonly: true, supportedVia: ["local-store"], verifiedWith: "controlled-node",
  },
  "drafts.list": {
    operation: "drafts.list", permission: "local draft access", phases: ["local-read"], input: {},
    output: "draft ID, revision, activity, and selected roster count", readonly: true, remoteReadonly: true,
    supportedVia: ["local-store"], verifiedWith: "controlled-node",
  },
  "drafts.prepare": {
    operation: "drafts.prepare", permission: "verified Ego session and manageable volunteer activity",
    phases: ["query", "visible-prepare", "awaiting-user"], input: {
      draftId: { type: "draft ID", required: true },
      via: { type: "ego", required: true },
      egoTaskSpace: { type: "integer", required: true },
      egoPage: { type: "p1 by default", required: false },
      egoSessionPage: { type: "p1 by default", required: false, purpose: "read the existing school session without navigation; egoPage remains the certification target" },
      timeout: { type: "positive integer milliseconds", required: false },
      dryRun: { type: "boolean", effect: "inspect only, zero controls or handoff" },
    }, output: "awaiting-user preparation, completed visible actions and preserved human changes; never invokes final submit",
    readonly: false, remoteReadonly: true, visiblePageWrite: true, finalSubmission: "human-only",
    sideEffect: "fills the matching existing page, or navigates an explicitly selected blank page; hands the editable page to the user",
    supportedVia: ["ego"], verifiedWith: "public-source; controlled-sdk; controlled-node; controlled-cli",
  },
  "drafts.submit": {
    operation: "drafts.submit", permission: "none; Ego submission is intentionally unsupported",
    phases: ["reject"], input: {
      draftId: { type: "draft ID", required: true },
      via: { type: "ego", required: true },
      yes: { type: "rejected flag" },
      retry: { type: "rejected flag" },
      apiFallback: { type: "rejected flag" },
    }, output: "INVALID_INPUT before browser or API side effects",
    readonly: false, remoteReadonly: true, finalSubmission: "human-only",
    sideEffect: "none; always rejected before launch or network write",
    supportedVia: [], verifiedWith: "public-source; controlled-sdk; controlled-cli",
  },
} as const;


function output(data: unknown, meta: Record<string, unknown> = {}): void {
  process.stdout.write(`${JSON.stringify({ schemaVersion: 1, ok: true, data, meta }, null, 2)}\n`);
}

function invalid(message: string): never {
  throw new FriendsError({ code: FriendsErrorCode.InvalidInput, message });
}

async function sha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function resolveMaterials(value: unknown): Promise<CertificationDraftMaterial[]> {
  const raw = value as { materials?: unknown };
  if (typeof raw !== "object" || raw === null || !Array.isArray(raw.materials)) {
    invalid("Material input must be {materials:[...]}");
  }
  const materials: CertificationDraftMaterial[] = [];
  for (const [index, item] of raw.materials.entries()) {
    const material = item as Record<string, unknown>;
    if (typeof material !== "object" || material === null) invalid("Each material must be an object");
    const id = typeof material.id === "string" && material.id !== "" ? material.id : `material-${index + 1}`;
    if (material.kind === "web-unrecoverable") {
      if (typeof material.label !== "string" || material.label === "") invalid("Web material label is required");
      materials.push({ kind: "web-unrecoverable", id, label: material.label, remoteRef: material.remoteRef ?? null });
    } else if (material.kind === "local-file") {
      if (typeof material.path !== "string" || material.path === "") invalid("Local material path is required");
      const path = resolve(material.path);
      const stat = await lstat(path).catch(() => null);
      if (stat === null || !stat.isFile() || stat.isSymbolicLink()) invalid(`Material is not a regular file: ${path}`);
      materials.push({ kind: "local-file", id, path, sha256: await sha256(path), size: stat.size });
    } else {
      invalid("Material kind must be local-file or web-unrecoverable");
    }
  }
  return materials;
}

type DraftCliPatch = VolunteerCertificationDraftPatch & { addStudentNos?: string[] };

function patch(value: unknown): DraftCliPatch {
  const raw = value as Record<string, unknown>;
  if (typeof raw !== "object" || raw === null) invalid("Draft edit input must be an object");
  const allowed = new Set(["addStudentNos", "includedStudentNos", "postIds", "durations", "materials"]);
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) invalid(`Unknown draft edit field: ${key}`);
  }
  if (raw.addStudentNos !== undefined && (!Array.isArray(raw.addStudentNos) || raw.addStudentNos.some(value => typeof value !== "string" || !value) || new Set(raw.addStudentNos).size !== raw.addStudentNos.length)) invalid("addStudentNos must be unique student numbers");
  return raw as DraftCliPatch;
}

export function registerDraftCommands(program: Command, options: { baseUrl: string }): void {
  const store = createCertificationDraftStore();
  const sdk = createFriendsSdk({ baseUrl: options.baseUrl });
  const runtimeBaseUrl = options.baseUrl;

  async function volunteerSession(queryOptions: Record<string, string | undefined> = {}) {
    const {session, entry} = await resolveQuerySession(queryOptions, options.baseUrl);
    const inspection = await sdk.verifyLocalSession(session);
    if (inspection.account.userNo !== session.account.userNo) {
      throw new FriendsError({ code: FriendsErrorCode.AuthRequired, message: "The stored account no longer matches" });
    }
    return { session, entry, accountUserNo: session.account.userNo, levelNo: session.context.levelNo, unitNo: session.context.unit.unitNo };
  }

  function client(session: Awaited<ReturnType<typeof volunteerSession>>) {
    return createVolunteerCertificationClient({
      baseUrl: options.baseUrl,
      session: {
        token: session.session.token,
        userLevel: session.session.userLevel,
        accountUserNo: session.accountUserNo,
        levelNo: session.levelNo,
        unitNo: session.unitNo,
      },
    });
  }

  const drafts = program.command("drafts").description("Local volunteer certification drafts");

  function queryOptions(command: Command): Command {
    return command.option("--via <api|ego>", "session source for direct API queries", "api")
      .option("--ego-task-space <number>", "existing Ego task space")
      .option("--ego-page <label>", "existing school page (default p1)")
      .option("--level-no <value>", "select an available school role")
      .option("--unit-no <value>", "select an available identity unit");
  }

  queryOptions(drafts.command("activities")).description("List manageable volunteer activities")
    .option("--json", "print stable JSON", true)
    .action(async (options: Record<string,string>) => {
      const context = await volunteerSession(options);
      output(await client(context).listManageableActivities(), {
        operation: "drafts.activities", via: "api", selectedEntry: context.entry, requestMode: "direct-api", verification: { activityContract: "public-source+controlled-api" },
      });
    });

  queryOptions(drafts.command("create")).description("Create a local certification draft from an authorized activity")
    .requiredOption("--activity-id <id>", "volunteer activity UUID")
    .option("--materials <file|->", "JSON file or stdin containing local material references")
    .option("--json", "print stable JSON", true)
    .action(async (options: Record<string, string>) => {
      const context = await volunteerSession(options);
      const source = await client(context).getCertificationSource(options.activityId);
      const materials = options.materials === undefined ? [] : await resolveMaterials(await readJsonInput(options.materials));
      const draft = createPartialVolunteerCertificationDraft({
        id: randomUUID(), binding: source.binding, activity: source.activity,
        registrations: source.registrations, materials,
      });
      const path = await store.save(draft);
      output({ draft, path }, {
        operation: "drafts.create", via: "api-query+local-store", selectedEntry: context.entry, requestMode: "direct-api",
        verification: { activityAndRoster: "controlled-api", remoteWrites: 0 },
      });
    });

  queryOptions(drafts.command("edit")).description("Atomically edit one draft revision")
    .argument("<draftId>", "draft ID")
    .requiredOption("--expected-revision <number>", "revision being edited")
    .requiredOption("--input <file|->", "JSON patch file or stdin")
    .option("--json", "print stable JSON", true)
    .action(async (draftId: string, options: Record<string, string>) => {
      const expectedRevision = Number(options.expectedRevision);
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
        invalid("--expected-revision must be a non-negative integer");
      }
      const current = await store.load(draftId);
      const input = patch(await readJsonInput(options.input));
      if (current.revision !== expectedRevision) {
        await store.savePatchConflict(draftId, expectedRevision, input);
      }
      const { addStudentNos, ...change } = input;
      if (addStudentNos?.length) {
        const active = client(await volunteerSession(options));
        const source = await active.getCertificationSource(current.binding.activityId);
        for (const key of ["accountUserNo", "levelNo", "unitNo", "organizationId", "activityId"] as const) {
          if (source.binding[key] !== current.binding[key]) invalid("The draft belongs to a different account, organization or activity");
        }
        change.addRegistrations = [];
        for (const studentNo of addStudentNos) {
          if (current.registrations.some(row => row.studentNo === studentNo)) invalid("The student is already in the draft");
          const student = await active.getStudent(studentNo);
          change.addRegistrations.push({ ...student, registrationId: null, postId: null, postName: null,
            postDurationHours: null, signDurationHours: null, isApplied: false, upstreamPreselected: false });
        }
      }
      const next = updateVolunteerCertificationDraft(current, {
        ...change,
        materials: input.materials === undefined ? undefined : await resolveMaterials({ materials: input.materials }),
      }, expectedRevision);
      const path = await store.save(next, { expectedRevision });
      output({ draft: next, path }, { operation: "drafts.edit", via: "local-store", verification: { remoteWrites: 0 } });
    });

  drafts.command("show").description("Show one stored draft")
    .argument("<draftId>", "draft ID")
    .option("--json", "print stable JSON", true)
    .action(async (draftId: string) => {
      output({ draft: await store.load(draftId) }, { operation: "drafts.show", via: "local-store" });
    });

  drafts.command("validate").description("Validate draft structure or submission completeness")
    .argument("<draftId>", "draft ID")
    .option("--mode <structure|complete>", "validation mode", "structure")
    .option("--json", "print stable JSON", true)
    .action(async (draftId: string, options: Record<string, string>) => {
      if (options.mode !== "structure" && options.mode !== "complete") invalid("--mode must be structure or complete");
      const draft = await store.load(draftId);
      output(validateVolunteerCertificationDraft(draft, options.mode), {
        operation: "drafts.validate", via: "local-store", verification: { remoteWrites: 0 },
      });
    });

  drafts.command("check").description("Check local material availability and hashes")
    .argument("<draftId>", "draft ID")
    .option("--json", "print stable JSON", true)
    .action(async (draftId: string) => {
      output(await store.checkMaterials(draftId), { operation: "drafts.check", via: "local-store" });
    });

  drafts.command("list").description("List local certification drafts")
    .option("--json", "print stable JSON", true)
    .action(async () => {
      output(await store.list(), { operation: "drafts.list", via: "local-store" });
    });

  queryOptions(drafts.command("prepare")).description("Fill a visible Ego certification page and hand it to the user")
    .argument("<draftId>", "draft ID")
    .option("--ego-session-page <label>", "existing school session page (default: the certification target page)")
    .option("--timeout <milliseconds>", "Ego interaction timeout", "300000")
    .option("--dry-run", "validate and inspect without filling or handoff")
    .option("--json", "print stable JSON", true)
    .action(async (draftId: string, options: Record<string, string | boolean>) => {
      if (options.via !== "ego") invalid("drafts prepare requires --via ego");
      const timeoutMs = Number(options.timeout);
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) invalid("--timeout must be a positive integer");
      const draft = await store.load(draftId);
      const sessionPage = typeof options.egoSessionPage === "string" ? options.egoSessionPage : undefined;
      const context = await volunteerSession({
        ...(options as Record<string, string | undefined>),
        egoPage: sessionPage ?? (typeof options.egoPage === "string" ? options.egoPage : undefined),
      });
      const result = await prepareVolunteerCertificationInEgo({
        draft,
        session: context.session,
        taskSpaceId: Number(options.egoTaskSpace),
        page: typeof options.egoPage === "string" ? options.egoPage : undefined,
        baseUrl: runtimeBaseUrl,
        timeoutMs,
        dryRun: options.dryRun === true,
      });
      output(result, {
        operation: "drafts.prepare",
        via: "ego-selected+visible-prepare",
        selectedEntry: context.entry,
        requestMode: "direct-api-recheck+visible-ego-prepare",
        verification: { activityAndRoster: "school-api-rechecked", finalSubmission: "human-only" },
      });
    });

  drafts.command("submit").description("Reject Ego certification submission before any side effect")
    .argument("<draftId>", "draft ID")
    .requiredOption("--via <ego>", "submission source; only the rejection path is implemented")
    .requiredOption("--ego-task-space <number>", "existing Ego task space")
    .option("--ego-page <label>", "existing school page (default p1)")
    .option("--yes", "rejected confirmation flag")
    .option("--retry", "rejected retry flag")
    .option("--api-fallback", "rejected API fallback flag")
    .option("--json", "print stable JSON", true)
    .action(async (draftId: string, options: Record<string, string | boolean>) => {
      await store.load(draftId);
      rejectVolunteerCertificationEgoSubmitInEgo({
        via: String(options.via),
        yes: options.yes === true,
        retry: options.retry === true,
        apiFallback: options.apiFallback === true,
      });
    });
}
