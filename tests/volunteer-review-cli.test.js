import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { executingEgo, school, session } from "./fixtures/volunteer-review.mjs";

const execFileAsync = promisify(execFile);

function run(cli, args, env, input = "") {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [cli, ...args], { env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.once("error", rejectRun);
    child.once("close", (code) => {
      const json = stdout.trimStart().startsWith("{") ? JSON.parse(stdout) : null;
      if (code === 0) resolveRun({ stdout, stderr, json });
      else rejectRun(Object.assign(new Error("CLI failed"), { code, stdout, stderr, json }));
    });
    child.stdin.end(input);
  });
}

test("real CLI queries volunteer records and reviews through both API and Ego", async (t) => {
  const upstream = await school(t);
  const home = await mkdtemp(join(tmpdir(), "friends-review-cli-"));
  const egoRoot = await mkdtemp(join(tmpdir(), "friends-review-ego-"));
  const ego = await executingEgo(egoRoot);
  await mkdir(home, { recursive: true, mode: 0o700 });
  const sessionPath = join(home, "session.json");
  await writeFile(sessionPath, JSON.stringify({
    schemaVersion: 1,
    loginMethod: "local",
    storage: "file",
    token: session.token,
    userLevel: session.userLevel,
    account: { userNo: session.accountUserNo, userName: "示例" },
    context: {
      levelNo: session.levelNo,
      levelName: "学生",
      unit: { unitType: 2, unitNo: session.unitNo, unitName: "示例学院" },
    },
  }) + "\n", { mode: 0o600 });
  await chmod(sessionPath, 0o600);
  const cli = process.env.FRIENDS_TEST_CLI ?? resolve("dist/cli/main.js");
  const env = {
    ...process.env,
    PATH: `${egoRoot}:${process.env.PATH}`,
    FRIENDS_HOME: home,
    FRIENDS_BASE_URL: upstream.baseUrl,
    EGO_SCRIPT_LOG: ego.scriptLog,
    EGO_ACTIONS_LOG: ego.actionLog,
  };

  const help = await run(cli, ["volunteer-hours", "--help"], env);
  assert.match(help.stdout, /authenticated volunteer hours/);
  const schema = await run(cli, ["schema", "volunteer-certification-reviews.decide", "--json"], env);
  assert.equal(schema.json.data.readonly, false);
  assert.equal(schema.json.data.supportedVia.length, 1);
  assert.equal(schema.json.data.submittedViaEgo, "never");

  const hours = await run(cli, [
    "volunteer-hours", "list", "--page", "2", "--page-size", "5", "--keyword", "示例", "--json",
  ], env);
  assert.equal(hours.json.data.items[0].id, "transcript-1");
  assert.equal(hours.json.meta.requestMode, "direct-api");
  const record = await run(cli, ["volunteer-hours", "show", "transcript-1", "--json"], env);
  assert.equal(record.json.data.items[0].durationHours.value, 1.5);

  const reviews = await run(cli, [
    "volunteer-certification-reviews", "list", "--via", "ego", "--ego-task-space", "16",
    "--ego-page", "p1", "--page", "2", "--page-size", "5", "--keyword", "示例", "--json",
  ], env);
  assert.equal(reviews.json.data.items[0].id, "review-1");
  assert.equal(reviews.json.meta.selectedEntry, "ego");
  assert.equal(reviews.json.meta.requestMode, "direct-api");

  await assert.rejects(
    () => run(cli, ["volunteer-certification-reviews", "decide", "review-1", "--via", "api", "--decision", "pass", "--message", "同意", "--json"], env),
    (error) => error.code === 2 && error.json.error.code === "INVALID_INPUT" && upstream.writes.length === 0,
  );
  const dryRun = await run(cli, [
    "volunteer-certification-reviews", "decide", "review-1", "--via", "api",
    "--decision", "pass", "--message", "同意认证", "--time", "2026-10-22", "--dry-run", "--json",
  ], env);
  assert.equal(dryRun.json.data.submitted, false);
  assert.equal(upstream.writes.length, 0);
  const decided = await run(cli, [
    "volunteer-certification-reviews", "decide", "review-1", "--via", "api",
    "--decision", "pass", "--message", "同意认证", "--time", "2026-10-22", "--confirm", "--json",
  ], env);
  assert.equal(decided.json.data.serverAcknowledged, true);
  assert.equal(decided.json.data.readback.state, "changed");
  assert.equal(upstream.writes.length, 1);

  const prepared = await run(cli, [
    "volunteer-certification-reviews", "prepare", "review-1", "--via", "ego",
    "--ego-task-space", "16", "--ego-page", "p1", "--decision", "pass",
    "--message", "请人工确认", "--json",
  ], env);
  assert.equal(prepared.json.data.status, "awaiting-user");
  assert.equal(prepared.json.data.submitted, false);
  assert.equal(prepared.json.meta.requestMode, "visible-ego-prepare");
  assert.equal(upstream.writes.length, 1);
  const runs = await ego.actions();
  const preparation = runs.at(-1);
  assert.match(preparation.script, /taskSpace\(16\)/);
  assert.match(preparation.script, /campusCerApprovalDetail\?uuid=review-1&activityId=activity-1&handleType=XSC/);
  assert.match(preparation.script, /page\.click\(/);
  assert.match(preparation.script, /page\.fill\(/);
  assert.match(preparation.script, /task\.handOff\(\)/);
  assert.doesNotMatch(preparation.script, /page\.locator\(|page\.getByText\(|page\.getByRole\(|task\.finish\(|\/pass|\/callback|保存/);
  const actionNames = preparation.actions.map((action) => action.type);
  assert.ok(actionNames.includes("click"));
  assert.ok(actionNames.includes("fill"));
  assert.ok(actionNames.includes("handOff"));

  await rm(home, { recursive: true, force: true });
  await rm(egoRoot, { recursive: true, force: true });
});
