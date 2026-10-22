import { createFriendsSdk, type VerifiedCourseSession } from "./index.js";
import { FriendsError, FriendsErrorCode } from "./errors.js";
import {
  buildVolunteerOfferingFirstPayload,
  buildVolunteerOfferingRegistrationPayload,
  newVolunteerOfferingGroupUuid,
  normalizeVolunteerOfferingInput,
  type NormalizedVolunteerOfferingInput,
  type VolunteerOfferingDictionaryItem,
  type VolunteerOfferingOrganizationContext,
  type VolunteerOfferingRemoteContext,
  type VolunteerOfferingUploadFile,
} from "./volunteer-offering.js";

type JsonObject = Record<string, unknown>;

const volunteerService = "zovecenter-saip-ek-app-young-volunteers";
const mainService = "zovecenter-saip-ek-app-agg-mob";
const volunteerPrefix = `/${volunteerService}/mob`;
const commonPrefix = `/${mainService}/biz-common`;

export interface VolunteerOfferingSession extends VerifiedCourseSession {}

export interface PreparedVolunteerOffering {
  status: "prepared";
  submitted: false;
  source: unknown;
  activityCategory: "SCHOOL_ACTIVITY" | "TEMP_ACTIVITY";
  context: VolunteerOfferingRemoteContext;
  payload: Readonly<JsonObject>;
  registration: Readonly<JsonObject> | null;
  materials: {
    publicityGroupUuid: string;
    attachmentGroupUuid: string | null;
    publicityPictures: VolunteerOfferingUploadFile[];
    attachments: VolunteerOfferingUploadFile[];
  };
  missing: string[];
}

export interface VolunteerOfferingUploadIntent {
  via: "api";
  intent: "upload-volunteer-offering-materials";
  confirm?: boolean;
  dryRun?: boolean;
}

export interface VolunteerOfferingSubmitIntent {
  via: "api";
  intent: "submit-volunteer-offering";
  confirm?: boolean;
  dryRun?: boolean;
}

export interface VolunteerOfferingMaterialsResult {
  state: "not-uploaded" | "complete" | "partial";
  uploaded: boolean;
  publicityPictures: { groupUuid: string; uploadedCount: number; expectedCount: number; resourceUuids: string[] };
  attachments: { groupUuid: string | null; uploadedCount: number; expectedCount: number; resourceUuids: string[] } | null;
  failed: Array<{ name: string; stage: "upload" | "readback"; code: FriendsErrorCode; message: string; uncertain: boolean }>;
  uncertain: Array<{ name: string; groupUuid: string; stage: "upload" | "readback"; confirmedByReadback: boolean }>;
}

export interface VolunteerOfferingSubmitResult {
  submitted: boolean;
  serverAcknowledged: boolean;
  submissionKind: "SCHOOL_ACTIVITY_TWO_STEP" | "TEMP_ACTIVITY_FINAL";
  applicationId: string | null;
  publicityGroupUuid: string;
  attachmentGroupUuid: string | null;
  readback: { state: "not-submitted" | "matched" | "unmatched" | "unavailable"; applicationId: string | null };
}

export interface VolunteerOfferingStatus {
  applicationId: string;
  state: "present";
  raw: JsonObject;
}

function invalid(message: string): never {
  throw new FriendsError({ code: FriendsErrorCode.InvalidInput, message });
}

function object(value: unknown): JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonObject : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function jsonHeaders(session: VolunteerOfferingSession, appKey: string): Record<string, string> {
  return {
    "content-type": "application/json",
    "h-zove-token": session.token,
    "h-zove-source": "30100",
    "h-zove-clienttype": "1",
    "h-zove-tenantid": "EK",
    "h-zove-appkey": appKey,
    "h-zove-userlevel": session.userLevel,
  };
}

function validateSession(session: VolunteerOfferingSession): VolunteerOfferingSession {
  if (
    !session || typeof session.token !== "string" || session.token === "" ||
    typeof session.userLevel !== "string" || session.userLevel === "" ||
    /[\r\n]/.test(session.token + session.userLevel) ||
    typeof session.account?.userNo !== "string" || session.account.userNo === "" ||
    typeof session.context?.levelNo !== "string" || session.context.levelNo === "" ||
    session.context.levelNo !== session.userLevel ||
    typeof session.context.unit?.unitNo !== "string" || session.context.unit.unitNo === ""
  ) invalid("A complete verified offering session is required");
  return session;
}

