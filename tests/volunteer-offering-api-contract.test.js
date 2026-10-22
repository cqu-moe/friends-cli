import assert from "node:assert/strict";
import { test } from "node:test";
import * as sdk from "../dist/index.js";
import { offeringInput, offeringSchool, offeringSession } from "./fixtures/volunteer-offering-api.mjs";

const uploadIntent = { via: "api", intent: "upload-volunteer-offering-materials", confirm: true };
const submitIntent = { via: "api", intent: "submit-volunteer-offering", confirm: true };

function client(upstream) {
  return sdk.createVolunteerOfferingClient({ ...upstream, session: offeringSession });
}

function remoteWriteRequests(upstream) {
  return upstream.state.requests.filter((request) =>
    request.path.includes("/protected-file-upload") ||
    request.path.includes("/school-activity-apply/next-step") ||
    request.path.includes("/school-activity-apply/apply")
  );
}

test("SDK rejects invalid offering dates, rosters, organizations, and material shapes before remote writes", async (t) => {
  const upstream = await offeringSchool(t);
  const offering = client(upstream);
  const cases = [
    ["invalid end date", (input) => { input.activity.endTime = "2026-02-30 10:00:00"; }],
    ["invalid phone", (input) => { input.activity.phone = "23800138000"; }],
    ["missing publicity", (input) => { input.materials.publicityPictures = []; }],
    ["wrong organization", (input) => { input.organizationId = "not-in-account"; }],
    ["TIME post without duration", (input) => { delete input.registration.posts[0].duration; }],
    ["post total over volunteers", (input) => { input.registration.posts[0].recruitNumber = 4; }],
    ["AUTO finish without capacity", (input) => { delete input.registration.applyNumber; }],
    ["choice question without option", (input) => { input.registration.questionnaires[0].options = []; }],
    ["unknown top field", (input) => { input.activityStyle = "legacy"; }],
    ["attachment extension", (input) => {
      input.materials.attachments = [new File(["x"], "program.exe", { type: "application/octet-stream" })];
    }],
    ["attachment size", (input) => {
      input.materials.attachments = [new File([new Uint8Array(21 * 1024 * 1024)], "too-large.pdf", { type: "application/pdf" })];
    }],
  ];
  for (const [name, change] of cases) {
    const input = offeringInput();
    change(input);
    await assert.rejects(() => offering.prepare(input), (error) => error.code === "INVALID_INPUT", name);
  }
  assert.deepEqual(remoteWriteRequests(upstream), []);
});

test("SDK rejects missing confirmation and Ego submit intent before any offering request", async (t) => {
  const upstream = await offeringSchool(t);
  const offering = client(upstream);
  const prepared = await offering.prepare(offeringInput());
  const requestCount = upstream.state.requests.length;
  await assert.rejects(() => offering.uploadMaterials(prepared, { ...uploadIntent, confirm: false }), /requires explicit confirmation/);
  await assert.rejects(() => offering.uploadMaterials(prepared, { via: "ego", intent: "upload-volunteer-offering-materials", confirm: true }), /--via api/);
  await assert.rejects(() => offering.submit(prepared, { ...submitIntent, confirm: false }), /requires explicit confirmation/);
  await assert.rejects(() => offering.submit(prepared, { via: "ego", intent: "submit-volunteer-offering", confirm: true, yes: true }), /--via api/);
  assert.equal(upstream.state.requests.length, requestCount);
});

test("SDK dry-run rechecks context and materials without uploads or final writes", async (t) => {
  const upstream = await offeringSchool(t);
  const offering = client(upstream);
  const prepared = await offering.prepare(offeringInput());
  const materials = await offering.uploadMaterials(prepared, { ...uploadIntent, dryRun: true, confirm: undefined });
  const result = await offering.submit(prepared, { ...submitIntent, dryRun: true, confirm: undefined });
  assert.equal(materials.uploaded, false);
  assert.equal(result.submitted, false);
  assert.equal(result.serverAcknowledged, false);
  assert.deepEqual(remoteWriteRequests(upstream), []);
});

test("SDK verifies a lost upload response by readback instead of claiming acknowledged success", async (t) => {
  const upstream = await offeringSchool(t);
  upstream.state.lostUploadNames = ["banner.png"];
  const offering = client(upstream);
  const input = offeringInput();
  const prepared = await offering.prepare(input);
  await assert.rejects(()=>offering.uploadMaterials(prepared, uploadIntent),error=>{
    assert.equal(error.code,"UNKNOWN_OUTCOME");
    assert.equal(error.recovery.readback,"matched");
    assert.ok(error.recovery.completed.some(item=>item.startsWith("publicity:")));
    return true;
  });
  assert.equal(upstream.state.uploads.length, 1);
});

