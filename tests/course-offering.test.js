import assert from "node:assert/strict";
import { test } from "node:test";
import { createFriendsSdk, FriendsErrorCode } from "../dist/index.js";
import { application, courseOfferingSchool, session } from "./fixtures/course-offering.mjs";

const stageIntent = { via: "api", intent: "stage-course-materials", confirm: true };
const nextIntent = { via: "api", intent: "save-course-first-step", confirm: true };
const finalIntent = { via: "api", intent: "submit-course-offering", confirm: true };

function files() {
  return [
    { kind: "attachment", file: new File(["controlled attachment"], "syllabus.txt", { type: "text/plain" }) },
    { kind: "publicity", file: new File(["controlled poster"], "poster.png", { type: "image/png" }) },
  ];
}

async function withMaterials(client) {
  const prepared = await client.prepare(application);
  const staged = await client.stageMaterials(prepared, files(), stageIntent);
  return { ...prepared, materials: staged.groups };
}

test("course offering SDK separates material staging, intermediate step, final submit, and status", async (t) => {
  const upstream = await courseOfferingSchool(t);
  const sdk = createFriendsSdk({ baseUrl: upstream.baseUrl, timeoutMs: 250 });
  const client = await sdk.createCourseOfferingClient(session);
  const prepared = await client.prepare(application);
  assert.equal(prepared.organization.name, "示例课程组织");
  assert.notEqual(prepared.materialGroups.attachmentGroupUuid, prepared.materialGroups.publicityPicturesGroupUuid);
  assert.match(prepared.materialGroups.attachmentGroupUuid, /^[0-9a-f]{32}$/);

  const dryRun = await client.stageMaterials(prepared, files(), { ...stageIntent, dryRun: true });
  assert.equal(dryRun.submitted, false);
  assert.equal(upstream.requests.filter((request) => request.url.includes("file-upload")).length, 0);

  const staged = await client.stageMaterials(prepared, files(), stageIntent);
  assert.equal(staged.submitted, true);
  assert.deepEqual(staged.items.map((item) => item.kind), ["attachment", "publicity"]);
  assert.equal(staged.groups.attachmentGroupUuid, prepared.materialGroups.attachmentGroupUuid);
  const uploads = upstream.requests.filter((request) => request.url.includes("file-upload"));
  assert.equal(uploads.length, 2);
  assert.ok(uploads.every((request) => String(request.contentType).includes("multipart/form-data")));
  assert.ok(uploads.every((request) => String(request.body).includes('name="groupId"')));

  const next = await client.saveFirstStep({
    ...prepared,
    materials: staged.groups,
  }, nextIntent);
  assert.equal(next.submitted, true);
  assert.equal(next.serverAcknowledged, true);
  assert.equal(next.courseId, "course-fixture");
  assert.equal(upstream.requests.some((request) => request.url.endsWith("/apply/apply")), false);

  const submitted = await client.submitFinal({
    ...prepared,
    uuid: "course-fixture",
    materials: staged.groups,
  }, finalIntent);
  assert.equal(submitted.submitted, true);
  assert.equal(submitted.serverAcknowledged, true);
  assert.equal(submitted.status.flowOverallState, 5);
  assert.equal(upstream.requests.filter((request) => request.url.endsWith("/apply/apply")).length, 1);

  const status = await client.status("course-fixture");
  assert.equal(status.name, "示例通识课程");
  assert.equal(status.state.known, false);
});

test("course offering SDK rejects unknown, unsupported, stale, and unpermitted input before writes", async (t) => {
  const upstream = await courseOfferingSchool(t);
  const client = await createFriendsSdk({ baseUrl: upstream.baseUrl, timeoutMs: 250 }).createCourseOfferingClient(session);
  for (const value of [
    { ...application, extra: true },
    { ...application, reportSet: { ...application.reportSet, questionnaires: [{ title: "问卷" }] } },
    { ...application, reportSet: { ...application.reportSet, posts: [{ postName: "岗位" }] } },
    { ...application, firstStep: { ...application.firstStep, beginTime: "2026-11-01 08:00:00" } },
    { ...application, binding: { ...application.binding, accountUserNo: "other" } },
  ]) {
    await assert.rejects(() => client.prepare(value), (error) => error.code === FriendsErrorCode.InvalidInput);
  }
  await assert.rejects(
    () => client.prepare({ ...application, binding: { ...application.binding, organizationId: "other" } }),
    (error) => error.code === FriendsErrorCode.PermissionDenied,
  );
  const manual = {
    ...application,
    firstStep: {
      ...application.firstStep,
      attestationType: "MAN",
      isOpenSign: false,
      signNumber: null,
    },
  };
  assert.equal((await client.prepare(manual)).firstStep.attestationType, "MAN");
  const prepared = await client.prepare(application);
  const requestCount = upstream.requests.length;
  for (const intent of [undefined, { ...stageIntent, via: "ego" }, { ...stageIntent, confirm: false }]) {
    await assert.rejects(() => client.stageMaterials(prepared, files(), intent), (error) =>
      error.code === FriendsErrorCode.InvalidInput
    );
  }
  assert.equal(upstream.requests.length, requestCount);
});

