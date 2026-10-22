import { FriendsError, FriendsErrorCode } from "./errors.js";

type JsonObject = Record<string, unknown>;

export interface VolunteerOfferingUploadFile {
  readonly name: string;
  readonly size: number;
  readonly type: string;
  readonly file: Blob;
}

export interface VolunteerOfferingOrganizationContext {
  id: string;
  name: string;
  type: string;
}

export interface VolunteerOfferingDictionaryItem {
  code: string;
  name: string;
}

export interface VolunteerOfferingRemoteContext {
  organization: VolunteerOfferingOrganizationContext;
  activityType: VolunteerOfferingDictionaryItem;
  activityLevel: VolunteerOfferingDictionaryItem;
  schoolYear: string;
  termNo: string;
}

export interface VolunteerOfferingActivityInput {
  activityName: string;
  activityType: string;
  activityLevel: string;
  beginTime: string;
  endTime: string;
  activityPlace: string;
  contacts: string;
  phone: string;
  volunteerNumber: number | string;
  totalDuration: number | string;
  activityContent: string;
  overview: string;
}

export interface VolunteerOfferingPostInput {
  postName: string;
  recruitNumber: number;
  duration?: number;
}

export interface VolunteerOfferingQuestionnaireOptionInput {
  optionName: string;
  sort: number;
}

export interface VolunteerOfferingQuestionnaireInput {
  title: string;
  itemType:
    | "CHOICE"
    | "MULTIPLE_CHOICE"
    | "TEXT"
    | "DATE"
    | "NUMBER"
    | "PICTURE"
    | "MULTIPLE_PICTURE"
    | "FILE"
    | "MULTIPLE_FILE";
  isMandatory: boolean;
  sort: number;
  options: VolunteerOfferingQuestionnaireOptionInput[];
}

export interface VolunteerOfferingRegistrationInput {
  openType: "NOW" | "AUTO";
  openTime: string;
  finishType: "NOW" | "AUTO";
  deadline: string;
  applyNumber?: number;
  isOpenEnrollment?: boolean;
  isEnrollExamine?: boolean;
  isHideList?: boolean;
  isLimitVolunteer?: boolean;
  volunteerStar?: Array<"ONE" | "TWO" | "THREE" | "FOUR" | "FIVE">;
  isPrivateCollection?: boolean;
  currentOrganization?: boolean;
  positionSetMethod: "TIME" | "SIGN";
  posts: VolunteerOfferingPostInput[];
  questionnaires?: VolunteerOfferingQuestionnaireInput[];
}

export interface VolunteerOfferingTemporaryPersonInput {
  studentNo: string;
  durationHours: number;
}

export interface VolunteerOfferingInput {
  schemaVersion: 1;
  kind: "volunteer-offering";
  activityCategory: "SCHOOL_ACTIVITY" | "TEMP_ACTIVITY";
  organizationId?: string;
  organizationName?: string;
  activity: VolunteerOfferingActivityInput;
  registration?: VolunteerOfferingRegistrationInput;
  materials: {
    publicityPictures: Array<File | VolunteerOfferingUploadFile>;
    attachments?: Array<File | VolunteerOfferingUploadFile>;
  };
  temporaryRoster?: VolunteerOfferingTemporaryPersonInput[];
}

export interface NormalizedVolunteerOfferingInput {
  activityCategory: "SCHOOL_ACTIVITY" | "TEMP_ACTIVITY";
  organizationId?: string;
  organizationName?: string;
  activity: VolunteerOfferingActivityInput;
  registration?: Required<Pick<VolunteerOfferingRegistrationInput,
    "openType" | "openTime" | "finishType" | "deadline" | "isOpenEnrollment" |
    "isEnrollExamine" | "isHideList" | "isLimitVolunteer" | "volunteerStar" |
    "isPrivateCollection" | "currentOrganization" | "positionSetMethod" | "posts" | "questionnaires"
  >> & { applyNumber?: number };
  materials: {
    publicityPictures: VolunteerOfferingUploadFile[];
    attachments: VolunteerOfferingUploadFile[];
  };
  temporaryRoster?: VolunteerOfferingTemporaryPersonInput[];
}

