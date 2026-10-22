import { reserveSchoolContext } from "./school-context.js";
import {createOrganizationActivityClient} from "./organization-activities.js";
export * from "./organization-activities.js";
import { FriendsError, FriendsErrorCode } from "./errors.js";
import {
  createCourseParticipationClient,
} from "./course-participation.js";
import {
  createVerifiedOrganizationClient,
  type OrganizationSession,
} from "./organizations.js";
import { createVolunteerClient } from "./volunteer.js";

import {
  createCourseOfferingClient,
  type CourseOfferingSession,
} from "./course-offering.js";

export { FriendsError, FriendsErrorCode, exitCodeFor } from "./errors.js";
export type { WriteRecovery } from "./errors.js";
export * from "./drafts.js";
export * from "./draft-source.js";
export {
  courseRegistrationId,
  validateCourseRegistrationListInput,
} from "./course-participation.js";
export type {
  CourseParticipationClient,
  CourseParticipationDependencies,
  CourseParticipationSession,
  CourseRegistrationId,
  CourseRegistrationListInput,
  CourseRegistrationPage,
  CourseRegistrationState,
  CourseRegistrationSummary,
  CourseQuestionnaireAnswerInput,
  CourseQuestionnaireAttachmentInput,
  CourseQuestionnaireAttachmentPlan,
  CourseApplyAttachmentResult,
  CourseQuestionnaireDefinition,
  CourseQuestionnaireItemType,
  CourseQuestionnaireResult,
} from "./course-participation.js";
export * from "./certification-prepare.js";
export {
  organizationId,
  organizationApplicationId,
  validateOrganizationMemberListInput,
  validateOrganizationApplicationListInput,
} from "./organizations.js";
export type {
  EditableOrganizationProfileField,
  OrganizationApplicationDetail,
  OrganizationApplicationId,
  OrganizationApplicationListInput,
  OrganizationApplicationPage,
  OrganizationApplicationRelation,
  OrganizationApplicationSummary,
  OrganizationApplicationType,
  OrganizationApplicationDecision,
  PreparedOrganizationApplicationDecision,
  DecidedOrganizationApplication,
  OrganizationApplicationDecisionIntent,
  OrganizationAccess,
  OrganizationClient,
  OrganizationId,
  OrganizationMember,
  OrganizationMemberListInput,
  OrganizationMemberPage,
  OrganizationLeaderChangeCandidate,
  OrganizationLeaderChangeApplication,
  OrganizationLeaderChangeInput,
  OrganizationLeaderChangeState,
  OrganizationLeaderChangeSubmitIntent,
  OrganizationProfile,
  OrganizationProfileChanges,
  OrganizationProfileSaveIntent,
  OrganizationSession,
  OrganizationSummary,
  PreparedOrganizationLeaderChange,
  PreparedOrganizationProfileUpdate,
  SubmittedOrganizationLeaderChange,
  SavedOrganizationProfile,
} from "./organizations.js";
export * from "./certification-api.js";
export * from "./course-offering.js";
export * from "./volunteer-reviews.js";

export {
  validateVolunteerRegisterInput,
  validateVolunteerListInput,
  volunteerActivityId,
  volunteerRegistrationId,
} from "./volunteer.js";
export type {
  VolunteerActivityDetail,
  VolunteerActivityId,
  VolunteerActivityPage,
  VolunteerActivityPost,
  VolunteerActivitySummary,
  VolunteerClient,
  VolunteerIdentity,
  VolunteerListInput,
  VolunteerManageableActivity,
  VolunteerQuestionnaire,
  VolunteerQuestionnaireAnswer,
  VolunteerQuestionnaireOption,
  VolunteerRegisterInput,
  VolunteerRegisterWriteInput,
  VolunteerRegisterPayload,
  VolunteerRegistration,
  VolunteerRegistrationId,
  VolunteerRegistrationPage,
  VolunteerRegistrationRecord,
  VolunteerRegistrationRequirements,
  VolunteerWithdrawalPreparation,
  VolunteerWriteReceipt,
  VolunteerWriteReadback,
  VolunteerWriteResult,
  VolunteerRegistrationPreparation,
} from "./volunteer.js";