test("course offering SDK accepts optional source materials but refuses a declared empty group", async (t) => {
  const upstream = await courseOfferingSchool(t);
  const client = await createFriendsSdk({ baseUrl: upstream.baseUrl }).createCourseOfferingClient(session);
  const prepared = await client.prepare(application);
  const saved = await client.saveFirstStep(prepared, nextIntent);
  assert.equal(saved.finalSubmission, false);
  const writes = upstream.requests.filter(r => r.url.endsWith("/apply/next-step")).length;
  await assert.rejects(() => client.saveFirstStep({ ...prepared, materials: { attachmentGroupUuid: "empty-group", publicityPicturesGroupUuid: null } }, nextIntent), { code: "INVALID_INPUT" });
  assert.equal(upstream.requests.filter(r => r.url.endsWith("/apply/next-step")).length, writes);
  const staged = await client.stageMaterials(prepared, [files()[0]], stageIntent);
  assert.equal(staged.items.length, 1);
  assert.equal(staged.groups.publicityPicturesGroupUuid, null);
  const updated = await client.saveFirstStep({ ...prepared, uuid: saved.courseId, materials: staged.groups }, nextIntent);
  assert.equal(updated.serverAcknowledged, true);
});

test("course offering SDK preserves UNKNOWN_OUTCOME and partial upload facts when an upload response is lost", async (t) => {
  const upstream = await courseOfferingSchool(t);
  upstream.state.mode = "upload-lost";
  const client = await createFriendsSdk({ baseUrl: upstream.baseUrl, timeoutMs: 250 }).createCourseOfferingClient(session);
  const prepared = await client.prepare(application);
  await assert.rejects(
    () => client.stageMaterials(prepared, files(), stageIntent),
    (error) => {
      assert.equal(error.code, FriendsErrorCode.UnknownOutcome);
      assert.equal(error.retryable, false);
      assert.equal(error.recovery.operation, "course-offering.stage-materials");
      assert.equal(error.recovery.organizationId, "org-fixture");
      assert.deepEqual(error.recovery.materialGroups, prepared.materialGroups);
      assert.deepEqual(error.recovery.uploadedMaterials, []);
      assert.deepEqual(error.recovery.inFlightMaterial, {
        kind: "attachment",
        fileName: "syllabus.txt",
        resourceId: null,
        serverAcknowledged: "unknown",
      });
      assert.deepEqual(error.recovery.completed, ["readback:matched"]);
      return true;
    },
  );
  assert.equal(upstream.requests.filter((request) => request.url.includes("file-upload")).length, 1);
});

test("course offering SDK never retries lost intermediate or final writes even when readback matches", async (t) => {
  for (const [mode, operation] of [["next-lost", "course-offering.save-first-step"], ["update-lost", "course-offering.save-first-step"], ["final-lost", "course-offering.submit-final"]]) await t.test(mode, async (t) => {
    const upstream = await courseOfferingSchool(t);
    const client = await createFriendsSdk({ baseUrl: upstream.baseUrl, timeoutMs: 250 }).createCourseOfferingClient(session);
    const prepared = await withMaterials(client);
    upstream.state.mode = mode;
    if (mode === "next-lost" || mode === "update-lost") {
      await assert.rejects(() => client.saveFirstStep({ ...prepared, uuid: mode === "update-lost" ? "course-fixture" : null }, nextIntent), (error) => {
        assert.equal(error.code, FriendsErrorCode.UnknownOutcome);
        assert.equal(error.recovery.operation, operation);
        assert.equal(error.recovery.serverAcknowledged, "unknown");
        assert.equal(error.recovery.input.firstStep.curriculumName, "示例通识课程");
        assert.equal(error.recovery.readback, mode === "update-lost" ? "matched" : "unavailable");
        assert.deepEqual(error.recovery.materialGroups, prepared.materialGroups);
        return true;
      });
      assert.equal(upstream.requests.filter((request) => mode === "update-lost" ? request.method === "PUT" : request.url.endsWith("/apply/next-step")).length, 1);
    } else {
      await client.saveFirstStep({ ...prepared, materials: { ...prepared.materialGroups } }, nextIntent);
      await assert.rejects(() => client.submitFinal({ ...prepared, uuid: "course-fixture", materials: { ...prepared.materialGroups } }, finalIntent), (error) => {
        assert.equal(error.code, FriendsErrorCode.UnknownOutcome);
        assert.equal(error.recovery.courseId, "course-fixture");
        assert.equal(error.recovery.readback, "matched");
        assert.deepEqual(error.recovery.materialGroups, prepared.materialGroups);
        return true;
      });
      assert.equal(upstream.requests.filter((request) => request.url.endsWith("/apply/apply")).length, 1);
    }
  });
});

