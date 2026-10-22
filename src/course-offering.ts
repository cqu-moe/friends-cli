import { FriendsError, FriendsErrorCode } from "./errors.js";
import { createFriendsSdk, type VerifiedCourseSession } from "./index.js";

type JsonObject = Record<string, unknown>;

const curriculumService = "zovecenter-saip-ek-app-curriculum";
const mainService = "zovecenter-saip-ek-agg-mob";
const commonPrefix = "/ek-agg-mob/biz-common";
const curriculumPrefix = `/${curriculumService}/mob`;
const attachmentExtensions = new Set([
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "png", "jpg", "jpeg",
  "gif", "bmp", "txt", "rar", "zip", "7z", "mp3", "avi", "wmv", "mpeg", "mp4",
]);
const videoExtensions = new Set(["avi", "wmv", "mpeg", "mp4"]);
const imageTypes = new Set(["image/png", "image/jpg", "image/jpeg", "image/gif", "image/bmp"]);
const dateTimePattern = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?$/;

export interface CourseOfferingSession extends VerifiedCourseSession {}

export interface CourseOfferingRole {
  roleName: string;
  integral: number;
  classHour: number;
}

export interface CourseOfferingApplication {
  schemaVersion: 1;
  kind: "course-offering";
  binding: {
    accountUserNo: string;
    levelNo: string;
    unitNo: string;
    organizationId: string;
  };
  uuid: string | null;
  firstStep: {
    curriculumName: string;
    curriculumType: string;
    curriculumLevel: string;
    curriculumPlace: string;
    beginTime: string;
    endTime: string;
    curriculumContent: string;
    role: CourseOfferingRole;
    attestationType: "AUTO" | "MAN";
    isOpenSign: boolean;
    signNumber: number | null;
    isEnroll: boolean;
    isAppraise: boolean;
  };
  reportSet: {
    openType: "NOW" | "AUTO";
    openTime: string;
    finishType: "NOW" | "AUTO";
    deadline: string;
    isEnrollExamine: boolean;
    isHideList: boolean;
    isDraft: boolean;
    isOrgMember: boolean;
    limitCollegeNo: string[];
    limitGrade: string[];
    limitSpecialtyTypeOne: string[];
    questionnaires: never[];
    posts: never[];
  };
  materials: {
    attachmentGroupUuid: string | null;
    publicityPicturesGroupUuid: string | null;
  };
}

export type PreparedCourseOfferingApplication = CourseOfferingApplication & {
  term: { beginYear: string; endYear: string; termNo: string | number };
  organization: {
    id: string;
    name: string;
    sourceType: string;
    applyLabelCode: string;
    submittedType: "LEAGUE" | "STUDENT";
  };
  typeName: string;
  levelName: string;
  materialGroups: CourseMaterialGroups;
};

export interface CourseMaterialGroups {
  attachmentGroupUuid: string;
  publicityPicturesGroupUuid: string;
}

export interface CourseMaterialUpload {
  kind: "attachment" | "publicity";
  file: Blob & { name: string };
}

export interface CourseMaterialIntent {
  via: "api";
  intent: "stage-course-materials";
  confirm?: boolean;
  dryRun?: boolean;
}

export interface CourseFirstStepIntent {
  via: "api";
  intent: "save-course-first-step";
  confirm?: boolean;
  dryRun?: boolean;
}

export interface CourseFinalIntent {
  via: "api";
  intent: "submit-course-offering";
  confirm?: boolean;
  dryRun?: boolean;
}

export interface StagedCourseMaterials {
  submitted: boolean;
  finalSubmission: false;
  serverAcknowledged: boolean;
  groups: CourseOfferingApplication["materials"];
  items: Array<{
    kind: "attachment" | "publicity";
    fileName: string;
    resourceId: string | null;
    serverAcknowledged: boolean;
  }>;
}

export interface SavedCourseFirstStep {
  submitted: boolean;
  serverAcknowledged: boolean;
  courseId: string | null;
  finalSubmission: false;
}

export interface CourseOfferingStatus {
  id: string;
  name: string | null;
  organization: { id: string | null; name: string | null };
  state: { raw: unknown; known: false };
  flowOverallState: string | number | null;
}

export interface SubmittedCourseOffering {
  submitted: boolean;
  serverAcknowledged: boolean;
  courseId: string;
  status: CourseOfferingStatus;
}

export interface CourseOfferingClient {
  prepare(input: unknown): Promise<PreparedCourseOfferingApplication>;
  stageMaterials(
    prepared: PreparedCourseOfferingApplication,
    files: CourseMaterialUpload[],
    intent: CourseMaterialIntent,
  ): Promise<StagedCourseMaterials>;
  saveFirstStep(
    prepared: PreparedCourseOfferingApplication,
    intent: CourseFirstStepIntent,
  ): Promise<SavedCourseFirstStep>;
  submitFinal(
    prepared: PreparedCourseOfferingApplication,
    intent: CourseFinalIntent,
  ): Promise<SubmittedCourseOffering>;
  status(courseId: string): Promise<CourseOfferingStatus>;
}