async function parseJsonResponse(response: Response): Promise<JsonObject> {
  let body: unknown;
  try {
    body = await response.json();
  } catch (cause) {
    throw new FriendsError({
      code: FriendsErrorCode.NetworkProtocol,
      message: `Unexpected non-JSON friends response (HTTP ${response.status})`,
      cause,
    });
  }
  const envelope = object(body);
  if (envelope === null || typeof envelope.code !== "string") {
    throw new FriendsError({ code: FriendsErrorCode.NetworkProtocol, message: "Unexpected friends response envelope" });
  }
  if (envelope.code !== "0") {
    throw new FriendsError({
      code: FriendsErrorCode.UpstreamBusiness,
      message: text(envelope.message) ?? "Friends API rejected the offering operation",
      upstreamCode: envelope.code,
      requestId: text(envelope.requestId) ?? undefined,
    });
  }
  return envelope;
}

async function callJson(options: {
  baseUrl: string;
  path: string;
  session: VolunteerOfferingSession;
  appKey: string;
  body?: unknown;
  method?: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  contentType?: string;
}): Promise<JsonObject> {
  let response: Response;
  try {
    response = await options.fetchImpl(new URL(`${options.baseUrl}${options.path}`), {
      method: options.method ?? (options.body === undefined ? "GET" : "POST"),
      headers: { ...jsonHeaders(options.session, options.appKey), "content-type": options.contentType ?? "application/json" },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      redirect: "error",
      signal: AbortSignal.timeout(options.timeoutMs),
    });
  } catch (cause) {
    throw new FriendsError({
      code: FriendsErrorCode.NetworkProtocol,
      message: "Could not reach the friends gateway",
      retryable: options.body === undefined,
      cause,
    });
  }
  if (response.status === 401) throw new FriendsError({ code: FriendsErrorCode.AuthRequired, message: "Friends session expired" });
  if (response.status === 403) throw new FriendsError({ code: FriendsErrorCode.PermissionDenied, message: "The friends API denied this offering context" });
  if (!response.ok) throw new FriendsError({ code: FriendsErrorCode.NetworkProtocol, message: `Unexpected friends HTTP status ${response.status}` });
  return parseJsonResponse(response);
}

function dictionaryItem(value: unknown, label: string): VolunteerOfferingDictionaryItem {
  const raw = object(value);
  const code = text(raw?.dataCode);
  const name = text(raw?.dataName);
  if (raw === null || code === null || name === null) invalid(`The school returned an invalid ${label}`);
  return { code, name };
}

function selectDictionaryItem(
  value: unknown,
  requested: string | undefined,
  label: string,
): VolunteerOfferingDictionaryItem {
  if (!Array.isArray(value) || value.length === 0) invalid(`The school returned no ${label} options`);
  const items = value.map((item) => dictionaryItem(item, label));
  if (requested === undefined) {
    if (items.length !== 1) invalid(`${label} is ambiguous; provide the source-verified code`);
    return items[0];
  }
  const selected = items.filter((item) => item.code === requested || item.name === requested);
  if (selected.length !== 1) invalid(`${label} is not available for this account`);
  return selected[0];
}

function organization(value: unknown): VolunteerOfferingOrganizationContext {
  const raw = object(value);
  const id = text(raw?.uuid);
  const name = text(raw?.organizationName);
  const type = text(raw?.organizationType);
  if (id === null || name === null || type === null) invalid("The school returned an invalid volunteer organization");
  return { id, name, type };
}

function parseResource(value: unknown): { uuid: string; title: string; extension: string } {
  const raw = object(value);
  const uuid = text(raw?.uuid);
  const title = text(raw?.title);
  const extension = typeof raw?.fileExtension === "string" ? raw.fileExtension : "";
  if (uuid === null || title === null) invalid("The school returned an invalid uploaded resource");
  return { uuid, title, extension };
}