test("course offering SDK retains completed uploads after a later response is lost", async (t) => {
  const upstream = await courseOfferingSchool(t);
  upstream.state.mode = "upload-lost-second";
  const client = await createFriendsSdk({ baseUrl: upstream.baseUrl, timeoutMs: 250 }).createCourseOfferingClient(session);
  const prepared = await client.prepare(application);
  await assert.rejects(
    () => client.stageMaterials(prepared, files(), stageIntent),
    (error) => {
      assert.equal(error.code, FriendsErrorCode.UnknownOutcome);
      assert.equal(error.recovery.uploadedMaterials.length, 1);
      assert.equal(error.recovery.uploadedMaterials[0].kind, "attachment");
      assert.equal(error.recovery.inFlightMaterial.kind, "publicity");
      assert.equal(error.recovery.readback, "matched");
      return true;
    },
  );
  assert.equal(upstream.requests.filter((request) => request.url.includes("file-upload")).length, 2);
});

test("course offering SDK reports a definitive final business conflict once", async (t) => {
  const upstream = await courseOfferingSchool(t);
  const client = await createFriendsSdk({ baseUrl: upstream.baseUrl, timeoutMs: 250 }).createCourseOfferingClient(session);
  const prepared = await withMaterials(client);
  upstream.state.mode = "business-final";
  await assert.rejects(
    () => client.submitFinal({ ...prepared, uuid: "course-fixture", materials: { ...prepared.materialGroups } }, finalIntent),
    (error) => {
      assert.equal(error.code === FriendsErrorCode.UpstreamBusiness, true);
      assert.equal(error.upstreamCode, "10002");
      return true;
    },
  );
  assert.equal(upstream.requests.filter((request) => request.url.endsWith("/apply/apply")).length, 1);
});


test("course offering SDK rechecks the bound account and organization before uploads", async (t) => {
  const upstream = await courseOfferingSchool(t);
  const client = await createFriendsSdk({ baseUrl: upstream.baseUrl }).createCourseOfferingClient(session);
  const prepared = await client.prepare(application);
  const tampered = structuredClone(prepared);
  tampered.binding.accountUserNo = "other-account";
  await assert.rejects(() => client.stageMaterials(tampered, files(), stageIntent), { code: "INVALID_INPUT" });
  upstream.state.mode = "organization-denied";
  await assert.rejects(() => client.stageMaterials(prepared, files(), stageIntent), { code: "PERMISSION_DENIED" });
  assert.equal(upstream.requests.filter(r => r.url.includes("file-upload")).length, 0);
});


test("course offering SDK refuses non-editable or wrong-organization applications before updating", async (t) => {
  const upstream = await courseOfferingSchool(t);
  const client = await createFriendsSdk({ baseUrl: upstream.baseUrl }).createCourseOfferingClient(session);
  const prepared = await client.prepare(application);
  const staged = await client.stageMaterials(prepared, files(), stageIntent);
  const existing = { ...prepared, uuid: "course-fixture", materials: staged.groups };
  for (const state of [5, 7, "FUTURE_STATE"]) {
    upstream.state.flowOverallState = state;
    await assert.rejects(() => client.saveFirstStep(existing, nextIntent), { code: "BUSINESS_REJECTED" });
    await assert.rejects(() => client.submitFinal(existing, finalIntent), { code: "BUSINESS_REJECTED" });
  }
  upstream.state.flowOverallState = 1;
  upstream.state.mode = "wrong-organization";
  await assert.rejects(() => client.saveFirstStep(existing, nextIntent), { code: "BUSINESS_REJECTED" });
  assert.equal(upstream.requests.filter(r => r.method === "PUT" || r.url.endsWith("/apply/apply")).length, 0);
});