function invalid(message: string): never {
  throw new FriendsError({ code: FriendsErrorCode.InvalidInput, message });
}

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

function isObject(value: unknown): value is JsonObject {
  return object(value) !== null;
}

function exactKeys(value: JsonObject, keys: readonly string[]): void {
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) invalid(`Unknown course offering field: ${key}`);
  }
}

function requiredObject(value: unknown, keys: readonly string[], message: string): JsonObject {
  const raw = object(value);
  if (raw === null) invalid(message);
  exactKeys(raw, keys);
  return raw;
}

function requiredText(value: unknown, name: string): string {
  if (typeof value !== "string" || value === "" || /[\r\n\0]/.test(value)) {
    invalid(`${name} must be a non-empty single-line string`);
  }
  return value;
}

function optionalId(value: unknown, name: string): string | null {
  if (value === null) return null;
  const id = requiredText(value, name);
  if (id === "." || id === ".." || /[\\/?#\s]/.test(id)) invalid(`Invalid ${name}`);
  return id;
}

function requiredBoolean(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") invalid(`${name} must be boolean`);
  return value;
}

function requiredFiniteNumber(value: unknown, name: string, minimum: number, maximum: number): number {
  const result = number(value);
  if (result === null || result < minimum || result > maximum) {
    invalid(`${name} must be a finite number between ${minimum} and ${maximum}`);
  }
  return result;
}

function requiredDateTime(value: unknown, name: string): string {
  const result = requiredText(value, name);
  const canonical = result.length === 16 ? `${result}:00` : result;
  const parsed = new Date(`${canonical.replace(" ", "T")}Z`);
  if (!dateTimePattern.test(result) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 19).replace("T", " ") !== canonical) {
    invalid(`${name} must be a real date using YYYY-MM-DD HH:mm or YYYY-MM-DD HH:mm:ss`);
  }
  return result;
}

function stringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== "string" || item === "")) {
    invalid(`${name} must be an array of non-empty strings`);
  }
  return [...value];
}

function validateSession(session: CourseOfferingSession): CourseOfferingSession {
  if (
    !isObject(session) ||
    typeof session.token !== "string" || session.token === "" ||
    typeof session.userLevel !== "string" || session.userLevel === "" ||
    /[\r\n]/.test(session.token + session.userLevel)
  ) invalid("A token and user level are required");
  if (
    typeof session.account?.userNo !== "string" || session.account.userNo === "" ||
    typeof session.context?.levelNo !== "string" || session.context.levelNo === "" ||
    session.context.levelNo !== session.userLevel ||
    typeof session.context.unit?.unitNo !== "string" || session.context.unit.unitNo === ""
  ) invalid("Course offering operations require a matching account and identity context");
  return {
    token: session.token,
    userLevel: session.userLevel,
    account: { userNo: session.account.userNo },
    context: { levelNo: session.context.levelNo, unit: { unitNo: session.context.unit.unitNo } },
  };
}

