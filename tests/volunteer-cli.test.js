import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const execFileAsync = promisify(execFile);
const run = (file, args, options = {}) =>
  execFileAsync(file, args, { timeout: 20_000, ...options });

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function identity(res) {
  json(res, 200, {
    code: "0",
    data: {
      loginLevels: [{
        levelNo: "XS",
        levelName: "学生",
        units: [{ unitType: 2, unitNo: "unit-a", unitName: "示例学院" }],
      }],
      userLoginType: "STUDENT_UNACTIVATED",
    },
  });
}

function runWithStdin(file, args, input, env) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(file, args, { env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", rejectRun);
    child.on("close", (code) => {
      if (code === 0) resolveRun({ stdout, stderr });
      else rejectRun(Object.assign(new Error(stderr || `exit ${code}`), { code, stdout, stderr }));
    });
    child.stdin.end(input);
  });
}

test("real CLI exposes volunteer schemas and runs the complete API flow", async (t) => {
  const requests = [];
  const activity = {
    uuid: "activity-1",
    activityName: "示例志愿活动",
    organizationName: "示例组织",
    activityType: "SCHOOL",
    activityTypeName: "校内活动",
    activityCategory: "SCHOOL_ACTIVITY",
    activityPlace: "示例地点",
    beginTime: "2099-01-01 10:00",
    endTime: "2099-01-01 12:00",
    openTime: "2000-01-01 10:00",
    deadline: "2999-01-01 10:00",
    isOpenEnrollment: true,
    activityState: "ENROLLING",
    studentApplied: null,
    questionnaires: [{
      uuid: "question-text",
      activityId: "activity-1",
      title: "为什么参加",
      itemType: "TEXT",
      isMandatory: true,
      options: [],
    }, {
      uuid: "question-choice",
      activityId: "activity-1",
      title: "是否同意服务安排",
      itemType: "CHOICE",
      isMandatory: false,
      options: [{ uuid: "option-a", optionName: "选项A" }],
    }],
  };
  const registration = {
    uuid: "registration-1",
    activityId: "activity-1",
    studentNo: "20210001",
    postId: "post-1",
    postName: "签到岗",
    postDuration: 2,
    flowOverallState: 7,
    flowCurrMsg: "审核通过",
  };
  let registered = false;
  let hideOptionName = false;
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const payload = body ? JSON.parse(body) : null;
      requests.push({ method: req.method, url: req.url, body: payload });
      if (req.url.endsWith("/checkUserAndGetUserLevel")) return identity(res);
      if (req.url.endsWith("/user/info")) return json(res, 200, { code: "0", data: { userNo: "20210001", userName: "张三" } });
      if (req.url.endsWith("/enterHall")) {
        return json(res, 200, { code: "0", data: { account: "20210001", name: "张三", userLoginStateLevel: "XS", departmentNo: "unit-a" } });
      }
      if (req.url.endsWith("/member/student-view")) return json(res, 200, { code: "0", data: {} });
      if (req.url.endsWith("/member-apply/can-apply")) return json(res, 200, { code: "0", data: true });
      if (req.url.endsWith("/school-activity-apply/student-apply-page-list")) {
        return json(res, 200, { code: "0", data: { currentPage: 1, pageSize: 2, totalCount: 1, pages: 1, data: [activity] } });
      }
      if (req.url.endsWith("/school-activity-apply/manager-activity-list")) {
        return json(res, 200, { code: "0", data: [{ uuid: "activity-1", organizationId: "org-1", name: "示例组织", activityName: "示例志愿活动", positionSetMethod: null }] });
      }
      if (req.url.endsWith("/school-activity-apply/approve-detail/activity-1")) {
        const visibleActivity = hideOptionName
          ? {
              ...activity,
              questionnaires: activity.questionnaires.map((question) => question.itemType === "CHOICE"
                ? { ...question, options: question.options.map((option) => ({ ...option, optionName: null })) }
                : question),
            }
          : activity;
        return json(res, 200, { code: "0", data: { ...visibleActivity, studentApplied: registered ? registration : null } });
      }
      if (req.url.endsWith("/school-activity-apply/post/activity-1")) {
        return json(res, 200, { code: "0", data: [{ uuid: "post-1", postName: "签到岗", duration: 2 }] });
      }
      if (req.url.endsWith("/schoolActivityStudentApply/can-apply/activity-1")) return json(res, 200, { code: "0", data: true });
      if (req.url.endsWith("/school-activity-apply/my-applied-page-list")) {
        return json(res, 200, { code: "0", data: { currentPage: 1, pageSize: 2, totalCount: 1, pages: 1, data: [{ ...activity, studentApplied: registration }] } });
      }
      if (req.url.endsWith("/schoolActivityStudentApply/registration-1")) {
        return json(res, 200, { code: "0", data: registration });
      }
      if (req.url.endsWith("/schoolActivityStudentApply/apply") && req.method === "POST") {
        registered = true;
        return json(res, 200, { code: "0", message: "报名成功", requestId: "register-request" });
      }
      if (req.url.endsWith("/schoolActivityStudentApply/quit/registration-1") && req.method === "DELETE") {
        registered = false;
        return json(res, 200, { code: "0", message: "退出成功", requestId: "withdraw-request" });
      }
      return json(res, 200, { code: "0", data: null });
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });

  const root = await mkdtemp(join(tmpdir(), "friends-volunteer-cli-"));
  const egoBrowser = join(root, "ego-browser");
  await writeFile(egoBrowser, [
    "#!/bin/sh",
    "cat > \"$EGO_SCRIPT_LOG\"",
    "if grep -q FRIENDS_CLI_VOLUNTEER_PREPARE \"$EGO_SCRIPT_LOG\"; then",
    "printf x >> \"$EGO_PREPARE_CALLS\"",
    "printf '%s\\n' 'FRIENDS_CLI_VOLUNTEER_PREPARE:{\"activityId\":\"activity-1\",\"pageLabel\":\"p9\",\"submitted\":false,\"handoff\":true}'",
    "else",
    "printf '%s\\n' 'FRIENDS_CLI_EGO_SESSION:{\"token\":\"ego-token\",\"userLevel\":\"XS\"}'",
    "fi",
    "",
  ].join("\n"));
  await chmod(egoBrowser, 0o700);
  const home = join(root, "home");
  const env = {
    ...process.env,
    PATH: `${root}:${process.env.PATH}`,
    FRIENDS_HOME: home,
    EGO_SCRIPT_LOG: join(root, "ego-script.js"),
    EGO_PREPARE_CALLS: join(root, "ego-prepare-calls"),
    FRIENDS_BASE_URL: `http://127.0.0.1:${server.address().port}/gateway`,
  };
  const cli = process.env.FRIENDS_TEST_CLI ?? resolve("dist/cli/main.js");
  t.after(() => rm(root, { recursive: true, force: true }));

  await run(process.execPath, [cli, "auth", "login", "--method", "local", "--storage", "file", "--json"], { env });
  const help = await run(process.execPath, [cli, "volunteers", "--help"]);
  assert.match(help.stdout, /identity/);
  assert.match(help.stdout, /register/);
  for (const args of [
    ["volunteers", "identity", "--help"],
    ["volunteers", "activities", "--help"],
    ["volunteers", "activities", "list", "--help"],
    ["volunteers", "activities", "show", "--help"],
    ["volunteers", "activities", "requirements", "--help"],
    ["volunteers", "registrations", "--help"],
    ["volunteers", "registrations", "list", "--help"],
    ["volunteers", "registrations", "show", "--help"],
    ["volunteers", "register", "--help"],
    ["volunteers", "withdraw", "--help"],
  ]) {
    const commandHelp = await run(process.execPath, [cli, ...args]);
    const commandGroup = args.length === 2 ||
      (args.length === 3 && (args[1] === "activities" || args[1] === "registrations"));
    assert.match(commandHelp.stdout, commandGroup ? /Commands:/ : /--json/);
  }
  const volunteerOperations = [
    "volunteers.identity",
    "volunteers.activities.list",
    "volunteers.activities.show",
    "volunteers.activities.requirements",
    "volunteers.registrations.list",
    "volunteers.registrations.show",
    "volunteers.register",
    "volunteers.withdraw",
  ];
  for (const operation of volunteerOperations) {
    const contract = JSON.parse((await run(process.execPath, [cli, "schema", operation, "--json"], { env })).stdout);
    assert.equal(contract.data.operation, operation);
    assert.equal(typeof contract.data.readonly, "boolean");
    assert.deepEqual(contract.data.supportedVia, ["api", "ego"]);
  }
  const schema = JSON.parse((await run(process.execPath, [cli, "schema", "volunteers.register", "--json"], { env })).stdout);
  assert.equal(schema.data.operation, "volunteers.register");
  assert.equal(schema.data.readonly, false);
  assert.deepEqual(schema.data.supportedVia, ["api", "ego"]);
  assert.equal(schema.data.apiWriteConfirmation, "--confirm required; --dry-run performs no write");
  assert.equal(schema.data.egoWriteStage, "visible prepare + human submit");
  assert.match(schema.data.credentialSource, /stored local session/);
  assert.match(schema.data.credentialSource, /existing Ego page session/);
  assert.equal(schema.data.executionSource, "via api|ego is execution only and is reported separately from credentialSource");

  const identityOutput = JSON.parse((await run(process.execPath, [cli, "volunteers", "identity", "--json"], { env })).stdout);
  assert.equal(identityOutput.data.membershipApplicationAllowed, true);
  const list = JSON.parse((await run(process.execPath, [
    cli, "volunteers", "activities", "list", "--kind", "participable", "--page", "1", "--page-size", "2", "--keyword", "示例", "--json",
  ], { env })).stdout);
  assert.equal(list.data.items[0].id, "activity-1");
  assert.equal(list.meta.via, "api");
  const manageable = JSON.parse((await run(process.execPath, [
    cli, "volunteers", "activities", "list", "--kind", "manageable", "--json",
  ], { env })).stdout);
  assert.equal(manageable.data[0].organizationId, "org-1");
  assert.equal(manageable.data[0].id, "activity-1");
  const detail = JSON.parse((await run(process.execPath, [cli, "volunteers", "activities", "show", "activity-1", "--json"], { env })).stdout);
  assert.equal(detail.data.id, "activity-1");
  const requirements = JSON.parse((await run(process.execPath, [cli, "volunteers", "activities", "requirements", "activity-1", "--json"], { env })).stdout);
  assert.equal(requirements.data.posts[0].id, "post-1");
  const registrations = JSON.parse((await run(process.execPath, [
    cli, "volunteers", "registrations", "list", "--page", "1", "--page-size", "2", "--json",
  ], { env })).stdout);
  assert.equal(registrations.data.items[0].registration.id, "registration-1");
  const registrationDetail = JSON.parse((await run(process.execPath, [cli, "volunteers", "registrations", "show", "registration-1", "--json"], { env })).stdout);
  assert.equal(registrationDetail.data.id, "registration-1");

  const answerFile = join(root, "register.json");
  await writeFile(answerFile, JSON.stringify({
    postId: "post-1",
    questionnaireAnswers: [
      { itemUuid: "question-text", type: "TEXT", inputContent: "服务社会" },
      { itemUuid: "question-choice", type: "CHOICE", optionUuid: "option-a" },
    ],
  }));
  const dryRun = JSON.parse((await runWithStdin(process.execPath, [
    cli, "volunteers", "register", "activity-1", "--input", "-", "--dry-run", "--json",
  ], JSON.stringify({
    postId: "post-1",
    questionnaireAnswers: [{ itemUuid: "question-text", type: "TEXT", inputContent: "stdin answer" }],
  }), env)).stdout);
  assert.equal(dryRun.data.wouldWrite, true);
  assert.equal(dryRun.data.payload.studentNo, "20210001");
  assert.equal(requests.some(({ url, method }) => url.endsWith("/schoolActivityStudentApply/apply") && method === "POST"), false);

  const register = JSON.parse((await run(process.execPath, [
    cli, "volunteers", "register", "activity-1", "--input", answerFile, "--confirm", "--json",
  ], { env })).stdout);
  assert.equal(register.data.receipt.serverAcknowledged, true);
  assert.equal(register.data.receipt.approved, null);
  assert.equal(register.data.readback.attempted, true);
  assert.equal(register.data.readback.coverage, "first-page-only");
  assert.equal(register.data.readback.matchingRegistration.id, "registration-1");
  assert.equal(register.meta.via, "api");
  const withdraw = JSON.parse((await run(process.execPath, [
    cli, "volunteers", "withdraw", "activity-1", "registration-1", "--confirm", "--json",
  ], { env })).stdout);
  assert.equal(withdraw.data.receipt.serverAcknowledged, true);
  assert.equal(withdraw.data.readback.attempted, true);

  const egoList = JSON.parse((await run(process.execPath, [
    cli, "volunteers", "activities", "list", "--via", "ego", "--ego-task-space", "7", "--ego-page", "p2", "--json",
  ], { env })).stdout);
  assert.equal(egoList.meta.selectedEntry, "ego");
  assert.equal(egoList.meta.requestMode, "direct-api");
  const egoPrepare = JSON.parse((await run(process.execPath, [
    cli, "volunteers", "register", "activity-1", "--input", answerFile, "--via", "ego",
    "--ego-task-space", "7", "--json",
  ], { env })).stdout);
  assert.equal(egoPrepare.data.submitted, false);
  assert.equal(egoPrepare.data.handoff, true);
  assert.equal(egoPrepare.data.pageLabel, "p9");
  assert.equal(egoPrepare.meta.via, "ego-visible-form+human-submit");
  const script = await readFile(join(root, "ego-script.js"), "utf8");
  assert.match(script, /campusActivityApplyDetail\?uuid=activity-1/);
  assert.match(script, /task\.newPage\(\)/);
  assert.match(script, /task\.handOff\(\)/);
  assert.match(script, /page\.snapshot\(\)/);
  assert.doesNotMatch(script, /page\.on\(/);
  assert.doesNotMatch(script, /fetch\(/);

  const callsBeforeMissingVisibleText = (await readFile(env.EGO_PREPARE_CALLS, "utf8")).length;
  hideOptionName = true;
  await assert.rejects(
    () => run(process.execPath, [
      cli, "volunteers", "register", "activity-1", "--input", answerFile, "--via", "ego",
      "--ego-task-space", "7", "--json",
    ], { env }),
    (error) => error.code === 2 &&
      JSON.parse(error.stdout).error.code === "INVALID_INPUT" &&
      JSON.parse(error.stdout).error.message === "Ego preparation requires a visible questionnaire option label for option-a",
  );
  assert.equal((await readFile(env.EGO_PREPARE_CALLS, "utf8")).length, callsBeforeMissingVisibleText);

  await assert.rejects(
    () => run(process.execPath, [cli, "volunteers", "register", "activity-1", "--input", answerFile, "--json"], { env }),
    (error) => error.code === 2 && JSON.parse(error.stdout).error.code === "INVALID_INPUT",
  );
  await assert.rejects(
    () => run(process.execPath, [cli, "volunteers", "withdraw", "activity-1", "registration-1", "--via", "ego", "--confirm", "--json"], { env }),
    (error) => error.code === 2 && JSON.parse(error.stdout).error.code === "INVALID_INPUT",
  );
  assert.equal(requests.filter(({ url, method }) =>
    url.endsWith("/schoolActivityStudentApply/apply") && method === "POST").length, 1);
});
