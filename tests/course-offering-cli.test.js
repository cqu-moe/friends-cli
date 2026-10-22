import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  application,
  cliPath,
  courseOfferingCliSetup,
  courseOfferingSchool,
  installCourseOfferingEgoFixture,
  writeMaterialPlan,
} from "./fixtures/course-offering.mjs";

function run(args, env, input = "") {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], { env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => stdout += chunk);
    child.stderr.on("data", (chunk) => stderr += chunk);
    child.on("error", reject);
    child.on("close", (code) => resolve({
      code,
      stdout,
      stderr,
      json: stdout.startsWith("{") ? JSON.parse(stdout) : null,
    }));
    child.stdin.end(input);
  });
}

test("course offering CLI covers file/stdin, dry-run, staged upload, intermediate write, final write, and status", async (t) => {
  const upstream = await courseOfferingSchool(t);
  const { home, env } = await courseOfferingCliSetup(t, upstream);
  const help = await run(["course-offering", "--help"], env);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /materials/);
  assert.match(help.stdout, /next-step/);
  const schema = await run(["schema", "course-offering.submit"], env);
  assert.equal(schema.code, 0);
  assert.equal(schema.json.data.remoteReadonly, false);
  assert.deepEqual(schema.json.data.supportedVia, ["api"]);

  for (const operation of ["prepare", "materials", "next-step", "submit", "status", "prepare-ego"]) {
    const help = await run(["course-offering", operation, "--help"], env);
    assert.equal(help.code, 0);
    assert.equal(help.stderr, "");
    assert.match(help.stdout, /Usage:/);
    const schema = await run(["schema", `course-offering.${operation}`], env);
    assert.equal(schema.code, 0);
    assert.equal(schema.json.schemaVersion, 1);
    assert.equal(schema.json.data.operation, `course-offering.${operation}`);
  }
  const inputFile = join(home, "application.json");
  const materialPlan = await writeMaterialPlan(home);
  await writeFile(inputFile, JSON.stringify(application), { mode: 0o600 });
  const prepared = await run(["course-offering", "prepare", "--input", inputFile], env);
  assert.equal(prepared.code, 0);
  assert.equal(prepared.json.schemaVersion, 1);
  assert.equal(prepared.json.data.term.termNo, "1");
  assert.equal(prepared.stderr, "");
  const denied = await run(["course-offering", "materials", "--input", inputFile, "--via", "ego", "--confirm"], env);
  assert.equal(denied.code, 2);
  const materialFile = join(home, "materials.json");
  await writeFile(materialFile, JSON.stringify(materialPlan), { mode: 0o600 });
  const preview = await run(["course-offering", "materials", "--input", materialFile, "--via", "api", "--dry-run"], env);
  assert.equal(preview.code, 0);
  assert.equal(preview.json.data.submitted, false);
  assert.equal(upstream.requests.filter((request) => request.url.includes("file-upload")).length, 0);

  const stagedFile = await run(["course-offering", "materials", "--input", materialFile, "--via", "api", "--confirm"], env);
  assert.equal(stagedFile.code, 0);
  assert.equal(stagedFile.json.data.submitted, true);
  assert.equal(stagedFile.stdout.includes("course-fixture-token"), false);
  assert.equal(upstream.requests.filter((request) => request.url.includes("file-upload")).length, 2);

  const stagedStdin = structuredClone(stagedFile.json.data);
  const staged = { ...application, materials: stagedStdin.groups };
  const nextPreview = await run(["course-offering", "next-step", "--input", "-", "--via", "api", "--dry-run"], env, JSON.stringify(staged));
  assert.equal(nextPreview.code, 0);
  assert.equal(nextPreview.json.data.submitted, false);
  assert.equal(upstream.requests.filter((request) => request.url.endsWith("/apply/next-step")).length, 0);
  const next = await run(["course-offering", "next-step", "--input", "-", "--via", "api", "--confirm"], env, JSON.stringify(staged));
  assert.equal(next.code, 0);
  assert.equal(next.json.data.courseId, "course-fixture");

  const finalValue = { ...staged, uuid: "course-fixture" };
  const update = await run(["course-offering", "next-step", "--input", "-", "--via", "api", "--confirm"], env, JSON.stringify(finalValue));
  assert.equal(update.code, 0);
  assert.equal(upstream.requests.filter(r => r.method === "PUT").length, 1);
  const finalPreview = await run(["course-offering", "submit", "--input", "-", "--via", "api", "--dry-run"], env, JSON.stringify(finalValue));
  assert.equal(finalPreview.code, 0);
  assert.equal(finalPreview.json.data.submitted, false);
  assert.equal(upstream.requests.some(r => r.url.endsWith("/apply/apply")), false);
  const submitted = await run(["course-offering", "submit", "--input", "-", "--via", "api", "--confirm"], env, JSON.stringify(finalValue));
  assert.equal(submitted.code, 0);
  assert.equal(submitted.stderr, "");
  assert.equal(submitted.json.data.submitted, true);
  assert.equal(upstream.requests.filter((request) => request.url.endsWith("/apply/apply")).length, 1);
  const status = await run(["course-offering", "status", "course-fixture"], env);
  assert.equal(status.code, 0);
  assert.equal(status.json.data.id, "course-fixture");
  assert.equal(status.json.data.state.raw, "PENDING");
  assert.equal(status.stdout.includes("privateStudentList"), false);
});