export function parseCourseOfferingApplication(input: unknown): CourseOfferingApplication {
  const raw = requiredObject(input, [
    "schemaVersion", "kind", "binding", "uuid", "firstStep", "reportSet", "materials",
  ], "Expected a course offering application");
  if (raw.schemaVersion !== 1 || raw.kind !== "course-offering") {
    invalid("Expected schemaVersion 1 and kind course-offering");
  }
  const bindingRaw = requiredObject(raw.binding, [
    "accountUserNo", "levelNo", "unitNo", "organizationId",
  ], "Expected a course offering binding");
  const binding = {
    accountUserNo: requiredText(bindingRaw.accountUserNo, "binding.accountUserNo"),
    levelNo: requiredText(bindingRaw.levelNo, "binding.levelNo"),
    unitNo: requiredText(bindingRaw.unitNo, "binding.unitNo"),
    organizationId: optionalId(bindingRaw.organizationId, "binding.organizationId")!,
  };
  const firstRaw = requiredObject(raw.firstStep, [
    "curriculumName", "curriculumType", "curriculumLevel", "curriculumPlace", "beginTime",
    "endTime", "curriculumContent", "role", "attestationType", "isOpenSign", "signNumber",
    "isEnroll", "isAppraise",
  ], "Expected course first-step fields");
  const roleRaw = requiredObject(firstRaw.role, ["roleName", "integral", "classHour"], "Expected a course role");
  const attestationType = firstRaw.attestationType === "AUTO" || firstRaw.attestationType === "MAN"
    ? firstRaw.attestationType
    : invalid("attestationType must be AUTO or MAN");
  const isOpenSign = requiredBoolean(firstRaw.isOpenSign, "isOpenSign");
  const signNumber = firstRaw.signNumber === null ? null
    : requiredFiniteNumber(firstRaw.signNumber, "signNumber", 1, 100);
  if ((isOpenSign && signNumber === null) || (!isOpenSign && signNumber !== null)) {
    invalid("signNumber is required exactly when isOpenSign is true");
  }
  const beginTime = requiredDateTime(firstRaw.beginTime, "beginTime");
  const endTime = requiredDateTime(firstRaw.endTime, "endTime");
  if (Date.parse(beginTime.replace(" ", "T")) >= Date.parse(endTime.replace(" ", "T"))) {
    invalid("beginTime must be earlier than endTime");
  }
  const curriculumName = requiredText(firstRaw.curriculumName, "curriculumName");
  const curriculumContent = requiredText(firstRaw.curriculumContent, "curriculumContent");
  const curriculumPlace = requiredText(firstRaw.curriculumPlace, "curriculumPlace");
  if (curriculumName.length > 32 || curriculumPlace.length > 32 || curriculumContent.length > 100) {
    invalid("Course name and place are limited to 32 characters; content to 100 characters");
  }
  const reportRaw = requiredObject(raw.reportSet, [
    "openType", "openTime", "finishType", "deadline", "isEnrollExamine", "isHideList",
    "isDraft", "isOrgMember", "limitCollegeNo", "limitGrade", "limitSpecialtyTypeOne",
    "questionnaires", "posts",
  ], "Expected course report-set fields");
  const openType = reportRaw.openType === "NOW" || reportRaw.openType === "AUTO"
    ? reportRaw.openType
    : invalid("openType must be NOW or AUTO");
  const finishType = reportRaw.finishType === "NOW" || reportRaw.finishType === "AUTO"
    ? reportRaw.finishType
    : invalid("finishType must be NOW or AUTO");
  if (reportRaw.isDraft !== false) invalid("Only final report settings are supported; isDraft must be false");
  if (!Array.isArray(reportRaw.questionnaires) || reportRaw.questionnaires.length > 0) {
    invalid("Non-empty course questionnaires are not supported yet");
  }
  if (!Array.isArray(reportRaw.posts) || reportRaw.posts.length > 0) {
    invalid("Non-empty course posts are not supported yet");
  }
  for (const name of ["limitCollegeNo", "limitGrade", "limitSpecialtyTypeOne"] as const) {
    if (stringArray(reportRaw[name], name).length > 0) invalid("Non-empty course audience restrictions are not supported yet");
  }
  const openTime = requiredDateTime(reportRaw.openTime, "openTime");
  const deadline = requiredDateTime(reportRaw.deadline, "deadline");
  if (Date.parse(openTime.replace(" ", "T")) >= Date.parse(deadline.replace(" ", "T"))) {
    invalid("openTime must be earlier than deadline");
  }
  if (Date.parse(deadline.replace(" ", "T")) >= Date.parse(endTime.replace(" ", "T"))) {
    invalid("deadline must be earlier than the course end time");
  }
  const materialRaw = requiredObject(raw.materials, [
    "attachmentGroupUuid", "publicityPicturesGroupUuid",
  ], "Expected course material fields");
  return {
    schemaVersion: 1,
    kind: "course-offering",
    binding,
    uuid: optionalId(raw.uuid, "uuid"),
    firstStep: {
      curriculumName,
      curriculumType: requiredText(firstRaw.curriculumType, "curriculumType"),
      curriculumLevel: requiredText(firstRaw.curriculumLevel, "curriculumLevel"),
      curriculumPlace,
      beginTime,
      endTime,
      curriculumContent,
      role: {
        roleName: requiredText(roleRaw.roleName, "role.roleName"),
        integral: requiredFiniteNumber(roleRaw.integral, "role.integral", 0, 9999.9),
        classHour: requiredFiniteNumber(roleRaw.classHour, "role.classHour", 0, 9999),
      },
      attestationType,
      isOpenSign,
      signNumber,
      isEnroll: requiredBoolean(firstRaw.isEnroll, "isEnroll"),
      isAppraise: requiredBoolean(firstRaw.isAppraise, "isAppraise"),
    },
    reportSet: {
      openType,
      openTime,
      finishType,
      deadline,
      isEnrollExamine: requiredBoolean(reportRaw.isEnrollExamine, "isEnrollExamine"),
      isHideList: requiredBoolean(reportRaw.isHideList, "isHideList"),
      isDraft: false,
      isOrgMember: requiredBoolean(reportRaw.isOrgMember, "isOrgMember"),
      limitCollegeNo: stringArray(reportRaw.limitCollegeNo, "limitCollegeNo"),
      limitGrade: stringArray(reportRaw.limitGrade, "limitGrade"),
      limitSpecialtyTypeOne: stringArray(reportRaw.limitSpecialtyTypeOne, "limitSpecialtyTypeOne"),
      questionnaires: [],
      posts: [],
    },
    materials: {
      attachmentGroupUuid: optionalId(materialRaw.attachmentGroupUuid, "attachmentGroupUuid"),
      publicityPicturesGroupUuid: optionalId(materialRaw.publicityPicturesGroupUuid, "publicityPicturesGroupUuid"),
    },
  };
}

function headers(session: CourseOfferingSession, appKey: string, json = true): Record<string, string> {
  const result: Record<string, string> = {
    "h-zove-token": session.token,
    "h-zove-source": "30100",
    "h-zove-clienttype": "1",
    "h-zove-tenantid": "EK",
    "h-zove-appkey": appKey,
    "h-zove-userlevel": session.userLevel,
  };
  if (json) result["content-type"] = "application/json";
  return result;
}

