import { createFriendsSdk, type VerifiedCourseSession } from "./index.js";
import { FriendsError, FriendsErrorCode, type WriteRecovery } from "./errors.js";

type ObjectValue = Record<string, unknown>;
export type OrganizationActivityReviewKind = "offering" | "registration";
export interface OrganizationOfferingReviewQuery {
  organizationId: string;
  page?: number;
  pageSize?: number;
  keyword?: string;
}
export interface OrganizationRegistrationReviewQuery extends OrganizationOfferingReviewQuery { activityId: string }
export interface OrganizationOfferingReviewInput {
  organizationId: string;
  id: string;
  decision: "pass" | "back" | "refuse";
  message: string;
  time: string;
  callbackActivityId?: string;
}
export interface OrganizationRegistrationReviewInput {
  organizationId: string;
  activityId: string;
  id: string;
  decision: "pass" | "refuse";
  message: string;
  time: string;
}
export interface PreparedOrganizationActivityReview {
  kind: OrganizationActivityReviewKind;
  id: string;
  organizationId: string;
  activityId: string;
  decision: "pass" | "back" | "refuse";
  status: "prepared";
  submitted: false;
  payload: Readonly<ObjectValue>;
  saveBeforeApproval: Readonly<ObjectValue> | null;
  route: string;
  review: { kind: OrganizationActivityReviewKind; id: string; organizationId: string; activityId: string; state: { raw: unknown; known: false; message: unknown } };
}
export interface OrganizationActivityReviewClientOptions {
  baseUrl?: string;
  session: VerifiedCourseSession;
  fetch?: typeof fetch;
  timeoutMs?: number;
}
const service = "zovecenter-saip-ek-app-team-organization-manage";
const prefix = `/${service}/mob`;
const common = "/ek-agg-mob/biz-common/flow";
function fail(message: string, code: FriendsErrorCode = FriendsErrorCode.InvalidInput): never {
  throw new FriendsError({ code, message });
}
function object(value: unknown): ObjectValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("Invalid school review object", FriendsErrorCode.NetworkProtocol);
  return value as ObjectValue;
}
function id(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value === "." || value === ".." || /[\\/?#\s]/.test(value)) fail("Invalid organization, activity or application ID");
  return value;
}
export function validateOrganizationActivityReviewInput(kind: OrganizationActivityReviewKind, input: OrganizationOfferingReviewInput | OrganizationRegistrationReviewInput) {
  if (kind !== "offering" && kind !== "registration") fail("Unknown organization approval kind");
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("Expected organization review input");
  const fields = ["organizationId", "id", "decision", "message", "time", kind === "offering" ? "callbackActivityId" : "activityId"];
  if (Object.keys(input).some(key => !fields.includes(key))) fail("Unsupported organization approval field");
  id(input.organizationId); id(input.id);
  if (kind === "registration") id((input as OrganizationRegistrationReviewInput).activityId);
  if (!(kind === "offering" ? ["pass", "back", "refuse"] : ["pass", "refuse"]).includes(input.decision)) fail("Unsupported organization approval decision");
  if (typeof input.message !== "string" || !input.message.trim() || input.message.length > 100) fail("Review message must contain 1 to 100 characters");
  if (typeof input.time !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input.time) || !Number.isFinite(Date.parse(input.time)) || new Date(input.time).toISOString().slice(0, 10) !== input.time) fail("Review time must be a valid YYYY-MM-DD date");
  const callback = (input as OrganizationOfferingReviewInput).callbackActivityId;
  if (callback !== undefined) {
    id(callback);
    if (input.decision === "pass") fail("A pass decision does not accept a callback node");
  }
}
function query(kind: OrganizationActivityReviewKind, input: OrganizationOfferingReviewQuery | OrganizationRegistrationReviewQuery) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("Expected organization review query");
  id(input.organizationId);
  const activityId = kind === "registration" ? id((input as OrganizationRegistrationReviewQuery).activityId) : undefined;
  if (Object.keys(input).some(key => !["organizationId", "page", "pageSize", "keyword", ...(kind === "registration" ? ["activityId"] : [])].includes(key))) fail("Unsupported organization review query field");
  const page = input.page ?? 1, pageSize = input.pageSize ?? 10, keyword = input.keyword ?? "";
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100 || typeof keyword !== "string") fail("Invalid organization review pagination or keyword");
  return { organizationId: input.organizationId, activityId, page, pageSize, keyword };
}

