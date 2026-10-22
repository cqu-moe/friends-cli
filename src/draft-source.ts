import { FriendsError, FriendsErrorCode } from "./errors.js";
import { createFriendsSdk } from "./index.js";

export interface VerifiedVolunteerSession {
  token: string;
  userLevel: string;
  accountUserNo: string;
  levelNo: string;
  unitNo: string;
}

export interface ManageableVolunteerActivity {
  id: string;
  name: string | null;
  organizationId: string | null;
  positionSetMethod: "TIME" | "SIGN" | null;
}

export interface VolunteerCertificationSource {
  binding: {
    accountUserNo: string;
    levelNo: string;
    unitNo: string;
    organizationId: string | null;
    activityId: string;
  };
  activity: {
    id: string;
    name: string | null;
    organizationName: string | null;
    positionSetMethod: "TIME" | "SIGN";
    posts: Array<{ id: string; name: string | null; durationHours: number | null }>;
  };
  registrations: Array<{
    registrationId: string | null;
    studentNo: string;
    studentName: string | null;
    postId: string | null;
    postName: string | null;
    postDurationHours: number | null;
    signDurationHours: number | null;
    isApplied: boolean | null;
    upstreamPreselected: boolean;
  }>;
}

type JsonObject = Record<string, unknown>;

const service = "zovecenter-saip-ek-app-young-volunteers";

