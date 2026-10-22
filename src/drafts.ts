import { FriendsError, FriendsErrorCode } from "./errors.js";

export type VolunteerPositionSetMethod = "TIME" | "SIGN";

export interface VolunteerActivityPost {
  id: string;
  name: string | null;
  durationHours: number | null;
}

export interface VolunteerRegistrationSource {
  registrationId: string | null;
  studentNo: string;
  studentName: string | null;
  postId: string | null;
  postName: string | null;
  postDurationHours: number | null;
  signDurationHours: number | null;
  isApplied: boolean | null;
  upstreamPreselected: boolean;
}

export interface CertificationDraftBinding {
  accountUserNo: string;
  levelNo: string;
  unitNo: string;
  organizationId: string | null;
  activityId: string;
}

export interface LocalFileMaterial {
  kind: "local-file";
  id: string;
  path: string;
  sha256: string;
  size: number;
}

export interface WebUnrecoverableMaterial {
  kind: "web-unrecoverable";
  id: string;
  label: string;
  remoteRef: unknown;
}

export type CertificationDraftMaterial = LocalFileMaterial | WebUnrecoverableMaterial;

export interface VolunteerCertificationDraft {
  schemaVersion: 1;
  kind: "volunteer-certification";
  id: string;
  revision: number;
  binding: CertificationDraftBinding;
  activity: {
    id: string;
    name: string | null;
    organizationName: string | null;
    positionSetMethod: VolunteerPositionSetMethod;
    posts: VolunteerActivityPost[];
  };
  registrations: VolunteerRegistrationSource[];
  includedStudentNos: string[];
  durations: Record<string, number>;
  materials: CertificationDraftMaterial[];
}

export interface VolunteerCertificationDraftPatch {
  addRegistrations?: VolunteerRegistrationSource[];
  includedStudentNos?: string[];
  postIds?: Record<string, string>;
  durations?: Record<string, number>;
  materials?: CertificationDraftMaterial[];
}

export interface DraftValidationIssue {
  code: string;
  message: string;
  path?: string;
}

export interface DraftValidationResult {
  valid: boolean;
  complete: boolean;
  issues: DraftValidationIssue[];
}

export interface MaterialFileFact {
  exists: false;
}

export interface AvailableMaterialFileFact {
  exists: true;
  regularFile: boolean;
  size: number;
  sha256: string;
}

export type MaterialFileFacts = MaterialFileFact | AvailableMaterialFileFact;

export interface VolunteerCertificationSubmitPayload {
  activityId: string;
  uuid: null;
  nameList: Array<{
    activityId: string;
    attestationDuration: number;
    postDuration: number | null;
    postId: string;
    postName: string;
    signDuration: number | null;
    studentNo: string;
    uuid: string;
    isApply: boolean | 0;
  }>;
}

type JsonObject = Record<string, unknown>;

const maximumDuration = 99_999.9;

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

function requiredId(value: unknown, name: string): string {
  const id = text(value);
  if (id === null || id === "." || id === ".." || /[\\/\r\n\0]/.test(id)) {
    invalid(`${name} must be a non-empty safe identifier`);
  }
  return id;
}

