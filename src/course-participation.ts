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

export type CourseQuestionnaireItemType =
  | "CHOICE"
  | "MULTIPLE_CHOICE"
  | "TEXT"
  | "NUMBER"
  | "DATE"
  | "PICTURE"
  | "MULTIPLE_PICTURE"
  | "FILE"
  | "MULTIPLE_FILE";

export interface CourseQuestionnaireDefinition {
  id: string;
  title: string;
  itemType: CourseQuestionnaireItemType;
  required: boolean;
  options: { id: string; itemId: string | null; name: string }[];
}

export type CourseQuestionnaireAnswerInput =
  | { questionId: string; choiceOptionId: string }
  | { questionId: string; choiceOptionIds: string[] }
  | { questionId: string; text: string }
  | { questionId: string; attachments: CourseQuestionnaireAttachmentInput[] };

export interface CourseQuestionnaireAttachmentInput {
  content: Blob;
  filename?: string;
}

export interface CourseQuestionnaireAttachmentPlan {
  questionId: string;
  itemType: CourseQuestionnaireItemType;
  groupUuid: string;
  maxCount: 1 | null;
  acceptedMimeTypes: string[];
  files: { filename: string; mimeType: string; size: number }[];
}

export interface CourseApplyAttachmentResult {
  questionId: string;
  itemType: CourseQuestionnaireItemType;
  groupUuid: string;
  resourceIds: string[];
  submitted: true;
  serverAck: { accepted: true; message: string | null };
  readback: { status: "verified" } | { status: "unavailable" };
}

