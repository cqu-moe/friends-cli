import type { Command } from "commander";
import { lstat, readFile } from "node:fs/promises";
import {
  createFriendsSdk,
  FriendsError,
  FriendsErrorCode,
  organizationId,
  organizationApplicationId,
  type OrganizationProfileChanges,
} from "../index.js";
import {
  prepareOrganizationApplicationDecisionInEgo,
  prepareOrganizationProfileInEgo,
} from "../node.js";
import { resolveQuerySession } from "./session.js";

export const organizationSchemas = {
  "organizations.list": {
    operation: "organizations.list",
    permission: "organizations returned for the verified school context",
    phases: ["query"],
    input: {
      via: { type: "api or ego", default: "api" },
      egoTaskSpace: { type: "integer", required: "with --via ego" },
      egoPage: { type: "string", default: "p1" },
      levelNo: { type: "string", required: "only when multiple Ego contexts match" },
      unitNo: { type: "string", required: "only when multiple Ego contexts match" },
    },
    output: "necessary organization summaries with derived access",
    readonly: true,
    supportedVia: ["api", "ego"],
    requestMode: "direct-api",
    verifiedWith: "public-source; controlled-api",
  },
  "organizations.profile.show": {
    operation: "organizations.profile.show",
    permission: "organization member or manager context; upstream enforces access",
    phases: ["query"],
    input: {
      via: { type: "api or ego", default: "api" },
      egoTaskSpace: { type: "integer", required: "with --via ego" },
      egoPage: { type: "string", default: "p1" },
      organizationId: { type: "organization UUID", required: true },
    },
    output: "necessary organization profile projection",
    readonly: true,
    supportedVia: ["api", "ego"],
    requestMode: "direct-api",
    verifiedWith: "public-source; controlled-api",
  },
  "organizations.members.list": {
    operation: "organizations.members.list",
    permission: "organization context; upstream enforces member-list access",
    phases: ["query"],
    input: {
      via: { type: "api or ego", default: "api" },
      egoTaskSpace: { type: "integer", required: "with --via ego" },
      egoPage: { type: "string", default: "p1" },
      organizationId: { type: "organization UUID", required: true },
      page: { type: "integer", minimum: 1, default: 1 },
      pageSize: { type: "integer", minimum: 1, default: 10 },
      keyword: { type: "string", upstreamField: "key" },
      postUuid: { type: "organization post UUID" },
      managerOnly: { type: "boolean", upstreamField: "isManager" },
    },
    output: "one page of necessary member projections",
    readonly: true,
    supportedVia: ["api", "ego"],
    requestMode: "direct-api",
    verifiedWith: "public-source; controlled-api",
  },
  "organizations.profile.prepare": {
    operation: "organizations.profile.prepare",
    permission: "organization profile editor returned by the school API",
    phases: ["visible-prepare"],
    input: {
      via: { type: "ego", required: true },
      egoTaskSpace: { type: "integer", required: true },
      egoPage: { type: "string", default: "p1" },
      organizationId: { type: "organization UUID", required: true },
      blurb: { type: "string", maximumLength: 1000 },
      logo: { type: "upload field; left for manual review" },
      backgroundGroupUuid: { type: "upload field; left for manual review" },
    },
    output: "an open editable page handed to the user; submitted is always false",
    readonly: false,
    remoteReadonly: true,
    sideEffect: "opens and visibly fills the production edit dialog, then hands the page to the user",
    supportedVia: ["ego-visible-prepare"],
    requestMode: "visible-ego-prepare",
    verifiedWith: "public-source; controlled-ego",
  },
  "organizations.profile.save": {
    operation: "organizations.profile.save",
    permission: "organization profile editor returned by the school API",
    phases: ["api-write"],
    input: {
      via: { type: "api", required: true },
      organizationId: { type: "organization UUID", required: true },
      changes: ["logo", "backgroundGroupUuid", "blurb"],
      input: { type: "JSON file or stdin containing only whitelisted changes" },
    },
    output: "saved profile after read-only server readback",
    readonly: false,
    remoteReadonly: false,
    confirmation: "requires independent --via api and --yes",
    sideEffect: "one confirmed profile PUT followed by one read-only GET; never retries PUT",
    supportedVia: ["api"],
    requestMode: "api-write",
    submittedViaEgo: "never",
    verifiedWith: "public-source; controlled-api",
  },
  "organizations.approvals.list": {
    operation: "organizations.approvals.list",
    permission: "organization principal or manager context returned by the school API",
    phases: ["query"],
    input: {
      via: { type: "api or ego", default: "api" },
      egoTaskSpace: { type: "integer", required: "with --via ego" },
      egoPage: { type: "string", default: "p1" },
      organizationId: { type: "organization UUID", required: true },
      type: { type: "join or exit", required: true },
      page: { type: "integer", minimum: 1, default: 1 },
      pageSize: { type: "integer", minimum: 1, default: 10 },
      keyword: { type: "string", upstreamField: "key" },
    },
    output: "one page of necessary join/exit application projections",
    readonly: true,
    supportedVia: ["api", "ego"],
    requestMode: "direct-api",
    verifiedWith: "public-source; controlled-api",
  },
  "organizations.approvals.show": {
    operation: "organizations.approvals.show",
    permission: "organization principal or manager context returned by the school API",
    phases: ["query"],
    input: {
      via: { type: "api or ego", default: "api" },
      egoTaskSpace: { type: "integer", required: "with --via ego" },
      egoPage: { type: "string", default: "p1" },
      applicationId: { type: "organization application UUID", required: true },
      type: { type: "join or exit", required: true },
    },
    output: "application projection plus the first current join-exit relation",
    readonly: true,
    supportedVia: ["api", "ego"],
    requestMode: "direct-api",
    verifiedWith: "public-source; controlled-api",
  },
  "organizations.approvals.prepare": {
    operation: "organizations.approvals.prepare",
    permission: "organization principal or manager context returned by the school API",
    phases: ["visible-prepare"],
    input: {
      via: { type: "ego", required: true },
      egoTaskSpace: { type: "integer", required: true },
      egoPage: { type: "string", default: "p1" },
      organizationId: { type: "organization UUID", required: true },
      applicationId: { type: "organization application UUID", required: true },
      type: { type: "join or exit", required: true },
      decision: { type: "approve or reject", required: true },
      message: { type: "string, maximumLength 100, required" },
      time: { type: "yyyy-MM-dd, required" },
    },
    output: "an open review dialog handed to the user; submitted is always false",
    readonly: false,
    remoteReadonly: true,
    sideEffect: "opens the production review dialog and fills only an empty opinion field, then hands off",
    supportedVia: ["ego-visible-prepare"],
    requestMode: "visible-ego-prepare",
    verifiedWith: "public-source; controlled-ego",
  },
  "organizations.approvals.decide": {
    operation: "organizations.approvals.decide",
    permission: "organization principal or manager context returned by the school API",
    phases: ["validate", "api-write", "readback"],
    input: {
      via: { type: "api", required: true },
      organizationId: { type: "organization UUID", required: true },
      applicationId: { type: "organization application UUID", required: true },
      type: { type: "join or exit", required: true },
      decision: { type: "approve or reject", required: true },
      message: { type: "string, maximumLength 100, required" },
      time: { type: "yyyy-MM-dd, required" },
      input: { type: "JSON file or stdin containing only message and time" },
      dryRun: { type: "boolean" },
      yes: { type: "boolean" },
    },
    output: "confirmed decision plus pending-state and relation readback",
    readonly: false,
    remoteReadonly: false,
    confirmation: "requires independent --via api and --yes",
    sideEffect: "one confirmed approval POST followed by read-only pending and relation checks; never retries POST",
    supportedVia: ["api"],
    requestMode: "api-write",
    submittedViaEgo: "never",
    verifiedWith: "public-source; controlled-api",
  },
} as const;

