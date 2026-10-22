import { FriendsError, FriendsErrorCode } from "./errors.js";

declare const organizationIdBrand: unique symbol;
export type OrganizationId = string & { readonly [organizationIdBrand]: true };
declare const organizationApplicationIdBrand: unique symbol;
export type OrganizationApplicationId = string & {
  readonly [organizationApplicationIdBrand]: true;
};

export type OrganizationAccess = "principal" | "manager" | "member";
export type EditableOrganizationProfileField = "logo" | "backgroundGroupUuid" | "blurb";
export type OrganizationApplicationType = "join" | "exit";
export type OrganizationApplicationDecision = "approve" | "reject";

export interface OrganizationSession {
  token: string;
  userLevel: string;
  account: { userNo: string; userName?: string };
  context: { levelNo: string; unit: { unitNo: string } };
}

export interface OrganizationSummary {
  id: string;
  name: string | null;
  type: string | null;
  access: OrganizationAccess;
  editableFields: EditableOrganizationProfileField[];
}

export interface OrganizationProfile {
  id: string;
  name: string | null;
  type: string | null;
  logo: string | null;
  backgroundGroupUuid: string | null;
  blurb: string | null;
}

export interface OrganizationMember {
  id: string;
  studentNo: string | null;
  name: string | null;
  postUuid: string | null;
  postName: string | null;
  isManager: boolean | null;
  isResponsiblePerson: boolean | null;
}

export interface OrganizationMemberListInput {
  page?: number;
  pageSize?: number;
  keyword?: string;
  postUuid?: string;
  managerOnly?: boolean;
}

export interface OrganizationMemberPage {
  items: OrganizationMember[];
  page: number;
  pageSize: number;
  totalCount: number | null;
  hasMore: boolean | null;
}

export interface OrganizationApplicationListInput {
  page?: number;
  pageSize?: number;
  keyword?: string;
}

export interface OrganizationApplicationSummary {
  id: string;
  organizationId: string | null;
  studentNo: string | null;
  studentName: string | null;
  flowMessage: string | null;
}

export interface OrganizationApplicationRelation {
  id: string | null;
  state: number | null;
  active: boolean | null;
  joinTime: string | null;
  exitTime: string | null;
}

export interface OrganizationApplicationDetail extends OrganizationApplicationSummary {
  relation: OrganizationApplicationRelation | null;
}

export interface OrganizationApplicationPage {
  items: OrganizationApplicationSummary[];
  page: number;
  pageSize: number;
  totalCount: number | null;
  hasMore: boolean | null;
}

export interface PreparedOrganizationApplicationDecision {
  status: "prepared";
  submitted: false;
  organizationId: string;
  applicationId: string;
  type: OrganizationApplicationType;
  decision: OrganizationApplicationDecision;
  message: string;
  time: string;
  relation: OrganizationApplicationRelation | null;
  payload: Readonly<Record<string, unknown>>;
}

export interface DecidedOrganizationApplication {
  status: "decided";
  submitted: true;
  serverAcknowledged: true;
  applicationNoLongerPending: true;
  organizationId: string;
  applicationId: string;
  type: OrganizationApplicationType;
  decision: OrganizationApplicationDecision;
  relation: OrganizationApplicationRelation | null;
}

export interface OrganizationApplicationDecisionIntent {
  via: "api";
  intent: "decide-organization-application";
  confirm: true;
}

export interface OrganizationProfileChanges {
  logo?: string;
  backgroundGroupUuid?: string;
  blurb?: string;
}

export interface PreparedOrganizationProfileUpdate {
  status: "prepared";
  submitted: false;
  organizationId: string;
  changes: OrganizationProfileChanges;
  editRoute: {
    path: string;
    query: { uuid: string; type: "isPrincipal" | "isAdmin" | "isGeneral" };
  };
  payload: Readonly<Record<string, unknown>>;
}

export interface SavedOrganizationProfile {
  status: "saved";
  submitted: true;
  serverAcknowledged: true;
  readback: "matched";
  organizationId: string;
  profile: OrganizationProfile;
}

export interface OrganizationProfileSaveIntent {
  via: "api";
  intent: "save-organization-profile";
  confirm: true;
}

export interface OrganizationClient {
  listManaged(): Promise<OrganizationSummary[]>;
  get(id: OrganizationId): Promise<OrganizationProfile>;
  listMembers(id: OrganizationId, input?: OrganizationMemberListInput): Promise<OrganizationMemberPage>;
  listApplications(
    id: OrganizationId,
    type: OrganizationApplicationType,
    input?: OrganizationApplicationListInput,
  ): Promise<OrganizationApplicationPage>;
  getApplication(
    type: OrganizationApplicationType,
    id: OrganizationApplicationId,
  ): Promise<OrganizationApplicationDetail>;
  prepareApplicationDecision(input: {
    organizationId: OrganizationId;
    applicationId: OrganizationApplicationId;
    type: OrganizationApplicationType;
    decision: OrganizationApplicationDecision;
    message: string;
    time: string;
  }): Promise<PreparedOrganizationApplicationDecision>;
  decideApplication(
    prepared: PreparedOrganizationApplicationDecision,
    intent: OrganizationApplicationDecisionIntent,
  ): Promise<DecidedOrganizationApplication>;
  prepareProfileUpdate(input: {
    organizationId: OrganizationId;
    changes: OrganizationProfileChanges;
  }): Promise<PreparedOrganizationProfileUpdate>;
  saveProfile(
    prepared: PreparedOrganizationProfileUpdate,
    intent: OrganizationProfileSaveIntent,
  ): Promise<SavedOrganizationProfile>;
}