test("course offering CLI reports missing confirmation and unknown outcomes without retry", async (t) => {
  const upstream = await courseOfferingSchool(t);
  const { home, env } = await courseOfferingCliSetup(t, upstream);
  await mkdir(join(home, "drafts"), { recursive: true });
  const materialPlan = await writeMaterialPlan(home);
  const unconfirmed = await run(["course-offering", "materials", "--input", "-", "--via", "api"], env, JSON.stringify(materialPlan));
  assert.equal(unconfirmed.code, 2);
  assert.equal(upstream.requests.filter((request) => request.url.includes("file-upload")).length, 0);
  upstream.state.mode = "upload-lost";
  const lost = await run(["course-offering", "materials", "--input", "-", "--via", "api", "--confirm"], env, JSON.stringify(materialPlan));
  assert.equal(lost.code, 7);
  assert.equal(lost.json.error.code, "UNKNOWN_OUTCOME");
  assert.equal(lost.json.error.retryable, false);
  assert.equal(lost.json.error.recovery.operation, "course-offering.stage-materials");
  assert.equal(upstream.requests.filter((request) => request.url.includes("file-upload")).length, 1);
});

test("course offering CLI prepares a visible Ego page and hands it off without submission", async (t) => {
  const upstream = await courseOfferingSchool(t);
  const { home, env } = await courseOfferingCliSetup(t, upstream);
  const url = `${upstream.baseUrl.replace("/gateway", "")}/mobile/course/courseInfo?type=add`;
  const ego = await installCourseOfferingEgoFixture(home, "ego-fixture-token", url, { sourceSlots: true, previousPreparation: true, unreliablePickerWait: true, openingAnimation: true });
  const egoEnv = {
    ...env,
    FRIENDS_EGO_FIXTURE_CONFIG: ego.config,
    PATH: `${ego.bin}:${process.env.PATH}`,
  };
  const inputFile = join(home, "ego-application.json");
  await writeFile(inputFile, JSON.stringify({ ...application, firstStep: { ...application.firstStep, beginTime: "2026-10-01 08:00", endTime: "2026-10-31 18:00" } }), { mode: 0o600 });
  const result = await run([
    "course-offering", "prepare-ego",
    "--input", inputFile,
    "--via", "ego",
    "--ego-task-space", "7",
  ], egoEnv);
  assert.equal(result.code, 0);
  assert.equal(result.stderr, "");
  assert.equal(result.json.data.submitted, false);
  assert.equal(result.json.data.handoff, "completed");
  assert.equal(result.json.data.executionError, null);
  assert.equal(
    upstream.requests.filter((request) => request.url.endsWith("/mob/organization/drop-down")).length,
    1,
  );
  assert.equal(result.json.meta.requestMode, "visible-ego-prepare");
  assert.equal(result.stdout.includes("course-fixture-token"), false);
  assert.equal(result.stdout.includes("ego-fixture-token"), false);
  const observed = JSON.parse(await readFile(ego.result, "utf8"));
  assert.equal(observed.model.curriculumType, "通识课");
  assert.equal(observed.model.curriculumLevel, "校级");
  assert.equal(observed.model.organizationName, "示例课程组织");
  assert.equal(observed.model.beginTime, "2026-10-01 08:00:00");
  assert.equal(observed.model.endTime, "2026-10-31 18:00:00");
  assert.equal(observed.submits, 0);
  assert.equal(observed.remoteWrites, 0);
  assert.equal(observed.handoffs, 1);
  assert.equal(observed.clicks.some(selector => selector.includes(".field-select input")), false);
});


test("course offering CLI rejects file declarations outside the explicit upload stage", async (t) => {
  const upstream = await courseOfferingSchool(t);
  const { home, env } = await courseOfferingCliSetup(t, upstream);
  const plan = await writeMaterialPlan(home);
  const result = await run(["course-offering", "next-step", "--input", "-", "--via", "api", "--confirm"], env, JSON.stringify(plan));
  assert.equal(result.code, 2);
  assert.equal(result.json.error.code, "INVALID_INPUT");
  assert.notEqual(result.stderr, "");
  assert.equal(upstream.requests.some(r => r.url.includes("file-upload") || r.url.endsWith("/apply/next-step")), false);
});

