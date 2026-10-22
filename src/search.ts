import { createFriendsSdk, createOrganizationParticipationClient, type CourseSummary, type VolunteerActivitySummary, type VerifiedCourseSession } from "./index.js";
import { FriendsError, FriendsErrorCode } from "./errors.js";

export type SearchType = "course" | "volunteer" | "organization-activity";
export interface SearchPagination { page?: number; pageSize?: number; maxPages?: number }
export interface UnifiedSearchInput {
  keyword?: string;
  types?: SearchType[];
  pagination?: Partial<Record<SearchType, SearchPagination>>;
}
type OrganizationSearchRecord = Awaited<ReturnType<ReturnType<typeof createOrganizationParticipationClient>["list"]>>["items"][number];
export type SearchRecord = CourseSummary | VolunteerActivitySummary | OrganizationSearchRecord;
export interface SearchItem {
  type: SearchType;
  id: string;
  name: string | null;
  record: SearchRecord;
  detail: { operation: "courses.get" | "volunteers.activities.show" | "organization-participation.show"; id: string };
}
export interface SearchPage { page: number; pageSize: number; totalCount: number | null; hasMore: boolean | null }
export interface SearchSourceResult {
  type: SearchType;
  status: "ok" | "partial" | "failed";
  items: SearchItem[];
  requested: Required<SearchPagination>;
  pages: SearchPage[];
  nextPage: number | null;
  complete: boolean | null;
  stoppedBecause: "end" | "budget" | "unknown-pagination" | "failure";
  budget: { maxPages: number; pagesRequested: number; pagesRead: number; exhausted: boolean };
  error: { code: FriendsErrorCode; message: string; retryable: boolean; upstreamCode?: string } | null;
}
export interface UnifiedSearchResult {
  keyword: string;
  status: "ok" | "partial" | "failed";
  complete: boolean;
  account: { userNo: string };
  context: { levelNo: string; unit: { unitNo: string } };
  sources: SearchSourceResult[];
}
export interface UnifiedSearchClientOptions { baseUrl?: string; session: VerifiedCourseSession; fetch?: typeof fetch; timeoutMs?: number }
export interface UnifiedSearchClient { search(input?: UnifiedSearchInput): Promise<UnifiedSearchResult> }
const types: SearchType[] = ["course", "volunteer", "organization-activity"];
const details = { course: "courses.get", volunteer: "volunteers.activities.show", "organization-activity": "organization-participation.show" } as const;
function invalid(message: string): never { throw new FriendsError({ code: FriendsErrorCode.InvalidInput, message }); }
function protocol(message: string): never { throw new FriendsError({ code: FriendsErrorCode.NetworkProtocol, message }); }
function object(value: unknown): boolean { return value !== null && typeof value === "object" && !Array.isArray(value); }

export function validateUnifiedSearchInput(input: UnifiedSearchInput = {}) {
  if (!object(input) || Object.keys(input).some(key => !["keyword", "types", "pagination"].includes(key))) invalid("Unsupported search input; only keyword, types and per-type pagination are supported");
  const { keyword = "", types: selected = types, pagination = {} } = input;
  if (typeof keyword !== "string") invalid("Search keyword must be a string");
  if (!Array.isArray(selected) || selected.length === 0 || new Set(selected).size !== selected.length || selected.some(type => !types.includes(type))) invalid("Search types must be distinct course, volunteer or organization-activity values");
  if (!object(pagination) || Object.keys(pagination).some(type => !selected.includes(type as SearchType))) invalid("Pagination must only name selected search types");
  const normalized = {} as Record<SearchType, Required<SearchPagination>>;
  for (const type of selected) {
    const configured = pagination[type], value = configured === undefined ? {} : configured;
    if (!object(value) || Object.keys(value).some(key => !["page", "pageSize", "maxPages"].includes(key))) invalid("Unsupported search pagination field");
    const { page = 1, pageSize = 10, maxPages = 1 } = value;
    if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100 || !Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 20 || !Number.isSafeInteger(page + maxPages)) invalid("Search requires a positive page, pageSize 1-100 and maxPages 1-20");
    normalized[type] = { page, pageSize, maxPages };
  }
  return { keyword, types: [...selected], pagination: normalized };
}

