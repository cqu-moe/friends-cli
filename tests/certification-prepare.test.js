import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createPartialVolunteerCertificationDraft,
  FriendsErrorCode,
  rejectVolunteerCertificationEgoSubmit,
  updateVolunteerCertificationDraft,
  buildVolunteerCertificationPreparation,
} from "../dist/index.js";

function completeDraft() {
  return updateVolunteerCertificationDraft(createPartialVolunteerCertificationDraft({
    id: "draft-1",
    binding: {
      accountUserNo: "20210001", levelNo: "XS", unitNo: "24080",
      organizationId: "org-1", activityId: "activity-1",
    },
    activity: {
      id: "activity-1", name: "迎新志愿服务", organizationName: "示例青年志愿者协会",
      positionSetMethod: "SIGN",
      posts: [{ id: "post-1", name: "引导岗", durationHours: 2.5 }],
    },
    registrations: [{
      registrationId: "registration-1", studentNo: "20210001", studentName: "示例学生",
      postId: "post-1", postName: "引导岗", postDurationHours: 2.5,
      signDurationHours: 2, isApplied: true, upstreamPreselected: true,
    }],
  }), {
    includedStudentNos: ["20210001"],
    durations: { "20210001": 2 },
  }, 0);
}

function source() {
  return {
    binding: {
      accountUserNo: "20210001", levelNo: "XS", unitNo: "24080",
      organizationId: "org-1", activityId: "activity-1",
    },
    activity: {
      id: "activity-1", name: "迎新志愿服务", organizationName: "示例青年志愿者协会",
      positionSetMethod: "SIGN", posts: [{ id: "post-1", name: "引导岗", durationHours: 2.5 }],
    },
    registrations: [{
      registrationId: "registration-1", studentNo: "20210001", studentName: "示例学生",
      postId: "post-1", postName: "引导岗", postDurationHours: 2.5,
      signDurationHours: 2, isApplied: true, upstreamPreselected: true,
    }],
  };
}

test("preparation selects matching people and adds missing manual people through visible actions", () => {
  const preparation = buildVolunteerCertificationPreparation(completeDraft(), source(), {
    activity: { id: "activity-1", name: "迎新志愿服务", organizationName: "示例青年志愿者协会", positionSetMethod: "SIGN" },
    rows: [
      { studentNo: "20210001", studentName: "示例学生", selected: false, durationHours: 2, postId: "post-1" },
    ],
    selectedStudentNos: [],
  });

  assert.equal(preparation.status, "ready");
  assert.deepEqual(preparation.actions, [
    { kind: "select-person", studentNo: "20210001", studentName: "示例学生" },
  ]);
  assert.deepEqual(preparation.preservedHumanChanges, []);
  assert.deepEqual(preparation.unresolved, []);
});

test("preparation preserves human selections and values instead of overwriting them", () => {
  const draft = updateVolunteerCertificationDraft(completeDraft(), {
    addRegistrations: [{
      registrationId: null, studentNo: "20210002", studentName: "示例志愿者", postId: "post-1",
      postName: "引导岗", postDurationHours: null, signDurationHours: null,
      isApplied: false, upstreamPreselected: false,
    }],
    includedStudentNos: ["20210001", "20210002"],
    postIds: { "20210002": "post-1" },
    durations: { "20210001": 2, "20210002": 1.5 },
  }, 1);
  const preparation = buildVolunteerCertificationPreparation(draft, source(), {
    activity: { id: "activity-1", name: "迎新志愿服务", organizationName: "示例青年志愿者协会", positionSetMethod: "SIGN" },
    rows: [
      { studentNo: "20210001", studentName: "示例学生", selected: true, durationHours: 3, postId: "post-1" },
      { studentNo: "20219999", studentName: "人工新增者", selected: true, durationHours: 4.5, postId: "post-1" },
    ],
    selectedStudentNos: ["20210001", "20219999"],
  });

  assert.equal(preparation.status, "awaiting-user");
  assert.equal(preparation.canPopulateWithoutOverwrite, false);
  assert.deepEqual(preparation.actions, []);
  assert.deepEqual(preparation.preservedHumanChanges.map((change) => [change.kind, change.studentNo]), [
    ["human-duration", "20210001"],
    ["human-selection", "20219999"],
  ]);
  assert.deepEqual(preparation.unresolved, [
    { studentNo: "20210002", reason: "missing-person" },
  ]);
});

test("preparation verifies account, organization, and activity before page actions", () => {
  const changed = source();
  changed.binding.organizationId = "org-other";
  assert.throws(
    () => buildVolunteerCertificationPreparation(completeDraft(), changed, {
      activity: { id: "activity-1", name: "迎新志愿服务", organizationName: "示例青年志愿者协会", positionSetMethod: "SIGN" },
      rows: [], selectedStudentNos: [],
    }),
    (error) => error.code === FriendsErrorCode.PermissionDenied,
  );
});

test("Ego certification submit is rejected before any side effect", () => {
  for (const input of [
    { via: "ego" },
    { via: "ego", confirmed: true },
    { via: "ego", yes: true },
    { via: "ego", retry: true, apiFallback: true },
  ]) {
    assert.throws(
      () => rejectVolunteerCertificationEgoSubmit(input),
      (error) => error.code === FriendsErrorCode.InvalidInput &&
        error.message.includes("prepare") &&
        error.message.includes("human"),
    );
  }
});
test('preparation changes unchanged school defaults but preserves newer human edits',()=>{
 const draft=updateVolunteerCertificationDraft(completeDraft(),{durations:{'20210001':1.5}},1);
 const page={activity:draft.activity,rows:[{studentNo:'20210001',studentName:'示例学生',selected:false,durationHours:2,postId:'post-1'}],selectedStudentNos:[]};
 const prepared=buildVolunteerCertificationPreparation(draft,source(),page);
 assert.equal(prepared.canPopulateWithoutOverwrite,true);
 assert.equal(prepared.actions[0].kind,'set-person');assert.equal(prepared.actions[0].durationHours,1.5);
 const unknownPost=buildVolunteerCertificationPreparation(completeDraft(),source(),{...page,rows:[{...page.rows[0],postId:null}]});
 assert.equal(unknownPost.actions[0].kind,'set-person');
});
