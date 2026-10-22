import { FriendsError, FriendsErrorCode } from "./errors.js";

declare const organizationIdBrand: unique symbol;
export type OrganizationId = string & { readonly [organizationIdBrand]: true };

export type OrganizationAccess = "principal" | "manager" | "member";
export type EditableOrganizationProfileField = "logo" | "backgroundGroupUuid" | "blurb";

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

  function requireProfileAccess(organization: OrganizationSummary): void {
    if (organization.editableFields.length === 0) {
      throw new FriendsError({
        code: FriendsErrorCode.PermissionDenied,
        message: "The current organization role cannot edit this profile",
        recovery: { operation: "organizations.profile.update", organizationId: organization.id },
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