export type VolunteerOfferingFirstPayload = Readonly<JsonObject>;
export type VolunteerOfferingRegistrationPayload = Readonly<JsonObject>;

const allowedTopKeys = new Set([
  "schemaVersion", "kind", "activityCategory", "organizationId", "organizationName",
  "activity", "registration", "materials", "temporaryRoster",
]);
const activityKeys = new Set(Object.keys({
  activityName: 0, activityType: 0, activityLevel: 0, beginTime: 0, endTime: 0,
  activityPlace: 0, contacts: 0, phone: 0, volunteerNumber: 0, totalDuration: 0,
  activityContent: 0, overview: 0,
} satisfies Record<keyof VolunteerOfferingActivityInput, number>));
const registrationKeys = new Set([
  "openType", "openTime", "finishType", "deadline", "applyNumber", "isOpenEnrollment",
  "isEnrollExamine", "isHideList", "isLimitVolunteer", "volunteerStar", "isPrivateCollection",
  "currentOrganization", "positionSetMethod", "posts", "questionnaires",
]);
const postKeys = new Set(["postName", "recruitNumber", "duration"]);
const questionnaireKeys = new Set(["title", "itemType", "isMandatory", "sort", "options"]);
const optionKeys = new Set(["optionName", "sort"]);
const imageExtensions = new Set(["jpg", "jpeg", "png", "gif", "bmp"]);
const attachmentExtensions = new Set([
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "png", "jpg", "jpeg", "gif", "bmp",
  "txt", "rar", "zip", "7z", "mp3", "avi", "wmv", "mpeg", "mp4",
]);
const videoExtensions = new Set(["avi", "wmv", "mpeg", "mp4"]);
const imageTypes = new Set(["image/png", "image/jpg", "image/jpeg", "image/gif", "image/bmp"]);
const questionnaireItemTypes = new Set([
  "CHOICE", "MULTIPLE_CHOICE", "TEXT", "DATE", "NUMBER", "PICTURE", "MULTIPLE_PICTURE", "FILE", "MULTIPLE_FILE",
]);
const stars = new Set(["ONE", "TWO", "THREE", "FOUR", "FIVE"]);

function invalid(message: string): never {
  throw new FriendsError({ code: FriendsErrorCode.InvalidInput, message });
}

function object(value: unknown): JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonObject : null;
}

function rejectUnknown(value: JsonObject, allowed: Set<string>, label: string): void {
  const key = Object.keys(value).find((item) => !allowed.has(item));
  if (key !== undefined) invalid(`${label} has an unsupported field: ${key}`);
}

function requiredString(value: unknown, field: string, maximum: number): string {
  if (typeof value !== "string" || value.trim() === "") invalid(`${field} is required`);
  if (value.length > maximum) invalid(`${field} must be at most ${maximum} characters`);
  return value;
}

function positiveInteger(value: unknown, field: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > maximum) {
    invalid(`${field} must be an integer from 1 through ${maximum}`);
  }
  return value as number;
}

function duration(value: unknown, field: string, maximum: number, step: number): number {
  const parsed = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed) || parsed <= 0 || parsed > maximum) {
    invalid(`${field} must be from 0 through ${maximum} hours`);
  }
  const rounded = Math.round(parsed / step) * step;
  if (Math.abs((parsed - rounded) / step) > 1e-9) invalid(`${field} must use ${step}-hour steps`);
  return Number(rounded.toFixed(1));
}

function localDateTime(value: unknown, field: string): string {
  if (typeof value !== "string") invalid(`${field} must use YYYY-MM-DD HH:mm[:ss]`);
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) invalid(`${field} must use YYYY-MM-DD HH:mm[:ss]`);
  const [, year, month, day, hour, minute, second] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second ?? 0)));
  if (
    date.getUTCFullYear() !== Number(year) || date.getUTCMonth() !== Number(month) - 1 ||
    date.getUTCDate() !== Number(day) || date.getUTCHours() !== Number(hour) ||
    date.getUTCMinutes() !== Number(minute) || date.getUTCSeconds() !== Number(second ?? 0)
  ) invalid(`${field} is not a valid date and time`);
  return `${year}-${month}-${day} ${hour}:${minute}:${second ?? "00"}`;
}