export function createOrganizationActivityReviewClient(options: OrganizationActivityReviewClientOptions) {
  const baseUrl = (options.baseUrl ?? "https://friends.cqu.edu.cn/gateway").replace(/\/$/, "");
  const session = structuredClone(options.session), fetchImpl = options.fetch ?? fetch, timeoutMs = options.timeoutMs ?? 60_000;
  const sdk = createFriendsSdk({ baseUrl, fetch: fetchImpl, timeoutMs });
  const prepared = new WeakMap<PreparedOrganizationActivityReview, { input: OrganizationOfferingReviewInput | OrganizationRegistrationReviewInput; value: string }>();
  let uncertain: WriteRecovery | undefined;
  let writing = false;
  async function request(path: string, method = "GET", body?: ObjectValue) {
    let response: Response, envelope: ObjectValue;
    try {
      response = await fetchImpl(baseUrl + path, {
        method, headers: { "content-type": "application/json", "h-zove-token": session.token, "h-zove-userlevel": session.userLevel, "h-zove-source": "30100", "h-zove-clienttype": "1", "h-zove-tenantid": "EK", "h-zove-appkey": path.startsWith("/ek-agg-mob/") ? "zovecenter-saip-ek-agg-mob" : service },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: "error", signal: AbortSignal.timeout(timeoutMs),
      });
    } catch { fail("Could not reach organization approvals", FriendsErrorCode.NetworkProtocol); }
    if (response.status === 401) fail("Friends session expired", FriendsErrorCode.AuthRequired);
    if (response.status === 403) fail("The school denied organization approval access", FriendsErrorCode.PermissionDenied);
    if (!response.ok) fail(`Unexpected school HTTP ${response.status}`, FriendsErrorCode.NetworkProtocol);
    try { envelope = object(await response.json()); } catch { fail("Invalid school approval response", FriendsErrorCode.NetworkProtocol); }
    if (typeof envelope.code !== "string") fail("Missing school business acknowledgement", FriendsErrorCode.NetworkProtocol);
    if (envelope.code !== "0") throw new FriendsError({ code: FriendsErrorCode.UpstreamBusiness, message: "The school rejected the organization approval operation", upstreamCode: envelope.code });
    return envelope.data;
  }
  async function scope(kind: OrganizationActivityReviewKind, q: ReturnType<typeof query>) {
    await sdk.verifyLocalSession(session);
    const index = object(await request(prefix + "/biz-common/sub-app/mobile-index", "POST"));
    const menus = object(object(index.extMap)["H-Zove-AppKey"]).menus;
    if (!Array.isArray(menus)) fail("The school did not expose organization roles", FriendsErrorCode.NetworkProtocol);
    const paths = menus.map(item => object(item).path);
    let mode: "FDY" | "zdls" | "XS02";
    if (kind === "offering") {
      if (session.userLevel === "FDY") mode = "FDY";
      else if (paths.includes("/zdls")) mode = "zdls";
      else fail("This identity cannot review organization offerings", FriendsErrorCode.PermissionDenied);
      const organizations = await request(prefix + "/apply-info/drop-down-list", "POST", { isTeacher: true });
      if (!Array.isArray(organizations) || !organizations.some(item => object(item).uuid === q.organizationId)) fail("Organization is outside the current approval scope", FriendsErrorCode.PermissionDenied);
    } else {
      mode = "XS02";
      if (!paths.some(path => path === "/fuzeren" || path === "/admin")) fail("This identity cannot review organization registrations", FriendsErrorCode.PermissionDenied);
      const organizations = await request(prefix + "/student-organization-info/my", "POST");
      const managed = Array.isArray(organizations) ? organizations.map(object).find(item => item.uuid === q.organizationId) : null;
      if (!managed || managed.responsiblePerson !== session.account.userNo && managed.currentUserIsManager !== true) fail("Organization registration reviews require its current manager or principal", FriendsErrorCode.PermissionDenied);
      const activities = await request(prefix + "/enroll-info/drop-down-list", "POST", {});
      if (!Array.isArray(activities) || !activities.some(item => object(item).uuid === q.activityId)) fail("Activity is outside the current registration approval scope", FriendsErrorCode.PermissionDenied);
      await activity(q.activityId!, q.organizationId);
    }
    const handle = kind === "offering" ? "FDY01" : "XS02";
    const states = await request(common + "/template-activity-state", "POST", { businessTypeCode: kind === "offering" ? "组织活动申请流程" : "社团加入退出申请", handleType: handle });
    if (!Array.isArray(states)) fail("Invalid organization approval states", FriendsErrorCode.NetworkProtocol);
    const pendingStates = states.map(object).filter(item => kind === "offering" ? typeof item.value === "string" && item.value.includes("等待") : item.code === "XS02");
    if (pendingStates.length !== 1 || typeof pendingStates[0].code !== "string" || !pendingStates[0].code) fail("Cannot identify the school's pending approval state", FriendsErrorCode.NetworkProtocol);
    return { mode, approvalState: pendingStates[0].code as string };
  }
  async function activity(activityId: string, organizationId: string) {
    const raw = object(await request(prefix + "/apply-info/" + encodeURIComponent(activityId)));
    if (raw.uuid !== activityId || raw.organizationId !== organizationId || typeof raw.activityName !== "string") fail("Activity does not match the requested organization and ID", FriendsErrorCode.PermissionDenied);
    return raw;
  }
  async function page(kind: OrganizationActivityReviewKind, q: ReturnType<typeof query>, context: Awaited<ReturnType<typeof scope>>) {
    const body = { currentPage: q.page, pageSize: q.pageSize, key: q.keyword, approvalState: context.approvalState, ...(kind === "offering" ? { organizationId: q.organizationId, userLevel: context.mode === "FDY" ? "" : "zdls" } : { activityId: q.activityId! }) };
    const data = object(await request(prefix + (kind === "offering" ? "/apply-info/activity-page-list" : "/enroll-info/approve-page-list"), "POST", body));
    if (!Array.isArray(data.data) || !Number.isSafeInteger(data.pages) || (data.pages as number) < 0 || data.currentPage !== q.page) fail("Invalid school approval page", FriendsErrorCode.NetworkProtocol);
    const rows = data.data.map(object);
    for (const row of rows) {
      id(row.uuid);
      if (kind === "offering" ? row.organizationId !== q.organizationId : row.activityId !== q.activityId || row.organizationId !== undefined && row.organizationId !== q.organizationId) fail("School returned an approval for a different object or organization", FriendsErrorCode.PermissionDenied);
    }
    return { rows, page: q.page, pageSize: q.pageSize, totalCount: typeof data.totalCount === "number" ? data.totalCount : null, hasMore: q.page < (data.pages as number) };
  }
  async function pending(kind: OrganizationActivityReviewKind, q: ReturnType<typeof query>, context: Awaited<ReturnType<typeof scope>>, reviewId: string) {
    for (let n = 1; n <= 100; n++) {
      const result = await page(kind, { ...q, page: n, pageSize: 50, keyword: "" }, context);
      const row = result.rows.find(row => row.uuid === reviewId);
      if (row) return row;
      if (!result.hasMore) return null;
    }
    fail("Pending approval scan exceeded 100 pages", FriendsErrorCode.NetworkProtocol);
  }
  const summary = (kind: OrganizationActivityReviewKind, raw: ObjectValue, organizationId: string) => ({ kind, id: id(raw.uuid), organizationId, activityId: kind === "offering" ? id(raw.uuid) : id(raw.activityId), name: raw.activityName ?? null, ...(kind === "registration" ? { studentNo: raw.studentNo ?? null, studentName: raw.studentName ?? null } : {}), state: { raw: raw.flowOverallState ?? null, known: false as const, message: raw.flowCurrMsg ?? null } });
  function identifiers(kind: OrganizationActivityReviewKind, input: { organizationId: string; id: string; activityId?: string }) {
    id(input.id);
    return query(kind, { organizationId: input.organizationId, ...(kind === "registration" ? { activityId: input.activityId! } : {}) });
  }
  async function current(kind: OrganizationActivityReviewKind, input: { organizationId: string; id: string; activityId?: string }) {
    const q = identifiers(kind, input), context = await scope(kind, q), row = await pending(kind, q, context, input.id);
    if (!row) fail("Application is not pending for this organization and identity", FriendsErrorCode.UpstreamBusiness);
    const raw = kind === "offering" ? await activity(input.id, input.organizationId) : row;
    if ([5, 7].includes(Number(row.flowOverallState)) || [5, 7].includes(Number(raw.flowOverallState))) fail("Application is already processed", FriendsErrorCode.UpstreamBusiness);
    if (kind === "registration" && (raw.activityId !== input.activityId || typeof raw.studentNo !== "string" || !raw.studentNo)) fail("Registration identity binding is incomplete", FriendsErrorCode.NetworkProtocol);
    return { q, context, raw };
  }
  async function buildPlan(kind: OrganizationActivityReviewKind, input: OrganizationOfferingReviewInput | OrganizationRegistrationReviewInput): Promise<PreparedOrganizationActivityReview> {
    validateOrganizationActivityReviewInput(kind, input);
    const now = await current(kind, input);
    let callback = "";
    if (kind === "offering" && input.decision !== "pass") {
      const nodes = await request(common + "/callback-list", "POST", { businessTypeCode: "组织活动申请流程", compareValue: "", handleType: "FDY01" });
      if (!Array.isArray(nodes) || nodes.length === 0) fail("No school callback node is available", FriendsErrorCode.NetworkProtocol);
      callback = id(object(object(nodes[0]).templateActivityRespDto).activityid);
      if ((input as OrganizationOfferingReviewInput).callbackActivityId !== undefined && (input as OrganizationOfferingReviewInput).callbackActivityId !== callback) fail("The decision requires the school's first callback node");
    }
    const identified = kind === "offering" ? { pass: "AGREEMENT", back: "REJECTION", refuse: "ADJUSTMENT" }[input.decision] : input.decision === "pass" ? "AGREEMENT" : "REJECTION";
    let saveBeforeApproval: ObjectValue | null = null;
    if (kind === "offering" && input.decision === "pass") {
      for (const key of ["beginYear", "endYear", "termNo", "beginTime", "endTime"]) if (typeof now.raw[key] !== "string" && typeof now.raw[key] !== "number") fail("Incomplete school activity form; review it manually", FriendsErrorCode.NetworkProtocol);
      saveBeforeApproval = { ...now.raw, time: `${now.raw.beginTime}~${now.raw.endTime}`, year: `${now.raw.beginYear}-${now.raw.endYear}学年第${now.raw.termNo}学期` };
    }
    const params = new URLSearchParams({ uuid: input.id, ...(kind === "registration" ? { acId: (input as OrganizationRegistrationReviewInput).activityId, studentNo: String(now.raw.studentNo), flowCurrMsg: typeof now.raw.flowCurrMsg === "string" ? now.raw.flowCurrMsg : "" } : {}) });
    return { kind, id: input.id, organizationId: input.organizationId, activityId: kind === "offering" ? input.id : (input as OrganizationRegistrationReviewInput).activityId, decision: input.decision, status: "prepared", submitted: false,
      payload: { identified, msg: input.message, time: input.time, uuid: input.id, ...(kind === "offering" ? { activityId: callback } : {}) }, saveBeforeApproval,
      review: summary(kind, now.raw, input.organizationId),
      route: `/mobile/acManage/${kind === "offering" ? "auditDetail" : "stuManageSignAuditDetail"}?${params}` };
  }
  async function verify(kind: OrganizationActivityReviewKind, input: { organizationId: string; id: string; activityId?: string }) {
    const q = identifiers(kind, input), context = await scope(kind, q), row = await pending(kind, q, context, input.id);
    const raw = kind === "offering" ? await activity(input.id, input.organizationId) : object(await request(prefix + "/enroll-info/flow/" + encodeURIComponent(input.id)));
    return { kind, id: input.id, organizationId: input.organizationId, pending: row !== null, state: kind === "offering" ? summary(kind, raw, input.organizationId).state : { raw: row?.flowOverallState ?? null, known: false as const, message: row?.flowCurrMsg ?? null }, decisionVerified: false as const };
  }
  function client<K extends OrganizationActivityReviewKind>(kind: K) {
    type Input = K extends "offering" ? OrganizationOfferingReviewInput : OrganizationRegistrationReviewInput;
    type Query = K extends "offering" ? OrganizationOfferingReviewQuery : OrganizationRegistrationReviewQuery;
    type Ids = K extends "offering" ? { organizationId: string; id: string } : { organizationId: string; activityId: string; id: string };
    return {
      async list(input: Query) {
        const q = query(kind, input), context = await scope(kind, q), result = await page(kind, q, context);
        return { items: result.rows.map(row => summary(kind, row, q.organizationId)), page: result.page, pageSize: result.pageSize, totalCount: result.totalCount, hasMore: result.hasMore };
      },
      async get(input: Ids) {
        const now = await current(kind, input);
        return summary(kind, now.raw, input.organizationId);
      },
      async prepare(input: Input) {
        validateOrganizationActivityReviewInput(kind, input);
        const snapshot = structuredClone(input);
        const plan = await buildPlan(kind, snapshot);
        prepared.set(plan, { input: snapshot, value: JSON.stringify(plan) });
        return plan;
      },
      verify: (input: Ids) => verify(kind, input),
      async decide(plan: PreparedOrganizationActivityReview, intent: { via: "api"; intent: `decide-organization-${K}-review`; confirm: true }) {
        if (intent?.via !== "api" || intent.intent !== `decide-organization-${kind}-review` || intent.confirm !== true) fail("Approval requires independent explicit API intent and confirmation");
        if (uncertain) throw new FriendsError({ code: FriendsErrorCode.UnknownOutcome, message: "An earlier write is unresolved; only read-only verification is allowed", recovery: uncertain });
        if (writing) fail("Another organization decision is in flight; no additional write was started");
        const saved = prepared.get(plan);
        if (!saved || plan.kind !== kind || saved.value !== JSON.stringify(plan)) fail("Use an unchanged approval prepared by the matching client");
        writing = true;
        prepared.delete(plan);
        try {
          const latest = await buildPlan(kind, saved.input);
          if (JSON.stringify(latest) !== saved.value) fail("Application or callback node changed after preparation", FriendsErrorCode.UpstreamBusiness);
          const completed: string[] = [];
          let acknowledged = false, writeError: FriendsError | undefined;
          try {
            if (latest.saveBeforeApproval) { await request(prefix + "/apply-info/next-update", "PUT", latest.saveBeforeApproval); completed.push("saved-activity-form"); }
            await request(prefix + (kind === "offering" ? "/apply-info/audit" : "/enroll-info/audit"), "PUT", latest.payload);
            acknowledged = true; completed.push("approval-acknowledged");
          } catch (error) {
            if (!(error instanceof FriendsError)) throw error;
            if (error.code !== FriendsErrorCode.NetworkProtocol) throw new FriendsError({ code: error.code, message: error.message, upstreamCode: error.upstreamCode, recovery: { operation: `organization.${kind}-reviews.decide`, organizationId: latest.organizationId, activityId: latest.activityId, applicationId: latest.id, completed, serverAcknowledged: false } });
            writeError = error;
          }
          let readback: "matched" | "unmatched" | "unavailable" = "unavailable";
          try { readback = (await verify(kind, saved.input)).pending ? "unmatched" : "matched"; } catch { /* A failed read cannot establish the write's outcome. */ }
          const recovery: WriteRecovery = { operation: `organization.${kind}-reviews.decide`, organizationId: latest.organizationId, activityId: latest.activityId, applicationId: latest.id, completed, serverAcknowledged: acknowledged ? true : "unknown", readback };
          if (writeError || readback === "unavailable") {
            uncertain = recovery;
            throw new FriendsError({ code: FriendsErrorCode.UnknownOutcome, message: "Organization approval may be partial; inspect the identifiers and completed steps; no retry or next write was made", recovery });
          }
          if (readback === "unmatched") throw new FriendsError({ code: FriendsErrorCode.UpstreamBusiness, message: "The school acknowledged the decision but the application is still pending", recovery });
          return { kind, id: latest.id, organizationId: latest.organizationId, activityId: latest.activityId, status: "acknowledged" as const, submitted: true as const, serverAcknowledged: true as const, readback, readbackBasis: "absent-from-current-role-pending-list" as const, decisionVerified: false as const, completed };
        } finally { writing = false; }
      },
    };
  }
  const offering = client("offering"), registration = client("registration");
  return { offering, registration };
}
