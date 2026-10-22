import assert from "node:assert/strict";
import { test } from "node:test";
import * as sdk from "../dist/index.js";
import { offeringInput, offeringSchool, offeringSession } from "./fixtures/volunteer-offering-api.mjs";

const intent = { via: "api", intent: "submit-volunteer-offering", confirm: true };
const uploadIntent = { via: "api", intent: "upload-volunteer-offering-materials", confirm: true };

function client(upstream) {
  return sdk.createVolunteerOfferingClient({ ...upstream, session: offeringSession });
}

test("SDK rechecks offering context and builds only source-verified first-page fields", async (t) => {
  const upstream = await offeringSchool(t);
  const prepared = await client(upstream).prepare(offeringInput());
  assert.equal(prepared.status, "prepared");
  assert.equal(prepared.context.organization.id, "org-1");
  assert.equal(prepared.context.organization.name, "虚构青协");
  assert.equal(prepared.context.organization.type, "STUDENT");
  assert.equal(prepared.context.activityType.code, "TYPE_CODE");
  assert.equal(prepared.context.activityLevel.code, "LEVEL_CODE");
  assert.equal(prepared.context.schoolYear, "2026-2027");
  assert.equal(prepared.context.termNo, "1");
  assert.deepEqual(upstream.state.requests.map((request) => request.path).slice(-4), [
    "/gateway/zovecenter-saip-ek-app-young-volunteers/mob/organization/drop-down",
    "/gateway/zovecenter-saip-ek-app-agg-mob/biz-common/system/data-code-list/mulit",
    "/gateway/zovecenter-saip-ek-app-agg-mob/biz-common/system/vschool-year-list",
    "/gateway/zovecenter-saip-ek-app-agg-mob/biz-common/system/vschool-term-list",
  ]);
  assert.equal(prepared.payload.activityName, "虚构图书馆志愿活动");
  assert.equal(prepared.payload.organizationId, "org-1");
  assert.equal(prepared.payload.organizationName, "虚构青协");
  assert.equal(prepared.payload.organizationType, "STUDENT");
  assert.equal(prepared.payload.activityType, "TYPE_CODE");
  assert.equal(prepared.payload.activityLevel, "LEVEL_CODE");
  assert.equal(prepared.payload.beginTime, "2026-11-02 09:00:00");
  assert.equal(prepared.payload.endTime, "2026-11-02 12:00:00");
  assert.equal(prepared.payload.volunteerNumber, "3");
  assert.equal(prepared.payload.totalDuration, 3);
  assert.equal(prepared.payload.beginYear, "2026");
  assert.equal(prepared.payload.endYear, "2027");
  assert.equal(prepared.payload.termNo, "1");
  assert.equal(prepared.payload.activityCategory, "SCHOOL_ACTIVITY");
  assert.match(prepared.payload.publicityPicturesGroupUuid, /^[0-9a-f]{32}$/);
  assert.equal("attachmentGroupUuid" in prepared.payload, false);
  assert.equal("applyReason" in prepared.payload, false);
  assert.equal("activityStyle" in prepared.payload, false);
});

test("SDK separates material upload, intermediate creation, final submit, and status", async (t) => {
  const upstream = await offeringSchool(t);
  const offering = client(upstream);
  const prepared = await offering.prepare(offeringInput());
  const materials = await offering.uploadMaterials(prepared, uploadIntent);
  assert.equal(materials.state, "complete");
  assert.equal(materials.publicityPictures.uploadedCount, 1);
  assert.equal(upstream.state.uploads.length, 1);
  assert.equal(upstream.state.uploads[0].groupUuid, prepared.payload.publicityPicturesGroupUuid);

  const result = await offering.submit(prepared, intent);
  assert.equal(result.submitted, true);
  assert.equal(result.serverAcknowledged, true);
  assert.equal(result.applicationId, "intermediate-uuid");
  assert.equal(result.readback.state, "matched");
  const next = upstream.state.requests.find((request) => request.path.endsWith("/next-step"));
  const apply = upstream.state.requests.find((request) => request.path.endsWith("/school-activity-apply/apply"));
  assert.equal(next.body, JSON.stringify(prepared.payload));
  assert.deepEqual(JSON.parse(apply.body), {
    ...prepared.registration,
    activityCategory: "SCHOOL_ACTIVITY",
    uuid: "intermediate-uuid",
    handleType: "EJZZ01",
    posts: [{ postName: "引导岗", recruitNumber: 2, duration: 1.5, uuid: "", activityId: "intermediate-uuid" }],
    questionnaires: [{
      activityId: "intermediate-uuid",
      title: "为何参加",
      itemType: "CHOICE",
      isMandatory: true,
      sort: 1,
      uuid: "",
      options: [{ optionName: "服务同学", sort: 1, uuid: "" }],
    }],
  });
  const status = await offering.status("intermediate-uuid");
  assert.equal(status.applicationId, "intermediate-uuid");
  assert.equal(status.raw.flowOverallState, "FUTURE_STATE");
});

test("TEMP_ACTIVITY next-step is itself the final write and never becomes an intermediate UUID", async (t) => {
  const upstream = await offeringSchool(t);
  const offering = client(upstream);
  const input = offeringInput();
  input.activityCategory = "TEMP_ACTIVITY";
  input.registration = undefined;
  input.materials = { publicityPictures: input.materials.publicityPictures };
  input.temporaryRoster = [{ studentNo: "20210002", durationHours: 1.5 }];
  const prepared = await offering.prepare(input);
  const materials = await offering.uploadMaterials(prepared, uploadIntent);
  const result = await offering.submit(prepared, intent);
  assert.equal(result.submitted, true);
  assert.equal(result.applicationId, null);
  assert.equal(result.submissionKind, "TEMP_ACTIVITY_FINAL");
  assert.equal(result.readback.state, "unavailable");
  const writes = upstream.state.requests.filter((request) => request.write);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].path.endsWith("/next-step"), true);
  assert.deepEqual(JSON.parse(writes[0].body), {
    ...prepared.payload,
    posts: [],
    nameList: [{ studentNo: "20210002", attestationDuration: 1.5, isApply: 0 }],
  });
});