export interface CourseQuestionnaireResult {
  curriculumId: string;
  attachmentGroupUuid: string | null;
  inputContent: string;
  itemType: CourseQuestionnaireItemType;
  itemUuid: string;
  optionUuid?: string;
  uuid: string;
  studentNo: string;
  title: string;
  multipartChoice: { optionUuid: string; optionName: string }[] | null;
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

export interface CourseParticipationDependencies {
  request: CourseParticipationTransport["request"];
  reverifySession: () => Promise<unknown>;
}

export interface CourseParticipationClient {
  listMyRegistrations(input?: CourseRegistrationListInput): Promise<CourseRegistrationPage>;
  getMyRegistration(registrationIdValue: string): Promise<CourseRegistrationSummary>;
  inspectApply(courseIdValue: string): Promise<PreparedCourseApply>;
  prepareApply(courseIdValue: string, input?: {
    roleId?: string;
    questionnaire?: CourseQuestionnaireAnswerInput[];
  }): Promise<PreparedCourseApply>;
  apply(input: {
    courseId: string;
    roleId?: string;
    questionnaire?: CourseQuestionnaireAnswerInput[];
    confirm: "apply";
  }): Promise<CourseApplyResult>;
  withdraw(input: { registrationId: string; confirm: "withdraw" }): Promise<CourseRegistrationWriteResult>;
  exit(input: { registrationId: string; confirm: "exit" }): Promise<CourseRegistrationWriteResult>;
}

export interface CourseApplyResult {
  submitted: true;
  serverAck: { accepted: true; message: string | null };
  message: string | null;
  readback: { status: "verified" } | { status: "unavailable" };
  registration: CourseRegistrationSummary["registration"];
  attachments: CourseApplyAttachmentResult[];
}

export interface CourseRegistrationWriteResult {
  submitted: true;
  serverAck: { accepted: true; message: string | null };
  message: string | null;
  readback: { status: "verified" } | { status: "unavailable" };
  stillListed: boolean | null;
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
  rolesRequired: boolean;
  roles: { id: string; name: string; classHour: number; integral: number }[];
  payload: {
    curriculumId: string;
    questionnaireResult: CourseQuestionnaireResult[] | null;
    studentNo: string;
    uuid: null;
    roleId?: string;
    roleName?: string;
    roleClassHour?: number;
    roleIntegral?: number;
  };
  questionnaires: CourseQuestionnaireDefinition[];
  attachmentPlans: CourseQuestionnaireAttachmentPlan[];
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

const questionnaireItemTypes = new Set<CourseQuestionnaireItemType>([
  "CHOICE",
  "MULTIPLE_CHOICE",
  "TEXT",
  "NUMBER",
  "DATE",
  "PICTURE",
  "MULTIPLE_PICTURE",
  "FILE",
  "MULTIPLE_FILE",
]);

function questionnaireDefinitions(value: unknown): CourseQuestionnaireDefinition[] {
  if (!Array.isArray(value)) {
    throw businessError("The course questionnaire contract is unknown");
  }
  return value.map((rawItem) => {
    const raw = object(rawItem);
    const id = text(raw?.uuid);
    const title = text(raw?.title);
    const itemType = text(raw?.itemType);
    if (raw === null || id === null || title === null ||
      itemType === null || !questionnaireItemTypes.has(itemType as CourseQuestionnaireItemType) ||
      (raw.isMandatory !== undefined && typeof raw.isMandatory !== "boolean")) {
      throw businessError("The course questionnaire contract is unknown");
    }
    const required = raw.isMandatory === true;
    if (!Array.isArray(raw.options)) {
      if (itemType === "CHOICE" || itemType === "MULTIPLE_CHOICE") {
        throw businessError("The course questionnaire option contract is unknown");
      }
      return { id, title, itemType: itemType as CourseQuestionnaireItemType, required, options: [] };
    }
    return {
      id,
      title,
      itemType: itemType as CourseQuestionnaireItemType,
      required,
      options: raw.options.map((rawOption) => {
        const option = object(rawOption);
        const optionId = text(option?.uuid);
        const optionName = text(option?.optionName);
        if (option === null || optionId === null || optionName === null) {
          throw businessError("The course questionnaire option contract is unknown");
        }
        return { id: optionId, itemId: text(option.itemUuid), name: optionName };
      }),
    };
  });
}

function questionText(input: CourseQuestionnaireAnswerInput): string | null {
  return "text" in input && typeof input.text === "string" ? input.text : null;
}

const imageMimeTypes = [
  "image/png",
  "image/jpg",
  "image/jpeg",
  "image/gif",
  "image/bmp",
];
const fileMimeTypes = ["application/pdf"];
const maxAttachmentBytes = 20 * 1024 * 1024;

function attachmentContract(itemType: CourseQuestionnaireItemType): {
  accepted: string[];
  maxCount: 1 | null;
} | null {
  if (itemType === "PICTURE" || itemType === "MULTIPLE_PICTURE") {
    return { accepted: imageMimeTypes, maxCount: itemType === "PICTURE" ? 1 : null };
  }
  if (itemType === "FILE" || itemType === "MULTIPLE_FILE") {
    return { accepted: fileMimeTypes, maxCount: itemType === "FILE" ? 1 : null };
  }
  return null;
}

function attachmentFilename(input: CourseQuestionnaireAttachmentInput): string {
  if (input.filename !== undefined) {
    if (typeof input.filename !== "string" || input.filename.trim() === "") {
      invalid("Each questionnaire attachment requires a non-empty filename");
    }
    return input.filename.trim();
  }
  const content = input.content as Blob & { name?: unknown };
  if (typeof content.name === "string" && content.name.trim() !== "") return content.name.trim();
  const extension = input.content.type === "application/pdf"
    ? ".pdf"
    : input.content.type === "image/png"
      ? ".png"
      : input.content.type === "image/gif"
        ? ".gif"
        : input.content.type === "image/bmp"
          ? ".bmp"
          : ".jpg";
  return `attachment${extension}`;
}

function validateAttachmentInput(
  question: CourseQuestionnaireDefinition,
  input: CourseQuestionnaireAttachmentInput[],
): CourseQuestionnaireAttachmentPlan["files"] {
  const contract = attachmentContract(question.itemType);
  if (contract === null) throw new Error("unreachable");
  if (input.length === 0) invalid(`Questionnaire ${question.itemType} requires at least one attachment`);
  if (contract.maxCount === 1 && input.length > 1) {
    invalid(`Questionnaire ${question.itemType} accepts one file only`);
  }
  return input.map((attachment) => {
    if (!object(attachment) || !(attachment.content instanceof Blob)) {
      invalid(`Questionnaire ${question.itemType} requires Blob attachment content`);
    }
    if (!contract.accepted.includes(attachment.content.type)) {
      invalid(`Questionnaire ${question.itemType} accepts ${contract.accepted.join(", ")} files`);
    }
    if (!Number.isSafeInteger(attachment.content.size) || attachment.content.size < 1) {
      invalid(`Questionnaire ${question.itemType} requires non-empty attachment content`);
    }
    if (attachment.content.size > maxAttachmentBytes) {
      invalid(`Questionnaire ${question.itemType} attachments must be at most 20 MiB`);
    }
    const filename = attachmentFilename(attachment);
    return { filename, mimeType: attachment.content.type, size: attachment.content.size };
  });
}

function validateQuestionnaireInput(input: unknown): CourseQuestionnaireAnswerInput[] {
  if (!Array.isArray(input)) invalid("questionnaire must be an array of verified answers");
  return input.map((raw) => {
    const answer = object(raw);
    if (answer === null || typeof answer.questionId !== "string" || answer.questionId === "") {
      invalid("Each questionnaire answer requires questionId");
    }
    if (["choiceOptionId", "choiceOptionIds", "text", "attachments"].filter(key => answer[key] !== undefined).length !== 1) {
      invalid("Each questionnaire answer must use exactly one answer type");
    }
    if (answer.choiceOptionId !== undefined) {
      if (typeof answer.choiceOptionId !== "string" || answer.choiceOptionId === "") {
        invalid("choiceOptionId must be a non-empty string");
      }
      return { questionId: answer.questionId, choiceOptionId: answer.choiceOptionId };
    }
    if (answer.choiceOptionIds !== undefined) {
      if (!Array.isArray(answer.choiceOptionIds) ||
        answer.choiceOptionIds.some((id) => typeof id !== "string" || id === "")) {
        invalid("choiceOptionIds must be an array of non-empty strings");
      }
      if (new Set(answer.choiceOptionIds).size !== answer.choiceOptionIds.length) invalid("choiceOptionIds must not contain duplicates");
      return { questionId: answer.questionId, choiceOptionIds: [...answer.choiceOptionIds] as string[] };
    }
    if (answer.text !== undefined) {
      if (typeof answer.text !== "string") invalid("questionnaire text must be a string");
      return { questionId: answer.questionId, text: answer.text };
    }
    if (answer.attachments !== undefined) {
      if (!Array.isArray(answer.attachments)) {
        invalid("attachments must be an array of questionnaire attachment input");
      }
      return {
        questionId: answer.questionId,
        attachments: answer.attachments.map(raw => {
          const attachment = object(raw);
          if (!attachment || !(attachment.content instanceof Blob)) invalid("Questionnaire attachments require Blob content");
          return { content: attachment.content, filename: attachment.filename as string | undefined };
        }),
      };
    }
    invalid("Each questionnaire answer requires choiceOptionId, choiceOptionIds, text, or attachments");
  });
}

function buildQuestionnaireResult(
  courseId: string,
  definitions: CourseQuestionnaireDefinition[],
  input: unknown,
  studentNo: string,
): {
  results: CourseQuestionnaireResult[] | null;
  attachmentPlans: CourseQuestionnaireAttachmentPlan[];
} {
  if (definitions.length === 0) {
    if (input !== undefined) invalid("This course has no questionnaire");
    return { results: null, attachmentPlans: [] };
  }
  const answers = validateQuestionnaireInput(input);
  const knownQuestionIds = new Set(definitions.map((question) => question.id));
  const unknownAnswer = answers.find((answer) => !knownQuestionIds.has(answer.questionId));
  if (unknownAnswer !== undefined) {
    invalid("questionnaire contains a questionId not returned by course detail");
  }
  const questionIds = answers.map((answer) => answer.questionId);
  if (new Set(questionIds).size !== questionIds.length) {
    invalid("Each course questionnaire question may be answered only once");
  }
  const attachmentPlans: CourseQuestionnaireAttachmentPlan[] = [];
  const results = definitions.map((question) => {
    const answer = answers.find((candidate) => candidate.questionId === question.id);
    const base = {
      curriculumId: courseId,
      attachmentGroupUuid: null,
      inputContent: "",
      itemType: question.itemType,
      itemUuid: question.id,
      uuid: question.id,
      studentNo,
      title: question.title,
      multipartChoice: null,
    };
    if (answer === undefined) {
      if (!question.required) {
        if (question.itemType === "CHOICE") {
          return { ...base, itemUuid: question.options[0]?.itemId ?? "" };
        }
        if (question.itemType === "MULTIPLE_CHOICE") return { ...base, itemUuid: question.options[0]?.itemId ?? "", multipartChoice: [] };
        return base;
      }
      invalid(`A questionnaire answer is required for "${question.title}"`);
    }
    if (answer.questionId !== question.id) throw new Error("unreachable");
    if (question.itemType === "CHOICE") {
      if (!("choiceOptionId" in answer)) {
        invalid(`Question "${question.title}" requires choiceOptionId`);
      }
      const option = question.options.find((candidate) => candidate.id === answer.choiceOptionId);
      if (option === undefined || option.itemId === null) {
        invalid(`choiceOptionId was not returned by course detail for "${question.title}"`);
      }
      return { ...base, itemUuid: option.itemId, optionUuid: option.id };
    }
    if (question.itemType === "MULTIPLE_CHOICE") {
      if (!("choiceOptionIds" in answer)) {
        invalid(`Question "${question.title}" requires choiceOptionIds`);
      }
      const options = answer.choiceOptionIds.map((id) => {
        const option = question.options.find((candidate) => candidate.id === id);
        if (option === undefined) invalid(`choiceOptionIds contains an option not returned for "${question.title}"`);
        return { optionUuid: option.id, optionName: option.name };
      });
      if (options.length === 0) invalid(`Question "${question.title}" requires at least one option`);
      return { ...base, itemUuid: question.options[0]?.itemId ?? "", multipartChoice: options };
    }
    if (question.itemType === "PICTURE" || question.itemType === "MULTIPLE_PICTURE" ||
      question.itemType === "FILE" || question.itemType === "MULTIPLE_FILE") {
      if (!("attachments" in answer)) {
        invalid(`Questionnaire ${question.itemType} requires attachments`);
      }
      const contract = attachmentContract(question.itemType);
      if (contract === null) throw new Error("unreachable");
      const files = validateAttachmentInput(question, answer.attachments);
      const groupUuid = crypto.randomUUID().replace(/-/g, "");
      attachmentPlans.push({
        questionId: question.id,
        itemType: question.itemType,
        groupUuid,
        maxCount: contract.maxCount,
        acceptedMimeTypes: [...contract.accepted],
        files,
      });
      return { ...base, attachmentGroupUuid: groupUuid };
    }
    const value = questionText(answer);
    if (value === null || value.trim() === "") invalid(`Question "${question.title}" requires text`);
    const trimmed = value.trim();
    if (question.itemType === "NUMBER" && (!/^[1-9][0-9]{0,3}$/.test(trimmed) || Number(trimmed) > 9999)) {
      invalid(`Question "${question.title}" requires an integer from 1 through 9999`);
    }
    if (question.itemType === "TEXT" && trimmed.length > 200) {
      invalid(`Question "${question.title}" must be at most 200 characters`);
    }
    if (
      question.itemType === "DATE" &&
      (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(trimmed) || Number.isNaN(new Date(trimmed.replace(/-/g, "/")).getTime()))
    ) {
      invalid(`Question "${question.title}" requires YYYY-MM-DD HH:mm`);
    }
    return { ...base, inputContent: trimmed };
  });
  return { results, attachmentPlans };
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
  dependencies: CourseParticipationDependencies,
): CourseParticipationClient {
  if (!object(session)) invalid("A verified course session is required");
  if (!object(dependencies) || typeof dependencies.request !== "function" ||
    typeof dependencies.reverifySession !== "function") {
    invalid("A curriculum API transport and write reverification are required");
  }
  const transport = dependencies;
  const reverifySession = dependencies.reverifySession;

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

  function attachmentRecovery(
    acknowledgedResources: Map<string, string[]>,
    plannedAttachments: CourseQuestionnaireAttachmentPlan[] = [],
  ) {
    return {
      attachmentGroupUuids: [
        ...plannedAttachments.map((plan) => plan.groupUuid),
      ],
      resourceIds: plannedAttachments.flatMap((plan) => acknowledgedResources.get(plan.groupUuid) ?? []),
    };
  }

  async function readAttachmentGroup(groupUuid: string): Promise<string[]> {
    const envelope = object(await transport.request(
      `/ek-agg-mob/biz-common/list-group-resource?groupUuid=${encodeURIComponent(groupUuid)}`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
      },
    ));
    const data = envelope?.data;
    if (!Array.isArray(data) || data.some(raw => !text(object(raw)?.uuid))) {
      throw new FriendsError({
        code: FriendsErrorCode.NetworkProtocol,
        message: "Unexpected course attachment group response",
      });
    }
    return data.map((rawItem) => text(object(rawItem)?.uuid)).filter((id): id is string => id !== null);
  }

