import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { prepareVolunteerCertificationReviewInEgo } from "../dist/node.js";
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
      else rejectRun(Object.assign(new Error(`CLI failed: ${stderr}`), { code, stdout, stderr, json }));
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
  assert.equal(prepared.json.data.reviewId, "review-1");
  assert.equal(prepared.json.data.activityId, "activity-1");
  assert.equal(prepared.json.data.schoolRole, "XSC");
  assert.equal(prepared.json.data.handleType, "XJ01");
  assert.equal(prepared.json.data.ego.messageAction, "filled");
  assert.equal(prepared.json.meta.requestMode, "visible-ego-prepare");
  assert.equal(prepared.json.meta.verification.pendingReview, "school-api-rechecked");
  assert.equal(upstream.writes.length, 1);
  const runs = await ego.actions();
  const preparation = runs.at(-1);
  assert.match(preparation.script, /taskSpace\(16\)/);
  assert.match(preparation.script, /campusCerApprovalDetail\?uuid=review-1&activityId=activity-1&handleType=XSC/);
  assert.match(preparation.script, /page\.click\(/);
  assert.match(preparation.script, /page\.fill\(/);
  assert.match(preparation.script, /task\.handOff\(\)/);
  assert.match(preparation.script, /page\.snapshot\(/);
  assert.doesNotMatch(
    preparation.script,
    /page\.locator\(|page\.getByText\(|page\.getByRole\(|task\.finish\(|\/pass|\/callback|externalWriteActions|finalSubmitActions|setAttribute|data-friends/,
  );
  assert.ok(preparation.stats.snapshots >= 2);
  assert.equal(preparation.stats.events.indexOf("snapshot") >= 0, true);
  assert.ok(preparation.stats.events.indexOf("snapshot") < preparation.stats.events.indexOf("click"));
  assert.deepEqual(preparation.stats.clicks, ["通过"]);
  assert.deepEqual(preparation.stats.fills, ["请人工确认"]);
  assert.equal(preparation.stats.handoffs, 1);
  assert.equal(preparation.stats.navigations, 0);
  assert.equal(preparation.stats.remoteWrites, 0);
  assert.equal(preparation.stats.externalSaves, 0);
  assert.equal(preparation.stats.finalConfirms, 0);

  await rm(home, { recursive: true, force: true });
  await rm(egoRoot, { recursive: true, force: true });
});

test("Node Ego preparation rechecks identity before touching the browser", async (t) => {
  const upstream = await school(t);
  upstream.state.account = "20219999";
  const egoRoot = await mkdtemp(join(tmpdir(), "friends-review-node-"));
  const ego = await executingEgo(egoRoot);
  await assert.rejects(
    () => prepareVolunteerCertificationReviewInEgo({
      taskSpaceId: 16,
      reviewId: "review-1",
      session,
      baseUrl: upstream.baseUrl,
      decision: "pass",
      message: "请人工确认",
      command: ego.command,
    }),
    (error) => error.code === "AUTH_REQUIRED",
  );
  assert.equal(upstream.state.writeAttempts ?? 0, 0);
  assert.equal(upstream.writes.length, 0);
  await assert.rejects(() => ego.actions(), /ENOENT/);
  await rm(egoRoot, { recursive: true, force: true });
});

test("Node Ego preparation executes a strict DOM and preserves human input", async (t) => {
  const upstream = await school(t);
  const egoRoot = await mkdtemp(join(tmpdir(), "friends-review-strict-"));
  const input = {
    taskSpaceId: 16,
    reviewId: "review-1",
    session,
    baseUrl: upstream.baseUrl,
    decision: "pass",
    message: "请人工确认",
  };

  const unrelated = await executingEgo(egoRoot, { currentUrl: "https://friends.cqu.edu.cn/unrelated" });
  await assert.rejects(
    () => prepareVolunteerCertificationReviewInEgo({ ...input, command: unrelated.command }),
    (error) => error.code === "PERMISSION_DENIED",
  );
  let runs = await unrelated.actions();
  assert.deepEqual(runs.at(-1).stats, {
    events: [],
    clicks: [],
    fills: [],
    snapshots: 0,
    handoffs: 0,
    navigations: 0,
    remoteWrites: 0,
    externalSaves: 0,
    finalConfirms: 0,
  });

  const blank = await executingEgo(egoRoot, { currentUrl: "about:blank" });
  await assert.rejects(
    () => prepareVolunteerCertificationReviewInEgo({ ...input, command: blank.command }),
    (error) => error.code === "PERMISSION_DENIED",
  );
  runs = await blank.actions();
  assert.equal(runs.at(-1).stats.navigations, 0);

  const allowedBlank = await executingEgo(egoRoot, { currentUrl: "about:blank" });
  const navigated = await prepareVolunteerCertificationReviewInEgo({
    ...input,
    allowBlankNavigation: true,
    command: allowedBlank.command,
  });
  assert.equal(navigated.navigated, true);
  assert.deepEqual(navigated.review, {
    id: "review-1",
    activityId: "activity-1",
    schoolRole: "XSC",
    handleType: "XJ01",
  });
  runs = await allowedBlank.actions();
  assert.equal(runs.at(-1).stats.navigations, 1);
  assert.deepEqual(runs.at(-1).stats.clicks, ["通过"]);
  assert.deepEqual(runs.at(-1).stats.fills, ["请人工确认"]);
  assert.equal(runs.at(-1).stats.remoteWrites, 0);
  assert.equal(runs.at(-1).stats.externalSaves, 0);
  assert.equal(runs.at(-1).stats.finalConfirms, 0);

  const human = await executingEgo(egoRoot, { initialMessage: "人工已输入" });
  const preserved = await prepareVolunteerCertificationReviewInEgo({
    ...input,
    command: human.command,
  });
  assert.equal(preserved.navigated, false);
  assert.equal(preserved.messageAction, "human-value-preserved");
  runs = await human.actions();
  assert.deepEqual(runs.at(-1).stats.fills, []);
  assert.match(runs.at(-1).html, /人工已输入/);
  assert.equal(runs.at(-1).stats.remoteWrites, 0);
  assert.equal(runs.at(-1).stats.externalSaves, 0);
  assert.equal(runs.at(-1).stats.finalConfirms, 0);
  assert.doesNotMatch(
    runs.at(-1).script,
    /page\.locator\(|page\.getByText\(|page\.getByRole\(|task\.finish\(|\/pass|\/callback|externalWriteActions|finalSubmitActions|setAttribute|data-friends/,
  );

  await rm(egoRoot, { recursive: true, force: true });
});


test("SDK and CLI reject changed visible accounts and retain unknown partial form outcome",async t=>{
 const upstream=await school(t);const root=await mkdtemp(join(tmpdir(),"friends-review-partial-"));t.after(()=>rm(root,{recursive:true,force:true}));
 const options={taskSpaceId:16,page:"p1",reviewId:"review-1",session,baseUrl:upstream.baseUrl,decision:"pass",message:"待人工审核"};
 let ego=await executingEgo(root,{browserToken:"different-token"});
 await assert.rejects(()=>prepareVolunteerCertificationReviewInEgo({...options,command:ego.command}),e=>e.code==="PERMISSION_DENIED");
 assert.deepEqual((await ego.actions()).at(-1).stats.clicks,[]);
 ego=await executingEgo(root,{failAfterFill:true});
 await assert.rejects(()=>prepareVolunteerCertificationReviewInEgo({...options,command:ego.command}),e=>e.code==="UNKNOWN_OUTCOME"&&e.recovery.applicationId==="review-1");
 let stats=(await ego.actions()).at(-1).stats;assert.equal(stats.handoffs,1);assert.equal(stats.finalConfirms,0);assert.equal(stats.remoteWrites,0);
 const env={...process.env,FRIENDS_BASE_URL:upstream.baseUrl,PATH:root+":"+process.env.PATH};
 await assert.rejects(()=>run(resolve("dist/cli/main.js"),["volunteer-certification-reviews","prepare","review-1","--via","ego","--ego-task-space","16","--ego-page","p1","--decision","pass","--message","待人工审核","--json"],env),e=>e.code===7&&e.json.error.code==="UNKNOWN_OUTCOME");
 stats=(await ego.actions()).at(-1).stats;assert.equal(stats.handoffs,1);assert.equal(stats.finalConfirms,0);assert.equal(stats.remoteWrites,0);
});
