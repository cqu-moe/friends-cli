import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  application,
  courseOfferingSchool,
  installCourseOfferingEgoFixture,
  session,
} from "./fixtures/course-offering.mjs";
import { prepareCourseOfferingInEgo } from "../dist/node.js";

async function setup(t, { token = "course-fixture-token", courseId = null, ...pageOptions } = {}) {
  const upstream = await courseOfferingSchool(t);
  const home = await mkdtemp(join(tmpdir(), "friends-course-ego-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const url = `${upstream.baseUrl.replace("/gateway", "")}/mobile/course/courseInfo?type=${courseId === null ? "add" : `Apply&uuid=${courseId}`}`;
  const { config, result, command } = await installCourseOfferingEgoFixture(home, token, url, pageOptions);
  const previousConfig = process.env.FRIENDS_EGO_FIXTURE_CONFIG;
  process.env.FRIENDS_EGO_FIXTURE_CONFIG = config;
  t.after(() => {
    if (previousConfig === undefined) delete process.env.FRIENDS_EGO_FIXTURE_CONFIG;
    else process.env.FRIENDS_EGO_FIXTURE_CONFIG = previousConfig;
  });
  return {
    upstream,
    options: {
      application: { ...application, uuid: courseId },
      session,
      taskSpaceId: 7,
      page: "p2",
      baseUrl: upstream.baseUrl,
      command,
      timeoutMs: 5_000,
    },
    async observed() {
      return JSON.parse(await readFile(result, "utf8"));
    },
  };
}

test("course offering Ego preparation executes visible fills, hands off, and makes zero writes", async (t) => {
  const fixture = await setup(t);
  const result = await prepareCourseOfferingInEgo(fixture.options);
  assert.equal(result.status, "awaiting-user");
  assert.equal(result.submitted, false);
  assert.equal(result.handoff, "completed");
  const observed = await fixture.observed();
  assert.equal(observed.remoteWrites, 0);
  assert.equal(observed.handoffs, 1);
  assert.equal(observed.navigations, 0);
  assert.equal(observed.model.curriculumName, "示例通识课程");
  assert.equal(observed.model.curriculumContent, "受控课程介绍");
  assert.equal(observed.model.beginTime, "2026-10-01 08:00");
  assert.equal(observed.model.endTime, "2026-10-31 18:00");
  assert.equal(observed.clicks.some(selector => selector.includes(".field-select input")), false);
  assert.equal(result.page.curriculumName, "示例通识课程");
  assert.equal(result.page.curriculumType, "通识课");
  assert.equal(result.page.organizationName, "示例课程组织");
});

test("course offering Ego preparation fails closed on a different visible session", async (t) => {
  const fixture = await setup(t, { token: "different-token" });
  await assert.rejects(() => prepareCourseOfferingInEgo(fixture.options), (error) => error.code === "PERMISSION_DENIED");
  const observed = await fixture.observed();
  assert.equal(observed.remoteWrites, 0);
  assert.equal(observed.handoffs, 0);
  assert.equal(observed.fills.length, 0);
});


test("course offering Ego preserves human input with source slot controls and reports remaining manual work", async (t) => {
  const fixture = await setup(t, { humanName: "人工课程名称", sourceSlots: true, previousPreparation: true, unreliablePickerWait: true, openingAnimation: true });
  const result = await prepareCourseOfferingInEgo(fixture.options);
  assert.equal(result.executionError, null);
  assert.equal(result.page.curriculumName, "人工课程名称");
  assert.equal(result.page.curriculumType, "通识课");
  assert.equal(result.page.curriculumLevel, "校级");
  assert.equal(result.page.organizationName, "示例课程组织");
  assert.equal(result.page.beginTime, "2026-10-01 08:00");
  assert.equal(result.page.endTime, "2026-10-31 18:00");
  assert.ok(result.actions.some(a => a.field === "curriculumName" && a.action === "human-value-preserved"));
  assert.ok(result.missing.includes("role"));
  assert.ok(result.missing.includes("human-review:report-settings-and-final-submit"));
  const observed = await fixture.observed();
  assert.equal(observed.model.curriculumName, "人工课程名称");
  assert.equal(observed.model.curriculumContent, "受控课程介绍");
  assert.equal(observed.model.curriculumType, "通识课");
  assert.equal(observed.model.curriculumLevel, "校级");
  assert.equal(observed.model.organizationName, "示例课程组织");
  assert.equal(observed.model.beginTime, "2026-10-01 08:00");
  assert.equal(observed.model.endTime, "2026-10-31 18:00");
  assert.equal(observed.submits, 0);
  assert.equal(observed.remoteWrites, 0);
  assert.equal(observed.handoffs, 1);
});

test("course offering Ego rejects partial visible failure while preserving the course, completed fields, and handoff", async (t) => {
  const fixture = await setup(t, { humanName: "人工保留", missingType: true, courseId: "course-fixture" });
  await assert.rejects(() => prepareCourseOfferingInEgo(fixture.options), error => {
    assert.equal(error.code, "UNKNOWN_OUTCOME");
    assert.equal(error.retryable, false);
    assert.equal(error.recovery.courseId, "course-fixture");
    assert.equal(error.recovery.handoff, "completed");
    assert.deepEqual(error.recovery.completed, ["curriculumPlace", "curriculumContent"]);
    assert.equal(error.recovery.page.curriculumName, "人工保留");
    assert.equal(error.recovery.executionError.code, "BUSINESS_REJECTED");
    return true;
  });
  const observed = await fixture.observed();
  assert.equal(observed.model.curriculumName, "人工保留");
  assert.equal(observed.remoteWrites, 0);
  assert.equal(observed.handoffs, 1);
});

test("course offering Ego dry-run opens no page and rejects final-submit bypass flags", async (t) => {
  const fixture = await setup(t);
  const result = await prepareCourseOfferingInEgo({ ...fixture.options, dryRun: true });
  assert.equal(result.dryRun, true);
  assert.equal(result.submitted, false);
  await assert.rejects(fixture.observed, { code: "ENOENT" });
  for (const flag of ["yes", "confirm", "submit"]) await assert.rejects(() => prepareCourseOfferingInEgo({ ...fixture.options, [flag]: true }), { code: "INVALID_INPUT" });
  assert.equal(fixture.upstream.requests.some(r => r.url.includes("file-upload") || r.url.endsWith("/apply/apply")), false);
});


test("course offering Ego refuses an already open human picker without filling, clicking, or resuming it", async (t) => {
  const fixture = await setup(t, { sourceSlots: true, openPicker: true, humanName: "人工保留" });
  await assert.rejects(() => prepareCourseOfferingInEgo(fixture.options), error => {
    assert.equal(error.code, "UNKNOWN_OUTCOME");
    assert.equal(error.recovery.handoff, "completed");
    assert.deepEqual(error.recovery.completed, []);
    assert.equal(error.recovery.page.curriculumName, "人工保留");
    return true;
  });
  const observed = await fixture.observed();
  assert.deepEqual(observed.clicks, []);
  assert.deepEqual(observed.fills, []);
  assert.equal(observed.handoffs, 1);
  assert.equal(observed.remoteWrites, 0);
});