const maximumInputBytes = 1024 * 1024;
const allowedChanges = new Set(["logo", "backgroundGroupUuid", "blurb"]);

function output(data: unknown, meta: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify({ schemaVersion: 1, ok: true, data, meta }, null, 2)}\n`);
}

function invalid(message: string): never {
  throw new FriendsError({ code: FriendsErrorCode.InvalidInput, message });
}

async function readInput(source: string | undefined): Promise<unknown> {
  if (source === undefined) return {};
  let text: string;
  if (source === "-") {
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const chunk of process.stdin) {
      const buffer = chunk as Buffer;
      length += buffer.length;
      if (length > maximumInputBytes) invalid("Organization input exceeds 1 MiB");
      chunks.push(buffer);
    }
    text = Buffer.concat(chunks).toString("utf8");
  } else {
    const stat = await lstat(source).catch(() => null);
    if (stat === null || !stat.isFile() || stat.isSymbolicLink()) {
      invalid("Organization input must be a regular file or stdin");
    }
    text = await readFile(source, "utf8");
    if (Buffer.byteLength(text) > maximumInputBytes) invalid("Organization input exceeds 1 MiB");
  }
  try {
    return JSON.parse(text);
  } catch {
    invalid("Organization input must be valid JSON");
  }
}

function changesFromInput(value: unknown): OrganizationProfileChanges {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid("Organization profile changes must be an object");
  }
  for (const key of Object.keys(value)) {
    if (!allowedChanges.has(key)) invalid(`Unknown organization profile field: ${key}`);
  }
  return value as OrganizationProfileChanges;
}

function collectChanges(
  options: Record<string, string | boolean | undefined>,
  inputValue: unknown,
): OrganizationProfileChanges {
  const inputChanges = changesFromInput(inputValue);
  const changes: OrganizationProfileChanges = {};
  for (const key of allowedChanges) {
    const flagValue = options[key];
    if (flagValue !== undefined) {
      if (typeof flagValue !== "string") invalid(`--${key} must be a string`);
      changes[key as keyof OrganizationProfileChanges] = flagValue;
    } else if (inputChanges[key as keyof OrganizationProfileChanges] !== undefined) {
      changes[key as keyof OrganizationProfileChanges] =
        inputChanges[key as keyof OrganizationProfileChanges] as string;
    }
  }
  return changes;
}

function collectDecisionFields(
  options: Record<string, string | boolean | undefined>,
  inputValue: unknown,
): { message?: string; time?: string } {
  if (inputValue !== undefined) {
    if (typeof inputValue !== "object" || inputValue === null || Array.isArray(inputValue)) {
      invalid("Organization application decision input must be an object");
    }
    for (const key of Object.keys(inputValue)) {
      if (!["message", "time"].includes(key)) {
        invalid(`Unknown organization application decision field: ${key}`);
      }
    }
  }
  const rawInput = inputValue as Record<string, unknown> | undefined;
  const result: { message?: string; time?: string } = {};
  for (const key of ["message", "time"] as const) {
    const flagValue = options[key];
    const inputValueField = rawInput?.[key];
    if (flagValue !== undefined) {
      if (typeof flagValue !== "string") invalid(`--${key} must be a string`);
      result[key] = flagValue;
    } else if (inputValueField !== undefined) {
      if (typeof inputValueField !== "string") invalid(`${key} must be a string`);
      result[key] = inputValueField;
    }
  }
  return result;
}

function positiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) invalid(`--${name} must be a positive integer`);
  return parsed;
}

function queryOptions(command: Command): Command {
  return command
    .option("--via <source>", "session source for direct API queries", "api")
    .option("--ego-task-space <number>", "existing Ego task space required by --via ego")
    .option("--ego-page <label>", "existing school page (default p1)")
    .option("--level-no <value>", "select an available school role")
    .option("--unit-no <value>", "select an available identity unit");
}

export function registerOrganizationCommands(program: Command, options: { baseUrl: string }): void {
  const sdk = createFriendsSdk({ baseUrl: options.baseUrl });
  const organizations = program
    .command("organizations")
    .description("managed student organizations");

  async function context(queryOptionsValue: Record<string, string | undefined>) {
    const source = await resolveQuerySession(queryOptionsValue, options.baseUrl);
    const client = await sdk.createOrganizationClient(source.session);
    return { source, client };
  }

  function directApiMeta(operation: string, entry: "api" | "ego") {
    return {
      operation,
      via: entry,
      selectedEntry: entry,
      requestMode: "direct-api",
      verification: { organizationContract: "public-source+controlled-api" },
    };
  }

  queryOptions(organizations.command("list"))
    .description("List organizations returned for the current account")
    .option("--json", "print stable JSON", true)
    .action(async (commandOptions: Record<string, string | undefined>) => {
      const { source, client } = await context(commandOptions);
      const items = await client.listManaged();
      output({ items }, directApiMeta("organizations.list", source.entry));
    });

  const profile = organizations.command("profile").description("Organization profile queries and controlled edits");

  queryOptions(profile.command("show"))
    .description("Show one organization profile")
    .argument("<organizationId>", "organization UUID")
    .option("--json", "print stable JSON", true)
    .action(async (organizationIdValue: string, commandOptions: Record<string, string | undefined>) => {
      const { source, client } = await context(commandOptions);
      const profileValue = await client.get(organizationId(organizationIdValue));
      output(profileValue, directApiMeta("organizations.profile.show", source.entry));
    });

  profile.command("prepare")
    .description("Open the production profile dialog in Ego and hand it to the user")
    .argument("<organizationId>", "organization UUID")
    .requiredOption("--via <source>", "visible preparation source", "ego")
    .requiredOption("--ego-task-space <number>", "existing Ego task space")
    .option("--ego-page <label>", "existing school page (default p1)")
    .option("--level-no <value>", "select an available school role")
    .option("--unit-no <value>", "select an available identity unit")
    .option("--blurb <text>", "organization introduction to fill before handoff")
    .option("--logo <value>", "logo value to record; upload remains manual in Ego")
    .option("--background-group-uuid <value>", "background value to record; upload remains manual in Ego")
    .option("--input <file|->", "JSON file or stdin containing whitelisted changes")
    .option("--json", "print stable JSON", true)
    .action(async (organizationIdValue: string, commandOptions: Record<string, string | undefined>) => {
      if (commandOptions.via !== "ego") invalid("Organization profile preparation requires --via ego");
      const taskSpaceId = Number(commandOptions.egoTaskSpace);
      if (!Number.isSafeInteger(taskSpaceId) || taskSpaceId < 1) {
        invalid("--ego-task-space must be a positive integer");
      }
      const changes = collectChanges(commandOptions, await readInput(commandOptions.input));
      const { source, client } = await context(commandOptions);
      const prepared = await client.prepareProfileUpdate({
        organizationId: organizationId(organizationIdValue),
        changes,
      });
      const query = new URLSearchParams({
        uuid: prepared.organizationId,
        type: prepared.editRoute.query.type,
      });
      const route = `/mobile${prepared.editRoute.path}?${query.toString()}`;
      const ego = await prepareOrganizationProfileInEgo({
        taskSpaceId,
        page: commandOptions.egoPage,
        route,
        blurb: changes.blurb,
      });
      const manualFields = (["logo", "backgroundGroupUuid"] as const)
        .filter((field) => changes[field] !== undefined);
      output(
        {
          status: "awaiting-user",
          submitted: false,
          organizationId: prepared.organizationId,
          changes: prepared.changes,
          editRoute: prepared.editRoute,
          manualFields,
          ego,
        },
        {
          operation: "organizations.profile.prepare",
          via: source.entry,
          requestMode: "visible-ego-prepare",
          verification: {
            organizationContract: "public-source+controlled-api",
            finalSubmission: "user-only",
          },
        },
      );
    });

  profile.command("save")
    .description("Confirm and save whitelisted organization profile fields through the API")
    .argument("<organizationId>", "organization UUID")
    .requiredOption("--via <source>", "independent API write intent")
    .option("--blurb <text>", "organization introduction")
    .option("--logo <value>", "organization logo")
    .option("--background-group-uuid <value>", "organization background group UUID")
    .option("--input <file|->", "JSON file or stdin containing whitelisted changes")
    .requiredOption("--yes", "confirm one organization profile write")
    .option("--json", "print stable JSON", true)
    .action(async (organizationIdValue: string, commandOptions: Record<string, string | undefined>) => {
      if (commandOptions.via !== "api") invalid("Organization profile saving requires --via api");
      const changes = collectChanges(commandOptions, await readInput(commandOptions.input));
      const { client } = await context({ via: "api" });
      const prepared = await client.prepareProfileUpdate({
        organizationId: organizationId(organizationIdValue),
        changes,
      });
      const saved = await client.saveProfile(prepared, {
        via: "api",
        intent: "save-organization-profile",
        confirm: true,
      });
      output(saved, {
        operation: "organizations.profile.save",
        via: "api",
        requestMode: "api-write",
        verification: { serverReadback: true, putRetries: 0 },
      });
    });

  const approvals = organizations.command("approvals").description("organization application reviews");

  queryOptions(approvals.command("list"))
    .description("List one page of join or exit applications")
    .argument("<organizationId>", "organization UUID")
    .requiredOption("--type <type>", "join or exit application")
    .option("--page <number>", "result page", "1")
    .option("--page-size <number>", "results per page", "10")
    .option("--keyword <value>", "student name or number keyword")
    .option("--json", "print stable JSON", true)
    .action(async (organizationIdValue: string, commandOptions: Record<string, string | undefined>) => {
      if (commandOptions.type !== "join" && commandOptions.type !== "exit") {
        invalid("--type must be join or exit");
      }
      const { source, client } = await context(commandOptions);
      const items = await client.listApplications(organizationId(organizationIdValue), commandOptions.type, {
        page: positiveInteger(String(commandOptions.page), "page"),
        pageSize: positiveInteger(String(commandOptions.pageSize), "page-size"),
        keyword: commandOptions.keyword,
      });
      output(items, directApiMeta("organizations.approvals.list", source.entry));
    });

  queryOptions(approvals.command("show"))
    .description("Show one application and its current relation")
    .argument("<applicationId>", "organization application UUID")
    .requiredOption("--type <type>", "join or exit application")
    .option("--json", "print stable JSON", true)
    .action(async (applicationIdValue: string, commandOptions: Record<string, string | undefined>) => {
      if (commandOptions.type !== "join" && commandOptions.type !== "exit") {
        invalid("--type must be join or exit");
      }
      const { source, client } = await context(commandOptions);
      const detail = await client.getApplication(
        commandOptions.type,
        organizationApplicationId(applicationIdValue),
      );
      output(detail, directApiMeta("organizations.approvals.show", source.entry));
    });

  queryOptions(approvals.command("prepare"))
    .description("Open one review decision in Ego and hand it to the user")
    .argument("<organizationId>", "organization UUID")
    .argument("<applicationId>", "organization application UUID")
    .requiredOption("--type <type>", "join or exit application")
    .requiredOption("--decision <decision>", "approve or reject")
    .option("--message <text>", "review opinion to fill only when the field is empty")
    .option("--time <date>", "review date recorded for API preparation; Ego date remains human-reviewable")
    .option("--input <file|->", "JSON file or stdin containing message and time")
    .option("--yes", "rejected because Ego preparation never submits")
    .option("--json", "print stable JSON", true)
    .action(async (
      organizationIdValue: string,
      applicationIdValue: string,
      commandOptions: Record<string, string | boolean | undefined>,
    ) => {
      if (commandOptions.via !== "ego") {
        invalid("Organization application preparation requires --via ego");
      }
      if (commandOptions.yes === true) {
        invalid("Ego preparation never authorizes or performs final submission");
      }
      if (commandOptions.type !== "join" && commandOptions.type !== "exit") {
        invalid("--type must be join or exit");
      }
      if (commandOptions.decision !== "approve" && commandOptions.decision !== "reject") {
        invalid("--decision must be approve or reject");
      }
      const taskSpaceId = Number(commandOptions.egoTaskSpace);
      if (!Number.isSafeInteger(taskSpaceId) || taskSpaceId < 1) {
        invalid("--ego-task-space must be a positive integer");
      }
      const fields = collectDecisionFields(
        commandOptions,
        commandOptions.input === undefined ? undefined : await readInput(String(commandOptions.input)),
      );
      if (fields.message === undefined) invalid("--message or input.message is required");
      if (fields.time === undefined) invalid("--time or input.time is required");
      const applicationType = commandOptions.type as "join" | "exit";
      const applicationDecision = commandOptions.decision as "approve" | "reject";
      const { source, client } = await context(commandOptions as Record<string, string | undefined>);
      const prepared = await client.prepareApplicationDecision({
        organizationId: organizationId(organizationIdValue),
        applicationId: organizationApplicationId(applicationIdValue),
        type: applicationType,
        decision: applicationDecision,
        message: fields.message,
        time: fields.time,
      });
      const path = applicationType === "join"
        ? "/mobile/groupManage/studentApprovalJoinDetail"
        : "/mobile/groupManage/studentApprovalExitDetail";
      const route = `${path}?${new URLSearchParams({ uuid: prepared.applicationId }).toString()}`;
      const ego = await prepareOrganizationApplicationDecisionInEgo({
        taskSpaceId,
        page: commandOptions.egoPage as string | undefined,
        route,
        applicationId: prepared.applicationId,
        type: applicationType,
        decision: applicationDecision,
        message: fields.message,
      });
      output(
        {
          status: "awaiting-user",
          submitted: false,
          organizationId: prepared.organizationId,
          applicationId: prepared.applicationId,
          type: prepared.type,
          decision: prepared.decision,
          message: prepared.message,
          time: prepared.time,
          relation: prepared.relation,
          ego,
        },
        {
          operation: "organizations.approvals.prepare",
          via: source.entry,
          requestMode: "visible-ego-prepare",
          verification: {
            organizationContract: "public-source+controlled-api",
            finalSubmission: "user-only",
          },
        },
      );
    });

  approvals.command("decide")
    .description("Preview or confirm one join/exit application decision")
    .argument("<organizationId>", "organization UUID")
    .argument("<applicationId>", "organization application UUID")
    .requiredOption("--type <type>", "join or exit application")
    .requiredOption("--decision <decision>", "approve or reject")
    .requiredOption("--via <source>", "independent API write intent")
    .option("--message <text>", "review opinion")
    .option("--time <date>", "review date in yyyy-MM-dd format")
    .option("--input <file|->", "JSON file or stdin containing message and time")
    .option("--dry-run", "validate and read school state without a write")
    .option("--yes", "confirm one organization application decision")
    .option("--json", "print stable JSON", true)
    .action(async (
      organizationIdValue: string,
      applicationIdValue: string,
      commandOptions: Record<string, string | boolean | undefined>,
    ) => {
      if (commandOptions.type !== "join" && commandOptions.type !== "exit") {
        invalid("--type must be join or exit");
      }
      if (commandOptions.decision !== "approve" && commandOptions.decision !== "reject") {
        invalid("--decision must be approve or reject");
      }
      if (commandOptions.via !== "api") {
        invalid("Organization application decisions require --via api");
      }
      if (commandOptions.dryRun === true && commandOptions.yes === true) {
        invalid("Use either --dry-run or --yes, not both");
      }
      if (commandOptions.dryRun !== true && commandOptions.yes !== true) {
        invalid("Organization application decisions require --yes unless --dry-run is used");
      }
      const fields = collectDecisionFields(
        commandOptions,
        commandOptions.input === undefined ? undefined : await readInput(String(commandOptions.input)),
      );
      if (fields.message === undefined) invalid("--message or input.message is required");
      if (fields.time === undefined) invalid("--time or input.time is required");
      const applicationType = commandOptions.type as "join" | "exit";
      const applicationDecision = commandOptions.decision as "approve" | "reject";
      const input = {
        organizationId: organizationId(organizationIdValue),
        applicationId: organizationApplicationId(applicationIdValue),
        type: applicationType,
        decision: applicationDecision,
        message: fields.message,
        time: fields.time,
      };
      const { client } = await context({ via: "api" });
      const prepared = await client.prepareApplicationDecision(input);
      if (commandOptions.dryRun === true) {
        output(prepared, {
          operation: "organizations.approvals.decide",
          via: "api",
          requestMode: "dry-run",
          verification: { remoteWrites: 0 },
        });
        return;
      }
      const decided = await client.decideApplication(prepared, {
        via: "api",
        intent: "decide-organization-application",
        confirm: true,
      });
      output(decided, {
        operation: "organizations.approvals.decide",
        via: "api",
        requestMode: "api-write",
        verification: { pendingReadback: true, relationReadback: true, postRetries: 0 },
      });
    });

  queryOptions(organizations.command("members"))
    .description("List one page of organization members")
    .argument("<organizationId>", "organization UUID")
    .option("--page <number>", "result page", "1")
    .option("--page-size <number>", "results per page", "10")
    .option("--keyword <value>", "student name or number keyword")
    .option("--post-uuid <uuid>", "organization post UUID")
    .option("--manager-only", "include only managers")
    .option("--json", "print stable JSON", true)
    .action(async (
      organizationIdValue: string,
      commandOptions: Record<string, string | boolean | undefined>,
    ) => {
      const { source, client } = await context(commandOptions as Record<string, string | undefined>);
      const members = await client.listMembers(organizationId(organizationIdValue), {
        page: positiveInteger(String(commandOptions.page), "page"),
        pageSize: positiveInteger(String(commandOptions.pageSize), "page-size"),
        keyword: commandOptions.keyword as string | undefined,
        postUuid: commandOptions.postUuid as string | undefined,
        managerOnly: commandOptions.managerOnly === true,
      });
      output(members, directApiMeta("organizations.members.list", source.entry));
    });
}
