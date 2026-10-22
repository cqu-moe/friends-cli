import { FriendsError, FriendsErrorCode } from "./errors.js";

declare const courseRegistrationIdBrand: unique symbol;
export type CourseRegistrationId = string & {
  readonly [courseRegistrationIdBrand]: true;
};

export interface CourseRegistrationListInput {
  page?: number;
  pageSize?: number;
  keyword?: string;
}

export interface CourseRegistrationState {
  raw: string | number | boolean | null;
  known: false;
  flowOverallState: number | null;
  message: string | null;
  nextOperatorRole: string | null;
}

export interface CourseRegistrationSummary {
  courseId: string | null;
  courseName: string | null;
  organizationName: string | null;
  beginTime: string | null;
  endTime: string | null;
  registration: {
    id: string | null;
    state: CourseRegistrationState;
  } | null;
}

export interface CourseRegistrationPage {
  items: CourseRegistrationSummary[];
  page: number;
  pageSize: number;
  totalCount: number | null;
  hasMore: boolean | null;
  hasMoreSource: "derived-from-pages" | "unknown";
}

export interface CourseParticipationSession {
  token: string;
  userLevel: string;
  account: { userNo: string; userName?: string };
  context: { levelNo: string; unit: { unitNo: string } };
}

export interface CourseParticipationTransport {
  request(path: string, init: RequestInit): Promise<unknown>;
}

export interface CourseParticipationClient {
  listMyRegistrations(input?: CourseRegistrationListInput): Promise<CourseRegistrationPage>;
  getMyRegistration(registrationIdValue: string): Promise<CourseRegistrationSummary>;
  prepareApply(courseIdValue: string, input?: { roleId?: string }): Promise<PreparedCourseApply>;
  apply(input: {
    courseId: string;
    roleId?: string;
    confirm: "apply";
  }): Promise<CourseApplyResult>;
  withdraw(input: { registrationId: string; confirm: "withdraw" }): Promise<CourseRegistrationWriteResult>;
  exit(input: { registrationId: string; confirm: "exit" }): Promise<CourseRegistrationWriteResult>;
}

export interface CourseApplyResult {
  submitted: true;
  message: string | null;
  registration: CourseRegistrationSummary["registration"];
}

export interface CourseRegistrationWriteResult {
  submitted: true;
  message: string | null;
  stillListed: boolean;
}

export interface PreparedCourseApply {
  submitted: false;
  course: {
    id: string;
    name: string | null;
    openTime: string | null;
    deadline: string | null;
    isEnroll: boolean | null;
  };
  payload: {
    curriculumId: string;
    questionnaireResult: null;
    studentNo: string;
    uuid: null;
    roleId?: string;
    roleName?: string;
    roleClassHour?: number;
    roleIntegral?: number;
  };
}

type JsonObject = Record<string, unknown>;

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
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

function scalar(value: unknown): string | number | boolean | null {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  return null;
}

export function courseRegistrationId(value: string): CourseRegistrationId {
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    value === "." ||
    value === ".." ||
    /[\\/?#\s]/.test(value)
  ) {
    invalid("Invalid course registration ID");
  }
  return value as CourseRegistrationId;
}

function participationCourseId(value: string): string {
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    value === "." ||
    value === ".." ||
    /[\\/?#\s]/.test(value)
  ) {
    invalid("Invalid course ID");
  }
  return value;
}

export function validateCourseRegistrationListInput(
  input: CourseRegistrationListInput = {},
) {
  if (!object(input)) invalid("Expected course registration query input");
  const page = input.page ?? 1;
  const pageSize = input.pageSize ?? 10;
  if (!Number.isSafeInteger(page) || page < 1) {
    invalid("page must be a positive integer");
  }
  if (!Number.isSafeInteger(pageSize) || pageSize < 1) {
    invalid("pageSize must be a positive integer");
  }
  if (input.keyword !== undefined && typeof input.keyword !== "string") {
    invalid("keyword must be a string");
  }
  return { page, pageSize, keyword: input.keyword ?? "" };
}

function registrationFields(rawCourse: JsonObject) {
  const rawRegistration = object(rawCourse.studentApplied);
  return {
    courseId: text(rawCourse.uuid),
    courseName: text(rawCourse.curriculumName),
    organizationName: text(rawCourse.organizationName),
    beginTime: text(rawCourse.beginTime),
    endTime: text(rawCourse.endTime),
    registration: rawRegistration === null
      ? null
      : {
          id: text(rawRegistration.uuid),
          state: {
            raw: scalar(rawRegistration.flowOverallState),
            known: false as const,
            flowOverallState: number(rawRegistration.flowOverallState),
            message: text(rawRegistration.flowCurrMsg),
            nextOperatorRole: text(rawRegistration.flowNextNodeOperateRole),
          },
        },
  };
}