function object(value: unknown): JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function boolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function method(value: unknown): "TIME" | "SIGN" {
  if (value !== "TIME" && value !== "SIGN") {
    throw new FriendsError({
      code: FriendsErrorCode.NetworkProtocol,
      message: "Unexpected volunteer activity certification method",
    });
  }
  return value;
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

async function callApi(
  baseUrl: string,
  path: string,
  session: VerifiedVolunteerSession,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<JsonObject> {
  let response: Response;
  try {
    response = await fetchImpl(new URL(`${baseUrl}${path}`), {
      method: "GET",
      headers: headers(session),
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (cause) {
    throw new FriendsError({
      code: FriendsErrorCode.NetworkProtocol,
      message: "Could not reach the friends gateway",
      retryable: true,
      cause,
    });
  }
  if (response.status === 401) {
    throw new FriendsError({ code: FriendsErrorCode.AuthRequired, message: "Friends session expired" });
  }
  if (response.status === 403) {
    throw new FriendsError({ code: FriendsErrorCode.PermissionDenied, message: "The friends API denied this context" });
  }
  if (!response.ok) {
    throw new FriendsError({
      code: FriendsErrorCode.NetworkProtocol,
      message: `Unexpected friends HTTP status ${response.status}`,
    });
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch (cause) {
    throw new FriendsError({
      code: FriendsErrorCode.NetworkProtocol,
      message: `Unexpected non-JSON friends response (HTTP ${response.status})`,
      cause,
    });
  }
  const envelope = object(payload);
  if (envelope === null || envelope.code !== "0") {
    throw new FriendsError({
      code: envelope?.code === undefined ? FriendsErrorCode.NetworkProtocol : FriendsErrorCode.UpstreamBusiness,
      message: text(envelope?.message) ?? "Unexpected volunteer activity response",
      upstreamCode: text(envelope?.code) ?? undefined,
      requestId: text(envelope?.requestId) ?? undefined,
    });
  }
  return envelope;
}

function activityId(value: unknown): string {
  const id = text(value);
  if (id === null || /[\\/?#\s]/.test(id)) {
    throw new FriendsError({ code: FriendsErrorCode.NetworkProtocol, message: "Unexpected volunteer activity ID" });
  }
  return id;
}

function parseActivity(value: unknown): ManageableVolunteerActivity {
  const raw = object(value);
  if (raw === null) {
    throw new FriendsError({ code: FriendsErrorCode.NetworkProtocol, message: "Unexpected manageable activity item" });
  }
  return {
    id: activityId(raw.uuid),
    name: text(raw.name) ?? text(raw.activityName),
    organizationId: text(raw.organizationId),
    positionSetMethod: raw.positionSetMethod === "TIME" || raw.positionSetMethod === "SIGN" ? raw.positionSetMethod : null,
  };
}

function parseDetail(value: unknown) {
  const raw = object(value);
  if (raw === null || !Array.isArray(raw.posts)) {
    throw new FriendsError({ code: FriendsErrorCode.NetworkProtocol, message: "Unexpected volunteer activity detail" });
  }
  return {
    id: activityId(raw.uuid),
    name: text(raw.activityName) ?? text(raw.name),
    organizationName: text(raw.organizationName),
    organizationId: text(raw.organizationId),
    positionSetMethod: method(raw.positionSetMethod),
    posts: raw.posts.map((postValue) => {
      const post = object(postValue);
      if (post === null) {
        throw new FriendsError({ code: FriendsErrorCode.NetworkProtocol, message: "Unexpected volunteer activity post" });
      }
      return {
        id: activityId(post.uuid),
        name: text(post.postName) ?? text(post.name),
        durationHours: number(post.duration) ?? number(post.postDuration),
      };
    }),
  };
}

function parseRegistrations(value: unknown): VolunteerCertificationSource["registrations"] {
  if (!Array.isArray(value)) {
    throw new FriendsError({ code: FriendsErrorCode.NetworkProtocol, message: "Unexpected volunteer registration roster" });
  }
  const seen = new Set<string>();
  const registrations: VolunteerCertificationSource["registrations"] = [];
  for (const itemValue of value) {
    const item = object(itemValue);
    if (item === null || typeof item.studentNo !== "string" || item.studentNo === "") {
      throw new FriendsError({ code: FriendsErrorCode.NetworkProtocol, message: "Unexpected volunteer registration item" });
    }
    if (seen.has(item.studentNo)) continue;
    seen.add(item.studentNo);
    registrations.push({
      registrationId: text(item.uuid),
      studentNo: item.studentNo,
      studentName: text(item.studentName),
      postId: text(item.postId),
      postName: text(item.postName),
      postDurationHours: number(item.postDuration) ?? number(item.postDurationHours),
      signDurationHours: number(item.signDuration) ?? number(item.signDurationHours),
      isApplied: boolean(item.isApply),
      upstreamPreselected: item.isAttestation === true,
    });
  }
  return registrations;
}

export function createVolunteerCertificationClient(options: {
  baseUrl: string;
  session: VerifiedVolunteerSession;
  fetch?: typeof fetch;
  timeoutMs?: number;
}) {
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  const fetchImpl = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 60_000;
  const session = { ...options.session };
  if (
    !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 ||
    [session.token, session.userLevel, session.accountUserNo, session.levelNo, session.unitNo]
      .some(value => typeof value !== "string" || !value || /[\r\n]/.test(value)) ||
    session.userLevel !== session.levelNo
  ) {
    throw new FriendsError({ code: FriendsErrorCode.InvalidInput, message: "A complete verified volunteer session is required" });
  }

  async function call(path: string) {
    return callApi(baseUrl, path, session, fetchImpl, timeoutMs);
  }

  async function verify() {
    await createFriendsSdk({ baseUrl, fetch: fetchImpl, timeoutMs }).verifyLocalSession({
      token: session.token, userLevel: session.userLevel, account: { userNo: session.accountUserNo },
      context: { levelNo: session.levelNo, unit: { unitNo: session.unitNo } },
    });
  }

  return {
    async getStudent(studentNo: string): Promise<{ studentNo: string; studentName: string }> {
      if (typeof studentNo !== "string" || !studentNo || /[\s\/?#]/.test(studentNo)) {
        throw new FriendsError({code: FriendsErrorCode.InvalidInput, message: "A student number is required"});
      }
      await verify();
      const envelope = await call(`/${service}/mob/common-business/query-student?studentNo=${encodeURIComponent(studentNo)}`);
      const student = object(envelope.data);
      if (student?.studentNo !== studentNo || !text(student?.studentName)) {
        throw new FriendsError({code: FriendsErrorCode.NetworkProtocol, message: "The school did not return the requested student"});
      }
      return { studentNo, studentName: student.studentName as string };
    },
    async listManageableActivities(): Promise<ManageableVolunteerActivity[]> {
      await verify();
      const envelope = await call(`/${service}/mob/school-activity-apply/manager-activity-list`);
      if (!Array.isArray(envelope.data)) {
        throw new FriendsError({ code: FriendsErrorCode.NetworkProtocol, message: "Unexpected manageable activity list" });
      }
      return envelope.data.map(parseActivity);
    },
    async getCertificationSource(activityIdInput: string): Promise<VolunteerCertificationSource> {
      const id = activityId(activityIdInput);
      const activities = await this.listManageableActivities();
      if (!activities.some((activity) => activity.id === id)) {
        throw new FriendsError({
          code: FriendsErrorCode.PermissionDenied,
          message: "The activity is not manageable in the current volunteer context",
        });
      }
      const detailEnvelope = await call(`/${service}/mob/school-activity-apply/approve-detail/${encodeURIComponent(id)}`);
      const activity = parseDetail(detailEnvelope.data);
      const rosterEnvelope = await call(`/${service}/mob/schoolActivityStudentApply/apply-list-by-activity/${encodeURIComponent(id)}`);
      if (activity.id !== id) {
        throw new FriendsError({ code: FriendsErrorCode.NetworkProtocol, message: "Volunteer detail returned a different activity" });
      }
      return {
        binding: {
          accountUserNo: session.accountUserNo,
          levelNo: session.levelNo,
          unitNo: session.unitNo,
          organizationId: activity.organizationId ?? activities.find((activity) => activity.id === id)?.organizationId ?? null,
          activityId: id,
        },
        activity: {
          id: activity.id,
          name: activity.name,
          organizationName: activity.organizationName,
          positionSetMethod: activity.positionSetMethod,
          posts: activity.posts,
        },
        registrations: parseRegistrations(rosterEnvelope.data),
      };
    },
  };
}
