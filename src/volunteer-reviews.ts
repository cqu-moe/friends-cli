import { createFriendsSdk } from "./index.js";
import type { VerifiedVolunteerSession } from "./draft-source.js";
import { FriendsError, FriendsErrorCode } from "./errors.js";

type JsonObject = Record<string, unknown>;
const service = "zovecenter-saip-ek-app-young-volunteers";
const prefix = `/${service}/mob`;
const roleToHandleType = {
  XSC: "XJ01",
  XY: "YJ01",
  FDY: "FDY01",
  Tutor: "JZG01",
  GuidingUnit: "YRDW01",
} as const;

export interface VolunteerHoursRecord {
  id: string;
}

export interface VolunteerHoursPage {
  items: VolunteerHoursRecord[];
  page: number;
  pageSize: number;
  totalCount: number | null;
  hasMore: boolean | null;
}

export interface VolunteerHoursDetail {
  id: string;
  totalDurationHours: number | null;
  totalIntegral: number | null;
  classRank: number | null;
  specialtyGradeRank: number | null;
  items: Array<{
    id: string | null;
    activityName: string | null;
    activityPlace: string | null;
    activityType: { raw: unknown; known: false };
    durationHours: { value: number | null; unit: "hours" };
    integral: number | null;
  }>;
}

export interface VolunteerCertificationReviewSummary {
  id: string;
  activityId: string | null;
  activityName: string | null;
  organizationName: string | null;
  beginTime: string | null;
  endTime: string | null;
  attestationCount: number | null;
  state: { raw: unknown; known: false; message: string | null };
}

export interface VolunteerCertificationReviewDetail {
  id: string;
  activityId: string | null;
  schoolRole: string;
  handleType: string;
  activity: { id: string | null; name: string | null; organizationName: string | null };
  entries: Array<{
    registrationId: string | null;
    studentNo: string;
    studentName: string | null;
    postId: string | null;
    postName: string | null;
    postDurationHours: number | null;
    signDurationHours: number | null;
    attestationDurationHours: number | null;
    isApplied: boolean | null;
  }>;
  state: { raw: unknown; known: false; currentNode: unknown; message: string | null };
}

export interface VolunteerCertificationReviewPage {
  items: VolunteerCertificationReviewSummary[];
  page: number;
  pageSize: number;
  totalCount: number | null;
  hasMore: boolean | null;
}

export interface VolunteerCertificationReviewIntent {
  via: "api";
  intent: "submit-volunteer-certification-review";
  decision: "pass" | "back";
  confirm?: boolean;
  dryRun?: boolean;
  message: string;
  time: string;
  callbackActivityId?: string;
}

function object(value: unknown): JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonObject : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function boolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function invalid(message: string): never {
  throw new FriendsError({ code: FriendsErrorCode.InvalidInput, message });
}