function newGroupUuid(): string {
  return globalThis.crypto.randomUUID().replace(/-/g, "");
}

function normalizePrepared(value: unknown): PreparedCourseOfferingApplication {
  const raw = requiredObject(value, [
    "schemaVersion", "kind", "binding", "uuid", "firstStep", "reportSet", "materials",
    "term", "organization", "typeName", "levelName", "materialGroups",
  ], "Expected a prepared course offering");
  const application = parseCourseOfferingApplication({
    schemaVersion: raw.schemaVersion,
    kind: raw.kind,
    binding: raw.binding,
    uuid: raw.uuid,
    firstStep: raw.firstStep,
    reportSet: raw.reportSet,
    materials: raw.materials,
  });
  const termRaw = requiredObject(raw.term, ["beginYear", "endYear", "termNo"], "Expected a school term");
  const organizationRaw = requiredObject(raw.organization, ["id", "name", "sourceType", "submittedType", "applyLabelCode"], "Expected a verified course organization");
  if (organizationRaw.submittedType !== "LEAGUE" && organizationRaw.submittedType !== "STUDENT") {
    invalid("Invalid organization submittedType");
  }
  const groupsRaw = requiredObject(raw.materialGroups, ["attachmentGroupUuid", "publicityPicturesGroupUuid"], "Expected material groups");
  return {
    ...application,
    term: {
      beginYear: requiredText(termRaw.beginYear, "term.beginYear"),
      endYear: requiredText(termRaw.endYear, "term.endYear"),
      termNo: typeof termRaw.termNo === "string" && /^[1-9][0-9]*$/.test(termRaw.termNo) ? termRaw.termNo : requiredFiniteNumber(termRaw.termNo, "term.termNo", 1, 12),
    },
    organization: {
      id: requiredText(organizationRaw.id, "organization.id"),
      name: requiredText(organizationRaw.name, "organization.name"),
      sourceType: requiredText(organizationRaw.sourceType, "organization.sourceType"),
      applyLabelCode: requiredText(organizationRaw.applyLabelCode, "organization.applyLabelCode"),
      submittedType: organizationRaw.submittedType,
    },
    typeName: requiredText(raw.typeName, "typeName"),
    levelName: requiredText(raw.levelName, "levelName"),
    materialGroups: {
      attachmentGroupUuid: optionalId(groupsRaw.attachmentGroupUuid, "attachmentGroupUuid") ?? invalid("An attachment group is required"),
      publicityPicturesGroupUuid: optionalId(groupsRaw.publicityPicturesGroupUuid, "publicityPicturesGroupUuid") ?? invalid("A publicity group is required"),
    },
  };
}

function validateIntent(
  intent: unknown,
  expected: string,
  operation: string,
): { dryRun: boolean } {
  const raw = requiredObject(intent, ["via", "intent", "confirm", "dryRun"], `Expected ${operation} intent`);
  if (raw.via !== "api" || raw.intent !== expected) {
    invalid(`${operation} requires independent via=api and intent=${expected}; Ego preparation never authorizes it`);
  }
  if (raw.confirm !== undefined && typeof raw.confirm !== "boolean") invalid("confirm must be boolean");
  if (raw.dryRun !== undefined && typeof raw.dryRun !== "boolean") invalid("dryRun must be boolean");
  const dryRun = raw.dryRun === true;
  if (!dryRun && raw.confirm !== true) invalid(`${operation} requires explicit confirmation`);
  return { dryRun };
}

function definitiveError(error: unknown): error is FriendsError {
  return error instanceof FriendsError && (
    error.code === FriendsErrorCode.AuthRequired ||
    error.code === FriendsErrorCode.PermissionDenied ||
    error.code === FriendsErrorCode.UpstreamBusiness
  );
}