type JsonObject = Record<string, unknown>;

const organizationService = "zovecenter-saip-ek-app-team-organization-manage";
const organizationPrefix = `/${organizationService}/mob`;
const editableFields: EditableOrganizationProfileField[] = ["logo", "backgroundGroupUuid", "blurb"];

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

function nullableText(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function boolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

export function organizationId(value: string): OrganizationId {
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    value === "." ||
    value === ".." ||
    /[\\/?#\s]/.test(value)
  ) {
    invalid("Invalid organization ID");
  }
  return value as OrganizationId;
}

export function organizationApplicationId(value: string): OrganizationApplicationId {
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    value === "." ||
    value === ".." ||
    /[\\/?#\s]/.test(value)
  ) {
    invalid("Invalid organization application ID");
  }
  return value as OrganizationApplicationId;
}

function validateSession(input: OrganizationSession): OrganizationSession {
  if (
    !input ||
    typeof input.token !== "string" ||
    input.token === "" ||
    typeof input.userLevel !== "string" ||
    input.userLevel === "" ||
    /[\r\n]/.test(input.token + input.userLevel)
  ) {
    invalid("A token and user level are required");
  }
  if (
    typeof input.account?.userNo !== "string" ||
    input.account.userNo === "" ||
    typeof input.context?.levelNo !== "string" ||
    input.context.levelNo === "" ||
    input.context.levelNo !== input.userLevel ||
    typeof input.context.unit?.unitNo !== "string" ||
    input.context.unit.unitNo === ""
  ) {
    invalid("Organization queries require a matching account and identity context");
  }
  return {
    token: input.token,
    userLevel: input.userLevel,
    account: { userNo: input.account.userNo },
    context: { levelNo: input.context.levelNo, unit: { unitNo: input.context.unit.unitNo } },
  };
}

function headers(session: OrganizationSession): Record<string, string> {
  return {
    "content-type": "application/json",
    "h-zove-token": session.token,
    "h-zove-source": "30100",
    "h-zove-clienttype": "1",
    "h-zove-tenantid": "EK",
    "h-zove-appkey": organizationService,
    "h-zove-userlevel": session.userLevel,
  };
}

async function callApi(
  baseUrl: string,
  path: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
  timeoutMs: number,
) {
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
  if (!envelope || typeof envelope.code !== "string") {
    throw new FriendsError({
      code: FriendsErrorCode.NetworkProtocol,
      message: `Unexpected friends response envelope (HTTP ${response.status})`,
    });
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

function accessFor(raw: JsonObject, accountUserNo: string): OrganizationAccess {
  return text(raw.responsiblePerson) === accountUserNo
    ? "principal"
    : raw.currentUserIsManager === true
      ? "manager"
      : "member";
}

function routeTypeFor(access: OrganizationAccess): "isPrincipal" | "isAdmin" | "isGeneral" {
  if (access === "principal") return "isPrincipal";
  if (access === "manager") return "isAdmin";
  return "isGeneral";
}

function profileEditRoute(raw: JsonObject, access: OrganizationAccess) {
  const type = text(raw.organizationType);
  const path =
    type === "STUDENT_CLUB"
      ? "/groupManage/studentClubEdit"
      : type === "UNIVERSITY_STUDENT_ORGANIZATION" || type === "COLLEGE_STUDENT_ORGANIZATION"
        ? "/groupManage/studentOrgEdit"
        : null;
  if (path === null) invalid("Profile editing is not supported for this organization type");
  return { path, query: { uuid: requiredId(raw.uuid), type: routeTypeFor(access) } };
}

function requiredId(value: unknown, name = "organization ID"): string {
  const id = text(value);
  if (id === null || id === "." || id === ".." || /[\\/\r\n\0]/.test(id)) {
    invalid(`Invalid ${name}`);
  }
  return id;
}

function summaryFields(raw: JsonObject, session: OrganizationSession): OrganizationSummary {
  const access = accessFor(raw, session.account.userNo);
  const canEditProfile = access === "principal" || (access === "manager" && session.userLevel !== "XS");
  return {
    id: requiredId(raw.uuid),
    name: nullableText(raw.organizationName),
    type: nullableText(raw.organizationType),
    access,
    editableFields: canEditProfile ? [...editableFields] : [],
  };
}

function profileFields(raw: JsonObject): OrganizationProfile {
  return {
    id: requiredId(raw.uuid),
    name: nullableText(raw.organizationName),
    type: nullableText(raw.organizationType),
    logo: nullableText(raw.logo),
    backgroundGroupUuid: nullableText(raw.backgroundGroupUuid),
    blurb: nullableText(raw.blurb),
  };
}

function memberFields(value: unknown): OrganizationMember {
  const raw = object(value);
  if (raw === null) invalid("Unexpected organization member item");
  return {
    id: requiredId(raw.uuid, "member ID"),
    studentNo: nullableText(raw.studentNo),
    name: nullableText(raw.studentName),
    postUuid: nullableText(raw.postUuid),
    postName: nullableText(raw.postName),
    isManager: boolean(raw.isManager),
    isResponsiblePerson: boolean(raw.isResponsiblePerson),
  };
}

function applicationFields(value: unknown): OrganizationApplicationSummary {
  const raw = object(value);
  if (raw === null) invalid("Unexpected organization application item");
  return {
    id: requiredId(raw.uuid, "application ID"),
    organizationId: nullableText(raw.organizationId),
    studentNo: nullableText(raw.studentNo),
    studentName: nullableText(raw.studentName),
    flowMessage: nullableText(raw.flowCurrMsg),
  };
}

function relationFields(value: unknown): OrganizationApplicationRelation | null {
  if (value === null || value === undefined) return null;
  const raw = object(value);
  if (raw === null) invalid("Unexpected organization application relation");
  const state = number(raw.state);
  return {
    id: nullableText(raw.uuid),
    state,
    active: state === null ? null : state === 1,
    joinTime: nullableText(raw.joinTime),
    exitTime: nullableText(raw.exitTime),
  };
}

export function validateOrganizationMemberListInput(
  input: OrganizationMemberListInput = {},
): Required<Pick<OrganizationMemberListInput, "page" | "pageSize" | "keyword">> &
Pick<OrganizationMemberListInput, "postUuid" | "managerOnly"> {
  if (!object(input)) invalid("Expected organization member query input");
  const page = input.page ?? 1;
  const pageSize = input.pageSize ?? 10;
  if (!Number.isSafeInteger(page) || page < 1) invalid("page must be a positive integer");
  if (!Number.isSafeInteger(pageSize) || pageSize < 1) invalid("pageSize must be a positive integer");
  if (input.keyword !== undefined && typeof input.keyword !== "string") invalid("keyword must be a string");
  if (input.postUuid !== undefined && typeof input.postUuid !== "string") invalid("postUuid must be a string");
  if (input.managerOnly !== undefined && typeof input.managerOnly !== "boolean") invalid("managerOnly must be boolean");
  return {
    page,
    pageSize,
    keyword: input.keyword ?? "",
    postUuid: input.postUuid,
    managerOnly: input.managerOnly,
  };
}

export function validateOrganizationApplicationListInput(
  input: OrganizationApplicationListInput = {},
): Required<Pick<OrganizationApplicationListInput, "page" | "pageSize" | "keyword">> {
  if (!object(input)) invalid("Expected organization application query input");
  const page = input.page ?? 1;
  const pageSize = input.pageSize ?? 10;
  if (!Number.isSafeInteger(page) || page < 1) invalid("page must be a positive integer");
  if (!Number.isSafeInteger(pageSize) || pageSize < 1) invalid("pageSize must be a positive integer");
  if (input.keyword !== undefined && typeof input.keyword !== "string") {
    invalid("keyword must be a string");
  }
  return { page, pageSize, keyword: input.keyword ?? "" };
}

function validateApplicationDecisionInput(value: unknown): {
  organizationId: OrganizationId;
  applicationId: OrganizationApplicationId;
  type: OrganizationApplicationType;
  decision: OrganizationApplicationDecision;
  message: string;
  time: string;
} {
  const raw = object(value);
  if (raw === null) invalid("Expected an organization application decision preparation");
  const allowed = ["organizationId", "applicationId", "type", "decision", "message", "time"];
  for (const key of Object.keys(raw)) {
    if (!allowed.includes(key)) invalid(`Unknown organization application preparation field: ${key}`);
  }
  for (const key of allowed) {
    if (raw[key] === undefined) invalid(`Organization application preparation requires ${key}`);
  }
  if (raw.type !== "join" && raw.type !== "exit") invalid("application type must be join or exit");
  if (raw.decision !== "approve" && raw.decision !== "reject") {
    invalid("application decision must be approve or reject");
  }
  if (typeof raw.message !== "string") invalid("message must be a string");
  const message = raw.message.trim();
  if (message === "") invalid("message must not be empty");
  if (message.length > 100) invalid("message exceeds the production 100-character limit");
  if (typeof raw.time !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw.time)) {
    invalid("time must use the production yyyy-MM-dd format");
  }
  const parsed = new Date(`${raw.time}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw.time) {
    invalid("time must be a valid calendar date");
  }
  return {
    organizationId: organizationId(raw.organizationId as string),
    applicationId: organizationApplicationId(raw.applicationId as string),
    type: raw.type,
    decision: raw.decision,
    message,
    time: raw.time,
  };
}

function validatePreparedApplicationDecision(value: unknown): {
  organizationId: OrganizationId;
  applicationId: OrganizationApplicationId;
  type: OrganizationApplicationType;
  decision: OrganizationApplicationDecision;
  message: string;
  time: string;
  payload: Record<string, unknown>;
} {
  const raw = object(value);
  if (raw === null) invalid("Expected a prepared organization application decision");
  const required = [
    "status",
    "submitted",
    "organizationId",
    "applicationId",
    "type",
    "decision",
    "message",
    "time",
    "relation",
    "payload",
  ];
  for (const key of Object.keys(raw)) {
    if (!required.includes(key)) invalid(`Unknown prepared organization application field: ${key}`);
  }
  if (raw.status !== "prepared" || raw.submitted !== false) {
    invalid("Expected an unsubmitted organization application preparation");
  }
  if (raw.type !== "join" && raw.type !== "exit") invalid("application type must be join or exit");
  if (raw.decision !== "approve" && raw.decision !== "reject") {
    invalid("application decision must be approve or reject");
  }
  if (typeof raw.message !== "string" || raw.message.trim() === "" || raw.message.length > 100) {
    invalid("Prepared application message is invalid");
  }
  if (typeof raw.time !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw.time)) {
    invalid("Prepared application time is invalid");
  }
  const payload = object(raw.payload);
  if (payload === null) invalid("Prepared application payload is invalid");
  return {
    organizationId: organizationId(raw.organizationId as string),
    applicationId: organizationApplicationId(raw.applicationId as string),
    type: raw.type,
    decision: raw.decision,
    message: raw.message.trim(),
    time: raw.time,
    payload,
  };
}

function validateApplicationDecisionIntent(value: unknown): OrganizationApplicationDecisionIntent {
  const raw = object(value);
  if (raw === null) invalid("An organization application decision requires independent API intent");
  for (const key of Object.keys(raw)) {
    if (!["via", "intent", "confirm"].includes(key)) {
      invalid(`Unknown organization application decision intent field: ${key}`);
    }
  }
  if (
    raw.via !== "api" ||
    raw.intent !== "decide-organization-application" ||
    raw.confirm !== true
  ) {
    invalid(
      "Organization application decisions require via=api, intent=decide-organization-application, and confirm=true; Ego preparation never authorizes them",
    );
  }
  return { via: "api", intent: "decide-organization-application", confirm: true };
}

function validateProfileChanges(input: OrganizationProfileChanges): OrganizationProfileChanges {
  const raw = object(input);
  if (raw === null) invalid("Expected organization profile changes");
  for (const key of Object.keys(raw)) {
    if (!editableFields.includes(key as EditableOrganizationProfileField)) {
      invalid(`Unknown organization profile field: ${key}`);
    }
  }
  const changes: OrganizationProfileChanges = {};
  for (const field of editableFields) {
    if (raw[field] !== undefined) {
      const value = raw[field];
      if (typeof value !== "string" || value === "") {
        invalid(`${field} must be a non-empty string`);
      }
      changes[field] = value;
    }
  }
  if (Object.keys(raw).length === 0) invalid("At least one profile field is required");
  if (changes.blurb !== undefined && changes.blurb.length > 1000) {
    invalid("blurb exceeds the production 1000-character limit");
  }
  return changes;
}

function validatePreparedProfileUpdate(value: unknown): {
  organizationId: OrganizationId;
  changes: OrganizationProfileChanges;
} {
  const raw = object(value);
  if (
    raw === null ||
    raw.status !== "prepared" ||
    raw.submitted !== false ||
    typeof raw.organizationId !== "string"
  ) {
    invalid("Expected an unsubmitted organization profile preparation");
  }
  return {
    organizationId: organizationId(raw.organizationId),
    changes: validateProfileChanges(raw.changes as OrganizationProfileChanges),
  };
}

function validateSaveIntent(value: unknown): OrganizationProfileSaveIntent {
  const raw = object(value);
  if (raw === null) invalid("An organization profile write requires independent API intent");
  for (const key of Object.keys(raw)) {
    if (!["via", "intent", "confirm"].includes(key)) {
      invalid(`Unknown organization profile write intent field: ${key}`);
    }
  }
  if (
    raw.via !== "api" ||
    raw.intent !== "save-organization-profile" ||
    raw.confirm !== true
  ) {
    invalid(
      "Organization profile saving requires via=api, intent=save-organization-profile, and confirm=true; Ego preparation never authorizes it",
    );
  }
  return { via: "api", intent: "save-organization-profile", confirm: true };
}

function changesMatch(profile: OrganizationProfile, changes: OrganizationProfileChanges) {
  for (const field of editableFields) {
    if (changes[field] !== undefined && profile[field] !== changes[field]) return false;
  }
  return true;
}

/**
 * Creates a client for an already-activated and context-verified session. The
 * public SDK entry point is `createFriendsSdk().createOrganizationClient`.
 */
export function createVerifiedOrganizationClient(options: {
  baseUrl: string;
  session: OrganizationSession;
  fetch?: typeof fetch;
  timeoutMs?: number;
  verifySession?: (session: OrganizationSession) => Promise<void>;
}): OrganizationClient {
  const session = validateSession(options.session);
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  const fetchImpl = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 60_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) invalid("timeoutMs must be a positive integer");
  let managedCache: OrganizationSummary[] | null = null;

  async function request(path: string, init: RequestInit) {
    return callApi(baseUrl, path, init, fetchImpl, timeoutMs);
  }

  async function refreshWriteAuthorization(): Promise<void> {
    await options.verifySession?.(session);
    managedCache = null;
  }

  async function managedOrganizations(): Promise<OrganizationSummary[]> {
    if (managedCache !== null) {
      return managedCache.map((organization) => ({ ...organization }));
    }
    const envelope = await request(`${organizationPrefix}/student-organization-info/my`, {
      method: "POST",
      headers: headers(session),
    });
    if (!Array.isArray(envelope.data)) {
      throw new FriendsError({
        code: FriendsErrorCode.NetworkProtocol,
        message: "Unexpected manageable organization response",
      });
    }
    managedCache = envelope.data.map((value) => {
      const raw = object(value);
      if (raw === null) {
        throw new FriendsError({
          code: FriendsErrorCode.NetworkProtocol,
          message: "Unexpected manageable organization item",
        });
      }
      return summaryFields(raw, session);
    });
    return managedCache.map((organization) => ({ ...organization }));
  }

  async function requireOrganization(id: OrganizationId): Promise<OrganizationSummary> {
    organizationId(id);
    const organizations = await managedOrganizations();
    const match = organizations.find((organization) => organization.id === id);
    if (match === undefined) {
      throw new FriendsError({
        code: FriendsErrorCode.PermissionDenied,
        message: "The organization is not available in the current account context",
        recovery: { operation: "organizations.select", organizationId: id },
      });
    }
    return match;
  }

  async function detail(id: string): Promise<{ raw: JsonObject; profile: OrganizationProfile }> {
    organizationId(id);
    const envelope = await request(
      `${organizationPrefix}/student-organization-info/${encodeURIComponent(id)}`,
      { method: "GET", headers: headers(session) },
    );
    const raw = object(envelope.data);
    if (raw === null || requiredId(raw.uuid) !== id) {
      throw new FriendsError({
        code: FriendsErrorCode.NetworkProtocol,
        message: "Unexpected organization detail response",
      });
    }
    return { raw, profile: profileFields(raw) };
  }

  async function applicationDetail(id: OrganizationApplicationId): Promise<{
    raw: JsonObject;
    summary: OrganizationApplicationSummary;
  }> {
    const applicationIdValue = organizationApplicationId(id);
    const envelope = await request(
      `${organizationPrefix}/student-organization-apply/${encodeURIComponent(applicationIdValue)}`,
      { method: "GET", headers: headers(session) },
    );
    const raw = object(envelope.data);
    if (raw === null || requiredId(raw.uuid, "application ID") !== applicationIdValue) {
      throw new FriendsError({
        code: FriendsErrorCode.NetworkProtocol,
        message: "Unexpected organization application detail response",
      });
    }
    if (nullableText(raw.organizationId) === null || nullableText(raw.studentNo) === null) {
      throw new FriendsError({
        code: FriendsErrorCode.NetworkProtocol,
        message: "Organization application detail omitted its organization or student",
      });
    }
    return { raw, summary: applicationFields(raw) };
  }

  async function applicationRelation(
    organizationIdValue: string,
    studentNo: string,
  ): Promise<OrganizationApplicationRelation | null> {
    const query = new URLSearchParams({
      organizationId: organizationIdValue,
      studentNo,
    });
    const envelope = await request(
      `${organizationPrefix}/student-organization-info/join-exit?${query.toString()}`,
      { method: "GET", headers: headers(session) },
    );
    if (!Array.isArray(envelope.data)) {
      throw new FriendsError({
        code: FriendsErrorCode.NetworkProtocol,
        message: "Unexpected organization application relation response",
      });
    }
    return envelope.data.length === 0 ? null : relationFields(envelope.data[0]);
  }

  async function pendingApprovalState(): Promise<string> {
    const envelope = await request("/biz-common/flow/template-activity-state", {
      method: "POST",
      headers: headers(session),
      body: JSON.stringify({
        businessTypeCode: "社团加入退出申请",
        handleType: "XS02",
      }),
    });
    if (!Array.isArray(envelope.data)) {
      throw new FriendsError({
        code: FriendsErrorCode.NetworkProtocol,
        message: "Unexpected organization approval state response",
      });
    }
    const waiting = envelope.data.flatMap((value) => {
      const raw = object(value);
      return typeof raw?.code === "string" &&
        typeof raw.value === "string" &&
        raw.value.includes("等待")
        ? [raw.code]
        : [];
    });
    if (waiting.length !== 1) {
      throw new FriendsError({
        code: FriendsErrorCode.NetworkProtocol,
        message: "Could not identify exactly one waiting organization approval state",
      });
    }
    return waiting[0];
  }

  async function pendingApplicationPresence(
    input: {
      organizationId: string;
      applicationId: OrganizationApplicationId;
      type: OrganizationApplicationType;
      message: string;
      time: string;
    },
    current: JsonObject,
  ): Promise<boolean> {
    const state = await pendingApprovalState();
    const body = {
      currentPage: 1,
      pageSize: 10,
      applyType: input.type === "join" ? 1 : 0,
      organizationId: input.organizationId,
      key: requiredId(current.studentNo, "application student number"),
      approvalState: state,
    };
    return applicationPageContains(body, input.applicationId);
  }

  async function applicationHasSelectedType(
    organizationIdValue: string,
    type: OrganizationApplicationType,
    applicationIdValue: string,
    studentNo: string,
  ): Promise<boolean> {
    return applicationPageContains(
      {
        pageSize: 10,
        applyType: type === "join" ? 1 : 0,
        organizationId: organizationIdValue,
        key: studentNo,
      },
      organizationApplicationId(applicationIdValue),
    );
  }

  async function applicationPageContains(
    baseBody: Record<string, unknown>,
    applicationIdValue: OrganizationApplicationId,
  ): Promise<boolean> {
    let currentPage = 1;
    let totalPages: number | null = null;
    do {
      const envelope = await request(`${organizationPrefix}/student-organization-apply/approve-list`, {
        method: "POST",
        headers: headers(session),
        body: JSON.stringify({ ...baseBody, currentPage }),
      });
      const page = object(envelope.data);
      if (page === null || !Array.isArray(page.data)) {
        throw new FriendsError({
          code: FriendsErrorCode.NetworkProtocol,
          message: "Unexpected organization application page response",
        });
      }
      if (page.data.some((value) => object(value)?.uuid === applicationIdValue)) return true;
      const responsePage = number(page.currentPage) ?? currentPage;
      const responsePages = number(page.pages);
      if (responsePages !== null) totalPages = responsePages;
      if (page.data.length === 0 || responsePage < currentPage) break;
      currentPage = responsePage + 1;
    } while (totalPages === null || currentPage <= totalPages);
    return false;
  }

  function requireProfileAccess(organization: OrganizationSummary): void {
    if (organization.editableFields.length === 0) {
      throw new FriendsError({
        code: FriendsErrorCode.PermissionDenied,
        message: "The current organization role cannot edit this profile",
        recovery: { operation: "organizations.profile.update", organizationId: organization.id },
      });
    }
  }

  function requireApplicationAccess(organization: OrganizationSummary): void {
    if (organization.access === "member") {
      throw new FriendsError({
        code: FriendsErrorCode.PermissionDenied,
        message: "The current organization role cannot review applications",
        recovery: { operation: "organizations.applications.read", organizationId: organization.id },
      });
    }
  }

  return {
    async listManaged() {
      return managedOrganizations();
    },
    async get(id: OrganizationId) {
      await requireOrganization(id);
      return (await detail(id)).profile;
    },
    async listMembers(id: OrganizationId, input: OrganizationMemberListInput = {}) {
      const organization = await requireOrganization(id);
      const query = validateOrganizationMemberListInput(input);
      const body: Record<string, unknown> = {
        currentPage: query.page,
        pageSize: query.pageSize,
        organizationId: organization.id,
        state: 1,
      };
      if (query.keyword !== "") body.key = query.keyword;
      if (query.postUuid !== undefined) body.postUuid = query.postUuid;
      if (query.managerOnly === true) body.isManager = true;
      const envelope = await request(
        `${organizationPrefix}/student-organization-apply/organizational-members-list`,
        { method: "POST", headers: headers(session), body: JSON.stringify(body) },
      );
      const page = object(envelope.data);
      if (page === null || !Array.isArray(page.data)) {
        throw new FriendsError({
          code: FriendsErrorCode.NetworkProtocol,
          message: "Unexpected organization member page response",
        });
      }
      const pages = number(page.pages);
      return {
        items: page.data.map(memberFields),
        page: number(page.currentPage) ?? query.page,
        pageSize: number(page.pageSize) ?? query.pageSize,
        totalCount: number(page.totalCount),
        hasMore: pages === null ? null : (number(page.currentPage) ?? query.page) < pages,
      };
    },
    async listApplications(
      id: OrganizationId,
      typeInput: OrganizationApplicationType,
      input: OrganizationApplicationListInput = {},
    ) {
      const organization = await requireOrganization(organizationId(id));
      requireApplicationAccess(organization);
      if (typeInput !== "join" && typeInput !== "exit") invalid("application type must be join or exit");
      const query = validateOrganizationApplicationListInput(input);
      const body: Record<string, unknown> = {
        currentPage: query.page,
        pageSize: query.pageSize,
        applyType: typeInput === "join" ? 1 : 0,
        organizationId: organization.id,
      };
      if (query.keyword !== "") body.key = query.keyword;
      const envelope = await request(
        `${organizationPrefix}/student-organization-apply/approve-list`,
        { method: "POST", headers: headers(session), body: JSON.stringify(body) },
      );
      const page = object(envelope.data);
      if (page === null || !Array.isArray(page.data)) {
        throw new FriendsError({
          code: FriendsErrorCode.NetworkProtocol,
          message: "Unexpected organization application page response",
        });
      }
      const pages = number(page.pages);
      return {
        items: page.data.map(applicationFields),
        page: number(page.currentPage) ?? query.page,
        pageSize: number(page.pageSize) ?? query.pageSize,
        totalCount: number(page.totalCount),
        hasMore: pages === null ? null : (number(page.currentPage) ?? query.page) < pages,
      };
    },
    async getApplication(typeInput: OrganizationApplicationType, id: OrganizationApplicationId) {
      if (typeInput !== "join" && typeInput !== "exit") invalid("application type must be join or exit");
      const applicationIdValue = organizationApplicationId(id);
      const envelope = await request(
        `${organizationPrefix}/student-organization-apply/${encodeURIComponent(applicationIdValue)}`,
        { method: "GET", headers: headers(session) },
      );
      const raw = object(envelope.data);
      if (raw === null || requiredId(raw.uuid, "application ID") !== applicationIdValue) {
        throw new FriendsError({
          code: FriendsErrorCode.NetworkProtocol,
          message: "Unexpected organization application detail response",
        });
      }
      const organizationIdValue = nullableText(raw.organizationId);
      if (organizationIdValue === null) {
        throw new FriendsError({
          code: FriendsErrorCode.NetworkProtocol,
          message: "Organization application detail did not identify its organization",
        });
      }
      const organization = await requireOrganization(organizationId(organizationIdValue));
      requireApplicationAccess(organization);
      const studentNo = nullableText(raw.studentNo);
      if (studentNo === null) {
        throw new FriendsError({
          code: FriendsErrorCode.NetworkProtocol,
          message: "Organization application detail did not identify its student",
        });
      }
      if (!(await applicationHasSelectedType(organization.id, typeInput, applicationIdValue, studentNo))) {
        throw new FriendsError({
          code: FriendsErrorCode.UpstreamBusiness,
          message: "The application is not in the selected join or exit list",
          recovery: {
            operation: "organizations.applications.show",
            organizationId: organization.id,
            applicationId: applicationIdValue,
            completed: ["application:type-checked"],
          },
        });
      }
      const relationUrl = `${organizationPrefix}/student-organization-info/join-exit?organizationId=${encodeURIComponent(organization.id)}&studentNo=${encodeURIComponent(studentNo)}`;
      const relationEnvelope = await request(relationUrl, { method: "GET", headers: headers(session) });
      if (!Array.isArray(relationEnvelope.data)) {
        throw new FriendsError({
          code: FriendsErrorCode.NetworkProtocol,
          message: "Unexpected organization application relation response",
        });
      }
      const relation = relationEnvelope.data.length === 0
        ? null
        : relationFields(relationEnvelope.data[0]);
      return { ...applicationFields(raw), relation };
    },
    async prepareApplicationDecision(input: {
      organizationId: OrganizationId;
      applicationId: OrganizationApplicationId;
      type: OrganizationApplicationType;
      decision: OrganizationApplicationDecision;
      message: string;
      time: string;
    }) {
      const decision = validateApplicationDecisionInput(input);
      const organization = await requireOrganization(decision.organizationId);
      requireApplicationAccess(organization);
      const current = await applicationDetail(decision.applicationId);
      if (current.summary.organizationId !== organization.id) {
        throw new FriendsError({
          code: FriendsErrorCode.PermissionDenied,
          message: "The organization application belongs to another organization",
          recovery: {
            operation: "organizations.applications.prepare",
            organizationId: organization.id,
            applicationId: decision.applicationId,
          },
        });
      }
      if (!(await pendingApplicationPresence(decision, current.raw))) {
        throw new FriendsError({
          code: FriendsErrorCode.UpstreamBusiness,
          message: "The organization application is not in the waiting state for the selected type and organization",
          recovery: {
            operation: "organizations.applications.prepare",
            organizationId: organization.id,
            applicationId: decision.applicationId,
            completed: ["state:pending-only"],
          },
        });
      }
      const studentNo = nullableText(current.raw.studentNo);
      if (studentNo === null) invalid("Application student number is required");
      const relation = await applicationRelation(organization.id, studentNo);
      const payload = structuredClone(current.raw);
      payload.uuid = decision.applicationId;
      return {
        status: "prepared" as const,
        submitted: false as const,
        organizationId: organization.id,
        applicationId: decision.applicationId,
        type: decision.type,
        decision: decision.decision,
        message: decision.message,
        time: decision.time,
        relation,
        payload,
      };
    },
    async decideApplication(
      value: PreparedOrganizationApplicationDecision,
      intentInput: OrganizationApplicationDecisionIntent,
    ) {
      validateApplicationDecisionIntent(intentInput);
      const prepared = validatePreparedApplicationDecision(value);
      await refreshWriteAuthorization();
      const organization = await requireOrganization(prepared.organizationId);
      requireApplicationAccess(organization);
      const current = await applicationDetail(prepared.applicationId);
      if (current.summary.organizationId !== organization.id) {
        throw new FriendsError({
          code: FriendsErrorCode.PermissionDenied,
          message: "The organization application belongs to another organization",
          recovery: {
            operation: "organizations.applications.decide",
            organizationId: organization.id,
            applicationId: prepared.applicationId,
          },
        });
      }
      if (JSON.stringify(current.raw) !== JSON.stringify(prepared.payload)) {
        throw new FriendsError({
          code: FriendsErrorCode.UpstreamBusiness,
          message: "The organization application changed after preparation",
          recovery: {
            operation: "organizations.applications.decide",
            organizationId: organization.id,
            applicationId: prepared.applicationId,
            completed: ["application:changed"],
          },
        });
      }
      const decisionInput = {
        organizationId: organization.id,
        applicationId: prepared.applicationId,
        type: prepared.type,
        decision: prepared.decision,
        message: prepared.message,
        time: prepared.time,
      };
      if (!(await pendingApplicationPresence(decisionInput, current.raw))) {
        throw new FriendsError({
          code: FriendsErrorCode.UpstreamBusiness,
          message: "The organization application is no longer waiting for this decision",
          recovery: {
            operation: "organizations.applications.decide",
            organizationId: organization.id,
            applicationId: prepared.applicationId,
            completed: ["state:pending-only"],
          },
        });
      }

      const payload = structuredClone(current.raw);
      payload.uuid = prepared.applicationId;
      const writePayload = {
        identified: prepared.decision === "approve" ? "AGREEMENT" : "ADJUSTMENT",
        msg: prepared.message,
        handleType: "XS02",
        studentOrganizationInfoApproveAddReqDto: payload,
        time: prepared.time,
        uuid: prepared.applicationId,
      };
      try {
        await request(`${organizationPrefix}/student-organization-apply/approve`, {
          method: "POST",
          headers: headers(session),
          body: JSON.stringify(writePayload),
        });
      } catch (error) {
        if (!(error instanceof FriendsError) || error.code !== FriendsErrorCode.NetworkProtocol) {
          throw error;
        }
        try {
          const stillPending = await pendingApplicationPresence(decisionInput, current.raw);
          await applicationRelation(
            organization.id,
            requiredId(current.raw.studentNo, "application student number"),
          );
          throw new FriendsError({
            code: FriendsErrorCode.UnknownOutcome,
            message: "The organization application decision response was lost; its outcome remains unknown even though a read-only readback completed",
            recovery: {
              operation: "organizations.applications.decide",
              organizationId: organization.id,
              applicationId: prepared.applicationId,
              completed: [`readback:${stillPending ? "unmatched" : "matched"}`],
              serverAcknowledged: "unknown",
              readback: stillPending ? "unmatched" : "matched",
            },
          });
        } catch (unknownError) {
          if (unknownError instanceof FriendsError && unknownError.code === FriendsErrorCode.UnknownOutcome) {
            throw unknownError;
          }
          throw new FriendsError({
            code: FriendsErrorCode.UnknownOutcome,
            message: "The organization application decision response was lost and the required read-only readback was unavailable",
            recovery: {
              operation: "organizations.applications.decide",
              organizationId: organization.id,
              applicationId: prepared.applicationId,
              completed: ["readback:unavailable"],
              serverAcknowledged: "unknown",
              readback: "unavailable",
            },
          });
        }
      }

      let stillPending: boolean;
      let relation: OrganizationApplicationRelation | null;
      try {
        stillPending = await pendingApplicationPresence(decisionInput, current.raw);
        relation = await applicationRelation(
          organization.id,
          requiredId(current.raw.studentNo, "application student number"),
        );
      } catch {
        throw new FriendsError({
          code: FriendsErrorCode.UnknownOutcome,
          message: "The school acknowledged the organization application decision, but the required read-only readback was unavailable",
          recovery: {
            operation: "organizations.applications.decide",
            organizationId: organization.id,
            applicationId: prepared.applicationId,
            completed: ["server-acknowledged", "readback:unavailable"],
            serverAcknowledged: true,
            readback: "unavailable",
          },
        });
      }
      if (stillPending) {
        throw new FriendsError({
          code: FriendsErrorCode.UpstreamBusiness,
          message: "The school acknowledged the organization application decision, but it remained in the waiting list",
          recovery: {
            operation: "organizations.applications.decide",
            organizationId: organization.id,
            applicationId: prepared.applicationId,
            completed: ["server-acknowledged", "readback:unmatched"],
            serverAcknowledged: true,
            readback: "unmatched",
          },
        });
      }
      return {
        status: "decided" as const,
        submitted: true as const,
        serverAcknowledged: true,
        applicationNoLongerPending: true as const,
        organizationId: organization.id,
        applicationId: prepared.applicationId,
        type: prepared.type,
        decision: prepared.decision,
        relation,
      };
    },
    async prepareProfileUpdate(input: { organizationId: OrganizationId; changes: OrganizationProfileChanges }) {
      const changes = validateProfileChanges(input?.changes);
      const organization = await requireOrganization(organizationId(input?.organizationId));
      requireProfileAccess(organization);
      const current = await detail(organization.id);
      const payload = structuredClone(current.raw);
      for (const field of editableFields) {
        if (changes[field] !== undefined) payload[field] = changes[field];
      }
      return {
        status: "prepared" as const,
        submitted: false as const,
        organizationId: organization.id,
        changes,
        editRoute: profileEditRoute(current.raw, organization.access),
        payload,
      };
    },
    async saveProfile(
      value: PreparedOrganizationProfileUpdate,
      intentInput: OrganizationProfileSaveIntent,
    ) {
      validateSaveIntent(intentInput);
      const prepared = validatePreparedProfileUpdate(value);
      await refreshWriteAuthorization();
      const organization = await requireOrganization(prepared.organizationId);
      requireProfileAccess(organization);
      const current = await detail(organization.id);
      const payload = structuredClone(current.raw);
      for (const field of editableFields) {
        if (prepared.changes[field] !== undefined) payload[field] = prepared.changes[field];
      }

      try {
        await request(`${organizationPrefix}/student-organization-info`, {
          method: "PUT",
          headers: headers(session),
          body: JSON.stringify(payload),
        });
      } catch (error) {
        if (!(error instanceof FriendsError) || error.code !== FriendsErrorCode.NetworkProtocol) {
          throw error;
        }
        let lostReadbackState: "matched" | "unmatched";
        try {
          const readback = await detail(organizationId(organization.id));
          lostReadbackState = changesMatch(readback.profile, prepared.changes)
            ? "matched" as const
            : "unmatched" as const;
        } catch {
          throw new FriendsError({
            code: FriendsErrorCode.UnknownOutcome,
            message: "The organization profile write response was lost and the read-only result check was unavailable",
            recovery: {
              operation: "organizations.profile.save",
              organizationId: organization.id,
              completed: ["readback:unavailable"],
              serverAcknowledged: "unknown",
              readback: "unavailable",
            },
          });
        }
        throw new FriendsError({
          code: FriendsErrorCode.UnknownOutcome,
          message: "The organization profile write response was lost; its outcome remains unknown even though a read-only readback completed",
          recovery: {
            operation: "organizations.profile.save",
            organizationId: organization.id,
            completed: [`readback:${lostReadbackState}`],
            serverAcknowledged: "unknown",
            readback: lostReadbackState,
          },
        });
      }

      let profile: OrganizationProfile;
      try {
        profile = (await detail(organization.id)).profile;
      } catch {
        throw new FriendsError({
          code: FriendsErrorCode.UnknownOutcome,
          message: "The school acknowledged the organization profile write, but the required read-only readback was unavailable",
          recovery: {
            operation: "organizations.profile.save",
            organizationId: organization.id,
            completed: ["server-acknowledged", "readback:unavailable"],
            serverAcknowledged: true,
            readback: "unavailable",
          },
        });
      }
      if (!changesMatch(profile, prepared.changes)) {
        throw new FriendsError({
          code: FriendsErrorCode.UpstreamBusiness,
          message: "The school acknowledged the organization profile write, but readback did not match every requested field",
          recovery: {
            operation: "organizations.profile.save",
            organizationId: organization.id,
            completed: ["server-acknowledged", "readback:unmatched"],
            serverAcknowledged: true,
            readback: "unmatched",
          },
        });
      }
      return {
        status: "saved" as const,
        submitted: true as const,
        serverAcknowledged: true,
        readback: "matched" as const,
        organizationId: organization.id,
        profile,
      };
    },
  };
}
