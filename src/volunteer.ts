import { FriendsError, FriendsErrorCode, type WriteRecovery } from "./errors.js";
import type { VolunteerActivityPost } from "./drafts.js";
import type { VerifiedCourseSession } from "./index.js";

declare const volunteerActivityIdBrand: unique symbol;
declare const volunteerRegistrationIdBrand: unique symbol;
export type VolunteerActivityId = string & { readonly [volunteerActivityIdBrand]: true };
export type VolunteerRegistrationId = string & { readonly [volunteerRegistrationIdBrand]: true };

type JsonObject = Record<string, unknown>;

const mainService = "zovecenter-saip-ek-agg-mob";
const volunteerService = "zovecenter-saip-ek-app-young-volunteers";
const volunteerRoot = `/${volunteerService}/mob`;
const registrationReadbackEndpoint = `${volunteerRoot}/school-activity-apply/my-applied-page-list` as const;
const supportedQuestionTypes = new Set(["CHOICE", "MULTIPLE_CHOICE", "TEXT", "NUMBER", "DATE"]);

export type { VolunteerActivityPost } from "./drafts.js";

export interface VolunteerListInput {
  page?: number;
  pageSize?: number;
  keyword?: string;
}

export interface VolunteerQuestionnaireOption {
  id: string;
  name: string | null;
}

export interface VolunteerQuestionnaire {
  id: string;
  activityId: string | null;
  title: string | null;
  type: string;
  mandatory: boolean | null;
  options: VolunteerQuestionnaireOption[];
}

export interface VolunteerActivitySummary {
  id: string | null;
  name: string | null;
  organizationName: string | null;
  type: string | null;
  typeName: string | null;
  category: string | null;
  place: string | null;
  beginTime: string | null;
  endTime: string | null;
  openTime: string | null;
  deadline: string | null;
  isOpenEnrollment: boolean | null;
  state: { raw: string | number | boolean | null; known: false };
}

export interface VolunteerActivityDetail extends VolunteerActivitySummary {
  questionnaires: VolunteerQuestionnaire[];
}

export interface VolunteerActivityPage {
  items: VolunteerActivitySummary[];
  page: number;
  pageSize: number;
  totalCount: number | null;
  hasMore: boolean | null;
  hasMoreSource: "derived-from-pages" | "unknown";
}

export interface VolunteerManageableActivity {
  id: string;
  organizationId: string | null;
  name: string | null;
  activityName: string | null;
  positionSetMethod: string | null;
}

export interface VolunteerRegistrationRequirements {
  activity: VolunteerActivityDetail;
  posts: VolunteerActivityPost[];
  canApply: boolean;
  unsupportedQuestionTypes: string[];
}

export interface VolunteerRegistration {
  id: string | null;
  activityId: string | null;
  studentNo: string | null;
  postId: string | null;
  postName: string | null;
  postDurationHours: number | null;
  state: {
    raw: string | number | boolean | null;
    known: false;
    flowOverallState: number | null;
    message: string | null;
    approved: boolean | null;
  };
}

export interface VolunteerRegistrationRecord {
  activity: VolunteerActivitySummary;
  registration: VolunteerRegistration;
}

export interface VolunteerRegistrationPage {
  items: VolunteerRegistrationRecord[];
  page: number;
  pageSize: number;
  totalCount: number | null;
  hasMore: boolean | null;
  hasMoreSource: "derived-from-pages" | "unknown";
}

export type VolunteerQuestionnaireAnswer =
  | { itemUuid: string; type: "CHOICE"; optionUuid: string }
  | { itemUuid: string; type: "MULTIPLE_CHOICE"; optionUuids: string[] }
  | { itemUuid: string; type: "TEXT" | "NUMBER" | "DATE"; inputContent: string };

export interface VolunteerRegisterInput {
  postId: string;
  questionnaireAnswers?: VolunteerQuestionnaireAnswer[];
}

export interface VolunteerRegisterWriteInput extends VolunteerRegisterInput {
  confirmation: "volunteers.register";
}

export interface VolunteerWriteReceipt {
  serverAcknowledged: true;
  message: string | null;
  requestId: string | null;
  approved: null;
  readbackRequired: true;
}

export interface VolunteerWriteReadback {
  attempted: boolean;
  endpoint: typeof registrationReadbackEndpoint;
  page: 1;
  pageSize: 100;
  coverage: "first-page-only";
  activityFound: boolean;
  matchingRegistration: VolunteerRegistration | null;
  approval: boolean | null;
  error: { code: string; message: string } | null;
}

export interface VolunteerWriteResult {
  receipt: VolunteerWriteReceipt;
  readback: VolunteerWriteReadback;
}