test("course offering SDK keeps ambiguous final acknowledgements unknown and preserves acknowledged writes when readback fails", async (t) => {
  for (const mode of ["final-ambiguous", "readback-forbidden"]) await t.test(mode, async t => {
    const upstream = await courseOfferingSchool(t);
    const client = await createFriendsSdk({ baseUrl: upstream.baseUrl }).createCourseOfferingClient(session);
    const prepared = await withMaterials(client);
    upstream.state.mode = mode;
    await assert.rejects(() => client.submitFinal({ ...prepared, uuid: "course-fixture" }, finalIntent), error => {
      assert.equal(error.code, "UNKNOWN_OUTCOME");
      assert.equal(error.recovery.serverAcknowledged, mode === "readback-forbidden" ? true : "unknown");
      return true;
    });
    assert.equal(upstream.requests.filter(r => r.url.endsWith("/apply/apply")).length, 1);
  });
});

test("course offering SDK preserves completed uploads on a definitive permission denial", async (t) => {
  const upstream = await courseOfferingSchool(t);
  const client = await createFriendsSdk({ baseUrl: upstream.baseUrl }).createCourseOfferingClient(session);
  const prepared = await client.prepare(application);
  upstream.state.mode = "upload-forbidden-second";
  await assert.rejects(() => client.stageMaterials(prepared, files(), stageIntent), error => {
    assert.equal(error.code, "PERMISSION_DENIED");
    assert.equal(error.recovery.uploadedMaterials.length, 1);
    assert.equal(error.recovery.uploadedMaterials[0].fileName, "syllabus.txt");
    assert.equal(error.recovery.serverAcknowledged, false);
    return true;
  });
  assert.equal(upstream.requests.filter(r => r.url.includes("file-upload")).length, 2);
});


test("course offering SDK rejects malformed dates, unsupported audiences, and ambiguous current terms before writes", async (t) => {
  const upstream = await courseOfferingSchool(t);
  const client = await createFriendsSdk({ baseUrl: upstream.baseUrl }).createCourseOfferingClient(session);
  for (const bad of [
    { ...application, firstStep: { ...application.firstStep, beginTime: "2026-02-30 08:00:00" } },
    { ...application, reportSet: { ...application.reportSet, limitGrade: ["not-a-school-grade"] } },
    { ...application, firstStep: { ...application.firstStep, curriculumType: "unknown" } },
  ]) await assert.rejects(() => client.prepare(bad), { code: "INVALID_INPUT" });
  upstream.state.terms.push({ termNo: "3", isCurrentTerm: "1" });
  await assert.rejects(() => client.prepare(application), { code: "NETWORK_PROTOCOL_ERROR" });
  assert.equal(upstream.requests.some(r => r.url.includes("file-upload") || r.url.endsWith("/apply/next-step")), false);
});


test("course offering SDK stops writes when the school identity context changes after preparation", async (t) => {
  const upstream = await courseOfferingSchool(t);
  const client = await createFriendsSdk({ baseUrl: upstream.baseUrl }).createCourseOfferingClient(session);
  const prepared = await client.prepare(application);
  upstream.state.mode = "other-context";
  await assert.rejects(() => client.stageMaterials(prepared, files(), stageIntent), { code: "AUTH_REQUIRED" });
  assert.equal(upstream.requests.some(r => r.url.includes("file-upload")), false);
});


test("course offering SDK validates files and refuses every Ego write intent without a business side effect", async (t) => {
  const upstream = await courseOfferingSchool(t);
  const client = await createFriendsSdk({ baseUrl: upstream.baseUrl }).createCourseOfferingClient(session);
  const prepared = await client.prepare(application);
  for (const batch of [
    [],
    [{ kind: "attachment", file: new File(["binary"], "bad.exe", { type: "application/octet-stream" }) }],
    [{ kind: "publicity", file: new File(["pdf"], "bad.pdf", { type: "application/pdf" }) }],
    [{ kind: "attachment", file: new File([], "empty.txt", { type: "text/plain" }) }],
    Array.from({ length: 6 }, () => files()[1]),
  ]) await assert.rejects(() => client.stageMaterials(prepared, batch, stageIntent), { code: "INVALID_INPUT" });
  await assert.rejects(() => client.stageMaterials(prepared, files(), { ...stageIntent, via: "ego" }), { code: "INVALID_INPUT" });
  await assert.rejects(() => client.saveFirstStep(prepared, { ...nextIntent, via: "ego" }), { code: "INVALID_INPUT" });
  await assert.rejects(() => client.submitFinal({ ...prepared, uuid: "course-fixture" }, { ...finalIntent, via: "ego" }), { code: "INVALID_INPUT" });
  assert.equal(upstream.requests.some(r => r.url.includes("file-upload") || r.url.endsWith("/apply/next-step") || r.url.endsWith("/apply/apply")), false);
  const dry = await client.saveFirstStep(prepared, { ...nextIntent, dryRun: true });
  assert.equal(dry.courseId, null);
  assert.equal(dry.submitted, false);
});