test("course offering CLI validates non-interactive input, materials, organization, state, and independent API intent", async (t) => {
  const upstream = await courseOfferingSchool(t);
  const { home, env } = await courseOfferingCliSetup(t, upstream);
  const plan = await writeMaterialPlan(home);
  const executable = join(home, "bad.exe");
  await writeFile(executable, "unsupported");
  const cases = [
    ["prepare", { ...application, unknown: true }, [], 2],
    ["prepare", { ...application, reportSet: { ...application.reportSet, posts: [{}] } }, [], 2],
    ["prepare", { ...application, binding: { ...application.binding, organizationId: "other-org" } }, [], 4],
    ["materials", { ...plan, materials: { ...plan.materials, files: [{ kind: "attachment", path: executable }] } }, ["--via", "api", "--confirm"], 2],
    ["next-step", application, ["--via", "api"], 2],
    ["next-step", { ...application, materials: { attachmentGroupUuid: "empty", publicityPicturesGroupUuid: null } }, ["--via", "api", "--confirm"], 2],
    ["submit", { ...application, uuid: "course-fixture" }, ["--via", "ego", "--confirm"], 2],
    ["submit", application, ["--via", "api", "--confirm"], 2],
  ];
  for (const [command, input, flags, code] of cases) {
    const result = await run(["course-offering", command, "--input", "-", ...flags], env, JSON.stringify(input));
    assert.equal(result.code, code, `${command}: ${result.stdout}`);
    assert.equal(result.json.schemaVersion, 1);
    assert.equal(result.json.ok, false);
    assert.notEqual(result.stderr, "");
  }
  const malformed = await run(["course-offering", "prepare", "--input", "-"], env, "{bad");
  assert.equal(malformed.code, 2);
  assert.equal(malformed.json.error.code, "INVALID_INPUT");
  const statusVia = await run(["course-offering", "status", "course-fixture", "--via", "unsupported"], env);
  assert.equal(statusVia.code, 2);
  assert.equal(upstream.requests.some(r => r.url.includes("file-upload") || r.url.endsWith("/apply/next-step") || r.url.endsWith("/apply/apply")), false);
  upstream.state.flowOverallState = 5;
  const pending = await run(["course-offering", "submit", "--input", "-", "--via", "api", "--confirm"], env, JSON.stringify({ ...application, uuid: "course-fixture" }));
  assert.equal(pending.code, 5);
  upstream.state.flowOverallState = 1;
  upstream.state.mode = "wrong-organization";
  const wrong = await run(["course-offering", "next-step", "--input", "-", "--via", "api", "--confirm"], env, JSON.stringify({ ...application, uuid: "course-fixture" }));
  assert.equal(wrong.code, 5);
  assert.equal(upstream.requests.some(r => r.method === "PUT" || r.url.endsWith("/apply/apply")), false);
});

test("course offering CLI preserves partial upload facts, explicit denials, and all uncertain write outcomes", async (t) => {
  for (const [mode, command, expectedCode] of [
    ["upload-lost-second", "materials", 7],
    ["upload-forbidden-second", "materials", 4],
    ["next-lost", "next-step", 7],
    ["update-lost", "next-step", 7],
    ["final-lost", "submit", 7],
    ["final-ambiguous", "submit", 7],
    ["readback-forbidden", "submit", 7],
    ["business-final", "submit", 5],
  ]) await t.test(mode, async (t) => {
    const upstream = await courseOfferingSchool(t);
    const { home, env } = await courseOfferingCliSetup(t, upstream);
    upstream.state.mode = mode;
    const input = command === "materials" ? await writeMaterialPlan(home) : { ...application, uuid: command === "submit" || mode === "update-lost" ? "course-fixture" : null };
    const result = await run(["course-offering", command, "--input", "-", "--via", "api", "--confirm"], env, JSON.stringify(input));
    assert.equal(result.code, expectedCode, result.stdout);
    assert.equal(result.json.schemaVersion, 1);
    assert.equal(result.json.ok, false);
    assert.notEqual(result.stderr, "");
    assert.equal(result.stdout.includes("course-fixture-token"), false);
    if (expectedCode === 7) {
      assert.equal(result.json.error.code, "UNKNOWN_OUTCOME");
      assert.equal(result.json.error.retryable, false);
      assert.equal(result.json.error.recovery.input.kind, "course-offering");
      assert.equal(result.json.error.recovery.input.binding.organizationId, "org-fixture");
    }
    if (command === "materials") {
      assert.equal(result.json.error.recovery.uploadedMaterials.length, 1);
      assert.equal(upstream.requests.filter(r => r.url.includes("file-upload")).length, 2);
    } else {
      assert.equal(upstream.requests.filter(r => r.method === "PUT" || r.url.endsWith("/apply/next-step") || r.url.endsWith("/apply/apply")).length, 1);
    }
    if (mode === "final-lost" || mode === "final-ambiguous") assert.equal(result.json.error.recovery.readback, "matched");
    if (mode === "readback-forbidden") assert.equal(result.json.error.recovery.serverAcknowledged, true);
  });
});