function selectRemoteOrganization(
  organizations: VolunteerOfferingOrganizationContext[],
  input: { organizationId?: string; organizationName?: string },
): VolunteerOfferingOrganizationContext {
  if (organizations.length === 0) invalid("The account has no volunteer organizations");
  const matched = organizations.filter((item) =>
    input.organizationId !== undefined ? item.id === input.organizationId :
    input.organizationName !== undefined ? item.name === input.organizationName : true
  );
  if (matched.length === 0) invalid("The requested volunteer organization is not available in this account context");
  if (matched.length > 1) invalid("Multiple volunteer organizations are available; select one explicitly");
  return matched[0];
}

function payloadMatches(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((item, index) => payloadMatches(item, right[index]));
  }
  if (typeof left === "object" && typeof right === "object" && left !== null && right !== null) {
    return Object.keys(left).every((key) =>
      Object.hasOwn(right as JsonObject, key) && payloadMatches((left as JsonObject)[key], (right as JsonObject)[key])
    );
  }
  return left === right;
}

export function createVolunteerOfferingClient(options: {
  baseUrl: string;
  session: VolunteerOfferingSession;
  fetch?: typeof fetch;
  timeoutMs?: number;
}) {
  const session = validateSession(options.session);
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  const fetchImpl = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 60_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) invalid("timeoutMs must be a positive integer");
  const identitySdk = createFriendsSdk({ baseUrl, fetch: fetchImpl, timeoutMs });

  async function json(path: string, body?: unknown, method?: string, contentType = "application/json") {
    return callJson({
      baseUrl, path, session, appKey: path.startsWith(commonPrefix) ? mainService : volunteerService,
      body, method, fetchImpl, timeoutMs, contentType,
    });
  }

  async function remoteContext(input: {
    organizationId?: string;
    organizationName?: string;
    activityType?: string;
    activityLevel?: string;
  }): Promise<VolunteerOfferingRemoteContext> {
    await identitySdk.verifyLocalSession(session);
    const organizationEnvelope = await json(`${volunteerPrefix}/organization/drop-down`, {
      isInstructor: false,
      currentPage: 1,
      key: "",
    });
    if (!Array.isArray(organizationEnvelope.data)) invalid("The school returned an invalid volunteer organization list");
    const selectedOrganization = selectRemoteOrganization(organizationEnvelope.data.map(organization), input);
    const dictionaryEnvelope = await json(`${commonPrefix}/system/data-code-list/mulit`, {
      codes: ["QNZYZXNHDLX", "QNZYZXNHDJB"],
    });
    const dictionary = object(dictionaryEnvelope.data);
    if (!Array.isArray(dictionary?.QNZYZXNHDLX) || !Array.isArray(dictionary?.QNZYZXNHDJB)) {
      invalid("The school returned incomplete offering dictionaries");
    }
    const yearEnvelope = await json(`${commonPrefix}/system/vschool-year-list`, {});
    if (!Array.isArray(yearEnvelope.data)) invalid("The school returned an invalid school year list");
    const years = yearEnvelope.data.filter((item) => object(item)?.isCurrentYear === 1);
    if (years.length !== 1) invalid("The school did not return exactly one current year");
    const year = object(years[0]);
    const schoolYear = text(year?.schoolYear);
    if (schoolYear === null || !/^\d{4}-\d{4}$/.test(schoolYear)) invalid("The school returned an invalid current year");
    const termEnvelope = await json(`${commonPrefix}/system/vschool-term-list`, {});
    if (!Array.isArray(termEnvelope.data)) invalid("The school returned an invalid school term list");
    const terms = termEnvelope.data.filter((item) => object(item)?.isCurrentTerm === 1);
    if (terms.length !== 1) invalid("The school did not return exactly one current term");
    const termNo = text(object(terms[0])?.termNo);
    if (termNo === null) invalid("The school returned an invalid current term");
    return {
      organization: selectedOrganization,
      activityType: selectDictionaryItem(dictionary.QNZYZXNHDLX, input.activityType, "activity type"),
      activityLevel: selectDictionaryItem(dictionary.QNZYZXNHDJB, input.activityLevel, "activity level"),
      schoolYear,
      termNo,
    };
  }

  function prepareResult(
    normalized: NormalizedVolunteerOfferingInput,
    context: VolunteerOfferingRemoteContext,
    source: unknown,
  ): PreparedVolunteerOffering {
    const publicityGroupUuid = newVolunteerOfferingGroupUuid();
    const attachmentGroupUuid = normalized.materials.attachments.length > 0 ? newVolunteerOfferingGroupUuid() : null;
    const payload = buildVolunteerOfferingFirstPayload(normalized, context, publicityGroupUuid, attachmentGroupUuid ?? undefined);
    const missing = ["materials:publicityPictures"];
    if (normalized.activityCategory === "SCHOOL_ACTIVITY") {
      return {
        status: "prepared", submitted: false, activityCategory: normalized.activityCategory, context,
        source,
        payload, registration: buildVolunteerOfferingRegistrationPayload(normalized, ""),
        materials: {
          publicityGroupUuid, attachmentGroupUuid,
          publicityPictures: normalized.materials.publicityPictures,
          attachments: normalized.materials.attachments,
        },
        missing,
      };
    }
    return {
      status: "prepared", submitted: false, activityCategory: normalized.activityCategory, context,
      source,
      payload, registration: null,
      materials: {
        publicityGroupUuid, attachmentGroupUuid,
        publicityPictures: normalized.materials.publicityPictures,
        attachments: normalized.materials.attachments,
      },
      missing,
    };
  }

  async function listResources(groupUuid: string): Promise<Array<{ uuid: string; title: string; extension: string }>> {
    const envelope = await json(`${commonPrefix}/list-group-resource?groupUuid=${encodeURIComponent(groupUuid)}`, null, "POST", "application/x-www-form-urlencoded");
    if (!Array.isArray(envelope.data)) invalid("The school returned an invalid resource group");
    return envelope.data.map(parseResource);
  }

  async function uploadOne(groupUuid: string, item: VolunteerOfferingUploadFile): Promise<string> {
    const form = new FormData();
    form.append("files", item.file, item.name);
    form.append("groupId", groupUuid);
    let response: Response;
    try {
      response = await fetchImpl(new URL(`${baseUrl}${commonPrefix}/protected-file-upload`), {
        method: "POST",
        headers: {
          "h-zove-token": session.token,
          "h-zove-source": "30100",
          "h-zove-clienttype": "1",
          "h-zove-tenantid": "EK",
          "h-zove-appkey": mainService,
          "h-zove-userlevel": session.userLevel,
        },
        body: form,
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (cause) {
      throw new FriendsError({
        code: FriendsErrorCode.NetworkProtocol,
        message: "The offering material upload outcome is unknown",
        cause,
      });
    }
    if (response.status === 401) throw new FriendsError({ code: FriendsErrorCode.AuthRequired, message: "Friends session expired" });
    if (response.status === 403) throw new FriendsError({ code: FriendsErrorCode.PermissionDenied, message: "The school denied offering material upload" });
    if (!response.ok) throw new FriendsError({ code: FriendsErrorCode.NetworkProtocol, message: `Unexpected upload HTTP status ${response.status}` });
    const envelope = await parseJsonResponse(response);
    if (!Array.isArray(envelope.data) || typeof envelope.data[0] !== "string") {
      throw new FriendsError({ code: FriendsErrorCode.NetworkProtocol, message: "The upload response did not return a resource UUID" });
    }
    return envelope.data[0];
  }

  function materialResult(
    publicity: { groupUuid: string; resources: string[] },
    attachments: { groupUuid: string | null; resources: string[] },
    publicityExpected: number,
    attachmentExpected: number,
    failed: VolunteerOfferingMaterialsResult["failed"],
    uncertain: VolunteerOfferingMaterialsResult["uncertain"],
    acknowledgedAll: boolean,
  ): VolunteerOfferingMaterialsResult {
    const complete = publicity.resources.length >= publicityExpected &&
      (attachments.groupUuid === null || attachments.resources.length >= attachmentExpected);
    return {
      state: complete ? "complete" : "partial",
      uploaded: acknowledgedAll,
      publicityPictures: { groupUuid: publicity.groupUuid, uploadedCount: publicity.resources.length, expectedCount: publicityExpected, resourceUuids: publicity.resources },
      attachments: attachments.groupUuid === null ? null : {
        groupUuid: attachments.groupUuid, uploadedCount: attachments.resources.length, expectedCount: attachmentExpected, resourceUuids: attachments.resources,
      },
      failed,
      uncertain,
    };
  }

  return {
    async prepare(value: unknown): Promise<PreparedVolunteerOffering> {
      const raw = object(value);
      if (raw === null) invalid("Expected a volunteer offering input object");
      const rawActivity = object(raw.activity);
      const preliminaryContext = await remoteContext({
        organizationId: text(raw.organizationId) ?? undefined,
        organizationName: text(raw.organizationName) ?? undefined,
        activityType: text(rawActivity?.activityType) ?? undefined,
        activityLevel: text(rawActivity?.activityLevel) ?? undefined,
      });
      const normalized = normalizeVolunteerOfferingInput(value, preliminaryContext);
      const source: unknown = { schemaVersion: 1, kind: "volunteer-offering", ...normalized };
      return prepareResult(normalized, preliminaryContext, source);
    },

    async uploadMaterials(prepared: PreparedVolunteerOffering, intent: VolunteerOfferingUploadIntent): Promise<VolunteerOfferingMaterialsResult> {
      if (intent?.via !== "api" || intent.intent !== "upload-volunteer-offering-materials") {
        invalid("Offering material upload requires an independent --via api intent");
      }
      if (intent.dryRun !== undefined && typeof intent.dryRun !== "boolean" || intent.confirm !== undefined && typeof intent.confirm !== "boolean") {
        invalid("Confirmation and dry-run must be booleans");
      }
      if (!intent.dryRun && intent.confirm !== true) invalid("Offering material upload requires explicit confirmation");
      if (prepared?.status !== "prepared" || prepared.submitted !== false) invalid("A prepared volunteer offering is required");
      if (intent.dryRun) {
        return {
          state: "not-uploaded", uploaded: false,
          publicityPictures: { groupUuid: prepared.materials.publicityGroupUuid, uploadedCount: 0, expectedCount: prepared.materials.publicityPictures.length, resourceUuids: [] },
          attachments: prepared.materials.attachmentGroupUuid === null ? null : { groupUuid: prepared.materials.attachmentGroupUuid, uploadedCount: 0, expectedCount: prepared.materials.attachments.length, resourceUuids: [] },
          failed: [],
          uncertain: [],
        };
      }
      const publicity = { groupUuid: prepared.materials.publicityGroupUuid, resources: (await listResources(prepared.materials.publicityGroupUuid)).map((item) => item.uuid) };
      const attachment = prepared.materials.attachmentGroupUuid === null
        ? { groupUuid: null, resources: [] }
        : { groupUuid: prepared.materials.attachmentGroupUuid, resources: (await listResources(prepared.materials.attachmentGroupUuid)).map((item) => item.uuid) };
      const failed: VolunteerOfferingMaterialsResult["failed"] = [];
      const uncertain: VolunteerOfferingMaterialsResult["uncertain"] = [];
      let acknowledgedAll = true;
      async function uploadGroup(groupUuid: string, items: VolunteerOfferingUploadFile[], resources: string[]): Promise<boolean> {
        for (const item of items) {
          try {
            const resourceUuid = await uploadOne(groupUuid, item);
            resources.push(resourceUuid);
          } catch (error) {
            const friendsError = error instanceof FriendsError ? error : new FriendsError({ code: FriendsErrorCode.NetworkProtocol, message: "Offering material upload failed" });
            acknowledgedAll = false;
            if (friendsError.code === FriendsErrorCode.NetworkProtocol) {
              let confirmed: string | null = null;
              try {
                const remoteResources = await listResources(groupUuid);
                const expectedTitle = item.name.replace(/\.[^.]+$/, "");
                confirmed = remoteResources.find(resource => `${resource.title}${resource.extension}` === item.name && resource.title === expectedTitle)?.uuid ?? null;
                if (confirmed !== null) resources.push(confirmed);
              } catch {
                // The upload result remains unknown when readback also fails.
              }
              uncertain.push({ name: item.name, groupUuid, stage: "upload", confirmedByReadback: confirmed !== null });
              if (confirmed !== null) continue;
            }
            failed.push({ name: item.name, stage: "upload", code: friendsError.code, message: friendsError.message, uncertain: friendsError.code === FriendsErrorCode.NetworkProtocol });
            return false;
          }
        }
        return true;
      }
      const publicityComplete = await uploadGroup(publicity.groupUuid, prepared.materials.publicityPictures, publicity.resources);
      const attachmentComplete = attachment.groupUuid === null || await uploadGroup(attachment.groupUuid, prepared.materials.attachments, attachment.resources);
      if (!publicityComplete || !attachmentComplete) {
        // Keep every completed resource and its group UUID; never retry or delete after partial failure.
      }
      return materialResult(publicity, attachment, prepared.materials.publicityPictures.length, prepared.materials.attachments.length, failed, uncertain, acknowledgedAll);
    },

    async submit(prepared: PreparedVolunteerOffering, intent: VolunteerOfferingSubmitIntent): Promise<VolunteerOfferingSubmitResult> {
      if (intent?.via !== "api" || intent.intent !== "submit-volunteer-offering") {
        invalid("Offering submission requires independent --via api intent; Ego preparation never authorizes it");
      }
      if (intent.dryRun !== undefined && typeof intent.dryRun !== "boolean" || intent.confirm !== undefined && typeof intent.confirm !== "boolean") {
        invalid("Confirmation and dry-run must be booleans");
      }
      if (!intent.dryRun && intent.confirm !== true) invalid("Offering submission requires explicit confirmation");
      if (prepared?.status !== "prepared" || prepared.submitted !== false) invalid("A prepared volunteer offering is required");
      const source = object(prepared.source);
      if (source === null) invalid("A prepared volunteer offering is required");
      const sourceActivity = object(source.activity);
      const context = await remoteContext({
        organizationId: prepared.context.organization.id,
        activityType: text(sourceActivity?.activityType) ?? undefined,
        activityLevel: text(sourceActivity?.activityLevel) ?? undefined,
      });
      const normalized = normalizeVolunteerOfferingInput(source, context);
      const firstPayload = buildVolunteerOfferingFirstPayload(
        normalized, context,
        prepared.materials.publicityGroupUuid,
        prepared.materials.attachmentGroupUuid ?? undefined,
      );
      const publicityResources = await listResources(prepared.materials.publicityGroupUuid);
      const attachmentResources = prepared.materials.attachmentGroupUuid === null ? [] : await listResources(prepared.materials.attachmentGroupUuid);
      if (intent.dryRun) {
        return {
          submitted: false, serverAcknowledged: false,
          submissionKind: prepared.activityCategory === "TEMP_ACTIVITY" ? "TEMP_ACTIVITY_FINAL" : "SCHOOL_ACTIVITY_TWO_STEP",
          applicationId: null, publicityGroupUuid: prepared.materials.publicityGroupUuid,
          attachmentGroupUuid: prepared.materials.attachmentGroupUuid,
          readback: { state: "not-submitted", applicationId: null },
        };
      }
      if (publicityResources.length < normalized.materials.publicityPictures.length) {
        invalid("Publicity pictures are incomplete; upload materials before submission");
      }
      if (attachmentResources.length < normalized.materials.attachments.length) invalid("Attachments are incomplete; upload materials before submission");
      if (prepared.activityCategory === "TEMP_ACTIVITY") {
        const tempPayload = { ...firstPayload, posts: [], nameList: normalized.temporaryRoster?.map((person) => ({
          studentNo: person.studentNo, attestationDuration: person.durationHours, isApply: 0,
        })) };
        if (!Array.isArray(tempPayload.nameList) || tempPayload.nameList.length === 0) invalid("TEMP_ACTIVITY requires a roster");
        try {
          await json(`${volunteerPrefix}/school-activity-apply/next-step`, tempPayload);
        } catch (error) {
          if (error instanceof FriendsError && ([FriendsErrorCode.AuthRequired, FriendsErrorCode.PermissionDenied, FriendsErrorCode.UpstreamBusiness] as FriendsErrorCode[]).includes(error.code)) throw error;
          throw new FriendsError({
            code: FriendsErrorCode.UnknownOutcome,
            message: "The school may have accepted the temporary offering. Inspect manager lists before any new submission; no retry was made.",
            recovery: { operation: "offerings.submit", completed: [`publicity:${prepared.materials.publicityGroupUuid}`] },
          });
        }
        return {
          submitted: true, serverAcknowledged: true, submissionKind: "TEMP_ACTIVITY_FINAL", applicationId: null,
          publicityGroupUuid: prepared.materials.publicityGroupUuid, attachmentGroupUuid: prepared.materials.attachmentGroupUuid,
          readback: { state: "unavailable", applicationId: null },
        };
      }
      let activityId: string;
      try {
        const next = await json(`${volunteerPrefix}/school-activity-apply/next-step`, firstPayload);
        const nextActivityId = text(next.data);
        if (nextActivityId === null) invalid("The offering next step did not return an intermediate UUID");
        activityId = nextActivityId;
      } catch (error) {
        if (error instanceof FriendsError && ([FriendsErrorCode.InvalidInput, FriendsErrorCode.AuthRequired, FriendsErrorCode.PermissionDenied, FriendsErrorCode.UpstreamBusiness] as FriendsErrorCode[]).includes(error.code)) throw error;
        throw new FriendsError({
          code: FriendsErrorCode.UnknownOutcome,
          message: "The school may have created the offering draft. Inspect manager lists before continuing; no retry was made.",
          recovery: { operation: "offerings.submit", completed: [`publicity:${prepared.materials.publicityGroupUuid}`] },
        });
      }
      const finalPayload = { ...buildVolunteerOfferingRegistrationPayload(normalized, activityId), uuid: activityId, handleType: "EJZZ01" };
      try {
        await json(`${volunteerPrefix}/school-activity-apply/apply`, finalPayload);
      } catch (error) {
        if (error instanceof FriendsError && ([FriendsErrorCode.AuthRequired, FriendsErrorCode.PermissionDenied, FriendsErrorCode.UpstreamBusiness] as FriendsErrorCode[]).includes(error.code)) throw error;
        let readback: { state: "matched" | "unmatched" | "unavailable"; applicationId: string | null } = { state: "unavailable", applicationId: null };
        try {
          const current = await this.status(activityId);
          readback = {
            state: payloadMatches(finalPayload, current.raw) ? "matched" : "unmatched",
            applicationId: current.applicationId,
          };
        } catch {
          // A failed readback does not turn a lost write response into success.
        }
        throw new FriendsError({
          code: FriendsErrorCode.UnknownOutcome,
          message: "The school may have accepted the offering. Inspect status before any new submission; no retry was made.",
          recovery: { operation: "offerings.submit", applicationId: activityId, readback: readback.state, completed: [`readback:${readback.state}`, `publicity:${prepared.materials.publicityGroupUuid}`] },
        });
      }
      let readback: { state: "matched" | "unmatched" | "unavailable"; applicationId: string | null };
      try {
        const current = await this.status(activityId);
        readback = { state: payloadMatches(finalPayload, current.raw) ? "matched" : "unmatched", applicationId: current.applicationId };
      } catch {
        readback = { state: "unavailable", applicationId: null };
      }
      return {
        submitted: true, serverAcknowledged: true, submissionKind: "SCHOOL_ACTIVITY_TWO_STEP",
        applicationId: activityId,
        publicityGroupUuid: prepared.materials.publicityGroupUuid, attachmentGroupUuid: prepared.materials.attachmentGroupUuid,
        readback,
      };
    },

    async status(applicationId: string): Promise<VolunteerOfferingStatus> {
      if (typeof applicationId !== "string" || applicationId === "" || /[\\/?#\s]/.test(applicationId)) {
        invalid("A valid offering application UUID is required");
      }
      const envelope = await json(`${volunteerPrefix}/school-activity-apply/approve-detail/${encodeURIComponent(applicationId)}`);
      const data = object(envelope.data);
      if (data === null || data.uuid !== applicationId) invalid("The offering status response identifies a different application");
      return { applicationId, state: "present", raw: data };
    },
  };
}
