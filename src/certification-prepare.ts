import {
  parseVolunteerCertificationDraft,
  validateVolunteerCertificationDraft,
  type VolunteerCertificationDraft,
} from "./drafts.js";
import type { VolunteerCertificationSource } from "./draft-source.js";
import { FriendsError, FriendsErrorCode } from "./errors.js";

export interface CertificationPageRow {
  studentNo: string | null;
  studentName: string | null;
  selected: boolean;
  durationHours: number | null;
  postId: string | null;
}

export interface CertificationPageSnapshot {
  activity: {
    id: string;
    name: string | null;
    organizationName: string | null;
    positionSetMethod: "TIME" | "SIGN";
  };
  rows: CertificationPageRow[];
  selectedStudentNos: string[];
}

export type VolunteerCertificationPreparationAction =
  | { kind: "select-person"; studentNo: string; studentName: string | null }
  | {
      kind: "set-person";
      studentNo: string;
      studentName: string | null;
      postId: string;
      postName: string;
      durationHours: number;
    }
  | {
      kind: "add-person";
      studentNo: string;
      studentName: string | null;
      postId: string;
      postName: string;
      durationHours: number;
    };

export interface PreservedHumanCertificationChange {
  kind: "human-duration" | "human-selection";
  studentNo: string;
  studentName: string | null;
  currentValue: number | string;
}

export interface UnresolvedCertificationItem {
  studentNo: string;
  reason: "missing-person" | "unknown-page-row";
}

export interface VolunteerCertificationPreparation {
  status: "ready" | "awaiting-user";
  canPopulateWithoutOverwrite: boolean;
  submitted: false;
  actions: VolunteerCertificationPreparationAction[];
  preservedHumanChanges: PreservedHumanCertificationChange[];
  unresolved: UnresolvedCertificationItem[];
}

export interface VerifiedPreparationSession {
  account: { userNo: string };
  context: { levelNo: string; unit: { unitNo: string } };
}

function invalid(message: string): never {
  throw new FriendsError({ code: FriendsErrorCode.InvalidInput, message });
}

function verifiedSource(source: VolunteerCertificationSource): VolunteerCertificationSource {
  if (!source || typeof source !== "object") invalid("Expected a volunteer certification source");
  if (
    typeof source.binding?.accountUserNo !== "string" ||
    typeof source.binding.levelNo !== "string" ||
    typeof source.binding.unitNo !== "string" ||
    typeof source.binding.activityId !== "string"
  ) {
    invalid("The volunteer certification source binding is incomplete");
  }
  if (
    source.binding.accountUserNo === "" || source.binding.levelNo === "" ||
    source.binding.unitNo === "" || source.binding.activityId === ""
  ) {
    invalid("The volunteer certification source binding is incomplete");
  }
  return source;
}

function verifyPreparationContext(
  draft: VolunteerCertificationDraft,
  sourceInput: VolunteerCertificationSource,
  session?: VerifiedPreparationSession,
): void {
  const source = verifiedSource(sourceInput);
  for (const key of ["accountUserNo", "levelNo", "unitNo", "activityId"] as const) {
    if (source.binding[key] !== draft.binding[key]) {
      throw new FriendsError({
        code: FriendsErrorCode.PermissionDenied,
        message: `The certification draft ${key} does not match the verified volunteer context`,
      });
    }
  }
  if (source.binding.organizationId !== draft.binding.organizationId) {
    throw new FriendsError({
      code: FriendsErrorCode.PermissionDenied,
      message: "The certification draft organization does not match the manageable activity",
    });
  }
  if (source.activity.id !== draft.activity.id || source.activity.positionSetMethod !== draft.activity.positionSetMethod) {
    throw new FriendsError({
      code: FriendsErrorCode.PermissionDenied,
      message: "The manageable activity no longer matches the certification draft",
    });
  }
  if (session !== undefined) {
    if (
      session.account.userNo !== draft.binding.accountUserNo ||
      session.context.levelNo !== draft.binding.levelNo ||
      session.context.unit.unitNo !== draft.binding.unitNo
    ) {
      throw new FriendsError({
        code: FriendsErrorCode.PermissionDenied,
        message: "The Ego account or context does not match the certification draft",
      });
    }
  }
}

function pageSnapshot(snapshot: CertificationPageSnapshot): CertificationPageSnapshot {
  if (!snapshot || typeof snapshot !== "object" || !Array.isArray(snapshot.rows)) {
    invalid("Expected a visible certification page snapshot");
  }
  if (snapshot.activity?.positionSetMethod !== "TIME" && snapshot.activity?.positionSetMethod !== "SIGN") {
    invalid("The visible certification method is unknown");
  }
  if (typeof snapshot.activity.id !== "string" || snapshot.activity.id === "") {
    invalid("The visible certification activity ID is unknown");
  }
  if (!Array.isArray(snapshot.selectedStudentNos)) invalid("Expected visible certification selections");
  return snapshot;
}

