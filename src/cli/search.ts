import type { Command } from "commander";
import { createUnifiedSearchClient, validateUnifiedSearchInput, FriendsError, FriendsErrorCode, exitCodeFor, type UnifiedSearchInput, type SearchType } from "../index.js";
import { resolveQuerySession } from "./session.js";
import { readJsonInput } from "./json-input.js";

export const searchSchemas = {
  search: {
    operation: "search", readonly: true, phases: ["query"], supportedVia: ["api", "ego"], requestMode: "direct-api",
    permission: "one school-verified account and fixed identity context; each domain enforces visibility",
    input: {
      keyword: "optional server keyword; no local filtering", type: "comma-separated course,volunteer,organization-activity; defaults to all",
      page: "positive start page for each selected type; default 1", pageSize: "1-100; default 10", maxPages: "page budget 1-20 per type; default 1",
      input: "JSON file or stdin (-): {keyword?,types?,pagination?:{[type]:{page?,pageSize?,maxPages?}}}; exclusive with query flags",
      via: "api (stored session) or ego (existing page session)", egoTaskSpace: "required positive integer for ego", egoPage: "existing page label, default p1",
    },
    output: "typed domain IDs and detail operations, original records, independent page metadata, budgets, completeness and errors; no global total/rank/next page",
    sideEffects: "identity verification/activation only; no business writes, DOM clicks or identity fallback",
    failure: "partial sources: explicit status and stderr, exit 0; all failed: ok=false with source data and common error exit code, mixed errors exit 6",
    verification: { controlled: "public SDK and real CLI subprocesses", liveEgo: false, liveAuthenticatedRead: false, liveWrites: false },
  },
};
function invalid(message: string): never { throw new FriendsError({ code: FriendsErrorCode.InvalidInput, message }); }
export function registerSearchCommand(program: Command, { baseUrl }: { baseUrl: string }) {
  program.command("search").description("Search courses, volunteer services and organization activities with separate pagination")
    .option("--keyword <text>", "server keyword for each selected domain")
    .option("--type <types>", "comma-separated course,volunteer,organization-activity")
    .option("--page <number>", "starting page for each selected type (default 1)")
    .option("--page-size <number>", "items per source page, 1-100 (default 10)")
    .option("--max-pages <number>", "maximum pages per selected type, 1-20 (default 1)")
    .option("--input <file|->", "query JSON with independent per-type pagination")
    .option("--via <source>", "query session source", "api")
    .option("--ego-task-space <number>", "existing Ego task space")
    .option("--ego-page <label>", "existing Ego page label")
    .option("--level-no <value>", "explicit Ego role selector")
    .option("--unit-no <value>", "explicit Ego unit selector")
    .option("--json", "single versioned JSON output", true)
    .action(async opts => {
      let input: UnifiedSearchInput;
      if (opts.input !== undefined) {
        if ([opts.keyword, opts.type, opts.page, opts.pageSize, opts.maxPages].some(value => value !== undefined)) invalid("--input cannot be combined with search query flags");
        input = await readJsonInput(opts.input) as UnifiedSearchInput;
      } else {
        const selected = validateUnifiedSearchInput({ keyword: opts.keyword, types: opts.type === undefined ? undefined : opts.type.split(",").map((type: string) => type.trim()) as SearchType[] });
        const pagination = { ...(opts.page !== undefined ? { page: Number(opts.page) } : {}), ...(opts.pageSize !== undefined ? { pageSize: Number(opts.pageSize) } : {}), ...(opts.maxPages !== undefined ? { maxPages: Number(opts.maxPages) } : {}) };
        input = { keyword: selected.keyword, types: selected.types, pagination: Object.fromEntries(selected.types.map(type => [type, pagination])) };
      }
      const query = validateUnifiedSearchInput(input), source = await resolveQuerySession(opts, baseUrl);
      const result = await createUnifiedSearchClient({ baseUrl, session: source.session }).search(query);
      const errors = result.sources.flatMap(source => source.error ? [source.error] : []);
      const code = errors.length > 0 && errors.every(error => error.code === errors[0].code) ? errors[0].code : FriendsErrorCode.NetworkProtocol;
      const error = result.status === "failed" ? { code, message: "All selected search sources failed; inspect data.sources", retryable: false } : undefined;
      process.stdout.write(JSON.stringify({ schemaVersion: 1, ok: !error, data: result, ...(error ? { error } : {}), meta: { operation: "search", via: source.entry === "ego" ? "ego-selected+direct-api" : "api", selectedEntry: source.entry, credentialSource: source.entry === "ego" ? "existing-ego-session" : "stored-session", requestMode: "direct-api", account: result.account, context: result.context } }) + "\n");
      if (result.status !== "ok") process.stderr.write(error?.message ?? "Some search sources failed; inspect data.sources for partial results");
      if (error) process.exitCode = exitCodeFor(error.code);
    });
}