export function createUnifiedSearchClient(options: UnifiedSearchClientOptions): UnifiedSearchClient {
  const baseUrl = options.baseUrl ?? "https://friends.cqu.edu.cn/gateway", session = structuredClone(options.session);
  const sdk = createFriendsSdk({ baseUrl, fetch: options.fetch, timeoutMs: options.timeoutMs });
  return {
    async search(input) {
      const query = validateUnifiedSearchInput(input);
      await sdk.verifyLocalSession(session);
      const sources: SearchSourceResult[] = [];
      for (const type of query.types) {
        const requested = query.pagination[type], pages: SearchPage[] = [], items: SearchItem[] = [];
        let pagesRequested = 0, error: SearchSourceResult["error"] = null;
        let stoppedBecause: SearchSourceResult["stoppedBecause"] = "failure";
        try {
          let list: (input: { page: number; pageSize: number; keyword: string }) => Promise<SearchPage & { items: SearchRecord[] }>;
          if (type === "course") { const client = await sdk.createCourseClient(session); list = input => client.list(input); }
          else if (type === "volunteer") { const client = await sdk.createVolunteerClient(session); list = input => client.listActivities(input); }
          else { const client = createOrganizationParticipationClient({ baseUrl, session, fetch: options.fetch, timeoutMs: options.timeoutMs }); list = input => client.list(input); }
          for (let offset = 0; offset < requested.maxPages; offset++) {
            const expectedPage = requested.page + offset;
            pagesRequested++;
            const page = await list({ page: expectedPage, pageSize: requested.pageSize, keyword: query.keyword });
            if (page.page !== expectedPage || !Number.isSafeInteger(page.pageSize) || page.pageSize < 1 || page.totalCount !== null && (!Number.isSafeInteger(page.totalCount) || page.totalCount < 0) || ![true, false, null].includes(page.hasMore)) protocol("Domain search returned inconsistent pagination");
            const found = page.items.map(record => {
              const id = type === "organization-activity" ? (record as OrganizationSearchRecord).activityId : (record as CourseSummary | VolunteerActivitySummary).id;
              if (typeof id !== "string" || !id || id === "." || id === ".." || /[\\/?#\s]/.test(id)) protocol("Domain search returned an invalid activity ID");
              return { type, id, name: record.name, record, detail: { operation: details[type], id } };
            });
            pages.push({ page: page.page, pageSize: page.pageSize, totalCount: page.totalCount, hasMore: page.hasMore });
            items.push(...found);
            if (page.hasMore === false) { stoppedBecause = "end"; break; }
            if (page.hasMore === null) { stoppedBecause = "unknown-pagination"; break; }
            stoppedBecause = "budget";
          }
        } catch (cause) {
          const failure = cause instanceof FriendsError ? cause : new FriendsError({ code: FriendsErrorCode.NetworkProtocol, message: "Search source query failed" });
          error = { code: failure.code, message: failure.message, retryable: failure.retryable, ...(failure.upstreamCode ? { upstreamCode: failure.upstreamCode } : {}) };
          stoppedBecause = "failure";
        }
        const last = pages.at(-1);
        sources.push({ type, status: error ? pages.length > 0 ? "partial" : "failed" : "ok", items, requested, pages,
          nextPage: last?.hasMore === true ? last.page + 1 : null,
          complete: error || requested.page !== 1 ? false : last?.hasMore === null ? null : last?.hasMore === false,
          stoppedBecause, budget: { maxPages: requested.maxPages, pagesRequested, pagesRead: pages.length, exhausted: stoppedBecause === "budget" }, error });
      }
      const failed = sources.filter(source => source.error !== null).length;
      return { keyword: query.keyword, status: sources.every(source => source.status === "failed") ? "failed" : failed > 0 ? "partial" : "ok", complete: sources.every(source => source.complete === true),
        account: { userNo: session.account.userNo }, context: { levelNo: session.context.levelNo, unit: { unitNo: session.context.unit.unitNo } }, sources };
    },
  };
}