function durationValue(value: number | null): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function buildVolunteerCertificationPreparation(
  draftInput: unknown,
  sourceInput: VolunteerCertificationSource,
  pageSnapshotInput: CertificationPageSnapshot,
  session?: VerifiedPreparationSession,
): VolunteerCertificationPreparation {
  const draft = parseVolunteerCertificationDraft(draftInput);
  const validation = validateVolunteerCertificationDraft(draft, "complete");
  if (!validation.complete) {
    invalid(`The certification draft is incomplete: ${validation.issues.map((issue) => issue.code).join(", ")}`);
  }
  verifyPreparationContext(draft, sourceInput, session);
  const page = pageSnapshot(pageSnapshotInput);
  if (
    page.activity.id !== draft.activity.id ||
    page.activity.positionSetMethod !== draft.activity.positionSetMethod ||
    (page.activity.name !== null && draft.activity.name !== null && page.activity.name !== draft.activity.name) ||
    (page.activity.organizationName !== null && draft.activity.organizationName !== null &&
      page.activity.organizationName !== draft.activity.organizationName)
  ) {
    throw new FriendsError({
      code: FriendsErrorCode.PermissionDenied,
      message: "The visible certification page belongs to a different activity or organization",
    });
  }

  const rowsByStudentNo = new Map<string, CertificationPageRow>();
  for (const row of page.rows) {
    if (row.studentNo === null) continue;
    if (rowsByStudentNo.has(row.studentNo)) invalid(`The visible page has duplicate student number: ${row.studentNo}`);
    rowsByStudentNo.set(row.studentNo, row);
  }
  const selected = new Set(page.selectedStudentNos);
  for (const studentNo of selected) {
    if (!rowsByStudentNo.has(studentNo)) invalid(`The visible selected student is not in the page roster: ${studentNo}`);
  }

  const actions: VolunteerCertificationPreparationAction[] = [];
  const preservedHumanChanges: PreservedHumanCertificationChange[] = [];
  const unresolved: UnresolvedCertificationItem[] = [];
  const missingPeople: string[] = [];
  let canPopulate = true;

  for (const studentNo of draft.includedStudentNos) {
    const registration = draft.registrations.find((item) => item.studentNo === studentNo)!;
    const desiredDuration = draft.durations[studentNo]!;
    const row = rowsByStudentNo.get(studentNo);
    if (row === undefined) {
      missingPeople.push(studentNo);
      actions.push({
        kind: "add-person",
        studentNo,
        studentName: registration.studentName,
        postId: registration.postId!,
        postName: registration.postName ?? draft.activity.posts.find((post) => post.id === registration.postId)!.name!,
        durationHours: desiredDuration,
      });
      continue;
    }

    const currentDuration = durationValue(row.durationHours);
    const baseline=sourceInput.registrations.find(item=>item.studentNo===studentNo);
    const baselineDuration=draft.activity.positionSetMethod==="TIME"?baseline?.postDurationHours:baseline?.signDurationHours;
    if (currentDuration !== null && currentDuration !== desiredDuration && currentDuration !== baselineDuration) {
      preservedHumanChanges.push({
        kind: "human-duration",
        studentNo,
        studentName: row.studentName,
        currentValue: currentDuration,
      });
      canPopulate = false;
      continue;
    }

    if (currentDuration !== desiredDuration || row.postId !== registration.postId) {
      actions.push({
        kind: "set-person",
        studentNo,
        studentName: row.studentName,
        postId: registration.postId!,
        postName: registration.postName ?? draft.activity.posts.find((post) => post.id === registration.postId)!.name!,
        durationHours: desiredDuration,
      });
    }
    if (!row.selected) {
      actions.push({ kind: "select-person", studentNo, studentName: row.studentName });
    }
  }

  for (const row of page.rows) {
    if (row.studentNo === null) unresolved.push({ studentNo: "", reason: "unknown-page-row" });
  }
  if (!canPopulate) {
    unresolved.push(...missingPeople.map((studentNo) => ({ studentNo, reason: "missing-person" as const })));
  }
  for (const studentNo of selected) {
    if (!draft.includedStudentNos.includes(studentNo)) {
      const row = rowsByStudentNo.get(studentNo);
      preservedHumanChanges.push({
        kind: "human-selection",
        studentNo,
        studentName: row?.studentName ?? null,
        currentValue: studentNo,
      });
      canPopulate = false;
    }
  }
  if (unresolved.length > 0) canPopulate = false;

  return {
    status: canPopulate ? "ready" : "awaiting-user",
    canPopulateWithoutOverwrite: canPopulate,
    submitted: false,
    actions: canPopulate ? actions : [],
    preservedHumanChanges,
    unresolved,
  };
}

export function rejectVolunteerCertificationEgoSubmit(input: {
  via?: string;
  confirmed?: boolean;
  yes?: boolean;
  retry?: boolean;
  apiFallback?: boolean;
} = { via: "ego" }): never {
  if (String(input.via ?? "ego").toLowerCase() !== "ego") {
    invalid("Volunteer certification submission through Ego requires --via ego");
  }
  throw new FriendsError({
    code: FriendsErrorCode.InvalidInput,
    message:
      "Ego certification submit is rejected before any side effect; use prepare, review the visible page, and let the human click the final submit button",
  });
}