test("SDK reports completed files after partial upload failure and does not retry or clean up", async (t) => {
  const upstream = await offeringSchool(t);
  upstream.state.uploadRejectNames = ["second.png"];
  const offering = client(upstream);
  const input = offeringInput();
  input.materials.publicityPictures = [
    input.materials.publicityPictures[0],
    new File([new Uint8Array([4])], "second.png", { type: "image/png" }),
  ];
  const prepared = await offering.prepare(input);
  const materials = await offering.uploadMaterials(prepared, uploadIntent);
  assert.equal(materials.state, "partial");
  assert.equal(materials.uploaded, false);
  assert.equal(materials.publicityPictures.uploadedCount, 1);
  assert.equal(materials.publicityPictures.resourceUuids.length, 1);
  assert.equal(materials.failed.length, 1);
  assert.equal(materials.failed[0].name, "second.png");
  assert.equal(materials.failed[0].code, "BUSINESS_REJECTED");
  assert.equal(upstream.state.uploads.filter((upload) => upload.fileName === "second.png").length, 1);
  assert.equal(upstream.state.groups.get(prepared.materials.publicityGroupUuid).length, 1);
});

test("SDK preserves UNKNOWN_OUTCOME and makes no second request after lost next-step response", async (t) => {
  const upstream = await offeringSchool(t);
  upstream.state.mode = "lost-next";
  const offering = client(upstream);
  const prepared = await offering.prepare(offeringInput());
  await offering.uploadMaterials(prepared, uploadIntent);
  await assert.rejects(() => offering.submit(prepared, submitIntent), (error) => {
    assert.equal(error.code, "UNKNOWN_OUTCOME");
    assert.match(error.message, /may have created/);
    return true;
  });
  assert.equal(upstream.state.requests.filter((request) => request.path.endsWith("/next-step")).length, 1);
  assert.equal(upstream.state.requests.some((request) => request.path.endsWith("/school-activity-apply/apply")), false);
});

test("SDK readbacks final payload after a lost response but still reports UNKNOWN_OUTCOME", async (t) => {
  const upstream = await offeringSchool(t);
  upstream.state.mode = "lost-final";
  const offering = client(upstream);
  const prepared = await offering.prepare(offeringInput());
  await offering.uploadMaterials(prepared, uploadIntent);
  let observed;
  await assert.rejects(() => offering.submit(prepared, submitIntent), (error) => {
    observed = error;
    return error instanceof Error;
  });
  assert.equal(observed.code, "UNKNOWN_OUTCOME");
  assert.equal(observed.recovery.applicationId, "intermediate-uuid");
  assert.equal(observed.recovery.readback, "matched");
  assert.equal(upstream.state.requests.filter((request) => request.path.endsWith("/school-activity-apply/apply")).length, 1);
});

test("SDK propagates permission and business rejections without retrying final submission", async (t) => {
  for (const mode of ["permission", "business"]) {
    const upstream = await offeringSchool(t);
    upstream.state.mode = mode;
    const offering = client(upstream);
    const prepared = await offering.prepare(offeringInput());
    await offering.uploadMaterials(prepared, uploadIntent);
    await assert.rejects(() => offering.submit(prepared, submitIntent), (error) =>
      mode === "permission" ? error.code === "PERMISSION_DENIED" : error.code === "BUSINESS_REJECTED"
    );
    assert.equal(upstream.state.requests.filter((request) => request.path.endsWith("/school-activity-apply/apply")).length, 1);
  }
});

test("SDK reports lost TEMP_ACTIVITY final response as UNKNOWN_OUTCOME", async (t) => {
  const upstream = await offeringSchool(t);
  upstream.state.mode = "lost-temp";
  const offering = client(upstream);
  const input = offeringInput();
  input.activityCategory = "TEMP_ACTIVITY";
  input.registration = undefined;
  input.temporaryRoster = [{ studentNo: "20210002", durationHours: 1.5 }];
  const prepared = await offering.prepare(input);
  await offering.uploadMaterials(prepared, uploadIntent);
  await assert.rejects(() => offering.submit(prepared, submitIntent), (error) => error.code === "UNKNOWN_OUTCOME");
  assert.equal(upstream.state.requests.filter((request) => request.path.endsWith("/next-step")).length, 1);
});

test("SDK status preserves unknown school flow fields verbatim", async (t) => {
  const upstream = await offeringSchool(t);
  const offering = client(upstream);
  const prepared = await offering.prepare(offeringInput());
  await offering.uploadMaterials(prepared, uploadIntent);
  await offering.submit(prepared, submitIntent);
  const status = await offering.status("intermediate-uuid");
  assert.equal(status.state, "present");
  assert.equal(status.raw.flowOverallState, "FUTURE_STATE");
  assert.equal(status.raw.flowCurrNode, undefined);
});


test("SDK revalidates offering materials and permission immediately before upload",async t=>{
 const upstream=await offeringSchool(t);const offering=client(upstream);const prepared=await offering.prepare(offeringInput());
 prepared.materials.publicityPictures=[{name:"danger.exe",file:new Blob(["x"]),size:1,type:"application/octet-stream"}];
 await assert.rejects(()=>offering.uploadMaterials(prepared,uploadIntent),e=>e.code==="INVALID_INPUT");
 assert.equal(upstream.state.uploads.length,0);
});