export function createCourseOfferingClient(options: {
  baseUrl: string;
  session: CourseOfferingSession;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): CourseOfferingClient {
  const session = validateSession(options.session);
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  const fetchImpl = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 60_000;
  const identitySdk = createFriendsSdk({ baseUrl, fetch: fetchImpl, timeoutMs });
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) invalid("timeoutMs must be a positive integer");

  async function requestJson(path: string, init: RequestInit): Promise<JsonObject> {
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
        message: "Could not reach the friends course service",
        retryable: init.method === "GET",
        cause,
      });
    }
    if (response.status === 401) throw new FriendsError({ code: FriendsErrorCode.AuthRequired, message: "Friends session expired" });
    if (response.status === 403) throw new FriendsError({ code: FriendsErrorCode.PermissionDenied, message: "The friends API denied this course context" });
    if (!response.ok) {
      throw new FriendsError({ code: FriendsErrorCode.NetworkProtocol, message: `Unexpected friends HTTP status ${response.status}` });
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch (cause) {
      throw new FriendsError({ code: FriendsErrorCode.NetworkProtocol, message: "Invalid course JSON response", cause });
    }
    const envelope = object(body);
    if (!envelope || typeof envelope.code !== "string") {
      throw new FriendsError({ code: FriendsErrorCode.NetworkProtocol, message: "Invalid course response envelope" });
    }
    if (envelope.code !== "0") {
      throw new FriendsError({
        code: FriendsErrorCode.UpstreamBusiness,
        message: text(envelope.message) ?? "The school rejected the course operation",
        upstreamCode: envelope.code,
        requestId: text(envelope.requestId) ?? undefined,
      });
    }
    return envelope;
  }

  async function post(path: string, body: unknown, appKey = curriculumService, json = true) {
    return requestJson(path, {
      method: "POST",
      headers: headers(session, appKey, json),
      body: json ? JSON.stringify(body ?? {}) : body as BodyInit,
    });
  }

  async function get(path: string, appKey = curriculumService) {
    return requestJson(path, { method: "GET", headers: headers(session, appKey) });
  }

  function statusFrom(raw: unknown): CourseOfferingStatus {
    const value = object(raw);
    if (!value) throw new FriendsError({ code: FriendsErrorCode.NetworkProtocol, message: "Unexpected course status response" });
    return {
      id: requiredText(value.uuid, "status.uuid"),
      name: text(value.curriculumName),
      organization: {
        id: optionalId(value.organizationId, "status.organizationId"),
        name: text(value.organizationName),
      },
      state: { raw: typeof value.curriculumState === "string" || typeof value.curriculumState === "number" ? value.curriculumState : null, known: false },
      flowOverallState: typeof value.flowOverallState === "string" || typeof value.flowOverallState === "number" ? value.flowOverallState : null,
    };
  }

  async function readStatus(courseId: string): Promise<CourseOfferingStatus> {
    const id = optionalId(courseId, "courseId");
    if (id === null) invalid("A course UUID is required");
    const envelope = await get(`${curriculumPrefix}/apply/approve-detail/${encodeURIComponent(id)}`);
    const status = statusFrom(envelope.data);
    if (status.id !== id) {
      throw new FriendsError({ code: FriendsErrorCode.NetworkProtocol, message: "Course status does not identify the requested course" });
    }
    return status;
  }

  async function editableStatus(prepared: PreparedCourseOfferingApplication): Promise<CourseOfferingStatus> {
    const current = await readStatus(prepared.uuid!);
    if (current.organization.id !== prepared.organization.id) {
      throw new FriendsError({ code: FriendsErrorCode.UpstreamBusiness, message: "The course belongs to a different organization" });
    }
    // The source offers submit/edit only for draft (1) and returned (3) applications.
    if (!["1", "3"].includes(String(current.flowOverallState))) {
      throw new FriendsError({ code: FriendsErrorCode.UpstreamBusiness, message: "The course state does not allow this offering write" });
    }
    return current;
  }

  async function listGroup(groupUuid: string): Promise<JsonObject[]> {
    const envelope = await post(
      `${commonPrefix}/list-group-resource?groupUuid=${encodeURIComponent(groupUuid)}`,
      null,
      mainService,
      false,
    );
    if (!Array.isArray(envelope.data)) {
      throw new FriendsError({ code: FriendsErrorCode.NetworkProtocol, message: "Invalid material group readback" });
    }
    return envelope.data.map(item => {
      const row = object(item);
      if (!row) throw new FriendsError({ code: FriendsErrorCode.NetworkProtocol, message: "Invalid material group item" });
      return row;
    });
  }

  async function requireUploadedMaterials(prepared: PreparedCourseOfferingApplication): Promise<CourseOfferingApplication["materials"]> {
    const materials = prepared.materials;
    for (const [kind, group] of Object.entries(materials)) {
      if (group === null) continue;
      const rows = await listGroup(group);
      if (rows.length === 0 || rows.some(row => text(row.uuid) === null)) invalid(`The declared course material group is empty or invalid: ${kind}`);
      if (kind === "publicityPicturesGroupUuid" && (rows.length > 5 || rows.some(row => ![".png", ".jpg", ".jpeg", ".gif", ".bmp"].includes(String(row.fileExtension).toLowerCase())))) {
        invalid("The publicity group must contain at most five supported images");
      }
    }
    return materials;
  }

  async function uploadOne(item: CourseMaterialUpload, groupUuid: string): Promise<string> {
    const form = new FormData();
    form.append("files", item.file, item.file.name);
    form.append("groupId", groupUuid);
    const envelope = await post(`${commonPrefix}/protected-file-upload`, form, mainService, false);
    if (!Array.isArray(envelope.data) || typeof envelope.data[0] !== "string" || envelope.data[0] === "") {
      throw new FriendsError({ code: FriendsErrorCode.NetworkProtocol, message: "Invalid material upload response" });
    }
    return envelope.data[0];
  }

  function validateUpload(item: CourseMaterialUpload): void {
    if (!isObject(item) || (item.kind !== "attachment" && item.kind !== "publicity")) {
      invalid("Each course material must be attachment or publicity");
    }
    if (
      !(item.file instanceof Blob) || typeof item.file?.name !== "string" || item.file.name === "" ||
      typeof item.file.type !== "string" || item.file.type === "" ||
      typeof item.file.size !== "number" || !Number.isSafeInteger(item.file.size) || item.file.size <= 0
    ) invalid("Each course material requires a named non-empty file");
    const extension = item.file.name.split(".").pop()?.toLowerCase() ?? "";
    if (item.kind === "publicity") {
      if (!imageTypes.has(item.file.type) || !["png", "jpg", "jpeg", "gif", "bmp"].includes(extension)) {
        invalid("Publicity pictures must be jpg, jpeg, png, gif, or bmp images");
      }
      if (item.file.size > 20 * 1024 * 1024) invalid("Publicity pictures cannot exceed 20 MiB");
      return;
    }
    if (!attachmentExtensions.has(extension)) invalid(`Unsupported attachment extension: ${extension}`);
    const maximum = videoExtensions.has(extension) ? 200 * 1024 * 1024 : 20 * 1024 * 1024;
    if (item.file.size > maximum) invalid("Attachment exceeds the production file size limit");
  }

  function firstStepPayload(
    prepared: PreparedCourseOfferingApplication,
    materials: CourseOfferingApplication["materials"],
  ): JsonObject {
    const first = prepared.firstStep;
    return {
      beginYear: prepared.term.beginYear,
      endYear: prepared.term.endYear,
      termNo: prepared.term.termNo,
      curriculumName: first.curriculumName,
      curriculumContent: first.curriculumContent,
      curriculumPlace: first.curriculumPlace,
      curriculumType: first.curriculumType,
      curriculumLType: first.curriculumType,
      curriculumLevel: first.curriculumLevel,
      organizationId: prepared.organization.id,
      organizationName: prepared.organization.name,
      organizationType: prepared.organization.submittedType,
      applyLabelCode: prepared.organization.applyLabelCode,
      beginTime: first.beginTime,
      endTime: first.endTime,
      attachmentGroupUuid: materials.attachmentGroupUuid,
      publicityPicturesGroupUuid: materials.publicityPicturesGroupUuid,
      roles: [{
        uuid: "",
        roleName: first.role.roleName,
        integral: first.role.integral,
        classHour: first.role.classHour,
      }],
      attestationType: first.attestationType,
      haveRole: "123",
      isAppraise: Number(first.isAppraise),
      isEnroll: Number(first.isEnroll),
      isOpenSign: Number(first.isOpenSign),
      signNumber: first.signNumber,
      uuid: prepared.uuid,
    };
  }

  function finalPayload(prepared: PreparedCourseOfferingApplication): JsonObject {
    const report = prepared.reportSet;
    return {
      deadline: report.deadline,
      openTime: report.openTime,
      finishType: report.finishType,
      openType: report.openType,
      isEnrollExamine: report.isEnrollExamine,
      isHideList: report.isHideList,
      isDraft: report.isDraft,
      isOrgMember: report.isOrgMember,
      limitCollegeNo: report.limitCollegeNo,
      limitGrade: report.limitGrade,
      limitSpecialtyTypeOne: report.limitSpecialtyTypeOne,
      questionnaires: report.questionnaires,
      posts: report.posts,
      uuid: prepared.uuid,
    };
  }

  async function prepare(input: unknown): Promise<PreparedCourseOfferingApplication> {
    const application = parseCourseOfferingApplication(input);
    if (
      application.binding.accountUserNo !== session.account.userNo ||
      application.binding.levelNo !== session.context.levelNo ||
      application.binding.unitNo !== session.context.unit.unitNo
    ) invalid("The course application belongs to a different account or context");
    await identitySdk.verifyLocalSession(session);
    const [years, terms, codes, organizations] = await Promise.all([
      post(`${commonPrefix}/system/vschool-year-list`, {}, mainService),
      post(`${commonPrefix}/term-list`, {}, mainService),
      post(`${commonPrefix}/system/data-code-list/mulit`, { codes: ["KCLX", "QNZYZXNHDJB"] }, mainService),
      post(`${curriculumPrefix}/organization/drop-down`, { currentPage: 1, key: "" }),
    ]);
    if (!Array.isArray(years.data) || !Array.isArray(terms.data) || !isObject(codes.data) || !Array.isArray(organizations.data)) {
      throw new FriendsError({ code: FriendsErrorCode.NetworkProtocol, message: "Invalid course source data" });
    }
    const currentYears = years.data.map(object).filter(item => String(item?.isCurrentYear) === "1");
    const currentTerms = terms.data.map(object).filter(item => String(item?.isCurrentTerm) === "1");
    if (currentYears.length !== 1 || currentTerms.length !== 1) throw new FriendsError({ code: FriendsErrorCode.NetworkProtocol, message: "The school did not return exactly one current year and term" });
    const year = currentYears[0];
    const term = currentTerms[0];
    const schoolYear = text(year?.schoolYear);
    const yearParts = schoolYear?.split("-");
    const termNo = typeof term?.termNo === "string" && /^[1-9][0-9]*$/.test(term.termNo) ? term.termNo : number(term?.termNo);
    if (!schoolYear || yearParts?.length !== 2 || !yearParts.every(part => /^\d{4}$/.test(part)) || termNo === null || !Number.isSafeInteger(Number(termNo)) || Number(termNo) < 1 || Number(termNo) > 12) {
      throw new FriendsError({ code: FriendsErrorCode.NetworkProtocol, message: "The school did not return one current year and term" });
    }
    const codeMap = codes.data;
    const types = Array.isArray(codeMap.KCLX) ? codeMap.KCLX.map(object) : [];
    const levels = Array.isArray(codeMap.QNZYZXNHDJB) ? codeMap.QNZYZXNHDJB.map(object) : [];
    const type = types.find(item => text(item?.dataCode) === application.firstStep.curriculumType);
    const level = levels.find(item => text(item?.dataCode) === application.firstStep.curriculumLevel);
    const typeName = type ? text(type.dataName) : null;
    const levelName = level ? text(level.dataName) : null;
    if (!type || !level) invalid("The selected course type or level is not available");
    if (typeName === null || levelName === null) {
      throw new FriendsError({ code: FriendsErrorCode.NetworkProtocol, message: "The school did not return a named course type and level" });
    }
    const organization = organizations.data.map(object).find(item =>
      text(item?.uuid) === application.binding.organizationId &&
      typeof item?.organizationName === "string" && typeof item?.organizationType === "string"
    );
    if (!organization) {
      throw new FriendsError({
        code: FriendsErrorCode.PermissionDenied,
        message: "The selected organization was not returned for the current course context",
      });
    }
    return {
      ...application,
      term: { beginYear: yearParts[0], endYear: yearParts[1], termNo },
      organization: {
        id: application.binding.organizationId,
        name: organization.organizationName as string,
        sourceType: organization.organizationType as string,
        applyLabelCode: text(organization.labelCode) ?? invalid("The school did not return the organization course label"),
        submittedType: organization.organizationType === "CCYL" ? "LEAGUE" : "STUDENT",
      },
      typeName,
      levelName,
      materialGroups: {
        attachmentGroupUuid: application.materials.attachmentGroupUuid ?? newGroupUuid(),
        publicityPicturesGroupUuid: application.materials.publicityPicturesGroupUuid ?? newGroupUuid(),
      },
    };
  }

  function applicationInput(prepared: PreparedCourseOfferingApplication): CourseOfferingApplication {
    const { term, organization, typeName, levelName, materialGroups, ...application } = prepared;
    return application;
  }

  async function refreshPrepared(value: unknown): Promise<PreparedCourseOfferingApplication> {
    const parsed = normalizePrepared(value);
    const fresh = await prepare(applicationInput(parsed));
    return { ...fresh, materialGroups: parsed.materialGroups };
  }

  return {
    prepare,
    async stageMaterials(value, uploads, intent) {
      const { dryRun } = validateIntent(intent, "stage-course-materials", "course material upload");
      const prepared = await refreshPrepared(value);
      if (uploads === null || !Array.isArray(uploads) || uploads.length === 0) invalid("At least one course material is required");
      for (const item of uploads) validateUpload(item);
      const publicityCount = uploads.filter(item => item.kind === "publicity").length;
      const existingPictures = prepared.materials.publicityPicturesGroupUuid === null ? 0 : (await listGroup(prepared.materials.publicityPicturesGroupUuid)).length;
      if (existingPictures + publicityCount > 5) invalid("At most five course publicity pictures are supported");
      const groups = {
        attachmentGroupUuid: prepared.materials.attachmentGroupUuid ?? (uploads.some(item => item.kind === "attachment") ? prepared.materialGroups.attachmentGroupUuid : null),
        publicityPicturesGroupUuid: prepared.materials.publicityPicturesGroupUuid ?? (publicityCount > 0 ? prepared.materialGroups.publicityPicturesGroupUuid : null),
      };
      if (dryRun) {
        return {
          submitted: false,
          finalSubmission: false,
          serverAcknowledged: false,
          groups,
          items: uploads.map(item => ({
            kind: item.kind,
            fileName: item.file.name,
            resourceId: null,
            serverAcknowledged: false,
          })),
        };
      }
      const items: StagedCourseMaterials["items"] = [];
      for (const item of uploads) {
        const groupUuid = item.kind === "attachment" ? groups.attachmentGroupUuid : groups.publicityPicturesGroupUuid;
        try {
          const resourceId = await uploadOne(item, groupUuid!);
          items.push({ kind: item.kind, fileName: item.file.name, resourceId, serverAcknowledged: true });
        } catch (error) {
          if (definitiveError(error)) {
            throw new FriendsError({
              code: error.code,
              message: error.message,
              upstreamCode: error.upstreamCode,
              requestId: error.requestId,
              recovery: {
                operation: "course-offering.stage-materials",
                input: { ...applicationInput(prepared), materials: groups },
                organizationId: prepared.organization.id,
                materialGroups: groups,
                uploadedMaterials: items,
                serverAcknowledged: false,
                completed: items.map(completed => `uploaded:${completed.kind}:${completed.fileName}`),
              },
            });
          }
          let readback: "matched" | "unmatched" | "unavailable" = "unavailable";
          try {
            const rows = await listGroup(groupUuid!);
            const expectedBase = item.file.name.replace(/\.[^.]+$/, "");
            readback = rows.some(row => text(row.uuid) !== null && (
              text(row.title) === expectedBase ||
              text(row.title) === item.file.name
            )) ? "matched" : "unmatched";
          } catch {
            readback = "unavailable";
          }
          throw new FriendsError({
            code: FriendsErrorCode.UnknownOutcome,
            message: "The school may have accepted a course material. Inspect the group before uploading again; no retry was made.",
            recovery: {
              operation: "course-offering.stage-materials",
              input: { ...applicationInput(prepared), materials: groups },
              organizationId: prepared.organization.id,
              materialGroups: groups,
              uploadedMaterials: items,
              inFlightMaterial: {
                kind: item.kind,
                fileName: item.file.name,
                resourceId: null,
                serverAcknowledged: "unknown",
              },
              serverAcknowledged: "unknown",
              readback,
              completed: [
                ...items.map(completed => `uploaded:${completed.kind}:${completed.fileName}`),
                `readback:${readback}`,
              ],
            },
          });
        }
      }
      return { submitted: true, finalSubmission: false, serverAcknowledged: true, groups, items };
    },
    async saveFirstStep(value, intent) {
      const { dryRun } = validateIntent(intent, "save-course-first-step", "course first-step write");
      const prepared = await refreshPrepared(value);
      const materials = await requireUploadedMaterials(prepared);
      if (prepared.uuid !== null) await editableStatus(prepared);
      if (dryRun) {
        return { submitted: false, serverAcknowledged: false, courseId: prepared.uuid, finalSubmission: false };
      }
      const payload = firstStepPayload(prepared, materials);
      const existing = prepared.uuid !== null;
      try {
        const envelope = existing
          ? await requestJson(`${curriculumPrefix}/apply`, {
              method: "PUT",
              headers: headers(session, curriculumService),
              body: JSON.stringify(payload),
            })
          : await post(`${curriculumPrefix}/apply/next-step`, payload);
        if (existing && envelope.data !== true && text(envelope.data) === null) throw new FriendsError({ code: FriendsErrorCode.NetworkProtocol, message: "Ambiguous course first-step acknowledgement" });
        const courseId = existing ? prepared.uuid : text(envelope.data);
        if (courseId === null) throw new FriendsError({ code: FriendsErrorCode.NetworkProtocol, message: "The school did not return a course UUID" });
        return { submitted: true, serverAcknowledged: true, courseId, finalSubmission: false };
      } catch (error) {
        if (definitiveError(error)) throw error;
        let readback: "matched" | "unmatched" | "unavailable" = "unavailable";
        if (prepared.uuid !== null) {
          try { readback = (await readStatus(prepared.uuid)).id === prepared.uuid ? "matched" : "unmatched"; }
          catch { readback = "unavailable"; }
        }
        throw new FriendsError({
          code: FriendsErrorCode.UnknownOutcome,
          message: "The school may have saved the course first step. Inspect course status before retrying; no retry was made.",
          recovery: {
            operation: "course-offering.save-first-step",
            input: applicationInput(prepared),
            readback,
            organizationId: prepared.organization.id,
            applicationId: prepared.uuid ?? undefined,
            courseId: prepared.uuid ?? undefined,
            materialGroups: materials,
            serverAcknowledged: "unknown",
          },
        });
      }
    },
    async submitFinal(value, intent) {
      const { dryRun } = validateIntent(intent, "submit-course-offering", "course offering submission");
      const prepared = await refreshPrepared(value);
      if (prepared.uuid === null) invalid("A course UUID from the intermediate first step is required");
      const materials = await requireUploadedMaterials(prepared);
      const current = await editableStatus(prepared);
      if (dryRun) {
        return { submitted: false, serverAcknowledged: false, courseId: prepared.uuid, status: current };
      }
      let serverAcknowledged: true | "unknown" = "unknown";
      try {
        const envelope = await post(`${curriculumPrefix}/apply/apply`, finalPayload(prepared));
        if (envelope.data !== true && envelope.data !== null && envelope.data !== prepared.uuid) throw new FriendsError({ code: FriendsErrorCode.NetworkProtocol, message: "Ambiguous course submission acknowledgement" });
        serverAcknowledged = true;
        return {
          submitted: true,
          serverAcknowledged: true,
          courseId: prepared.uuid,
          status: await readStatus(prepared.uuid),
        };
      } catch (error) {
        if (serverAcknowledged === "unknown" && definitiveError(error)) throw error;
        let readback: "matched" | "unmatched" | "unavailable" = "unavailable";
        if (serverAcknowledged === "unknown") {
          try { readback = (await readStatus(prepared.uuid)).id === prepared.uuid ? "matched" : "unmatched"; }
          catch { readback = "unavailable"; }
        }
        throw new FriendsError({
          code: FriendsErrorCode.UnknownOutcome,
          message: "The school may have accepted the course offering. Inspect its status before any new submission; no retry was made.",
          recovery: {
            operation: "course-offering.submit-final",
            input: applicationInput(prepared),
            organizationId: prepared.organization.id,
            applicationId: prepared.uuid,
            courseId: prepared.uuid,
            materialGroups: materials,
            serverAcknowledged,
            readback,
          },
        });
      }
    },
    status: readStatus,
  };
}