export interface VolunteerRegisterPayload {
  activityId: string;
  postId: string;
  postDuration: number;
  postName: string;
  questionnaireResult: JsonObject[] | null;
  studentNo: string;
  uuid: null;
}

export interface VolunteerRegistrationPreparation {
  activity: VolunteerActivityDetail;
  posts: VolunteerActivityPost[];
  payload: VolunteerRegisterPayload;
}

export interface VolunteerWithdrawalPreparation {
  activity: VolunteerActivityDetail;
  registration: VolunteerRegistration;
}

export interface VolunteerIdentity {
  memberView: { present: boolean; interpreted: false };
  membershipApplicationAllowed: boolean;
}

export interface VolunteerClient {
  getIdentity(): Promise<VolunteerIdentity>;
  listActivities(input?: VolunteerListInput): Promise<VolunteerActivityPage>;
  listManageableActivities(): Promise<VolunteerManageableActivity[]>;
  getActivity(id: VolunteerActivityId): Promise<VolunteerActivityDetail>;
  getRegistrationRequirements(id: VolunteerActivityId): Promise<VolunteerRegistrationRequirements>;
  listRegistrations(input?: VolunteerListInput): Promise<VolunteerRegistrationPage>;
  getRegistration(id: VolunteerRegistrationId): Promise<VolunteerRegistration>;
  prepareRegistration(id: VolunteerActivityId, input: VolunteerRegisterInput): Promise<VolunteerRegistrationPreparation>;
  register(id: VolunteerActivityId, input: VolunteerRegisterWriteInput): Promise<VolunteerWriteResult>;
  prepareWithdrawal(activityId: VolunteerActivityId, registrationId: VolunteerRegistrationId): Promise<VolunteerWithdrawalPreparation>;
  withdraw(activityId: VolunteerActivityId, registrationId: VolunteerRegistrationId, input: {
    confirmation: "volunteers.withdraw";
  }): Promise<VolunteerWriteResult>;
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function boolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function object(value: unknown): JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function invalid(message: string): never {
  throw new FriendsError({ code: FriendsErrorCode.InvalidInput, message });
}

function protocol(message: string): never {
  throw new FriendsError({ code: FriendsErrorCode.NetworkProtocol, message });
}

export function volunteerActivityId(value: string): VolunteerActivityId {
  if (typeof value !== "string" || value.trim() === "" || value === "." || value === ".." || /[\\/?#\s]/.test(value)) {
    invalid("Invalid volunteer activity ID");
  }
  return value as VolunteerActivityId;
}

export function volunteerRegistrationId(value: string): VolunteerRegistrationId {
  if (typeof value !== "string" || value.trim() === "" || value === "." || value === ".." || /[\\/?#\s]/.test(value)) {
    invalid("Invalid volunteer registration ID");
  }
  return value as VolunteerRegistrationId;
}

export function validateVolunteerListInput(input: VolunteerListInput = {}) {
  if (!object(input)) invalid("Expected volunteer query input");
  const page = input.page ?? 1;
  const pageSize = input.pageSize ?? 10;
  if (!Number.isSafeInteger(page) || page < 1) invalid("page must be a positive integer");
  if (!Number.isSafeInteger(pageSize) || pageSize < 1) invalid("pageSize must be a positive integer");
  if (input.keyword !== undefined && typeof input.keyword !== "string") invalid("keyword must be a string");
  return { page, pageSize, keyword: input.keyword ?? "" };
}

function headers(token: string, userLevel: string, appKey: string): Record<string, string> {
  return {
    "content-type": "application/json",
    "h-zove-token": token,
    "h-zove-source": "30100",
    "h-zove-clienttype": "1",
    "h-zove-tenantid": "EK",
    "h-zove-appkey": appKey,
    "h-zove-userlevel": userLevel,
  };
}

async function readApi(options: {
  baseUrl: string;
  path: string;
  init: RequestInit;
  fetchImpl: typeof fetch;
  timeoutMs: number;
}) {
  let response: Response;
  try {
    response = await options.fetchImpl(new URL(`${options.baseUrl}${options.path}`), {
      ...options.init,
      redirect: "error",
      signal: AbortSignal.timeout(options.timeoutMs),
    });
  } catch (cause) {
    throw new FriendsError({
      code: FriendsErrorCode.NetworkProtocol,
      message: "Could not reach the friends gateway",
      retryable: true,
      cause,
    });
  }
  if (response.status === 401) throw new FriendsError({ code: FriendsErrorCode.AuthRequired, message: "Friends session expired" });
  if (response.status === 403) throw new FriendsError({ code: FriendsErrorCode.PermissionDenied, message: "The friends API denied this context" });
  if (!response.ok) {
    throw new FriendsError({ code: FriendsErrorCode.NetworkProtocol, message: `Unexpected friends HTTP status ${response.status}` });
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
  return businessEnvelope(payload, response.status);
}

function businessEnvelope(payload: unknown, httpStatus: number) {
  const envelope = object(payload);
  if (!envelope || typeof envelope.code !== "string") {
    protocol(`Unexpected friends response envelope (HTTP ${httpStatus})`);
  }
  if (envelope.code !== "0") {
    throw new FriendsError({
      code: FriendsErrorCode.UpstreamBusiness,
      message: text(envelope.message) ?? "Friends API returned a business error",
      upstreamCode: envelope.code,
      requestId: text(envelope.requestId) ?? undefined,
    });
  }
  return envelope;
}

async function writeApi(options: Parameters<typeof readApi>[0] & { recovery: WriteRecovery }) {
  let response: Response;
  try {
    response = await options.fetchImpl(new URL(`${options.baseUrl}${options.path}`), {
      ...options.init,
      redirect: "error",
      signal: AbortSignal.timeout(options.timeoutMs),
    });
  } catch {
    unknownOutcome(options.recovery, "The volunteer write request could not be completed");
  }
  if (response.status === 401) throw new FriendsError({ code: FriendsErrorCode.AuthRequired, message: "Friends session expired" });
  if (response.status === 403) throw new FriendsError({ code: FriendsErrorCode.PermissionDenied, message: "The friends API denied this context" });
  if (response.status >= 500) unknownOutcome(options.recovery, "The friends API returned an uncertain write status");
  if (!response.ok) {
    throw new FriendsError({ code: FriendsErrorCode.NetworkProtocol, message: `Unexpected friends HTTP status ${response.status}` });
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    unknownOutcome(options.recovery, "The friends API write response could not be read");
  }
  try {
    return businessEnvelope(payload, response.status);
  } catch (error) {
    if (error instanceof FriendsError && error.code === FriendsErrorCode.NetworkProtocol) {
      unknownOutcome(options.recovery, "The friends API returned an invalid write envelope");
    }
    throw error;
  }
}

function unknownOutcome(recovery: WriteRecovery, message: string): never {
  throw new FriendsError({
    code: FriendsErrorCode.UnknownOutcome,
    message: `${message}; query its state before another attempt`,
    recovery,
  });
}

function activityFields(raw: JsonObject): VolunteerActivitySummary {
  return {
    id: text(raw.uuid),
    name: text(raw.activityName),
    organizationName: text(raw.organizationName),
    type: text(raw.activityType),
    typeName: text(raw.activityTypeName),
    category: text(raw.activityCategory),
    place: text(raw.activityPlace),
    beginTime: text(raw.beginTime),
    endTime: text(raw.endTime),
    openTime: text(raw.openTime),
    deadline: text(raw.deadline),
    isOpenEnrollment: boolean(raw.isOpenEnrollment),
    state: {
      raw: text(raw.activityState) ?? number(raw.activityState) ?? boolean(raw.activityState),
      known: false,
    },
  };
}

function registrationFields(raw: JsonObject): VolunteerRegistration {
  const flowOverallState = number(raw.flowOverallState);
  return {
    id: text(raw.uuid),
    activityId: text(raw.activityId),
    studentNo: text(raw.studentNo),
    postId: text(raw.postId),
    postName: text(raw.postName),
    postDurationHours: number(raw.postDuration),
    state: {
      raw: text(raw.flowCurrMsg) ?? flowOverallState,
      known: false,
      flowOverallState,
      message: text(raw.flowCurrMsg),
      approved: flowOverallState === 7 ? true : flowOverallState === 3 || flowOverallState === 5 ? false : null,
    },
  };
}

function parsePage(rawData: unknown, query: ReturnType<typeof validateVolunteerListInput>) {
  const raw = object(rawData);
  if (!raw || !Array.isArray(raw.data)) protocol("Unexpected volunteer page envelope");
  const pages = number(raw.pages);
  const page = number(raw.currentPage) ?? query.page;
  const pageSize = number(raw.pageSize) ?? query.pageSize;
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1) {
    protocol("Unexpected volunteer pagination metadata");
  }
  return {
    page,
    pageSize,
    totalCount: number(raw.totalCount),
    hasMore: pages === null ? null : page < pages,
    hasMoreSource: pages === null ? "unknown" as const : "derived-from-pages" as const,
  };
}

function parseDetail(rawData: unknown): VolunteerActivityDetail {
  const raw = object(rawData);
  if (!raw) protocol("Unexpected volunteer activity detail envelope");
  const questionnaires = Array.isArray(raw.questionnaires)
    ? raw.questionnaires.map((item) => {
      const value = object(item);
      if (!value || typeof value.uuid !== "string" || typeof value.itemType !== "string") {
        protocol("Unexpected volunteer questionnaire");
      }
      return {
        id: value.uuid,
        activityId: text(value.activityId),
        title: text(value.title),
        type: value.itemType,
        mandatory: boolean(value.isMandatory),
        options: Array.isArray(value.options)
          ? value.options.map((option) => {
            const rawOption = object(option);
            if (!rawOption || typeof rawOption.uuid !== "string") protocol("Unexpected volunteer questionnaire option");
            return { id: rawOption.uuid, name: text(rawOption.optionName) };
          })
          : [],
      };
    })
    : [];
  return { ...activityFields(raw), questionnaires };
}

function parsePosts(rawData: unknown): VolunteerActivityPost[] {
  if (!Array.isArray(rawData)) protocol("Unexpected volunteer posts envelope");
  return rawData.map((item) => {
    const raw = object(item);
    if (!raw || typeof raw.uuid !== "string") protocol("Unexpected volunteer post");
    return { id: raw.uuid, name: text(raw.postName), durationHours: number(raw.duration) };
  });
}

function parseTime(value: string | null): number | null {
  if (value === null) return null;
  const time = Date.parse(`${value.replace(/-/g, "/")}`);
  return Number.isNaN(time) ? null : time;
}

function checkRegistrationWindow(activity: VolunteerActivitySummary) {
  if (activity.state.raw === "CANCELED") invalid("Volunteer activity is canceled");
  if (activity.isOpenEnrollment === false) invalid("Volunteer activity is not open for enrollment");
  const now = Date.now();
  const open = parseTime(activity.openTime);
  const deadline = parseTime(activity.deadline);
  if ((open !== null && now < open) || (deadline !== null && now > deadline)) {
    invalid("Volunteer registration window is closed");
  }
}

function checkedAnswer(input: unknown, item: JsonObject): JsonObject {
  const answer = object(input);
  if (
    !answer || answer.itemUuid !== item.uuid ||
    (answer.type === "CHOICE" || answer.type === "MULTIPLE_CHOICE" || answer.type === "TEXT" || answer.type === "NUMBER" || answer.type === "DATE") === false ||
    answer.type !== item.itemType
  ) invalid(`Questionnaire answer type does not match ${String(item.title ?? item.uuid)}`);
  return answer;
}

function buildQuestionnaireResult(
  questions: JsonObject[],
  answers: unknown[],
  studentNo: string,
): JsonObject[] {
  const questionIds = new Set(questions
    .map((item) => (typeof item.uuid === "string" ? item.uuid : null))
    .filter((id): id is string => id !== null));
  const byId = new Map(answers.map((answer) => {
    const value = object(answer);
    if (!value || typeof value.itemUuid !== "string") invalid("Questionnaire answer requires itemUuid");
    return [value.itemUuid, value];
  }));
  if (byId.size !== answers.length) invalid("Duplicate questionnaire answer");
  if ([...byId.keys()].some((id) => !questionIds.has(id))) {
    invalid("Questionnaire answer does not belong to this activity");
  }
  return questions.map((item) => {
    if (typeof item.uuid !== "string" || typeof item.itemType !== "string" || typeof item.title !== "string") {
      protocol("Unexpected volunteer questionnaire");
    }
    if (!supportedQuestionTypes.has(item.itemType)) {
      invalid(`Unsupported volunteer questionnaire type ${item.itemType}: uploads are not implemented`);
    }
    const answer = byId.get(item.uuid);
    if (answer !== undefined) checkedAnswer(answer, item);
    const mandatory = item.isMandatory === true;
    const rawOptions = Array.isArray(item.options) ? item.options : [];
    const optionObjects = rawOptions.map((option) => object(option)).filter((option): option is JsonObject => option !== null);
    let optionUuid = "";
    let multipartChoice: JsonObject[] | null = null;
    let inputContent = "";
    if (item.itemType === "CHOICE") {
      if (answer === undefined) {
        if (mandatory) invalid(`Missing required questionnaire answer: ${item.title}`);
      } else {
        const selected = answer.optionUuid;
        if (typeof selected !== "string" || selected === "") {
          invalid("CHOICE questionnaire answer requires optionUuid");
        }
        if (!optionObjects.some((option) => option.uuid === selected)) {
          invalid("Questionnaire option does not belong to its activity question");
        }
        optionUuid = selected;
      }
    } else if (item.itemType === "MULTIPLE_CHOICE") {
      const selected = answer === undefined ? [] : answer.optionUuids;
      if (!Array.isArray(selected) || selected.some((option) => typeof option !== "string")) {
        invalid("MULTIPLE_CHOICE answer requires optionUuids");
      }
      if (selected.length === 0 && mandatory) invalid(`Missing required questionnaire answer: ${item.title}`);
      if (new Set(selected).size !== selected.length) invalid("Duplicate questionnaire option answer");
      if (!selected.every((option) => optionObjects.some((rawOption) => rawOption.uuid === option))) {
        invalid("Questionnaire option does not belong to its activity question");
      }
      multipartChoice = selected.map((optionUuidValue) => {
        const rawOption = optionObjects.find((option) => option.uuid === optionUuidValue) ?? {};
        return { ...rawOption, optionUuid: optionUuidValue };
      });
    } else {
      if (answer === undefined) {
        if (mandatory) invalid(`Missing required questionnaire answer: ${item.title}`);
      } else {
        const content = answer.inputContent;
        if (typeof content !== "string" || content === "") {
          invalid(`${item.itemType} questionnaire answer requires inputContent`);
        }
        inputContent = content;
      }
      if (item.itemType === "NUMBER" && inputContent !== "" && (!/^\d+$/.test(inputContent) || Number(inputContent) > 9999)) {
        invalid("NUMBER questionnaire answer must be an integer up to 9999");
      }
    }
    return {
      activityId: item.activityId ?? "",
      itemType: item.itemType,
      itemUuid: item.uuid,
      optionUuid,
      uuid: item.uuid,
      studentNo,
      title: item.title,
      multipartChoice,
      inputContent,
      attachmentGroupUuid: "",
    };
  });
}

async function activateSession(options: {
  baseUrl: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  session: VerifiedCourseSession;
}): Promise<"STUDENT" | "TEACHER"> {
  const input = options.session;
  if (
    !input || typeof input.token !== "string" || input.token === "" ||
    typeof input.userLevel !== "string" || input.userLevel === "" ||
    /[\r\n]/.test(input.token + input.userLevel) ||
    typeof input.account?.userNo !== "string" ||
    input.context?.levelNo !== input.userLevel || typeof input.context?.unit?.unitNo !== "string"
  ) invalid("A verified account and matching volunteer context are required");
  const identityHeaders = headers(input.token, input.userLevel, mainService);
  const init = { method: "POST", headers: identityHeaders, body: "{}" };
  const [levels, info] = await Promise.all([
    readApi({ ...options, path: "/ek-agg-mob/user/checkUserAndGetUserLevel", init }),
    readApi({ ...options, path: "/ek-agg-mob/user/info", init }),
  ]);
  const levelData = object(levels.data);
  const infoData = object(info.data);
  const contexts = Array.isArray(levelData?.loginLevels) ? levelData.loginLevels : [];
  const matchesContext = contexts.some((levelValue) => {
    const level = object(levelValue);
    return level?.levelNo === input.context.levelNo && Array.isArray(level.units) &&
      level.units.some((unitValue) => object(unitValue)?.unitNo === input.context.unit.unitNo);
  });
  if (infoData?.userNo !== input.account.userNo || !matchesContext) {
    throw new FriendsError({ code: FriendsErrorCode.AuthRequired, message: "The volunteer session no longer matches; log in again" });
  }
  const userLoginType = text(levelData?.userLoginType);
  const userType = userLoginType === "STUDENT" || userLoginType === "STUDENT_UNACTIVATED"
    ? "STUDENT"
    : userLoginType === "TEACHER" || userLoginType === "OTHER" ? "TEACHER" : undefined;
  if (userType === undefined) protocol("Unsupported friends userLoginType");
  const entered = await readApi({
    ...options,
    path: "/ek-agg-mob/user/enterHall",
    init: {
      method: "POST",
      headers: identityHeaders,
      body: JSON.stringify({ departNo: input.context.unit.unitNo, userStateLevel: input.context.levelNo, userType }),
    },
  });
  const enteredData = object(entered.data);
  if (
    enteredData?.account !== input.account.userNo ||
    enteredData?.userLoginStateLevel !== input.context.levelNo ||
    enteredData?.departmentNo !== input.context.unit.unitNo
  ) protocol("enterHall returned a different volunteer account");
  return userType;
}

export function createVolunteerClient(options: {
  session: VerifiedCourseSession;
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): VolunteerClient {
  if (!object(options) || !object(options.session)) invalid("Expected volunteer client options");
  const baseUrl = (options.baseUrl ?? "https://friends.cqu.edu.cn/gateway").replace(/\/$/, "");
  const fetchImpl = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 60_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) invalid("timeoutMs must be a positive integer");
  const session = structuredClone(options.session);
  const requestHeaders = headers(session.token, session.userLevel, volunteerService);
  let activated = false;
  let activatedUserType: "STUDENT" | "TEACHER" | undefined;
  let activationPromise: Promise<void> | undefined;
  function ensureActivated(): Promise<void> {
    if (activated) return Promise.resolve();
    activationPromise ??= activateSession({ baseUrl, fetchImpl, timeoutMs, session })
      .then((userType) => {
        activatedUserType = userType;
        activated = true;
      })
      .finally(() => {
        activationPromise = undefined;
      });
    return activationPromise;
  }
  async function call(path: string, init: RequestInit) {
    await ensureActivated();
    return readApi({ baseUrl, path, init, fetchImpl, timeoutMs });
  }
  async function callWrite(path: string, init: RequestInit, recovery: WriteRecovery) {
    await ensureActivated();
    return writeApi({ baseUrl, path, init, fetchImpl, timeoutMs, recovery });
  }
  function requireStudentSession() {
    if (activatedUserType !== "STUDENT") invalid("Volunteer registration operations require a student session");
  }
  function receipt(envelope: JsonObject): VolunteerWriteReceipt {
    return {
      serverAcknowledged: true,
      message: text(envelope.message),
      requestId: text(envelope.requestId),
      approved: null,
      readbackRequired: true,
    };
  }
  async function detail(id: VolunteerActivityId): Promise<JsonObject> {
    volunteerActivityId(id);
    const envelope = await call(
      `${volunteerRoot}/school-activity-apply/approve-detail/${encodeURIComponent(id)}`,
      { method: "GET", headers: requestHeaders },
    );
    const raw = object(envelope.data);
    if (!raw) protocol("Unexpected volunteer activity detail envelope");
    if (raw.uuid !== id) invalid("Activity detail does not match requested volunteer activity ID");
    return raw;
  }
  async function posts(id: VolunteerActivityId): Promise<VolunteerActivityPost[]> {
    const envelope = await call(
      `${volunteerRoot}/school-activity-apply/post/${encodeURIComponent(id)}`,
      { method: "GET", headers: requestHeaders },
    );
    return parsePosts(envelope.data);
  }

  async function prepareRegistration(id: VolunteerActivityId, input: VolunteerRegisterInput) {
    volunteerActivityId(id);
    if (!object(input) || typeof input.postId !== "string" || input.postId === "") invalid("postId is required");
    if (input.questionnaireAnswers !== undefined && !Array.isArray(input.questionnaireAnswers)) {
      invalid("questionnaireAnswers must be an array");
    }
    const [rawDetail, activityPosts, canApply] = await Promise.all([
      detail(id),
      posts(id),
      call(`${volunteerRoot}/schoolActivityStudentApply/can-apply/${encodeURIComponent(id)}`, {
        method: "GET",
        headers: requestHeaders,
      }),
    ]);
    const activity = parseDetail(rawDetail);
    requireStudentSession();
    checkRegistrationWindow(activity);
    const existingRegistration = rawDetail.studentApplied;
    if (existingRegistration !== null && existingRegistration !== undefined) {
      const studentApplied = object(existingRegistration);
      if (studentApplied === null) protocol("Unexpected existing volunteer registration");
      if (studentApplied.studentNo !== undefined && studentApplied.studentNo !== session.account.userNo) {
        invalid("Existing volunteer registration belongs to another student");
      }
      invalid("This account already has a volunteer registration for the activity");
    }
    if (canApply.data !== true) invalid("The school API says this account cannot apply now");
    const post = activityPosts.find((candidate) => candidate.id === input.postId);
    if (post === undefined) invalid("Post does not belong to this volunteer activity");
    if (post.durationHours === null) invalid("Volunteer post duration is missing");
    const questions = Array.isArray(rawDetail.questionnaires) ? rawDetail.questionnaires : [];
    if (questions.some((question) => {
      const value = object(question);
      return value !== null && value.activityId !== undefined && value.activityId !== null && value.activityId !== id;
    })) invalid("Questionnaire does not belong to this volunteer activity");
    const questionnaireResult = buildQuestionnaireResult(
      questions.map((question) => object(question)).filter((question): question is JsonObject => question !== null),
      input.questionnaireAnswers ?? [],
      session.account.userNo,
    );
    return {
      activity,
      posts: activityPosts,
      payload: {
        activityId: id,
        postId: post.id,
        postDuration: post.durationHours,
        postName: post.name ?? "",
        questionnaireResult: questionnaireResult.length === 0 ? null : questionnaireResult,
        studentNo: session.account.userNo,
        uuid: null,
      },
    };
  }

  async function prepareWithdrawal(activityId: VolunteerActivityId, registrationId: VolunteerRegistrationId) {
    volunteerActivityId(activityId);
    volunteerRegistrationId(registrationId);
    const [activityEnvelope, registrationEnvelope] = await Promise.all([
      detail(activityId),
      call(`${volunteerRoot}/schoolActivityStudentApply/${encodeURIComponent(registrationId)}`, {
        method: "GET",
        headers: requestHeaders,
      }),
    ]);
    const activity = parseDetail(activityEnvelope);
    requireStudentSession();
    const rawRegistration = object(registrationEnvelope.data);
    if (!rawRegistration || rawRegistration.uuid !== registrationId) {
      invalid("Registration detail does not match requested volunteer registration ID");
    }
    if (rawRegistration.activityId !== activityId) invalid("Registration does not belong to this volunteer activity");
    if (rawRegistration.studentNo !== session.account.userNo) {
      invalid("Volunteer registration belongs to another student");
    }
    const registration = registrationFields(rawRegistration);
    if (registration.state.approved !== true) invalid("Only an approved volunteer registration can be quit");
    checkRegistrationWindow(activity);
    return { activity, registration };
  }

  async function readbackRegistrations(activityId: VolunteerActivityId, registrationId?: string): Promise<VolunteerWriteReadback> {
    let endpointAttempted = false;
    const failed = {
      attempted: false,
      endpoint: registrationReadbackEndpoint,
      page: 1 as const,
      pageSize: 100 as const,
      coverage: "first-page-only" as const,
      activityFound: false,
      matchingRegistration: null,
      approval: null,
      error: null,
    };
    try {
      const envelope = await call(registrationReadbackEndpoint, {
        method: "POST",
        headers: requestHeaders,
        body: JSON.stringify({
          currentPage: 1,
          pageSize: 100,
          classNo: "",
          collegeNo: "",
          specialtyNo: "",
          specialtyType: "",
          key: "",
          activityLevel: "",
          activityState: "",
          activityType: "",
          activityCategory: "",
          isInstructor: false,
          state: "",
        }),
      });
      endpointAttempted = true;
      const pagination = parsePage(envelope.data, { page: 1, pageSize: 100, keyword: "" });
      const raw = object(envelope.data);
      const rows = raw?.data;
      if (!Array.isArray(rows) || pagination.page !== 1) protocol("Unexpected personal volunteer registration page");
      const records = rows.map((item) => {
        const value = object(item);
        if (value === null) protocol("Unexpected personal volunteer registration item");
        const studentApplied = object(value.studentApplied);
        if (!studentApplied || typeof studentApplied.uuid !== "string") {
          protocol("Unexpected personal volunteer registration item");
        }
        return { activity: activityFields(value), registration: registrationFields(studentApplied) };
      });
      const matches = records.filter((record) =>
        record.activity.id === activityId &&
        (registrationId === undefined || record.registration.id === registrationId));
      const matchingRegistration = matches[0]?.registration ?? null;
      return {
        attempted: true,
        endpoint: registrationReadbackEndpoint,
        page: 1,
        pageSize: 100,
        coverage: "first-page-only",
        activityFound: records.some((record) => record.activity.id === activityId),
        matchingRegistration,
        approval: matchingRegistration?.state.approved ?? null,
        error: null,
      };
    } catch (error) {
      const failure = error instanceof FriendsError
        ? error
        : new FriendsError({ code: FriendsErrorCode.NetworkProtocol, message: "Volunteer readback failed" });
      return { ...failed, attempted: endpointAttempted, error: { code: failure.code, message: failure.message } };
    }
  }


  return {
    async getIdentity() {
      const [memberView, canApply] = await Promise.all([
        call(`${volunteerRoot}/member/student-view`, { method: "GET", headers: requestHeaders }),
        call(`${volunteerRoot}/member-apply/can-apply`, { method: "GET", headers: requestHeaders }),
      ]);
      return {
        memberView: { present: object(memberView.data) !== null, interpreted: false as const },
        membershipApplicationAllowed: canApply.data === true,
      };
    },
    async listActivities(input: VolunteerListInput = {}) {
      const query = validateVolunteerListInput(input);
      const envelope = await call(`${volunteerRoot}/school-activity-apply/student-apply-page-list`, {
        method: "POST",
        headers: requestHeaders,
        body: JSON.stringify({
          currentPage: query.page,
          pageSize: query.pageSize,
          classNo: "",
          collegeNo: "",
          specialtyNo: "",
          specialtyType: "",
          key: query.keyword,
          activityLevel: "",
          activityState: "",
          activityType: "",
          activityCategory: "",
          isInstructor: false,
          state: "",
        }),
      });
      const pagination = parsePage(envelope.data, query);
      const raw = object(envelope.data);
      const rows = raw?.data;
      if (!Array.isArray(rows)) protocol("Unexpected volunteer activity list item");
      const items = rows.map((item) => {
        const value = object(item);
        if (value === null) protocol("Unexpected volunteer activity list item");
        return activityFields(value);
      });
      return {
        ...pagination,
        items,
      };
    },
    async listManageableActivities() {
      const envelope = await call(`${volunteerRoot}/school-activity-apply/manager-activity-list`, {
        method: "GET",
        headers: requestHeaders,
      });
      if (!Array.isArray(envelope.data)) protocol("Unexpected manageable volunteer activity envelope");
      return envelope.data.map((item) => {
        const raw = object(item);
        if (raw === null) protocol("Unexpected manageable volunteer activity item");
        const id = text(raw.uuid);
        if (id === null) protocol("Unexpected manageable volunteer activity ID");
        return {
          id,
          organizationId: text(raw.organizationId),
          name: text(raw.name),
          activityName: text(raw.activityName),
          positionSetMethod: text(raw.positionSetMethod),
        };
      });
    },
    async getActivity(id) {
      return parseDetail(await detail(id));
    },
    async getRegistrationRequirements(id) {
      const [parsedDetail, activityPosts, canApply] = await Promise.all([
        detail(id),
        posts(id),
        call(`${volunteerRoot}/schoolActivityStudentApply/can-apply/${encodeURIComponent(id)}`, {
          method: "GET",
          headers: requestHeaders,
        }),
      ]);
      const parsed = parseDetail(parsedDetail);
      return {
        activity: parsed,
        posts: activityPosts,
        canApply: canApply.data === true,
        unsupportedQuestionTypes: [...new Set(parsed.questionnaires
          .filter((question) => !supportedQuestionTypes.has(question.type))
          .map((question) => question.type))],
      };
    },
    async listRegistrations(input: VolunteerListInput = {}) {
      const query = validateVolunteerListInput(input);
      const envelope = await call(registrationReadbackEndpoint, {
        method: "POST",
        headers: requestHeaders,
        body: JSON.stringify({
          currentPage: query.page,
          pageSize: query.pageSize,
          classNo: "",
          collegeNo: "",
          specialtyNo: "",
          specialtyType: "",
          key: query.keyword,
          activityLevel: "",
          activityState: "",
          activityType: "",
          activityCategory: "",
          isInstructor: false,
          state: "",
        }),
      });
      requireStudentSession();
      const pagination = parsePage(envelope.data, query);
      const raw = object(envelope.data);
      const rows = raw?.data;
      if (!Array.isArray(rows)) protocol("Unexpected personal volunteer registration page");
      return {
        ...pagination,
        items: rows.map((item) => {
          const value = object(item);
          if (value === null) protocol("Unexpected personal volunteer registration item");
          const studentApplied = object(value.studentApplied);
          if (!studentApplied || typeof studentApplied.uuid !== "string") {
            protocol("Unexpected personal volunteer registration item");
          }
          if (studentApplied.studentNo !== session.account.userNo) {
            protocol("Personal volunteer registration list returned another student");
          }
          return {
            activity: activityFields(value),
            registration: registrationFields(studentApplied),
          };
        }),
      };
    },
    async getRegistration(id) {
      volunteerRegistrationId(id);
      const envelope = await call(
        `${volunteerRoot}/schoolActivityStudentApply/${encodeURIComponent(id)}`,
        { method: "GET", headers: requestHeaders },
      );
      const raw = object(envelope.data);
      if (!raw || raw.uuid !== id) invalid("Registration detail does not match requested volunteer registration ID");
      requireStudentSession();
      if (raw.studentNo !== session.account.userNo) {
        invalid("Volunteer registration belongs to another student");
      }
      return registrationFields(raw);
    },
    async prepareRegistration(id, input) {
      return prepareRegistration(id, input);
    },
    async register(id, input) {
      if (!object(input) || input.confirmation !== "volunteers.register") {
        invalid("SDK volunteer registration requires confirmation: volunteers.register");
      }
      const { payload } = await prepareRegistration(id, input);
      const envelope = await callWrite(`${volunteerRoot}/schoolActivityStudentApply/apply`, {
        method: "POST",
        headers: requestHeaders,
        body: JSON.stringify(payload),
      }, { operation: "volunteers.register", activityId: id });
      return { receipt: receipt(envelope), readback: await readbackRegistrations(id) };
    },
    async prepareWithdrawal(activityId, registrationId) {
      return prepareWithdrawal(activityId, registrationId);
    },
    async withdraw(activityId, registrationId, input) {
      if (!object(input) || input.confirmation !== "volunteers.withdraw") {
        invalid("SDK volunteer withdrawal requires confirmation: volunteers.withdraw");
      }
      await prepareWithdrawal(activityId, registrationId);
      const envelope = await callWrite(
        `${volunteerRoot}/schoolActivityStudentApply/quit/${encodeURIComponent(registrationId)}`,
        { method: "DELETE", headers: requestHeaders },
        { operation: "volunteers.withdraw", activityId, registrationId },
      );
      return {
        receipt: receipt(envelope),
        readback: await readbackRegistrations(activityId, registrationId),
      };
    },
  };
}