function businessError(message: string): FriendsError {
  return new FriendsError({ code: FriendsErrorCode.UpstreamBusiness, message });
}

export function createCourseParticipationClient(
  session: CourseParticipationSession,
  transport: CourseParticipationTransport,
): CourseParticipationClient {
  if (!object(session)) invalid("A verified course session is required");
  if (!object(transport) || typeof transport.request !== "function") {
    invalid("A curriculum API transport is required");
  }

  async function findRegistrationByCourse(courseId: string) {
    let page = 1;
    let pagesSeen = 0;
    do {
      const result = await participationClient.listMyRegistrations({ page, pageSize: 20 });
      pagesSeen += 1;
      const found = result.items.find((item) => item.courseId === courseId);
      if (found?.registration) return found.registration;
      if (result.hasMore !== true || pagesSeen >= 100) return null;
      page += 1;
    } while (true);
  }

  async function findRegistrationSummaryById(registrationIdValue: CourseRegistrationId) {
    let page = 1;
    let pagesSeen = 0;
    do {
      const result = await participationClient.listMyRegistrations({ page, pageSize: 20 });
      pagesSeen += 1;
      const found = result.items.find((item) => item.registration?.id === registrationIdValue);
      if (found?.registration) return found;
      if (result.hasMore !== true || pagesSeen >= 100) return null;
      page += 1;
    } while (true);
  }

  async function findRegistrationById(registrationIdValue: CourseRegistrationId) {
    return (await findRegistrationSummaryById(registrationIdValue))?.registration ?? null;
  }

  async function changeRegistration(
    operation: "withdraw" | "exit",
    input: { registrationId: string; confirm: "withdraw" | "exit" },
  ): Promise<CourseRegistrationWriteResult> {
    if (!object(input)) invalid(`Expected course registration ${operation} input`);
    if (input.confirm !== operation) invalid(`confirm must be exactly "${operation}"`);
    const id = courseRegistrationId(input.registrationId);
    const existing = await findRegistrationById(id);
    if (existing === null) {
      throw businessError("Course registration ID was not found in personal records");
    }
    const path = operation === "withdraw"
      ? `/zovecenter-saip-ek-app-curriculum/mob/student-apply/${encodeURIComponent(id)}`
      : `/zovecenter-saip-ek-app-curriculum/mob/student-apply/quit/${encodeURIComponent(id)}`;
    let envelope: JsonObject | null;
    try {
      envelope = object(await transport.request(path, { method: operation === "withdraw" ? "GET" : "DELETE" }));
    } catch (cause) {
      if (!(cause instanceof FriendsError) || cause.code !== FriendsErrorCode.NetworkProtocol) {
        throw cause;
      }
      let stillListed = false;
      let completed: string[] = [];
      try {
        stillListed = (await findRegistrationById(id)) !== null;
        completed = ["read-only-follow-up"];
      } catch {
        // The write may already have happened; do not probe with another write.
      }
      throw new FriendsError({
        code: FriendsErrorCode.UnknownOutcome,
        message: `Course registration ${operation} outcome is unknown; inspect read-only results before any human retry`,
        cause,
        recovery: {
          operation: `courses.registrations.${operation}`,
          registrationId: id,
          completed,
        },
      });
    }
    const stillListed = (await findRegistrationById(id)) !== null;
    return { submitted: true, message: text(envelope?.message), stillListed };
  }

  const participationClient = {
    async listMyRegistrations(
      input: CourseRegistrationListInput = {},
    ): Promise<CourseRegistrationPage> {
      const query = validateCourseRegistrationListInput(input);
      const envelope = object(await transport.request(
        "/zovecenter-saip-ek-app-curriculum/mob/apply/my-applied-page-list",
        {
          method: "POST",
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
      ));
      const page = object(envelope?.data);
      if (!page || !Array.isArray(page.data)) {
        throw new FriendsError({
          code: FriendsErrorCode.NetworkProtocol,
          message: "Unexpected course registration page envelope",
        });
      }
      const pages = number(page.pages);
      const currentPage = number(page.currentPage) ?? query.page;
      const pageSize = number(page.pageSize) ?? query.pageSize;
      return {
        items: page.data.map((rawItem) => {
          const raw = object(rawItem);
          if (!raw) {
            throw new FriendsError({
              code: FriendsErrorCode.NetworkProtocol,
              message: "Unexpected course registration list item",
            });
          }
          return registrationFields(raw);
        }),
        page: currentPage,
        pageSize,
        totalCount: number(page.totalCount),
        hasMore: pages === null ? null : currentPage < pages,
        hasMoreSource: pages === null ? "unknown" : "derived-from-pages",
      };
    },
    async getMyRegistration(registrationIdValue: string) {
      const id = courseRegistrationId(registrationIdValue);
      const found = await findRegistrationSummaryById(id);
      if (found === null) {
        throw businessError("Course registration ID was not found in personal records");
      }
      return found;
    },
    async prepareApply(
      courseIdValue: string,
      input: { roleId?: string } = {},
    ): Promise<PreparedCourseApply> {
      const id = participationCourseId(courseIdValue);
      if (!object(input)) invalid("Expected course apply preparation input");
      if (input.roleId !== undefined && typeof input.roleId !== "string") {
        invalid("roleId must be a string");
      }
      const envelope = object(await transport.request(
        `/zovecenter-saip-ek-app-curriculum/mob/apply/${encodeURIComponent(id)}`,
        { method: "GET" },
      ));
      const raw = object(envelope?.data);
      if (!raw || text(raw.uuid) !== id) {
        throw new FriendsError({
          code: FriendsErrorCode.NetworkProtocol,
          message: "Unexpected course detail envelope",
        });
      }
      if (raw.studentApplied !== undefined && raw.studentApplied !== null) {
        throw businessError("A course registration already exists for this course");
      }
      if (raw.isEnroll === false) {
        throw businessError("The school course response says enrollment is not open");
      }
      if (!Array.isArray(raw.questionnaires)) {
        throw businessError("The course questionnaire contract is unknown");
      }
      if (raw.questionnaires.length > 0) {
        throw businessError("This course has a questionnaire; submit it through the reviewed school flow");
      }
      if (!Array.isArray(raw.roles)) {
        throw businessError("The course role contract is unknown");
      }
      const payload: PreparedCourseApply["payload"] = {
        curriculumId: id,
        questionnaireResult: null,
        studentNo: session.account.userNo,
        uuid: null,
      };
      if (raw.roles.length > 0 || input.roleId !== undefined) {
        if (input.roleId === undefined) {
          invalid("This course requires an explicit roleId from course detail");
        }
        const rawRole = raw.roles
          .map((item) => object(item))
          .find((role) => text(role?.uuid) === input.roleId);
        if (rawRole === undefined || rawRole === null) {
          invalid("roleId was not returned by course detail");
        }
        const roleName = text(rawRole.roleName);
        const classHour = number(rawRole.classHour);
        const integral = number(rawRole.integral);
        if (roleName === null || classHour === null || integral === null) {
          throw businessError("The selected course role is incomplete");
        }
        payload.roleId = input.roleId;
        payload.roleName = roleName;
        payload.roleClassHour = classHour;
        payload.roleIntegral = integral;
      }
      return {
        submitted: false,
        course: {
          id,
          name: text(raw.curriculumName),
          openTime: text(raw.openTime),
          deadline: text(raw.deadline),
          isEnroll: raw.isEnroll === true || raw.isEnroll === false ? raw.isEnroll : null,
        },
        payload,
      };
    },
    async apply(input: {
      courseId: string;
      roleId?: string;
      confirm: "apply";
    }): Promise<CourseApplyResult> {
      if (!object(input)) invalid("Expected course apply input");
      if (input.confirm !== "apply") invalid("confirm must be exactly \"apply\"");
      const prepared = await participationClient.prepareApply(input.courseId, {
        roleId: input.roleId,
      });
      let envelope: JsonObject | null;
      try {
        envelope = object(await transport.request(
          "/zovecenter-saip-ek-app-curriculum/mob/student-apply/apply",
          { method: "POST", body: JSON.stringify(prepared.payload) },
        ));
      } catch (cause) {
        if (!(cause instanceof FriendsError) || cause.code !== FriendsErrorCode.NetworkProtocol) {
          throw cause;
        }
        let registration: CourseRegistrationSummary["registration"] = null;
        let completed: string[] = [];
        try {
          registration = await findRegistrationByCourse(input.courseId);
          completed = ["read-only-follow-up"];
        } catch {
          // Keep UNKNOWN_OUTCOME; a failed read cannot justify another write.
        }
        throw new FriendsError({
          code: FriendsErrorCode.UnknownOutcome,
          message: "Course apply outcome is unknown; inspect read-only results before any human retry",
          cause,
          recovery: {
            operation: "courses.registrations.apply",
            courseId: input.courseId,
            registrationId: registration?.id ?? undefined,
            completed,
          },
        });
      }
      const registration = await findRegistrationByCourse(input.courseId);
      return {
        submitted: true,
        message: text(envelope?.message),
        registration,
      };
    },
    async withdraw(input: { registrationId: string; confirm: "withdraw" }) {
      return changeRegistration("withdraw", input);
    },
    async exit(input: { registrationId: string; confirm: "exit" }) {
      return changeRegistration("exit", input);
    },
  };
  return participationClient;
}