function file(value: File | VolunteerOfferingUploadFile): VolunteerOfferingUploadFile {
  const raw = value as { name?: unknown; size?: unknown; type?: unknown; file?: unknown };
  const actual = raw.file instanceof Blob ? raw.file : value;
  const name = typeof raw.name === "string" ? raw.name : (actual as File).name;
  const size = typeof raw.size === "number" ? raw.size : actual.size;
  const type = typeof raw.type === "string" ? raw.type : (actual as File).type;
  if (!(actual instanceof Blob) || typeof name !== "string" || name === "" || !Number.isSafeInteger(size) || size < 0) {
    invalid("Offering materials must be File or Blob objects with a name and size");
  }
  return { name, size, type, file: actual };
}

function extension(name: string): string {
  const value = name.split(".").pop()?.toLowerCase() ?? "";
  return value === name.toLowerCase() || value === "" ? "" : value;
}

function validateFiles(value: unknown, label: string, options: {
  required: boolean;
  maximum: number;
  extensions: Set<string>;
  normalBytes: number;
  videoBytes?: number;
}): VolunteerOfferingUploadFile[] {
  if (!Array.isArray(value)) invalid(`${label} must be an array`);
  if (options.required && value.length === 0) invalid(`${label} is required`);
  if (value.length > options.maximum) invalid(`${label} accepts at most ${options.maximum} files`);
  return value.map((item) => {
    const uploaded = file(item as File | VolunteerOfferingUploadFile);
    const currentExtension = extension(uploaded.name);
    if (!options.extensions.has(currentExtension)) invalid(`${label} does not allow ${uploaded.name}`);
    const limit = options.videoBytes && videoExtensions.has(currentExtension) ? options.videoBytes : options.normalBytes;
    if (uploaded.size > limit) {
      invalid(`${uploaded.name} exceeds ${Math.floor(limit / 1024 / 1024)} MiB`);
    }
    if (options.extensions === imageExtensions && uploaded.type !== "" && !imageTypes.has(uploaded.type.toLowerCase())) {
      invalid(`${label} only accepts jpg, jpeg, png, gif, and bmp images`);
    }
    return uploaded;
  });
}

function selectOrganization(input: {
  organizationId?: string;
  organizationName?: string;
}, organizations: VolunteerOfferingOrganizationContext[]) {
  if (organizations.length === 0) invalid("The account has no volunteer organizations");
  const selected = organizations.filter((organization) =>
    input.organizationId !== undefined ? organization.id === input.organizationId :
    input.organizationName !== undefined ? organization.name === input.organizationName :
    true
  );
  if (selected.length === 0) invalid("The requested volunteer organization is not available in this account context");
  if (selected.length > 1) invalid("Multiple volunteer organizations are available; select organizationId or organizationName");
  return selected[0];
}

function selectDictionary(value: unknown, requested: string, label: string): VolunteerOfferingDictionaryItem {
  const raw = object(value);
  if (raw === null || raw.code !== requested && raw.name !== requested) invalid(`${label} is not available for this account`);
  if (typeof raw.code !== "string" || typeof raw.name !== "string") invalid(`The school returned an invalid ${label}`);
  return { code: raw.code, name: raw.name };
}