function requiredId(value: unknown, name: string): string {
  const id = text(value);
  if (id === null || id === "." || id === ".." || /[\\/?#\s]/.test(id)) {
    throw new FriendsError({ code: FriendsErrorCode.NetworkProtocol, message: `Unexpected ${name}` });
  }
  return id;
}

function validateSession(session: VerifiedVolunteerSession): VerifiedVolunteerSession {
  if (
    !session ||
    [session.token, session.userLevel, session.accountUserNo, session.levelNo, session.unitNo]
      .some((value) => typeof value !== "string" || value === "" || /[\r\n]/.test(value)) ||
    session.userLevel !== session.levelNo
  ) {
    invalid("A complete verified volunteer session is required");
  }
  return { ...session };
}

function headers(session: VerifiedVolunteerSession): Record<string, string> {
  return {
    "content-type": "application/json",
    "h-zove-token": session.token,
    "h-zove-source": "30100",
    "h-zove-clienttype": "1",
    "h-zove-tenantid": "EK",
    "h-zove-appkey": service,
    "h-zove-userlevel": session.userLevel,
  };
}

function pageInput(input: { page?: number; pageSize?: number; keyword?: string } = {}) {
  const page = input.page ?? 1;
  const pageSize = input.pageSize ?? 10;
  if (!Number.isSafeInteger(page) || page < 1) invalid("page must be a positive integer");
  if (!Number.isSafeInteger(pageSize) || pageSize < 1) invalid("pageSize must be a positive integer");
  if (input.keyword !== undefined && typeof input.keyword !== "string") invalid("keyword must be a string");
  return { page, pageSize, keyword: input.keyword ?? "" };
}

function parseId(value: string, name: string): string {
  if (typeof value !== "string" || value.trim() === "" || /[\\/?#\s]/.test(value)) invalid(`Invalid ${name}`);
  return value;
}

function parsePageEnvelope<T>(
  value: unknown,
  query: ReturnType<typeof pageInput>,
  item: (raw: JsonObject) => T,
) {
  const raw = object(value);
  if (raw === null || !Array.isArray(raw.data)) {
    throw new FriendsError({ code: FriendsErrorCode.NetworkProtocol, message: "Unexpected volunteer page response" });
  }
  const pages = number(raw.pages);
  const currentPage = number(raw.currentPage) ?? query.page;
  return {
    items: raw.data.map((value) => item(object(value) ?? invalid("Unexpected volunteer page item"))),
    page: currentPage,
    pageSize: number(raw.pageSize) ?? query.pageSize,
    totalCount: number(raw.totalCount),
    hasMore: pages === null ? null : currentPage < pages,
  };
}

function summary(raw: JsonObject): VolunteerCertificationReviewSummary {
  return {
    id: requiredId(raw.uuid, "certification review ID"),
    activityId: nullableText(raw.activityId),
    activityName: nullableText(raw.activityName),
    organizationName: nullableText(raw.organizationName),
    beginTime: nullableText(raw.beginTime),
    endTime: nullableText(raw.endTime),
    attestationCount: number(raw.attestationNumber),
    state: { raw: raw.flowOverallState ?? null, known: false, message: nullableText(raw.flowCurrMsg) },
  };
}

function reviewDetail(raw: JsonObject, schoolRole: string, handleType: string): VolunteerCertificationReviewDetail {
  const activity = object(raw.activityInfo) ?? {};
  const entries = Array.isArray(raw.nameList) ? raw.nameList : invalid("Unexpected certification roster");
  return {
    id: requiredId(raw.uuid, "certification review ID"),
    activityId: nullableText(raw.activityId) ?? nullableText(activity.uuid),
    schoolRole,
    handleType,
    activity: {
      id: nullableText(activity.uuid),
      name: nullableText(activity.activityName),
      organizationName: nullableText(activity.organizationName),
    },
    entries: entries.map((value) => {
      const row = object(value) ?? invalid("Unexpected certification roster item");
      if (typeof row.studentNo !== "string" || row.studentNo === "") {
        throw new FriendsError({ code: FriendsErrorCode.NetworkProtocol, message: "Unexpected certification roster item" });
      }
      return {
        registrationId: nullableText(row.uuid),
        studentNo: row.studentNo,
        studentName: nullableText(row.studentName),
        postId: nullableText(row.postId),
        postName: nullableText(row.postName),
        postDurationHours: number(row.postDuration),
        signDurationHours: number(row.signDuration),
        attestationDurationHours: number(row.attestationDuration),
        isApplied: boolean(row.isApply),
      };
    }),
    state: {
      raw: raw.flowOverallState ?? null,
      known: false,
      currentNode: raw.flowCurrNode ?? null,
      message: nullableText(raw.flowCurrMsg),
    },
  };
}

function createClient(options: {
  baseUrl: string;
  session: VerifiedVolunteerSession;
  fetch?: typeof fetch;
  timeoutMs?: number;
}) {
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  const session = validateSession(options.session);
  const fetchImpl = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 60_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) invalid("timeoutMs must be a positive integer");
  const sdk = createFriendsSdk({ baseUrl, fetch: fetchImpl, timeoutMs });

  async function request(path: string, init: RequestInit, write = false): Promise<JsonObject> {
    let response: Response;
    try {
      response = await fetchImpl(new URL(`${baseUrl}${path}`), {
        ...init,
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (cause) {
      throw new FriendsError({
        code: FriendsErrorCode.NetworkProtocol,
        message: "Could not reach the volunteer service",
        retryable: !write,
        cause,
      });
    }
    if (response.status === 401) throw new FriendsError({ code: FriendsErrorCode.AuthRequired, message: "Friends session expired" });
    if (response.status === 403) throw new FriendsError({ code: FriendsErrorCode.PermissionDenied, message: "The school denied this volunteer operation" });
    if (response.status === 409 || !response.ok) {
      throw new FriendsError({
        code: response.status === 409 ? FriendsErrorCode.UpstreamBusiness : FriendsErrorCode.NetworkProtocol,
        message: response.status === 409
          ? "The school reported a certification review state conflict"
          : `Unexpected school HTTP status ${response.status}`,
      });
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch (cause) {
      throw new FriendsError({ code: FriendsErrorCode.NetworkProtocol, message: "Invalid volunteer JSON response", cause });
    }
    const envelope = object(body);
    if (envelope === null || typeof envelope.code !== "string") {
      throw new FriendsError({ code: FriendsErrorCode.NetworkProtocol, message: "Invalid volunteer response" });
    }
    if (envelope.code !== "0") {
      throw new FriendsError({
        code: FriendsErrorCode.UpstreamBusiness,
        message: text(envelope.message) ?? "The school rejected the volunteer operation",
        upstreamCode: envelope.code,
      });
    }
    return envelope;
  }

  async function verify() {
    await sdk.verifyLocalSession({
      token: session.token,
      userLevel: session.userLevel,
      account: { userNo: session.accountUserNo },
      context: { levelNo: session.levelNo, unit: { unitNo: session.unitNo } },
    });
  }

  async function realRole() {
    await verify();
    const envelope = await request("/ek-agg-mob/user/info", { method: "POST", headers: headers(session), body: "{}" });
    const role = text(object(envelope.data)?.userLoginStateLevel);
    const handleType = role === null ? undefined : roleToHandleType[role as keyof typeof roleToHandleType];
    if (role === null || handleType === undefined) {
      throw new FriendsError({
        code: FriendsErrorCode.PermissionDenied,
        message: "The current school identity does not expose a real certification review role",
      });
    }
    return { role, handleType };
  }

  return { baseUrl, session, fetchImpl, timeoutMs, request, verify, realRole };
}

export function createVolunteerHoursClient(options: {
  baseUrl: string;
  session: VerifiedVolunteerSession;
  fetch?: typeof fetch;
  timeoutMs?: number;
}) {
  const client = createClient(options);
  return {
    async list(input: { page?: number; pageSize?: number; keyword?: string } = {}): Promise<VolunteerHoursPage> {
      const query = pageInput(input);
      await client.verify();
      const envelope = await client.request(`${prefix}/student-transcript/page`, {
        method: "POST",
        headers: headers(client.session),
        body: JSON.stringify({
          currentPage: query.page,
          pageSize: query.pageSize,
          classNo: "",
          collegeNo: "",
          key: query.keyword,
          specialtyNo: "",
          specialtyType: "",
          poorLevel: "",
          flowStateFormate: "",
          studentGroupKey: "",
          examine: 1,
        }),
      });
      return parsePageEnvelope(envelope.data, query, (raw): VolunteerHoursRecord => ({
        id: requiredId(raw.uuid, "transcript ID"),
      }));
    },
    async get(idInput: string): Promise<VolunteerHoursDetail> {
      const id = parseId(idInput, "transcript ID");
      await client.verify();
      const envelope = await client.request(`${prefix}/student-transcript/${encodeURIComponent(id)}`, {
        method: "GET",
        headers: headers(client.session),
      });
      const raw = object(envelope.data) ?? invalid("Unexpected volunteer transcript");
      const items = Array.isArray(raw.itemList) ? raw.itemList : invalid("Unexpected volunteer transcript items");
      return {
        id: nullableText(raw.uuid) ?? id,
        totalDurationHours: number(raw.totalDuration),
        totalIntegral: number(raw.totalIntegral),
        classRank: number(raw.classRank),
        specialtyGradeRank: number(raw.specialtyGradeRank),
        items: items.map((value) => {
          const item = object(value) ?? invalid("Unexpected volunteer transcript item");
          return {
            id: nullableText(item.uuid),
            activityName: nullableText(item.activityName),
            activityPlace: nullableText(item.activityPlace),
            activityType: { raw: item.activityType ?? null, known: false as const },
            durationHours: { value: number(item.totalDuration), unit: "hours" as const },
            integral: number(item.totalIntegral),
          };
        }),
      };
    },
  };
}

export function createVolunteerCertificationReviewClient(options: {
  baseUrl: string;
  session: VerifiedVolunteerSession;
  fetch?: typeof fetch;
  timeoutMs?: number;
}) {
  const client = createClient(options);

  async function currentState(id: string) {
    const { role, handleType } = await client.realRole();
    const envelope = await client.request(`${prefix}/school-activity-attestation-apply/approve-detail/${encodeURIComponent(id)}`, {
      method: "GET",
      headers: headers(client.session),
    });
    const raw = object(envelope.data) ?? invalid("Unexpected certification review detail");
    return { raw, projected: reviewDetail(raw, role, handleType), role, handleType };
  }

  async function flowState(handleType: string) {
    const envelope = await client.request("/biz-common/flow/template-activity-state", {
      method: "POST",
      headers: headers(client.session),
      body: JSON.stringify({ businessTypeCode: "校内活动认证申请", handleType }),
    });
    const states = Array.isArray(envelope.data) ? envelope.data : invalid("Unexpected certification flow states");
    const match = states.map((value) => object(value)).find((value) => value?.code === "0");
    if (match === undefined) invalid("The school did not expose a pending certification review state");
    return "0";
  }

  async function callbackNodes(handleType: string) {
    const envelope = await client.request("/biz-common/flow/callback-list", {
      method: "POST",
      headers: headers(client.session),
      body: JSON.stringify({ businessTypeCode: "校内活动认证申请", handleType }),
    });
    return (Array.isArray(envelope.data) ? envelope.data : []).map((value) => {
      const node = object(object(value)?.templateActivityRespDto);
      return {
        id: nullableText(node?.activityid),
        name: nullableText(node?.name),
      };
    });
  }

  function validateIntent(intent: VolunteerCertificationReviewIntent) {
    if (
      intent?.via !== "api" ||
      intent.intent !== "submit-volunteer-certification-review" ||
      (intent.decision !== "pass" && intent.decision !== "back")
    ) {
      invalid("Certification review requires independent --via api and a pass or back decision; REFUSE is not exposed");
    }
    if (intent.dryRun !== undefined && typeof intent.dryRun !== "boolean") invalid("dry-run must be boolean");
    if (intent.confirm !== undefined && typeof intent.confirm !== "boolean") invalid("confirm must be boolean");
    if (!intent.dryRun && intent.confirm !== true) invalid("Certification review requires explicit confirmation");
    if (typeof intent.message !== "string" || intent.message.trim() === "" || intent.message.length > 100) {
      invalid("A non-empty certification review message of at most 100 characters is required");
    }
    if (typeof intent.time !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(intent.time)) invalid("Review time must be YYYY-MM-DD");
    if (intent.callbackActivityId !== undefined && typeof intent.callbackActivityId !== "string") {
      invalid("callbackActivityId must be a string");
    }
  }

  return {
    async list(input: { page?: number; pageSize?: number; keyword?: string } = {}): Promise<VolunteerCertificationReviewPage> {
      const query = pageInput(input);
      const { handleType } = await client.realRole();
      const state = await flowState(handleType);
      const envelope = await client.request(`${prefix}/school-activity-attestation-apply/page-list`, {
        method: "POST",
        headers: headers(client.session),
        body: JSON.stringify({
          currentPage: query.page,
          pageSize: query.pageSize,
          classNo: "",
          collegeNo: "",
          key: query.keyword,
          specialtyNo: "",
          specialtyType: "",
          activityType: "",
          activityCategory: "",
          handleType,
          state,
        }),
      });
      return parsePageEnvelope(envelope.data, query, summary);
    },
    async get(idInput: string): Promise<VolunteerCertificationReviewDetail> {
      return (await currentState(parseId(idInput, "certification review ID"))).projected;
    },
    async decide(idInput: string, intent: VolunteerCertificationReviewIntent) {
      validateIntent(intent);
      const id = parseId(idInput, "certification review ID");
      const before = await currentState(id);
      let callbackActivityId: string | null = null;
      if (intent.decision === "back") {
        const nodes = await callbackNodes(before.handleType);
        if (nodes.length === 1) callbackActivityId = nodes[0].id;
        else if (nodes.length > 1) {
          callbackActivityId = intent.callbackActivityId ?? null;
          if (callbackActivityId === null || !nodes.some((node) => node.id === callbackActivityId)) {
            invalid("Select callbackActivityId from the school-returned callback nodes");
          }
        }
      }
      const payload = {
        callbackActivityId,
        time: intent.time,
        msg: intent.message,
        handleType: before.handleType,
        applyInfo: intent.decision === "pass"
          ? { nameList: before.raw.nameList, activityId: before.projected.activityId, uuid: id }
          : null,
        uuid: id,
      };
      if (intent.dryRun) {
        return {
          submitted: false as const,
          serverAcknowledged: false as const,
          decision: intent.decision,
          payload,
          readback: { state: "not-submitted" as const, detail: before.projected },
        };
      }

      let acknowledged = false;
      try {
        await client.request(`${prefix}/school-activity-attestation-apply/${intent.decision === "pass" ? "pass" : "callback"}`, {
          method: "POST",
          headers: headers(client.session),
          body: JSON.stringify(payload),
        }, true);
        acknowledged = true;
      } catch (error) {
        if (!(error instanceof FriendsError) || error.code !== FriendsErrorCode.NetworkProtocol) throw error;
        let readbackState = "unavailable";
        let recoveryCompleted = "readback:unavailable";
        try {
          const after = await currentState(id);
          readbackState = JSON.stringify(after.raw) === JSON.stringify(before.raw) ? "unchanged" : "changed";
          recoveryCompleted = `readback:${readbackState}`;
        } catch {
          // The original write outcome remains unknown even when readback matches.
        }
        throw new FriendsError({
          code: FriendsErrorCode.UnknownOutcome,
          message: "The school may have accepted the certification review; inspect it before another decision; no retry was made",
          recovery: {
            operation: "volunteer-certification-reviews.decide",
            activityId: before.projected.activityId ?? undefined,
            applicationId: id,
            completed: ["POST", recoveryCompleted],
          },
        });
      }

      try {
        const after = await currentState(id);
        const state = JSON.stringify(after.raw) === JSON.stringify(before.raw) ? "unchanged" : "changed";
        return {
          submitted: true as const,
          serverAcknowledged: true as const,
          decision: intent.decision,
          payload,
          readback: { state, detail: after.projected },
        };
      } catch {
        return {
          submitted: true as const,
          serverAcknowledged: true as const,
          decision: intent.decision,
          payload,
          readback: { state: "unavailable" as const, detail: null },
        };
      }
    },
  };
}