  async function uploadAttachments(
    courseId: string,
    plans: CourseQuestionnaireAttachmentPlan[],
    answers: CourseQuestionnaireAnswerInput[],
  ): Promise<CourseApplyAttachmentResult[]> {
    if (plans.length === 0) return [];
    const results: CourseApplyAttachmentResult[] = [];
    const acknowledgedResources = new Map<string, string[]>();
    const recovery = () => ({
      operation: "courses.registrations.apply.attachments",
      courseId,
      completed: acknowledgedResources.size > 0 ? ["partial-protected-upload"] : [],
      ...attachmentRecovery(acknowledgedResources, plans),
    });
    try {
      for (const plan of plans) {
        const answer = answers.find(candidate => candidate.questionId === plan.questionId);
        if (!answer || !("attachments" in answer)) invalid(`Questionnaire ${plan.itemType} requires attachments`);
        const resourceIds: string[] = [];
        for (const [index, file] of plan.files.entries()) {
          await reverifySession();
          const content = answer.attachments[index]?.content;
          if (!(content instanceof Blob)) invalid("Questionnaire attachment content changed during preparation");
          const form = new FormData();
          form.append("files", content, file.filename);
          form.append("groupId", plan.groupUuid);
          let resourceId: string;
          try {
            const envelope = object(await transport.request("/ek-agg-mob/biz-common/protected-file-upload", {
              method: "POST", body: form,
            }));
            const data = envelope?.data;
            if (!Array.isArray(data) || data.length !== 1 || typeof data[0] !== "string" || !data[0]) {
              throw new FriendsError({ code: FriendsErrorCode.NetworkProtocol, message: "Course attachment upload did not return one resource UUID" });
            }
            resourceId = data[0];
          } catch (cause) {
            if (cause instanceof FriendsError && cause.code !== FriendsErrorCode.NetworkProtocol) throw cause;
            let readback: "matched" | "unmatched" | "unavailable" = "unavailable";
            try {
              const visible = await readAttachmentGroup(plan.groupUuid);
              readback = visible.some(id => !resourceIds.includes(id)) ? "matched" : "unmatched";
            } catch {
              // A failed read does not make an upload retryable.
            }
            throw new FriendsError({
              code: FriendsErrorCode.UnknownOutcome,
              message: "Course attachment upload outcome is unknown; inspect the group before any human retry",
              cause,
              recovery: { ...recovery(), serverAcknowledged: "unknown", readback,
                completed: [...recovery().completed, "read-only-follow-up"] },
            });
          }
          resourceIds.push(resourceId);
          acknowledgedResources.set(plan.groupUuid, [...resourceIds]);
        }
        let readback: CourseApplyAttachmentResult["readback"] = { status: "unavailable" };
        let visible: string[] | undefined;
        try { visible = await readAttachmentGroup(plan.groupUuid); } catch {
          // A definitive upload receipt survives an unavailable readback.
        }
        if (visible !== undefined) {
          if (!resourceIds.every(id => visible.includes(id))) {
            throw new FriendsError({ code: FriendsErrorCode.UnknownOutcome,
              message: "Course attachment group does not match its upload receipts; inspect before continuing",
              recovery: { ...recovery(), serverAcknowledged: true, readback: "unmatched" } });
          }
          readback = { status: "verified" };
        }
        results.push({ questionId: plan.questionId, itemType: plan.itemType, groupUuid: plan.groupUuid,
          resourceIds, submitted: true, serverAck: { accepted: true, message: null }, readback });
      }
    } catch (cause) {
      if (cause instanceof FriendsError && cause.recovery) throw cause;
      throw new FriendsError({ code: cause instanceof FriendsError ? cause.code : FriendsErrorCode.UnknownOutcome,
        message: cause instanceof Error ? cause.message : "Course attachment preparation interrupted",
        upstreamCode: cause instanceof FriendsError ? cause.upstreamCode : undefined,
        requestId: cause instanceof FriendsError ? cause.requestId : undefined,
        cause, recovery: recovery() });
    }
    return results;
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
    await reverifySession();
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
    let stillListed: boolean | null;
    let readback: CourseRegistrationWriteResult["readback"] = { status: "verified" };
    try {
      stillListed = (await findRegistrationById(id)) !== null;
    } catch {
      stillListed = null;
      readback = { status: "unavailable" };
    }
    const message = text(envelope?.message);
    return {
      submitted: true,
      serverAck: { accepted: true, message },
      message,
      readback,
      stillListed,
    };
  }