function duration(value: unknown, path: string): number {
  const durationValue = number(value);
  if (
    durationValue === null ||
    durationValue < 0 ||
    durationValue > maximumDuration ||
    Math.abs(durationValue * 10 - Math.round(durationValue * 10)) > 1e-9
  ) {
    invalid(`${path} must be hours from 0 through 99999.9 with one decimal`);
  }
  return durationValue;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function validateBinding(value: unknown): CertificationDraftBinding {
  const raw = object(value);
  if (raw === null) invalid("Expected a certification draft binding");
  return {
    accountUserNo: requiredId(raw.accountUserNo, "binding.accountUserNo"),
    levelNo: requiredId(raw.levelNo, "binding.levelNo"),
    unitNo: requiredId(raw.unitNo, "binding.unitNo"),
    organizationId: nullableText(raw.organizationId),
    activityId: requiredId(raw.activityId, "binding.activityId"),
  };
}

function validatePost(value: unknown): VolunteerActivityPost {
  const raw = object(value);
  if (raw === null) invalid("Expected a volunteer activity post");
  return {
    id: requiredId(raw.id, "post.id"),
    name: nullableText(raw.name),
    durationHours: raw.durationHours === undefined || raw.durationHours === null
      ? null
      : duration(raw.durationHours, "post.durationHours"),
  };
}

function validateActivity(value: unknown): VolunteerCertificationDraft["activity"] {
  const raw = object(value);
  if (raw === null) invalid("Expected a volunteer activity");
  if (raw.positionSetMethod !== "TIME" && raw.positionSetMethod !== "SIGN") {
    invalid("activity.positionSetMethod must be TIME or SIGN");
  }
  if (!Array.isArray(raw.posts)) invalid("activity.posts must be an array");
  return {
    id: requiredId(raw.id, "activity.id"),
    name: nullableText(raw.name),
    organizationName: nullableText(raw.organizationName),
    positionSetMethod: raw.positionSetMethod,
    posts: raw.posts.map(validatePost),
  };
}

function validateRegistration(value: unknown): VolunteerRegistrationSource {
  const raw = object(value);
  if (raw === null) invalid("Expected a volunteer registration source");
  if (raw.registrationId !== null && raw.registrationId !== undefined) {
    requiredId(raw.registrationId, "registration.registrationId");
  }
  if (raw.postId !== null && raw.postId !== undefined) {
    requiredId(raw.postId, "registration.postId");
  }
  return {
    registrationId: raw.registrationId === undefined || raw.registrationId === null
      ? null
      : raw.registrationId as string,
    studentNo: requiredId(raw.studentNo, "registration.studentNo"),
    studentName: nullableText(raw.studentName),
    postId: raw.postId === undefined || raw.postId === null ? null : raw.postId as string,
    postName: nullableText(raw.postName),
    postDurationHours: raw.postDurationHours === undefined || raw.postDurationHours === null
      ? null
      : duration(raw.postDurationHours, "registration.postDurationHours"),
    signDurationHours: raw.signDurationHours === undefined || raw.signDurationHours === null
      ? null
      : duration(raw.signDurationHours, "registration.signDurationHours"),
    isApplied: boolean(raw.isApplied),
    upstreamPreselected: raw.upstreamPreselected === true,
  };
}

function validateMaterial(value: unknown): CertificationDraftMaterial {
  const raw = object(value);
  if (raw === null) invalid("Expected a certification material");
  const id = requiredId(raw.id, "material.id");
  if (raw.kind === "web-unrecoverable") {
    const label = text(raw.label);
    if (label === null) invalid("web-unrecoverable material label is required");
    return { kind: "web-unrecoverable", id, label, remoteRef: raw.remoteRef ?? null };
  }
  if (raw.kind !== "local-file") invalid("material.kind must be local-file or web-unrecoverable");
  const path = text(raw.path);
  const sha256 = typeof raw.sha256 === "string" ? raw.sha256.toLowerCase() : "";
  const size = number(raw.size);
  if (path === null || !/^([a-z]:[\\/]|\/)/i.test(path)) invalid("local material path must be absolute");
  if (!/^[0-9a-f]{64}$/.test(sha256)) invalid("local material sha256 must be a SHA-256 hex digest");
  if (size === null || size < 0) invalid("local material size must be non-negative");
  return { kind: "local-file", id, path, sha256, size };
}

function validateDraftShape(value: unknown): VolunteerCertificationDraft {
  const raw = object(value);
  if (raw === null) invalid("Expected a volunteer certification draft");
  const revision = number(raw.revision);
  if (
    raw.schemaVersion !== 1 ||
    raw.kind !== "volunteer-certification" ||
    revision === null ||
    !Number.isSafeInteger(revision) ||
    revision < 0
  ) {
    invalid("Unsupported volunteer certification draft version or revision");
  }
  if (!Array.isArray(raw.registrations) || !Array.isArray(raw.includedStudentNos) ||
      !Array.isArray(raw.materials)) {
    invalid("Draft roster, selection, and materials must be arrays");
  }
  if (object(raw.durations) === null) invalid("Draft durations must be an object");
  return {
    schemaVersion: 1,
    kind: "volunteer-certification",
    id: requiredId(raw.id, "draft.id"),
    revision,
    binding: validateBinding(raw.binding),
    activity: validateActivity(raw.activity),
    registrations: raw.registrations.map(validateRegistration),
    includedStudentNos: raw.includedStudentNos.map((value) => requiredId(value, "includedStudentNos")),
    durations: Object.fromEntries(
      Object.entries(raw.durations as Record<string, unknown>).map(([key, value]) => [key, duration(value, `durations.${key}`)]),
    ),
    materials: raw.materials.map(validateMaterial),
  };
}

function ensureDraftReferences(draft: VolunteerCertificationDraft): void {
  if (draft.activity.id !== draft.binding.activityId) {
    invalid("Draft activity binding does not match the activity");
  }
  const studentNos = new Set<string>();
  for (const registration of draft.registrations) {
    if (studentNos.has(registration.studentNo)) {
      invalid(`Duplicate registration student number: ${registration.studentNo}`);
    }
    studentNos.add(registration.studentNo);
  }
  const postIds = new Set(draft.activity.posts.map((post) => post.id));
  for (const registration of draft.registrations) {
    if (registration.postId !== null && !postIds.has(registration.postId)) {
      invalid(`Registration ${registration.studentNo} refers to an unknown post`);
    }
  }
  if (new Set(draft.includedStudentNos).size !== draft.includedStudentNos.length) {
    invalid("Included student numbers must be unique");
  }
  for (const studentNo of draft.includedStudentNos) {
    if (!studentNos.has(studentNo)) invalid(`Included student is not in the source roster: ${studentNo}`);
  }
  for (const key of Object.keys(draft.durations)) {
    if (!studentNos.has(key)) invalid(`Duration refers to an unknown student: ${key}`);
  }
  const materialIds = new Set<string>();
  for (const material of draft.materials) {
    if (materialIds.has(material.id)) invalid(`Duplicate material id: ${material.id}`);
    materialIds.add(material.id);
  }
}

export function createPartialVolunteerCertificationDraft(input: {
  id: string;
  binding: unknown;
  activity: unknown;
  registrations: unknown;
  materials?: unknown;
}): VolunteerCertificationDraft {
  if (!Array.isArray(input.registrations)) invalid("registrations must be an array");
  if (input.materials !== undefined && !Array.isArray(input.materials)) invalid("materials must be an array");
  const draft = validateDraftShape({
    schemaVersion: 1,
    kind: "volunteer-certification",
    id: input.id,
    revision: 0,
    binding: input.binding,
    activity: input.activity,
    registrations: input.registrations,
    includedStudentNos: [],
    durations: {},
    materials: input.materials ?? [],
  });
  ensureDraftReferences(draft);
  return draft;
}

export function parseVolunteerCertificationDraft(value: unknown): VolunteerCertificationDraft {
  const draft = validateDraftShape(value);
  ensureDraftReferences(draft);
  return draft;
}

export function updateVolunteerCertificationDraft(
  draftInput: unknown,
  patch: VolunteerCertificationDraftPatch,
  expectedRevision: number,
): VolunteerCertificationDraft {
  const draft = validateDraftShape(draftInput);
  ensureDraftReferences(draft);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    invalid("expectedRevision must be a non-negative integer");
  }
  if (expectedRevision !== draft.revision) {
    throw new FriendsError({
      code: FriendsErrorCode.UpstreamBusiness,
      message: `Draft revision conflict: expected ${expectedRevision}, current ${draft.revision}`,
    });
  }
  if (object(patch) === null) invalid("Expected a draft patch");
  for (const key of Object.keys(patch)) {
    if (!["addRegistrations", "includedStudentNos", "postIds", "durations", "materials"].includes(key)) invalid(`Unknown draft patch field: ${key}`);
  }
  const next = clone(draft);
  next.revision += 1;
  if (patch.addRegistrations !== undefined) {
    if (!Array.isArray(patch.addRegistrations)) invalid("addRegistrations must be an array");
    next.registrations.push(...patch.addRegistrations.map(validateRegistration));
  }
  if (patch.includedStudentNos !== undefined) {
    if (!Array.isArray(patch.includedStudentNos)) invalid("includedStudentNos must be an array");
    next.includedStudentNos = patch.includedStudentNos.map((value) => requiredId(value, "includedStudentNos"));
  }
  if (patch.postIds !== undefined) {
    const rawPosts = object(patch.postIds);
    if (rawPosts === null) invalid("postIds must be an object");
    for (const [studentNo, postId] of Object.entries(rawPosts)) {
      const registration = next.registrations.find((item) => item.studentNo === studentNo);
      const post = next.activity.posts.find((item) => item.id === postId);
      if (registration === undefined) invalid(`Unknown duration student: ${studentNo}`);
      if (post === undefined || typeof postId !== "string") invalid(`Unknown post for student: ${studentNo}`);
      registration.postId = post.id;
      registration.postName = post.name;
      registration.postDurationHours = post.durationHours;
      if (next.activity.positionSetMethod === "TIME" && post.durationHours !== null) {
        next.durations[studentNo] = post.durationHours;
      }
    }
  }
  if (patch.durations !== undefined) {
    const rawDurations = object(patch.durations);
    if (rawDurations === null) invalid("durations must be an object");
    next.durations = Object.fromEntries(
      Object.entries(rawDurations).map(([key, value]) => [key, duration(value, `durations.${key}`)]),
    );
  }
  if (patch.materials !== undefined) {
    if (!Array.isArray(patch.materials)) invalid("materials must be an array");
    next.materials = patch.materials.map(validateMaterial);
  }
  ensureDraftReferences(next);
  return next;
}

