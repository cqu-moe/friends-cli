import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildVolunteerCertificationSubmitPayload,
  checkVolunteerCertificationMaterials,
  createPartialVolunteerCertificationDraft,
  FriendsErrorCode,
  updateVolunteerCertificationDraft,
  validateVolunteerCertificationDraft,
} from "../dist/index.js";

const source = {
  id: "draft-1",
  binding: {
    accountUserNo: "20210001",
    levelNo: "XS",
    unitNo: "24080",
    organizationId: "org-1",
    activityId: "activity-1",
  },
  activity: {
    id: "activity-1",
    name: "迎新志愿服务",
    organizationName: "示例青年志愿者协会",
    positionSetMethod: "TIME",
    posts: [{ id: "post-1", name: "引导岗", durationHours: 2.5 }],
  },
  registrations: [
    {
      registrationId: "registration-1",
      studentNo: "20210001",
      studentName: "示例学生",
      postId: "post-1",
      postName: "引导岗",
      postDurationHours: 2.5,
      signDurationHours: null,
      isApplied: true,
      upstreamPreselected: true,
    },
  ],
};

test("partial volunteer certification drafts keep revisions and explicit selections", () => {
  const draft = createPartialVolunteerCertificationDraft(source);
  assert.equal(draft.revision, 0);
  assert.deepEqual(draft.includedStudentNos, []);
  assert.equal(validateVolunteerCertificationDraft(draft, "structure").valid, true);
  assert.equal(validateVolunteerCertificationDraft(draft, "complete").complete, false);

  const edited = updateVolunteerCertificationDraft(draft, {
    includedStudentNos: ["20210001"],
    durations: { "20210001": 2.5 },
  }, 0);
  assert.equal(edited.revision, 1);
  assert.equal(validateVolunteerCertificationDraft(edited, "complete").complete, true);

  assert.throws(
    () => updateVolunteerCertificationDraft(draft, {}, 1),
    (error) => error.code === FriendsErrorCode.UpstreamBusiness,
  );
});

test("complete validation and payload preserve the production hour contract", () => {
  const draft = updateVolunteerCertificationDraft(
    createPartialVolunteerCertificationDraft(source),
    { includedStudentNos: ["20210001"], durations: { "20210001": 2.5 } },
    0,
  );
  assert.deepEqual(buildVolunteerCertificationSubmitPayload(draft), {
    activityId: "activity-1",
    uuid: null,
    nameList: [{
      activityId: "activity-1",
      attestationDuration: 2.5,
      postDuration: 2.5,
      postId: "post-1",
      postName: "引导岗",
      signDuration: null,
      studentNo: "20210001",
      uuid: "registration-1",
      isApply: true,
    }],
  });

  const invalid = updateVolunteerCertificationDraft(draft, {
    durations: {},
  }, 1);
  const result = validateVolunteerCertificationDraft(invalid, "complete");
  assert.equal(result.complete, false);
  assert.ok(result.issues.some((issue) => issue.code === "MISSING_DURATION"));
  assert.throws(
    () => buildVolunteerCertificationSubmitPayload(invalid),
    (error) => error.code === FriendsErrorCode.InvalidInput,
  );
});

test("material checks distinguish missing, changed, and unrecoverable references", () => {
  const draft = updateVolunteerCertificationDraft(createPartialVolunteerCertificationDraft(source), {
    materials: [
      { kind: "local-file", id: "material-1", path: "/tmp/material-1", sha256: "a".repeat(64), size: 1 },
      { kind: "local-file", id: "material-missing", path: "/tmp/material-missing", sha256: "c".repeat(64), size: 1 },
      { kind: "web-unrecoverable", id: "material-2", label: "网页材料", remoteRef: null },
    ],
  }, 0);
  const statuses = checkVolunteerCertificationMaterials(draft, {
    "/tmp/material-1": { exists: true, regularFile: true, size: 1, sha256: "b".repeat(64) },
    "/tmp/material-missing": { exists: false },
  });
  assert.deepEqual(materialStatuses(statuses), [
    "material-1:hash-mismatch",
    "material-missing:missing",
    "material-2:web-unrecoverable",
  ]);
});

function materialStatuses(statuses) {
  return statuses.map((status) => `${status.materialId}:${status.status}`);
}

test("manual additions can be saved and certified without fabricating a registration UUID", () => {
  const original = createPartialVolunteerCertificationDraft({ ...source, registrations: [] });
  const draft = updateVolunteerCertificationDraft(original, {
    addRegistrations: [{ registrationId: null, studentNo: "20210002", studentName: "示例志愿者", postId: null, postName: null, postDurationHours: null, signDurationHours: null, isApplied: false, upstreamPreselected: false }],
    includedStudentNos: ["20210002"], postIds: { "20210002": "post-1" }, durations: { "20210002": 1.5 },
  }, 0);
  assert.equal(original.registrations.length, 0);
  assert.equal(draft.registrations[0].postName, "引导岗");
  assert.equal(validateVolunteerCertificationDraft(draft, "complete").complete, true);
  assert.deepEqual(buildVolunteerCertificationSubmitPayload(draft).nameList, [{
    activityId: "activity-1", attestationDuration: 1.5, postDuration: 1.5,
    postId: "post-1", postName: "引导岗", signDuration: null,
    studentNo: "20210002", uuid: "", isApply: 0,
  }]);
  assert.throws(() => updateVolunteerCertificationDraft(draft, {addRegistrations:draft.registrations}, 1), e=>e.code==="INVALID_INPUT");
});