  async function loadApply(courseIdValue: string) {
    const id = participationCourseId(courseIdValue);
    await reverifySession();
    const envelope = object(await transport.request(
      `/zovecenter-saip-ek-app-curriculum/mob/apply/approve-detail/${encodeURIComponent(id)}`,
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
    const questionnaires = questionnaireDefinitions(raw.questionnaires);
    if (!Array.isArray(raw.roles)) {
      throw businessError("The course role contract is unknown");
    }
    const roles = raw.roles.map(value => {
      const role = object(value);
      const id = text(role?.uuid), name = text(role?.roleName);
      const classHour = number(role?.classHour), integral = number(role?.integral);
      if (!id || !name || classHour === null || integral === null) throw businessError("The course role contract is incomplete");
      return { id, name, classHour, integral };
    });
    return {
      id,
      raw,
      roles,
      questionnaires,
      preparation: {
        submitted: false,
        course: {
          id,
          name: text(raw.curriculumName),
          openTime: text(raw.openTime),
          deadline: text(raw.deadline),
          isEnroll: raw.isEnroll === true || raw.isEnroll === false ? raw.isEnroll : null,
        },
        rolesRequired: roles.length > 0,
        roles,
        payload: {
          curriculumId: id,
          questionnaireResult: null,
          studentNo: session.account.userNo,
          uuid: null,
        },
        questionnaires,
        attachmentPlans: [],
      } satisfies PreparedCourseApply,
    };
  }

  const participationClient = {
    async listMyRegistrations(
      input: CourseRegistrationListInput = {},
    ): Promise<CourseRegistrationPage> {
      const query = validateCourseRegistrationListInput(input);
      await reverifySession();
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
    async inspectApply(courseIdValue: string): Promise<PreparedCourseApply> {
      return loadApply(courseIdValue).then((loaded) => loaded.preparation);
    },
    async prepareApply(
      courseIdValue: string,
      input: { roleId?: string; questionnaire?: CourseQuestionnaireAnswerInput[] } = {},
    ): Promise<PreparedCourseApply> {
      if (!object(input)) invalid("Expected course apply preparation input");
      if (input.roleId !== undefined && typeof input.roleId !== "string") {
        invalid("roleId must be a string");
      }
      const loaded = await loadApply(courseIdValue);
      const questionnaire = buildQuestionnaireResult(
        loaded.id,
        loaded.questionnaires,
        input.questionnaire,
        session.account.userNo,
      );
      const payload: PreparedCourseApply["payload"] = {
        ...loaded.preparation.payload,
        questionnaireResult: questionnaire.results,
      };
      if (loaded.roles.length > 0 || input.roleId !== undefined) {
        if (input.roleId === undefined) {
          invalid("This course requires an explicit roleId from course detail");
        }
        const role = loaded.roles.find(role => role.id === input.roleId);
        if (!role) invalid("roleId was not returned by course detail");
        payload.roleId = role.id;
        payload.roleName = role.name;
        payload.roleClassHour = role.classHour;
        payload.roleIntegral = role.integral;
      }
      return {
        ...loaded.preparation,
        payload,
        attachmentPlans: questionnaire.attachmentPlans,
      };
    },
    async apply(input: {
      courseId: string;
      roleId?: string;
      questionnaire?: CourseQuestionnaireAnswerInput[];
      confirm: "apply";
    }): Promise<CourseApplyResult> {
      if (!object(input)) invalid("Expected course apply input");
      if (input.confirm !== "apply") invalid("confirm must be exactly \"apply\"");
      const questionnaire = input.questionnaire === undefined ? undefined : validateQuestionnaireInput(input.questionnaire);
      const prepared = await participationClient.prepareApply(input.courseId, {
        roleId: input.roleId,
        questionnaire,
      });
      const attachments = await uploadAttachments(
        input.courseId,
        prepared.attachmentPlans,
        questionnaire ?? [],
      );
      let envelope: JsonObject | null;
      try {
        await reverifySession();
      } catch (cause) {
        if (attachments.length === 0) throw cause;
        throw new FriendsError({ code: cause instanceof FriendsError ? cause.code : FriendsErrorCode.UnknownOutcome,
          message: cause instanceof Error ? cause.message : "Course session reverification failed after upload", cause,
          recovery: { operation: "courses.registrations.apply", courseId: input.courseId,
            attachmentGroupUuids: attachments.map(item => item.groupUuid), resourceIds: attachments.flatMap(item => item.resourceIds),
            completed: ["protected-upload"] } });
      }
      try {
        envelope = object(await transport.request(
          "/zovecenter-saip-ek-app-curriculum/mob/student-apply/apply",
          { method: "POST", body: JSON.stringify(prepared.payload) },
        ));
      } catch (cause) {
        if (cause instanceof FriendsError && cause.code !== FriendsErrorCode.NetworkProtocol) {
          if (attachments.length === 0) throw cause;
          throw new FriendsError({ code: cause.code, message: cause.message, upstreamCode: cause.upstreamCode,
            requestId: cause.requestId, cause, recovery: { operation: "courses.registrations.apply", courseId: input.courseId,
              attachmentGroupUuids: attachments.map(item => item.groupUuid), resourceIds: attachments.flatMap(item => item.resourceIds),
              completed: ["protected-upload"] } });
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
            ...(attachments.length > 0
              ? {
                  attachmentGroupUuids: attachments.map((attachment) => attachment.groupUuid),
                  resourceIds: attachments.flatMap((attachment) => attachment.resourceIds),
                }
              : {}),
          },
        });
      }
      let registration: CourseRegistrationSummary["registration"] = null;
      let readback: CourseApplyResult["readback"] = { status: "verified" };
      try {
        registration = await findRegistrationByCourse(input.courseId);
        if (registration === null) readback = { status: "unavailable" };
      } catch {
        registration = null;
        readback = { status: "unavailable" };
      }
      const message = text(envelope?.message);
      return {
        submitted: true,
        serverAck: { accepted: true, message },
        message,
        readback,
        registration,
        attachments,
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