export function validateVolunteerCertificationDraft(
  draftInput: unknown,
  mode: "structure" | "complete" = "structure",
): DraftValidationResult {
  let draft: VolunteerCertificationDraft;
  try {
    draft = validateDraftShape(draftInput);
    ensureDraftReferences(draft);
  } catch (error) {
    if (error instanceof FriendsError && error.code === FriendsErrorCode.InvalidInput) {
      return { valid: false, complete: false, issues: [{ code: "INVALID_STRUCTURE", message: error.message }] };
    }
    throw error;
  }
  if (mode === "structure") return { valid: true, complete: false, issues: [] };

  const issues: DraftValidationIssue[] = [];
  if (!draft.binding.organizationId) issues.push({ code: "MISSING_ORGANIZATION", message: "The activity organization must be known before submission" });
  if (draft.includedStudentNos.length === 0) {
    issues.push({ code: "EMPTY_SELECTION", message: "Select at least one registration" });
  }
  const posts = new Map(draft.activity.posts.map((post) => [post.id, post]));
  for (const studentNo of draft.includedStudentNos) {
    const registration = draft.registrations.find((item) => item.studentNo === studentNo);
    if (registration === undefined) continue;
    const path = `registrations.${studentNo}`;
    const post = registration.postId === null ? undefined : posts.get(registration.postId);
    if (post === undefined) issues.push({ code: "MISSING_POST", message: "A selected registration has no valid post", path });
    else if (post.name === null) issues.push({ code: "MISSING_POST_NAME", message: "The selected post has no name", path });
    const attestationDuration = draft.durations[studentNo];
    if (attestationDuration === undefined) {
      issues.push({ code: "MISSING_DURATION", message: "A selected registration has no duration", path });
    }
    if (registration.isApplied === null) {
      issues.push({ code: "UNKNOWN_APPLICATION_STATE", message: "Registration application state is unknown", path });
    }
    if (registration.registrationId === null && registration.isApplied !== false) {
      issues.push({ code: "UNKNOWN_REGISTRATION_SOURCE", message: "A manual addition must be identified as not registered", path });
    }
  }
  if (draft.materials.length > 0) {
    issues.push({
      code: "MATERIAL_UPLOAD_UNSUPPORTED",
      message: "The current certification page has no verified material upload field; remove local material references before submission",
    });
  }
  return { valid: issues.length === 0, complete: issues.length === 0, issues };
}

