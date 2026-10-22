import type { Command } from "commander";
import { createOrganizationActivityReviewClient, validateOrganizationActivityReviewInput, FriendsError, FriendsErrorCode, type OrganizationOfferingReviewInput, type OrganizationRegistrationReviewInput } from "../index.js";
import { resolveQuerySession } from "./session.js";
import { readJsonInput } from "./json-input.js";
import { prepareOrganizationActivityReviewInEgo } from "../node.js";

const querySchema = { readonly: true, phases: ["query"], supportedVia: ["api", "ego"], requestMode: "direct-api", permission: "fresh school role, organization scope and domain-specific pending list", verification: { source: "2026-10-22 public production chunks", controlled: "SDK and real CLI subprocesses", liveEgo: false, liveAuthenticatedRead: false, liveApiWrite: false, humanSubmit: false } };
export const organizationActivityReviewSchemas = Object.fromEntries((["offering", "registration"] as const).flatMap(kind => {
  const input = { organization: "required organization UUID", ...(kind === "registration" ? { activity: "required activity UUID, distinct from registration UUID" } : {}) };
  return (["list", "show", "verify", "prepare", "decide"] as const).map(operation => [`organization-activities.${kind}-reviews.${operation}`, {
    ...querySchema, requestMode: operation === "prepare" ? "visible-ego-prepare" : operation === "decide" ? "api-write" : "direct-api", input: { ...input, ...(operation === "list" ? { page: "positive integer", pageSize: "integer 1-100", keyword: "optional string" } : { id: kind === "offering" ? "existing offering application UUID" : "existing registration UUID" }), ...(operation === "prepare" || operation === "decide" ? { decision: kind === "offering" ? "pass|back|refuse" : "pass|refuse", input: "JSON file or stdin: message (1-100), time (YYYY-MM-DD); offering back/refuse optionally callbackActivityId", via: "explicit and independent of confirmation" } : {}) },
    ...(operation === "prepare" ? { readonly: false, supportedVia: ["ego"], phases: ["dry-run", "visible-prepare", "human-final-submit"], submittedViaEgo: "never" } : {}),
    ...(operation === "decide" ? { readonly: false, supportedVia: ["api"], phases: ["dry-run", ...(kind === "offering" ? ["save-existing-form-before-pass"] : []), "explicit-api-write", "readback"], confirmation: "requires independent --via api and --yes unless --dry-run", unknownOutcome: "exit 7; no retries or next write even if readback matches" } : {}),
  }]);
}));
function invalid(message: string): never { throw new FriendsError({ code: FriendsErrorCode.InvalidInput, message }); }
function output(data: unknown, operation: string, via: string, requestMode: string) {
  process.stdout.write(JSON.stringify({ schemaVersion: 1, ok: true, data, meta: { operation, via, selectedEntry: via, requestMode } }) + "\n");
}
export function registerOrganizationActivityReviewCommands(program: Command, { baseUrl }: { baseUrl: string }) {
  const parent = program.commands.find(command => command.name() === "organization-activities") ?? program.command("organization-activities");
  for (const kind of ["offering", "registration"] as const) {
    const group = parent.command(kind + "-reviews").description(`Review existing organization activity ${kind} applications`);
    function options(command: Command, write = false) {
      command.requiredOption("--organization <uuid>", "organization approval scope");
      if (kind === "registration") command.requiredOption("--activity <uuid>", "activity UUID, distinct from registration UUID");
      if (write) command.requiredOption("--via <source>", "explicit API decision or visible Ego preparation");
      else command.option("--via <source>", "verified session source", "api");
      return command.option("--ego-task-space <number>", "existing Ego task space").option("--ego-page <label>", "existing page label").option("--level-no <value>", "Ego school role selector").option("--unit-no <value>", "Ego unit selector").option("--timeout <milliseconds>", "request or Ego preparation timeout", "60000").option("--json", "versioned single JSON output", true);
    }
    const ids = (opts: Record<string, string>, reviewId?: string) => ({ organizationId: opts.organization, ...(kind === "registration" ? { activityId: opts.activity } : {}), ...(reviewId ? { id: reviewId } : {}) });
    const timeout = (opts: Record<string, string>) => { const value = Number(opts.timeout); if (!Number.isSafeInteger(value) || value < 1) invalid("--timeout must be a positive integer"); return value; };
    async function context(opts: Record<string, string>) {
      const timeoutMs = timeout(opts), source = await resolveQuerySession(opts, baseUrl);
      return { source, client: createOrganizationActivityReviewClient({ baseUrl, session: source.session, timeoutMs }) };
    }
    options(group.command("list")).option("--page <number>", "page", "1").option("--page-size <number>", "page size (1-100)", "10").option("--keyword <text>", "school keyword filter").action(async opts => {
      const { client, source } = await context(opts);
      const input = { ...ids(opts), page: Number(opts.page), pageSize: Number(opts.pageSize), keyword: opts.keyword };
      const result = kind === "offering" ? await client.offering.list(input) : await client.registration.list({ ...input, activityId: opts.activity });
      output(result, `organization-activities.${kind}-reviews.list`, source.entry, "direct-api");
    });
    for (const operation of ["show", "verify"] as const) options(group.command(operation).argument("<id>", "domain-specific application UUID")).action(async (reviewId, opts) => {
      const { client, source } = await context(opts), input = { ...ids(opts, reviewId), id: reviewId };
      const result = kind === "offering" ? await client.offering[operation === "show" ? "get" : "verify"](input) : await client.registration[operation === "show" ? "get" : "verify"]({ ...input, activityId: opts.activity });
      output(result, `organization-activities.${kind}-reviews.${operation}`, source.entry, "direct-api");
    });
    async function reviewInput(reviewId: string, opts: Record<string, string>) {
      const fields = await readJsonInput(opts.input);
      if (!fields || typeof fields !== "object" || Array.isArray(fields) || Object.keys(fields).some(key => !["message", "time", ...(kind === "offering" ? ["callbackActivityId"] : [])].includes(key))) invalid("Unsupported review JSON fields");
      const input = { ...fields, ...ids(opts, reviewId), id: reviewId, decision: opts.decision } as OrganizationOfferingReviewInput | OrganizationRegistrationReviewInput;
      validateOrganizationActivityReviewInput(kind, input);
      return input;
    }
    options(group.command("prepare").argument("<id>", "existing application UUID"), true).requiredOption("--decision <value>", kind === "offering" ? "pass, back or refuse" : "pass or refuse").requiredOption("--input <file|->", "review opinion and date JSON").option("--dry-run", "preview without changing any visible controls").action(async (reviewId, opts) => {
      if (opts.via !== "ego") invalid("prepare requires --via ego");
      if (opts.levelNo !== undefined || opts.unitNo !== undefined) invalid("Select the intended school identity in Ego before preparation");
      const result = await prepareOrganizationActivityReviewInEgo({ kind, input: await reviewInput(reviewId, opts), taskSpaceId: Number(opts.egoTaskSpace), page: opts.egoPage, baseUrl, timeoutMs: timeout(opts), dryRun: Boolean(opts.dryRun) });
      output(result, `organization-activities.${kind}-reviews.prepare`, "ego", opts.dryRun ? "dry-run" : "visible-ego-prepare");
    });
    options(group.command("decide").argument("<id>", "existing application UUID"), true).requiredOption("--decision <value>", kind === "offering" ? "pass, back or refuse" : "pass or refuse").requiredOption("--input <file|->", "review opinion and date JSON").option("--dry-run", "validate and preview without business writes").option("--yes", "confirm explicit API decision").action(async (reviewId, opts) => {
      if (opts.via !== "api") invalid("decide requires explicit --via api; Ego supports prepare only");
      if (!opts.dryRun && !opts.yes) invalid("API decision requires --yes or --dry-run");
      const input = await reviewInput(reviewId, opts);
      const { client } = await context(opts);
      const plan = kind === "offering" ? await client.offering.prepare(input as OrganizationOfferingReviewInput) : await client.registration.prepare(input as OrganizationRegistrationReviewInput);
      const result = opts.dryRun ? { ...plan, dryRun: true } : kind === "offering" ? await client.offering.decide(plan, { via: "api", intent: "decide-organization-offering-review", confirm: true }) : await client.registration.decide(plan, { via: "api", intent: "decide-organization-registration-review", confirm: true });
      output(result, `organization-activities.${kind}-reviews.decide`, "api", opts.dryRun ? "dry-run" : "api-write");
    });
  }
}