test("course offering CLI uses the verified Ego query context and enforces the human-only submission boundary", async (t) => {
  const upstream = await courseOfferingSchool(t);
  const { home, env } = await courseOfferingCliSetup(t, upstream);
  const url = `${upstream.baseUrl.replace("/gateway", "")}/mobile/course/courseInfo?type=add`;
  const ego = await installCourseOfferingEgoFixture(home, "ego-fixture-token", url, { humanName: "人工课程名称" });
  const egoEnv = { ...env, FRIENDS_EGO_FIXTURE_CONFIG: ego.config, PATH: `${ego.bin}:${process.env.PATH}` };
  const status = await run(["course-offering", "status", "course-fixture", "--via", "ego", "--ego-task-space", "7"], egoEnv);
  assert.equal(status.code, 0);
  assert.equal(status.json.meta.via, "ego");
  assert.equal(status.json.meta.requestMode, "direct-api");
  let observed = JSON.parse(await readFile(ego.result, "utf8"));
  assert.deepEqual(observed.fills, []);
  assert.deepEqual(observed.clicks, []);
  assert.equal(observed.remoteWrites, 0);
  const dry = await run(["course-offering", "prepare-ego", "--input", "-", "--ego-task-space", "7", "--dry-run"], egoEnv, JSON.stringify(application));
  assert.equal(dry.code, 0);
  assert.equal(dry.json.data.dryRun, true);
  observed = JSON.parse(await readFile(ego.result, "utf8"));
  assert.deepEqual(observed.fills, []);
  assert.deepEqual(observed.clicks, []);
  for (const flag of ["--yes", "--confirm"]) {
    const bypass = await run(["course-offering", "prepare-ego", "--input", "-", "--ego-task-space", "7", flag], egoEnv, JSON.stringify(application));
    assert.equal(bypass.code, 2);
    assert.equal(bypass.json.error.code, "INVALID_INPUT");
  }
  const prepared = await run(["course-offering", "prepare-ego", "--input", "-", "--ego-task-space", "7"], egoEnv, JSON.stringify(application));
  assert.equal(prepared.code, 0);
  assert.equal(prepared.json.data.submitted, false);
  assert.equal(prepared.json.data.page.curriculumName, "人工课程名称");
  observed = JSON.parse(await readFile(ego.result, "utf8"));
  assert.equal(observed.model.curriculumName, "人工课程名称");
  assert.equal(observed.handoffs, 1);
  assert.equal(observed.remoteWrites, 0);
  assert.equal(upstream.requests.some(r => r.url.includes("file-upload") || r.url.endsWith("/apply/next-step") || r.url.endsWith("/apply/apply")), false);
});


test("course offering CLI reports a partial visible preparation as exit 7 with a preserved editable handoff", async (t) => {
  const upstream = await courseOfferingSchool(t);
  const { home, env } = await courseOfferingCliSetup(t, upstream);
  const url = `${upstream.baseUrl.replace("/gateway", "")}/mobile/course/courseInfo?type=Apply&uuid=course-fixture`;
  const ego = await installCourseOfferingEgoFixture(home, "ego-fixture-token", url, { sourceSlots: true, missingType: true, humanName: "人工保留" });
  const result = await run(["course-offering", "prepare-ego", "--input", "-", "--ego-task-space", "7"], {
    ...env, FRIENDS_EGO_FIXTURE_CONFIG: ego.config, PATH: `${ego.bin}:${process.env.PATH}`,
  }, JSON.stringify({ ...application, uuid: "course-fixture" }));
  assert.equal(result.code, 7);
  assert.equal(result.json.ok, false);
  assert.equal(result.json.error.code, "UNKNOWN_OUTCOME");
  assert.equal(result.json.error.retryable, false);
  assert.equal(result.json.error.recovery.courseId, "course-fixture");
  assert.equal(result.json.error.recovery.handoff, "completed");
  assert.deepEqual(result.json.error.recovery.completed, ["curriculumPlace", "curriculumContent"]);
  assert.equal(result.json.error.recovery.page.curriculumName, "人工保留");
  assert.notEqual(result.stderr, "");
  const observed = JSON.parse(await readFile(ego.result, "utf8"));
  assert.equal(observed.model.curriculumName, "人工保留");
  assert.equal(observed.handoffs, 1);
  assert.equal(observed.submits, 0);
  assert.equal(observed.remoteWrites, 0);
});