export function buildVolunteerCertificationSubmitPayload(
  draftInput: unknown,
): VolunteerCertificationSubmitPayload {
  const draft = validateDraftShape(draftInput);
  ensureDraftReferences(draft);
  const validation = validateVolunteerCertificationDraft(draft, "complete");
  if (!validation.complete) {
    throw new FriendsError({
      code: FriendsErrorCode.InvalidInput,
      message: `The certification draft is incomplete: ${validation.issues.map((issue) => issue.code).join(", ")}`,
    });
  }
  const posts = new Map(draft.activity.posts.map((post) => [post.id, post]));
  return {
    activityId: draft.activity.id,
    uuid: null,
    nameList: draft.includedStudentNos.map((studentNo) => {
      const registration = draft.registrations.find((item) => item.studentNo === studentNo)!;
      const post = posts.get(registration.postId!)!;
      const attestationDuration = draft.durations[studentNo]!;
      return {
        activityId: draft.activity.id,
        attestationDuration,
        postDuration: draft.activity.positionSetMethod === "TIME" ? attestationDuration : null,
        postId: post.id,
        postName: registration.postName ?? post.name!,
        signDuration: draft.activity.positionSetMethod === "SIGN" ? attestationDuration : null,
        studentNo,
        uuid: registration.registrationId ?? "",
        isApply: registration.registrationId === null ? 0 : registration.isApplied!,
      };
    }),
  };
}

export function checkVolunteerCertificationMaterials(
  draftInput: unknown,
  files: Record<string, MaterialFileFacts>,
): Array<{ materialId: string; status: "available" | "missing" | "hash-mismatch" | "not-regular-file" | "web-unrecoverable" }> {
  const draft = validateDraftShape(draftInput);
  ensureDraftReferences(draft);
  if (object(files) === null) invalid("Expected material file facts");
  return draft.materials.map((material) => {
    if (material.kind === "web-unrecoverable") {
      return { materialId: material.id, status: "web-unrecoverable" as const };
    }
    const fact = files[material.path];
    if (fact === undefined || fact.exists !== true) {
      return { materialId: material.id, status: "missing" as const };
    }
    if (!fact.regularFile || fact.sha256 !== material.sha256 || fact.size !== material.size) {
      return { materialId: material.id, status: fact.regularFile ? "hash-mismatch" : "not-regular-file" };
    }
    return { materialId: material.id, status: "available" };
  });
}
