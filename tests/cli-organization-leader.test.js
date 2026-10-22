import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { leaderScenario } from "./fixtures/organization-leader-scenario.mjs";
import { leaderEgoFixture } from "./fixtures/organization-leader-ego.mjs";

test("real CLI checks responsible-person candidates, submits once, and queries application and current relationship separately", async t => {
  const scenario = await leaderScenario(t);
  const root = await mkdtemp(join(tmpdir(), "friends-leader-cli-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await chmod(root, 0o700);
  await writeFile(join(root, "session.json"), JSON.stringify({ schemaVersion: 1, loginMethod: "local", storage: "file", token: "fixture-token", userLevel: "XS", account: { userNo: "20210001", userName: "示例学生" }, context: { levelNo: "XS", levelName: "学生", unit: { unitType: 2, unitNo: "24080", unitName: "示例学院" } } }), { mode: 0o600 });
  const input = { candidateStudentNo: "20210002", newResponsiblePhone: "13800000002", newResponsiblePolitical: "共青团员", newPostUuid: "new-post", reason: "毕业交接" };
  const file = join(root, "input.json");
  await writeFile(file, JSON.stringify(input));
  const cli = process.env.FRIENDS_TEST_CLI ?? resolve("dist/cli/main.js");
  async function run(args, stdin, extraEnv = {}) {
    const child = spawn(process.execPath, [cli, ...args], { env: { ...process.env, FRIENDS_HOME: root, FRIENDS_BASE_URL: scenario.baseUrl, ...extraEnv }, timeout: 20_000, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", b => stdout += b); child.stderr.on("data", b => stderr += b);
    const code = await new Promise((resolve, reject) => { child.on("error", reject); child.on("close", resolve); child.stdin.end(stdin ?? ""); });
    return { code, stdout, stderr, value: args.includes("--help") ? null : JSON.parse(stdout) };
  }
  const help = await run(["organizations", "leader-change", "--help"]);
  assert.equal(help.code, 0); assert.match(help.stdout, /candidates/); assert.match(help.stdout, /submit/);
  for (const op of ["candidates", "status", "prepare", "submit"]) {
    const result = await run(["schema", `organizations.leader-change.${op}`]);
    assert.equal(result.code, 0); assert.equal(result.value.schemaVersion, 1);
  }
  const candidates = await run(["organizations", "leader-change", "candidates", "leader-org", "--keyword", "20210002"]);
  assert.equal(candidates.value.data.items[0].studentNo, "20210002");
  const noMaterial = await run(["organizations", "leader-change", "submit", "leader-org", "--via", "api", "--candidate-student-no", "20210002", "--dry-run"]);
  assert.equal(noMaterial.code, 2);
  const badJson = await run(["organizations", "leader-change", "submit", "leader-org", "--via", "api", "--input", "-", "--dry-run"], "{");
  assert.equal(badJson.code, 2); assert.ok(badJson.stderr.length > 0);
  const wrongOrganization = await run(["organizations", "leader-change", "submit", "other-org", "--via", "api", "--input", file, "--dry-run"]);
  assert.equal(wrongOrganization.code, 4);
  const wrongCandidate = await run(["organizations", "leader-change", "submit", "leader-org", "--via", "api", "--input", "-", "--dry-run"], JSON.stringify({ ...input, candidateStudentNo: "20218888" }));
  assert.equal(wrongCandidate.code, 5);
  const preview = await run(["organizations", "leader-change", "submit", "leader-org", "--via", "api", "--input", "-", "--dry-run"], JSON.stringify(input));
  assert.equal(preview.value.data.submitted, false); assert.equal(scenario.writes().length, 0);
  for (const args of [
    ["--via", "ego", "--yes"], ["--via", "api"], ["--via", "api", "--yes", "--dry-run"],
  ]) {
    const denied = await run(["organizations", "leader-change", "submit", "leader-org", "--input", file, ...args]);
    assert.equal(denied.code, 2); assert.equal(denied.value.error.code, "INVALID_INPUT");
  }
  const ego = await leaderEgoFixture(t, scenario.baseUrl);
  const egoEnv = { PATH: `${dirname(ego.command)}:${process.env.PATH}`, FRIENDS_HOME: join(root, "no-local-session") };
  for (const command of ["candidates", "status"]) {
    const queried = await run(["organizations", "leader-change", command, "leader-org", "--via", "ego", "--ego-task-space", "16"], undefined, egoEnv);
    assert.equal(queried.code, 0); assert.equal(queried.value.meta.selectedEntry, "ego"); assert.equal(queried.value.meta.requestMode, "direct-api");
  }
  const egoArgs = ["organizations", "leader-change", "prepare", "leader-org", "--via", "ego", "--ego-task-space", "16", "--input", file];
  const egoPreview = await run([...egoArgs, "--dry-run"], undefined, egoEnv);
  assert.equal(egoPreview.code, 0); assert.equal(egoPreview.value.data.dryRun, true);
  let browserEvidence = JSON.parse(await readFile(ego.evidence, "utf8"));
  assert.deepEqual(browserEvidence.clicks, []); assert.deepEqual(browserEvidence.fills, []); assert.equal(browserEvidence.handoffs, 0);
  const egoPrepared = await run(egoArgs, undefined, egoEnv);
  assert.equal(egoPrepared.code, 0); assert.equal(egoPrepared.value.data.submitted, false);
  assert.deepEqual(egoPrepared.value.data.manualFields, []); assert.equal(scenario.writes().length, 0);
  browserEvidence = JSON.parse(await readFile(ego.evidence, "utf8"));
  assert.equal(browserEvidence.candidate, "新负责人"); assert.equal(browserEvidence.post, "新职务"); assert.equal(browserEvidence.reason, "毕业交接"); assert.equal(browserEvidence.submits, 0); assert.equal(browserEvidence.externalWrites, 0);
  const bypass = await run([...egoArgs, "--yes"], undefined, egoEnv);
  assert.equal(bypass.code, 2); assert.equal(scenario.writes().length, 0);

  const submitted = await run(["organizations", "leader-change", "submit", "leader-org", "--via", "api", "--input", file, "--yes"]);
  assert.equal(submitted.code, 0); assert.equal(submitted.value.data.application.id, "change-fixture");
  assert.equal(submitted.value.data.responsiblePersonChanged, false); assert.equal(scenario.writes().length, 1);
  const status = await run(["organizations", "leader-change", "status", "leader-org"]);
  assert.equal(status.value.data.application.flow.currentMessage, "等待审核"); assert.equal(status.value.data.currentResponsiblePerson, "20210001");
  const duplicate = await run(["organizations", "leader-change", "submit", "leader-org", "--via", "api", "--input", file, "--yes"]);
  assert.equal(duplicate.code, 5); assert.equal(scenario.writes().length, 1);
  scenario.state.application = null; scenario.state.manager = true;
  const denied = await run(["organizations", "leader-change", "submit", "leader-org", "--via", "api", "--input", file, "--yes"]);
  assert.equal(denied.code, 4); assert.equal(scenario.writes().length, 1);
  scenario.state.manager = false; scenario.state.postMode = "denied";
  const rejected = await run(["organizations", "leader-change", "submit", "leader-org", "--via", "api", "--input", file, "--yes"]);
  assert.equal(rejected.code, 5); assert.equal(rejected.value.error.code, "BUSINESS_REJECTED");
  scenario.state.postMode = "lost";
  const lost = await run(["organizations", "leader-change", "submit", "leader-org", "--via", "api", "--input", file, "--yes"]);
  assert.equal(lost.code, 7); assert.equal(lost.value.error.code, "UNKNOWN_OUTCOME");
  assert.equal(lost.value.error.recovery.applicationReadback, "matched"); assert.equal(lost.value.error.recovery.applicationId, "change-fixture"); assert.equal(scenario.writes().length, 3);
  assert.equal(submitted.stderr, "");
});