export function normalizeVolunteerOfferingInput(
  value: unknown,
  context: VolunteerOfferingRemoteContext,
): NormalizedVolunteerOfferingInput {
  const input = object(value);
  if (input === null) invalid("Expected a volunteer offering input object");
  rejectUnknown(input, allowedTopKeys, "Volunteer offering input");
  if (input.schemaVersion !== 1 || input.kind !== "volunteer-offering") invalid("Expected volunteer offering schema version 1");
  if (input.activityCategory !== "SCHOOL_ACTIVITY" && input.activityCategory !== "TEMP_ACTIVITY") {
    invalid("activityCategory must be SCHOOL_ACTIVITY or TEMP_ACTIVITY");
  }
  if (input.organizationId !== undefined && typeof input.organizationId !== "string") invalid("organizationId must be a string");
  if (input.organizationName !== undefined && typeof input.organizationName !== "string") invalid("organizationName must be a string");

  const activityRaw = object(input.activity);
  if (activityRaw === null) invalid("activity is required");
  rejectUnknown(activityRaw, activityKeys, "Offering activity");
  const activity = { ...activityRaw } as unknown as VolunteerOfferingActivityInput;
  for (const field of ["activityName", "activityType", "activityLevel", "activityPlace", "contacts", "phone", "activityContent", "overview"] as const) {
    requiredString(activity[field], field, field === "activityName" || field === "activityPlace" ? 32 : field === "contacts" ? 16 : 200);
  }
  if (!/^1\d{10}$/.test(activity.phone)) invalid("phone must be a mainland China mobile number");
  const volunteerNumber = typeof activity.volunteerNumber === "string" ? Number(activity.volunteerNumber) : activity.volunteerNumber;
  if (typeof activity.volunteerNumber === "string" && !/^\d{1,4}$/.test(activity.volunteerNumber)) {
    invalid("volunteerNumber must contain at most four digits");
  }
  if (!Number.isSafeInteger(volunteerNumber) || volunteerNumber < 1 || volunteerNumber > 9999) {
    invalid("volunteerNumber must be an integer from 1 through 9999");
  }
  activity.volunteerNumber = String(volunteerNumber);
  const totalDuration = duration(activity.totalDuration, "totalDuration", 9999.9, 0.1);
  activity.totalDuration = totalDuration;
  const beginTime = localDateTime(activity.beginTime, "beginTime");
  const endTime = localDateTime(activity.endTime, "endTime");
  if (Date.parse(beginTime.replace(" ", "T") + "Z") >= Date.parse(endTime.replace(" ", "T") + "Z")) {
    invalid("endTime must be after beginTime");
  }
  activity.beginTime = beginTime;
  activity.endTime = endTime;

  const organization = selectOrganization({
    organizationId: input.organizationId as string | undefined,
    organizationName: input.organizationName as string | undefined,
  }, [context.organization]);
  if (context.organization.id !== organization.id) invalid("The requested volunteer organization changed");
  const activityType = selectDictionary(context.activityType, activity.activityType, "activity type");
  const activityLevel = selectDictionary(context.activityLevel, activity.activityLevel, "activity level");
  activity.activityType = activityType.code;
  activity.activityLevel = activityLevel.code;

  const materialsRaw = object(input.materials);
  if (materialsRaw === null) invalid("materials are required");
  rejectUnknown(materialsRaw, new Set(["publicityPictures", "attachments"]), "Offering materials");
  const materials = {
    publicityPictures: validateFiles(materialsRaw.publicityPictures, "publicityPictures", {
      required: true, maximum: 5, extensions: imageExtensions, normalBytes: 20 * 1024 * 1024,
    }),
    attachments: validateFiles(materialsRaw.attachments ?? [], "attachments", {
      required: false, maximum: 10, extensions: attachmentExtensions, normalBytes: 20 * 1024 * 1024,
      videoBytes: 200 * 1024 * 1024,
    }),
  };

  let registration: NormalizedVolunteerOfferingInput["registration"];
  if (input.activityCategory === "SCHOOL_ACTIVITY") {
    const raw = object(input.registration);
    if (raw === null) invalid("registration settings are required for SCHOOL_ACTIVITY");
    rejectUnknown(raw, registrationKeys, "Offering registration settings");
    if (raw.openType !== "NOW" && raw.openType !== "AUTO") invalid("openType must be NOW or AUTO");
    if (raw.finishType !== "NOW" && raw.finishType !== "AUTO") invalid("finishType must be NOW or AUTO");
    const openTime = localDateTime(raw.openTime, "openTime");
    const deadline = localDateTime(raw.deadline, "deadline");
    if (Date.parse(deadline.replace(" ", "T") + "Z") >= Date.parse(beginTime.replace(" ", "T") + "Z")) {
      invalid("registration deadline must be before the activity begins");
    }
    const applyNumber = raw.finishType === "AUTO"
      ? positiveInteger(raw.applyNumber, "applyNumber", 9999)
      : undefined;
    if (raw.positionSetMethod !== "TIME" && raw.positionSetMethod !== "SIGN") invalid("positionSetMethod must be TIME or SIGN");
    if (!Array.isArray(raw.posts) || raw.posts.length === 0) invalid("At least one post is required");
    const posts = raw.posts.map((postValue) => {
      const post = object(postValue);
      if (post === null) invalid("Each offering post must be an object");
      rejectUnknown(post, postKeys, "Offering post");
      const recruitNumber = positiveInteger(post.recruitNumber, "recruitNumber", 9999);
      if (raw.positionSetMethod === "TIME") {
        if (post.duration === undefined) invalid("TIME posts require duration");
        const postDuration = duration(post.duration, "post duration", totalDuration, 0.5);
        return { postName: requiredString(post.postName, "postName", 10), recruitNumber, duration: postDuration };
      }
      if (post.duration !== undefined) invalid("SIGN posts must not provide duration");
      return { postName: requiredString(post.postName, "postName", 10), recruitNumber };
    });
    if (posts.reduce((sum, post) => sum + post.recruitNumber, 0) > volunteerNumber) {
      invalid("Post recruitment total exceeds volunteerNumber");
    }
    const volunteerStar = Array.isArray(raw.volunteerStar) ? raw.volunteerStar : [];
    if (volunteerStar.some((star) => !stars.has(star as string))) invalid("volunteerStar contains an unsupported level");
    if (raw.isLimitVolunteer === true && volunteerStar.length === 0) invalid("isLimitVolunteer requires volunteerStar");
    const questionnaires = Array.isArray(raw.questionnaires) ? raw.questionnaires : [];
    const normalizedQuestionnaires = questionnaires.map((questionValue) => {
      const question = object(questionValue);
      if (question === null) invalid("Each questionnaire item must be an object");
      rejectUnknown(question, questionnaireKeys, "Questionnaire item");
      if (!questionnaireItemTypes.has(String(question.itemType))) invalid("Unsupported questionnaire itemType");
      const options = Array.isArray(question.options) ? question.options.map((optionValue) => {
        const option = object(optionValue);
        if (option === null) invalid("Each questionnaire option must be an object");
        rejectUnknown(option, optionKeys, "Questionnaire option");
        return { optionName: requiredString(option.optionName, "optionName", 32), sort: positiveInteger(option.sort, "option sort", 999999) };
      }) : [];
      if ((question.itemType === "CHOICE" || question.itemType === "MULTIPLE_CHOICE") && options.length === 0) {
        invalid("Choice questionnaire items require options");
      }
      if (question.itemType !== "CHOICE" && question.itemType !== "MULTIPLE_CHOICE" && options.length > 0) {
        invalid("Non-choice questionnaire items must not provide options");
      }
      return {
        title: requiredString(question.title, "questionnaire title", 32),
        itemType: question.itemType as VolunteerOfferingQuestionnaireInput["itemType"],
        isMandatory: question.isMandatory === true,
        sort: positiveInteger(question.sort, "questionnaire sort", 999999),
        options,
      };
    });
    registration = {
      openType: raw.openType, openTime, finishType: raw.finishType, deadline, applyNumber,
      isOpenEnrollment: raw.isOpenEnrollment === undefined ? true : raw.isOpenEnrollment === true,
      isEnrollExamine: raw.isEnrollExamine === undefined ? false : raw.isEnrollExamine === true,
      isHideList: raw.isHideList === undefined ? false : raw.isHideList === true,
      isLimitVolunteer: raw.isLimitVolunteer === undefined ? false : raw.isLimitVolunteer === true,
      volunteerStar,
      isPrivateCollection: raw.isPrivateCollection === undefined ? false : raw.isPrivateCollection === true,
      currentOrganization: raw.currentOrganization === undefined ? false : raw.currentOrganization === true,
      positionSetMethod: raw.positionSetMethod,
      posts,
      questionnaires: normalizedQuestionnaires,
    };
  } else if (input.registration !== undefined) {
    invalid("TEMP_ACTIVITY must not provide registration settings");
  }

  let temporaryRoster: VolunteerOfferingTemporaryPersonInput[] | undefined;
  if (input.activityCategory === "TEMP_ACTIVITY") {
    if (!Array.isArray(input.temporaryRoster) || input.temporaryRoster.length === 0) {
      invalid("TEMP_ACTIVITY requires a non-empty temporaryRoster");
    }
    temporaryRoster = input.temporaryRoster.map((personValue) => {
      const person = object(personValue);
      if (person === null) invalid("Each temporary roster person must be an object");
      rejectUnknown(person, new Set(["studentNo", "durationHours"]), "Temporary roster person");
      if (typeof person.studentNo !== "string" || /[\s\/?#]/.test(person.studentNo)) invalid("A valid studentNo is required");
      return { studentNo: person.studentNo, durationHours: duration(person.durationHours, "temporary certification duration", 99999.9, 0.5) };
    });
    if (new Set(temporaryRoster.map((person) => person.studentNo)).size !== temporaryRoster.length) {
      invalid("temporaryRoster contains a duplicate studentNo");
    }
  } else if (input.temporaryRoster !== undefined) {
    invalid("SCHOOL_ACTIVITY must not provide temporaryRoster");
  }

  return {
    activityCategory: input.activityCategory,
    organizationId: input.organizationId as string | undefined,
    organizationName: input.organizationName as string | undefined,
    activity,
    registration,
    materials,
    temporaryRoster,
  };
}

export function newVolunteerOfferingGroupUuid(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function buildVolunteerOfferingFirstPayload(
  input: NormalizedVolunteerOfferingInput,
  context: VolunteerOfferingRemoteContext,
  publicityGroupUuid: string,
  attachmentGroupUuid?: string,
): VolunteerOfferingFirstPayload {
  const [beginYear, endYear] = context.schoolYear.split("-");
  if (!/^\d{4}$/.test(beginYear ?? "") || !/^\d{4}$/.test(endYear ?? "")) {
    invalid("The school returned an invalid current year");
  }
  const payload: JsonObject = {
    activityName: input.activity.activityName,
    activityType: input.activity.activityType,
    activityLevel: input.activity.activityLevel,
    beginTime: input.activity.beginTime,
    endTime: input.activity.endTime,
    activityPlace: input.activity.activityPlace,
    organizationId: context.organization.id,
    organizationName: context.organization.name,
    organizationType: context.organization.type === "CCYL" ? "LEAGUE" : "STUDENT",
    contacts: input.activity.contacts,
    phone: input.activity.phone,
    volunteerNumber: input.activity.volunteerNumber,
    totalDuration: input.activity.totalDuration,
    activityContent: input.activity.activityContent,
    overview: input.activity.overview,
    publicityPicturesGroupUuid: publicityGroupUuid,
    beginYear,
    endYear,
    termNo: context.termNo,
    activityCategory: input.activityCategory,
  };
  if (attachmentGroupUuid !== undefined) payload.attachmentGroupUuid = attachmentGroupUuid;
  return payload;
}

export function buildVolunteerOfferingRegistrationPayload(
  input: NormalizedVolunteerOfferingInput,
  activityId: string,
): VolunteerOfferingRegistrationPayload {
  const registration = input.registration;
  if (registration === undefined) invalid("Registration settings are required");
  const payload: JsonObject = {
    deadline: registration.deadline,
    openTime: registration.openTime,
    finishType: registration.finishType,
    isEnrollExamine: registration.isEnrollExamine,
    isHideList: registration.isHideList,
    isLimitVolunteer: registration.isLimitVolunteer,
    isOpenEnrollment: registration.isOpenEnrollment,
    isPrivateCollection: registration.isPrivateCollection,
    openType: registration.openType,
    positionSetMethod: registration.positionSetMethod,
    posts: registration.posts.map((post) => ({ ...post, uuid: "", activityId })),
    questionnaires: registration.questionnaires.map((question) => ({
      activityId, title: question.title, itemType: question.itemType, isMandatory: question.isMandatory,
      sort: question.sort, uuid: "", options: question.options.map((option) => ({ ...option, uuid: "" })),
    })),
    volunteerStar: registration.volunteerStar,
    activityCategory: input.activityCategory,
    currentOrganization: registration.currentOrganization,
  };
  if (registration.applyNumber !== undefined) payload.applyNumber = registration.applyNumber;
  return payload;
}