export * from "./volunteer-offering.js";
export * from "./volunteer-offering-api.js";
declare const courseIdBrand: unique symbol;
export type CourseId = string & { readonly [courseIdBrand]: true };
export type UserLevel = string;

export interface CourseListInput {
  page?: number;
  pageSize?: number;
  keyword?: string;
}

export interface CourseSummary {
  id: string | null;
  name: string | null;
  organizationName: string | null;
  level: string | null;
  type: string | null;
  typeName: string | null;
  place: string | null;
  content: string | null;
  beginTime: string | null;
  endTime: string | null;
  openTime: string | null;
  deadline: string | null;
  isEnroll: boolean | null;
  isEnrollExamine: boolean | null;
  limitCollegeNo: string[] | null;
  limitGrade: string[] | null;
  limitSpecialtyTypeOne: string[] | null;
  state: {
    raw: string | number | boolean | null;
    known: false;
    flowOverallState: number | null;
    studentApplied: boolean | null;
  };
}

export interface CourseDetail extends CourseSummary {
  roles: Array<{ uuid: string | null; roleName: string | null; integral: number | null; classHour: number | null }> | null;
  questionnaires: { count: number | null; content: "none" | "unverified" };
}

export interface CoursePage {
  items: CourseSummary[];
  page: number;
  pageSize: number;
  totalCount: number | null;
  hasMore: boolean | null;
  hasMoreSource: "derived-from-pages" | "unknown";
}

export interface CourseClient {
  list(input?: CourseListInput): Promise<CoursePage>;
  get(id: CourseId): Promise<CourseDetail>;
}

export interface LoginUnit {
  unitType: number;
  unitNo: string;
  unitName: string;
}

export interface LoginContext {
  levelNo: string;
  levelName: string;
  unit: LoginUnit;
}

export interface LocalSessionInspection {
  account: { userNo: string; userName: string };
  userLoginType: string;
  message: string | null;
  contexts: LoginContext[];
}

export interface ActivatedLocalContext {
  account: { userNo: string; userName: string };
  context: LoginContext;
}

export interface VerifiedCourseSession {
  token: string;
  userLevel: UserLevel;
  account: { userNo: string; userName?: string };
  context: { levelNo: string; unit: { unitNo: string } };
}

type JsonObject = Record<string, unknown>;

const mainService = "zovecenter-saip-ek-agg-mob";
const curriculumService = "zovecenter-saip-ek-app-curriculum";

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function boolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function strings(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : null;
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function object(value: unknown): JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function courseFields(raw: JsonObject) {
  return {
    id: text(raw.uuid),
    name: text(raw.curriculumName),
    organizationName: text(raw.organizationName),
    level: text(raw.curriculumLevel),
    type: text(raw.curriculumType),
    typeName: text(raw.curriculumTypeName),
    place: text(raw.curriculumPlace),
    content: text(raw.curriculumContent),
    beginTime: text(raw.beginTime),
    endTime: text(raw.endTime),
    openTime: text(raw.openTime),
    deadline: text(raw.deadline),
    isEnroll: boolean(raw.isEnroll),
    isEnrollExamine: boolean(raw.isEnrollExamine),
    limitCollegeNo: strings(raw.limitCollegeNo),
    limitGrade: strings(raw.limitGrade),
    limitSpecialtyTypeOne: strings(raw.limitSpecialtyTypeOne),
    state: {
      raw: text(raw.curriculumState) ?? number(raw.curriculumState) ?? boolean(raw.curriculumState),
      known: false as const,
      flowOverallState: number(raw.flowOverallState),
      studentApplied: boolean(raw.studentApplied),
    },
  };
}

export function validateCourseListInput(input: CourseListInput = {}) {
  if (!object(input)) invalid("Expected course query input");
  const page = input.page ?? 1;
  const pageSize = input.pageSize ?? 10;
  if (!Number.isSafeInteger(page) || page < 1) {
    throw new FriendsError({
      code: FriendsErrorCode.InvalidInput,
      message: "page must be a positive integer",
    });
  }
  if (!Number.isSafeInteger(pageSize) || pageSize < 1) {
    throw new FriendsError({
      code: FriendsErrorCode.InvalidInput,
      message: "pageSize must be a positive integer",
    });
  }
  if (input.keyword !== undefined && typeof input.keyword !== "string") {
    throw new FriendsError({
      code: FriendsErrorCode.InvalidInput,
      message: "keyword must be a string",
    });
  }
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
    throw new FriendsError({
      code: FriendsErrorCode.AuthRequired,
      message: "Friends session expired",
    });
  }
  if (response.status === 403) {
    throw new FriendsError({
      code: FriendsErrorCode.PermissionDenied,
      message: "The friends API denied this context",
    });
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

function parseInspection(levelData: unknown, infoData: unknown): LocalSessionInspection {
  const levelBody = object(levelData);
  const infoBody = object(infoData);
  const loginLevels = levelBody?.loginLevels;
  const userNo = text(infoBody?.userNo);
  const userName = text(infoBody?.userName);
  if (!Array.isArray(loginLevels) || userNo === null || userName === null) {
    throw new FriendsError({
      code: FriendsErrorCode.NetworkProtocol,
      message: "Unexpected friends identity response",
    });
  }
  const contexts: LoginContext[] = [];
  for (const rawLevel of loginLevels) {
    const level = object(rawLevel);
    const levelNo = text(level?.levelNo);
    const levelName = text(level?.levelName);
    if (!level || levelNo === null || levelName === null || !Array.isArray(level.units)) {
      throw new FriendsError({
        code: FriendsErrorCode.NetworkProtocol,
        message: "Unexpected friends login level response",
      });
    }
    for (const rawUnit of level.units) {
      const unit = object(rawUnit);
      const unitNo = text(unit?.unitNo);
      const unitName = text(unit?.unitName);
      if (
        !unit ||
        unitNo === null ||
        unitName === null ||
        typeof unit.unitType !== "number"
      ) {
        throw new FriendsError({
          code: FriendsErrorCode.NetworkProtocol,
          message: "Unexpected friends login unit response",
        });
      }
      contexts.push({
        levelNo,
        levelName,
        unit: { unitType: unit.unitType, unitNo, unitName },
      });
    }
  }
  if (contexts.length === 0) {
    throw new FriendsError({
      code: FriendsErrorCode.PermissionDenied,
      message: "The friends account has no selectable context",
    });
  }
  return {
    account: { userNo, userName },
    userLoginType: text(levelBody?.userLoginType) ?? "",
    message: text(levelBody?.msg),
    contexts,
  };
}

function chooseContext(
  contexts: LoginContext[],
  selector?: { levelNo?: string; unitNo?: string },
) {
  const matches = contexts.filter(
    (context) =>
      (selector?.levelNo === undefined || context.levelNo === selector.levelNo) &&
      (selector?.unitNo === undefined || context.unit.unitNo === selector.unitNo),
  );
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) {
    throw new FriendsError({
      code: FriendsErrorCode.InvalidInput,
      message: "The selected friends context was not returned by the school API",
    });
  }
  throw new FriendsError({
    code: FriendsErrorCode.InvalidInput,
    message: `Multiple friends contexts match; specify level-no and unit-no from: ${contexts
      .map((context) => `${context.levelNo}/${context.unit.unitNo} (${context.levelName}/${context.unit.unitName})`)
      .join(", ")}`,
  });
}

function userTypeFor(userLoginType: string): "STUDENT" | "TEACHER" {
  if (userLoginType === "STUDENT" || userLoginType === "STUDENT_UNACTIVATED") return "STUDENT";
  if (userLoginType === "TEACHER" || userLoginType === "OTHER") return "TEACHER";
  throw new FriendsError({
    code: FriendsErrorCode.NetworkProtocol,
    message: `Unsupported friends userLoginType: ${userLoginType}`,
  });
}

export function courseId(value: string): CourseId {
  if (typeof value !== "string" || value.trim() === "" || value === "." || value === ".." || /[\\/?#\s]/.test(value)) {
    throw new FriendsError({
      code: FriendsErrorCode.InvalidInput,
      message: "Invalid course ID",
    });
  }
  return value as CourseId;
}

function invalid(message: string): never {
  throw new FriendsError({ code: FriendsErrorCode.InvalidInput, message });
}

function validateSession(input: { token: string; userLevel?: string }): void {
  if (!input || typeof input.token !== "string" || !input.token ||
      (typeof input.userLevel !== "string" || (!input.userLevel && input.userLevel !== "")) ||
      /[\r\n]/.test(input.token + input.userLevel)) invalid("A token and user level are required");
}

function snapshotSession(input: VerifiedCourseSession): VerifiedCourseSession {
  validateSession(input);
  if (typeof input.account?.userNo !== "string" || !input.account.userNo ||
      typeof input.context?.unit?.unitNo !== "string" || !input.context.unit.unitNo ||
      input.context.levelNo !== input.userLevel) invalid("Account, role and identity unit must match");
  return {token:input.token, userLevel:input.userLevel, account:{userNo:input.account.userNo},
    context:{levelNo:input.context.levelNo, unit:{unitNo:input.context.unit.unitNo}}};
}

export function createFriendsSdk(options: {
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
} = {}) {
  const baseUrl = (options.baseUrl ?? "https://friends.cqu.edu.cn/gateway").replace(/\/$/, "");
  const fetchImpl = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 60_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) invalid("timeoutMs must be a positive integer");

  async function inspectLocalSession(input: {
    token: string;
    userLevel?: string;
  }): Promise<LocalSessionInspection> {
    validateSession(input);
    const init = {
      method: "POST",
      headers: headers(input.token, input.userLevel ?? "", mainService),
      body: "{}",
    };
    const [levels, info] = await Promise.all([
      callApi(baseUrl, "/ek-agg-mob/user/checkUserAndGetUserLevel", init, fetchImpl, timeoutMs),
      callApi(baseUrl, "/ek-agg-mob/user/info", init, fetchImpl, timeoutMs),
    ]);
    return parseInspection(levels.data, info.data);
  }

  async function verifyLocalSession(input: VerifiedCourseSession): Promise<LocalSessionInspection> {
    const session = snapshotSession(input);
    const inspection = await inspectLocalSession(session);
    if (inspection.account.userNo !== session.account.userNo || !inspection.contexts.some(context =>
      context.levelNo === session.context.levelNo && context.unit.unitNo === session.context.unit.unitNo)) {
      throw new FriendsError({code:FriendsErrorCode.AuthRequired, message:"The stored account or context no longer matches; log in again"});
    }
    return inspection;
  }

  const sdk = {
    inspectLocalSession,
    verifyLocalSession,
    async activateLocalContext(source: {
      token: string;
      userLevel?: string;
      selector?: { levelNo?: string; unitNo?: string };
      expectedAccount?: string;
    }): Promise<ActivatedLocalContext> {
      validateSession(source);
      const input = {...source, selector:source.selector ? {...source.selector} : undefined};
      const inspection = await inspectLocalSession(input);
      if (
        input.expectedAccount !== undefined &&
        inspection.account.userNo !== input.expectedAccount
      ) {
        throw new FriendsError({
          code: FriendsErrorCode.AuthRequired,
          message: "The friends session belongs to a different account",
        });
      }
      const context = chooseContext(inspection.contexts, input.selector);
      const userType = userTypeFor(inspection.userLoginType);
      await reserveSchoolContext(baseUrl, input.token, inspection.account.userNo, context.levelNo, context.unit.unitNo);
      const envelope = await callApi(
        baseUrl,
        "/ek-agg-mob/user/enterHall",
        {
          method: "POST",
          headers: headers(input.token, context.levelNo, mainService),
          body: JSON.stringify({
            departNo: context.unit.unitNo,
            userStateLevel: context.levelNo,
            userType,
          }),
        },
        fetchImpl,
        timeoutMs,
      );
      const entered = object(envelope.data);
      const account = text(entered?.account);
      const name = text(entered?.name);
      const enteredLevel = text(entered?.userLoginStateLevel);
      const departmentNo = text(entered?.departmentNo);
      if (
        account === null ||
        name === null ||
        account !== inspection.account.userNo ||
        enteredLevel !== context.levelNo ||
        departmentNo !== context.unit.unitNo
      ) {
        throw new FriendsError({
          code: FriendsErrorCode.NetworkProtocol,
          message: "enterHall returned a different account",
        });
      }
      return { account: inspection.account, context };
    },
    async createCourseClient(input: VerifiedCourseSession) {
      const session = snapshotSession(input);
      await sdk.activateLocalContext({token:session.token, userLevel:session.userLevel,
        expectedAccount:session.account.userNo,
        selector:{levelNo:session.context.levelNo, unitNo:session.context.unit.unitNo}});
      const courseHeaders = headers(session.token, session.userLevel, curriculumService);
      return {
        async list(input: CourseListInput = {}): Promise<CoursePage> {
          const query = validateCourseListInput(input);
          const envelope = await callApi(
            baseUrl,
            "/zovecenter-saip-ek-app-curriculum/mob/apply/student-apply-page-list",
            {
              method: "POST",
              headers: courseHeaders,
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
                isInstructor: false,
                state: "",
              }),
            },
            fetchImpl,
            timeoutMs,
          );
          const page = object(envelope.data);
          if (!page || !Array.isArray(page.data)) {
            throw new FriendsError({
              code: FriendsErrorCode.NetworkProtocol,
              message: "Unexpected course page envelope",
            });
          }
          const pages = number(page.pages);
          const currentPage = number(page.currentPage) ?? query.page;
          const pageSize = number(page.pageSize) ?? query.pageSize;
          const items = page.data.map((rawItem) => {
            const raw = object(rawItem);
            if (!raw) {
              throw new FriendsError({
                code: FriendsErrorCode.NetworkProtocol,
                message: "Unexpected course list item",
              });
            }
            return courseFields(raw);
          });
          return {
            items,
            page: currentPage,
            pageSize,
            totalCount: number(page.totalCount),
            hasMore: pages === null ? null : currentPage < pages,
            hasMoreSource: pages === null ? "unknown" : "derived-from-pages",
          };
        },
        async get(id: CourseId): Promise<CourseDetail> {
          courseId(id);
          const envelope = await callApi(
            baseUrl,
            `/zovecenter-saip-ek-app-curriculum/mob/apply/${encodeURIComponent(id)}`,
            { method: "GET", headers: courseHeaders },
            fetchImpl,
            timeoutMs,
          );
          const raw = object(envelope.data);
          if (!raw) {
            throw new FriendsError({
              code: FriendsErrorCode.NetworkProtocol,
              message: "Unexpected course detail envelope",
            });
          }
          const roles = Array.isArray(raw.roles)
            ? raw.roles.map((role) => {
                const value = object(role) ?? {};
                return { uuid: text(value.uuid), roleName: text(value.roleName), integral: number(value.integral), classHour: number(value.classHour) };
              })
            : null;
          return { ...courseFields(raw), roles, questionnaires: {
            count: Array.isArray(raw.questionnaires) ? raw.questionnaires.length : null,
            content: Array.isArray(raw.questionnaires) && raw.questionnaires.length === 0 ? "none" : "unverified",
          }};
        },
      };
    },
    async createOrganizationActivityClient(input: VerifiedCourseSession) {
      return createOrganizationActivityClient({baseUrl,fetch:fetchImpl,timeoutMs,session:snapshotSession(input)});
    },
    async createCourseParticipationClient(input: VerifiedCourseSession) {
      const session = snapshotSession(input);
      await sdk.activateLocalContext({
        token: session.token,
        userLevel: session.userLevel,
        expectedAccount: session.account.userNo,
        selector: {
          levelNo: session.context.levelNo,
          unitNo: session.context.unit.unitNo,
        },
      });
      const participationHeaders = headers(
        session.token,
        session.userLevel,
        curriculumService,
      );
      return createCourseParticipationClient(session, {
        request: (path, init) => {
          const requestHeaders: Record<string, string> = {
            ...participationHeaders,
            "h-zove-appkey": path.startsWith("/ek-agg-mob/biz-common/") ? mainService : curriculumService,
            ...(init.headers as Record<string, string> | undefined),
          };
          if (init.body instanceof FormData) delete requestHeaders["content-type"];
          return callApi(
            baseUrl,
            path,
            { ...init, headers: requestHeaders },
            fetchImpl,
            timeoutMs,
          );
        },
        reverifySession: () => sdk.activateLocalContext({
          token: session.token,
          userLevel: session.userLevel,
          expectedAccount: session.account.userNo,
          selector: {
            levelNo: session.context.levelNo,
            unitNo: session.context.unit.unitNo,
          },
        }),
      });
    },
    async createOrganizationClient(input: OrganizationSession) {
      const session = snapshotSession(input);
      await sdk.activateLocalContext({
        token: session.token,
        userLevel: session.userLevel,
        expectedAccount: session.account.userNo,
        selector: { levelNo: session.context.levelNo, unitNo: session.context.unit.unitNo },
      });
      return createVerifiedOrganizationClient({
        baseUrl,
        session,
        fetch: fetchImpl,
        timeoutMs,
        verifySession: async (currentSession) => {
          await sdk.activateLocalContext({
            token: currentSession.token,
            userLevel: currentSession.userLevel,
            expectedAccount: currentSession.account.userNo,
            selector: {
              levelNo: currentSession.context.levelNo,
              unitNo: currentSession.context.unit.unitNo,
            },
          });
        },
      });
    },
    async createVolunteerClient(input: VerifiedCourseSession) {
      return createVolunteerClient({
        session: input,
        baseUrl,
        fetch: fetchImpl,
        timeoutMs,
      });
    },
    async createCourseOfferingClient(input: CourseOfferingSession) {
      const session = snapshotSession(input);
      await sdk.activateLocalContext({
        token: session.token,
        userLevel: session.userLevel,
        expectedAccount: session.account.userNo,
        selector: { levelNo: session.context.levelNo, unitNo: session.context.unit.unitNo },
      });
      return createCourseOfferingClient({ baseUrl, session, fetch: fetchImpl, timeoutMs });
    },
  };
  return sdk;
}
export {createVolunteerActivityReviewClient} from './volunteer-activity-reviews.js';
export type {VolunteerActivityReviewType, VolunteerActivityReviewInput, PreparedVolunteerActivityReview, VolunteerActivityReviewClientOptions} from './volunteer-activity-reviews.js';

export * from "./organization-participation.js";
export { createOrganizationActivityReviewClient, validateOrganizationActivityReviewInput } from "./organization-activity-reviews.js";
export type { OrganizationActivityReviewKind, OrganizationOfferingReviewQuery, OrganizationRegistrationReviewQuery, OrganizationOfferingReviewInput, OrganizationRegistrationReviewInput, PreparedOrganizationActivityReview, OrganizationActivityReviewClientOptions } from "./organization-activity-reviews.js";

export {createCourseReviewClient, validateCourseReviewInput, type CourseReviewType, type CourseReviewInput, type PreparedCourseReview} from './course-reviews.js';

export * from "./search.js";
