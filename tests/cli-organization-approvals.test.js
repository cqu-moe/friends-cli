import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FriendsErrorCode } from "../dist/index.js";
import { prepareOrganizationApplicationDecisionInEgo } from "../dist/node.js";

const execFileAsync = promisify(execFile);

function reply(res, body) {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function identity(res) {
  reply(res, {
    code: "0",
    data: {
      loginLevels: [{
        levelNo: "XS",
        levelName: "学生",
        units: [{ unitType: 2, unitNo: "24080", unitName: "示例学院" }],
      }],
      userLoginType: "STUDENT",
    },
  });
}

test("real CLI queries, previews, and confirms organization application decisions", async (t) => {
  const requests = [];
  let postMode = "ack";
  let readbackPhase = false;
  let relationActive = true;
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      requests.push({ method: req.method, url: req.url, body: body === "" ? null : JSON.parse(body) });
      if (req.url.endsWith("/checkUserAndGetUserLevel")) return identity(res);
      if (req.url.endsWith("/user/info")) {
        return reply(res, { code: "0", data: { userNo: "20210001", userName: "示例管理员" } });
      }
      if (req.url.endsWith("/enterHall")) {
        return reply(res, {
          code: "0",
          data: {
            account: "20210001",
            name: "示例管理员",
            userLoginStateLevel: "XS",
            departmentNo: "24080",
          },
        });
      }
      if (req.url.endsWith("/student-organization-info/my")) {
        return reply(res, {
          code: "0",
          data: [{
            uuid: "org-cli",
            organizationName: "CLI示例组织",
            organizationType: "STUDENT_CLUB",
            responsiblePerson: "20219999",
            currentUserIsManager: true,
          }],
        });
      }
      if (req.url.endsWith("/biz-common/flow/template-activity-state")) {
        return reply(res, { code: "0", data: [{ code: "WAIT", value: "等待审批" }] });
      }
      if (req.method === "POST" && req.url.endsWith("/student-organization-apply/approve-list")) {
        const input = JSON.parse(body);
        const present = !readbackPhase &&
          (input.approvalState === undefined || input.approvalState === "WAIT");
        return reply(res, {
          code: "0",
          data: {
            data: present ? [{
              uuid: input.applyType === 1 ? "join-cli" : "exit-cli",
              organizationId: "org-cli",
              studentNo: "20210002",
              studentName: "CLI成员",
              flowCurrMsg: "等待审批",
              privateField: "must-not-project",
            }] : [],
            currentPage: input.currentPage,
            pageSize: input.pageSize,
            pages: present ? 1 : 0,
            totalCount: present ? 1 : 0,
          },
        });
      }
      if (req.method === "GET" && /\/student-organization-apply\/(?:join|exit)-cli$/.test(req.url)) {
        return reply(res, {
          code: "0",
          data: {
            uuid: req.url.endsWith("join-cli") ? "join-cli" : "exit-cli",
            organizationId: "org-cli",
            studentNo: "20210002",
            studentName: "CLI成员",
            flowCurrMsg: "等待审批",
            schoolInternalField: "school-value",
          },
        });
      }
      if (req.url.includes("/student-organization-info/join-exit?")) {
        return reply(res, {
          code: "0",
          data: [{
            uuid: "relation-cli",
            state: relationActive ? 1 : 0,
            joinTime: "2026-01-01",
            exitTime: relationActive ? null : "2026-10-22",
          }],
        });
      }
      if (req.method === "POST" && req.url.endsWith("/student-organization-apply/approve")) {
        readbackPhase = true;
        if (postMode === "lost") {
          req.socket.destroy();
          return;
        }
        return reply(res, { code: "0", message: "操作成功" });
      }
      return reply(res, 404, {});
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const home = await mkdtemp(join(tmpdir(), "friends-org-approvals-cli-"));
  const sessionPath = join(home, "session.json");
  await writeFile(sessionPath, JSON.stringify({
    schemaVersion: 1,
    loginMethod: "local",
    storage: "file",
    token: "cli-token",
    userLevel: "XS",
    account: { userNo: "20210001", userName: "示例管理员" },
    context: { levelNo: "XS", levelName: "学生", unit: { unitType: 2, unitNo: "24080", unitName: "示例学院" } },
  }) + "\n", { mode: 0o600 });
  await chmod(sessionPath, 0o600);
  const env = {
    ...process.env,
    FRIENDS_HOME: home,
    FRIENDS_BASE_URL: `http://127.0.0.1:${server.address().port}/gateway`,
  };
  const cli = process.env.FRIENDS_TEST_CLI ?? join(process.cwd(), "dist/cli/main.js");
  const run = (args, options = {}) => {
    const childEnv = { ...env, ...options.env };
    return options.input === undefined ? execFileAsync(process.execPath, [cli, ...args], {
      timeout: 20_000,
      ...options,
      env: childEnv,
    }) : new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { timeout: 20_000, env: childEnv });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => stdout += chunk);
    child.stderr.on("data", (chunk) => stderr += chunk);
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(Object.assign(new Error("CLI failed"), { code, stdout, stderr }));
    });
    child.stdin.end(options.input);
    });
  };

  const help = await run(["organizations", "approvals", "--help"]);
  assert.match(help.stdout, /organization application reviews/);
  const schema = JSON.parse((await run(["schema", "organizations.approvals.decide", "--json"])).stdout);
  assert.equal(schema.data.readonly, false);
  assert.equal(schema.data.confirmation, "requires independent --via api and --yes");
  assert.equal(schema.data.submittedViaEgo, "never");

  const joinList = JSON.parse((await run([
    "organizations", "approvals", "list", "org-cli", "--type", "join",
    "--page", "2", "--page-size", "5", "--keyword", "CLI成员", "--json",
  ])).stdout);
  assert.equal(joinList.data.items[0].id, "join-cli");
  assert.equal(joinList.meta.operation, "organizations.approvals.list");
  assert.equal(JSON.stringify(joinList).includes("privateField"), false);
  const exit = JSON.parse((await run(["organizations", "approvals", "list", "org-cli", "--type", "exit", "--json"])).stdout);
  assert.equal(exit.data.items[0].id, "exit-cli");
  const shownExit = JSON.parse((await run(["organizations", "approvals", "show", "exit-cli", "--type", "exit", "--json"])).stdout);
  assert.equal(shownExit.data.id, "exit-cli");
  const shown = JSON.parse((await run(["organizations", "approvals", "show", "join-cli", "--type", "join", "--json"])).stdout);
  assert.equal(shown.data.relation.active, true);
  assert.equal(shown.meta.requestMode, "direct-api");

  const postCount = () => requests.filter((request) =>
    request.method === "POST" && request.url.endsWith("/student-organization-apply/approve"),
  ).length;
  const dryRun = JSON.parse((await run([
    "organizations", "approvals", "decide", "org-cli", "join-cli",
    "--type", "join", "--decision", "approve", "--via", "api", "--dry-run",
    "--input", "-", "--json",
  ], { input: '{"message":"CLI同意","time":"2026-10-22"}' })).stdout);
  assert.equal(dryRun.data.status, "prepared");
  assert.equal(dryRun.data.submitted, false);
  assert.equal(postCount(), 0);

  const beforeRejects = postCount();
  await assert.rejects(
    () => run([
      "organizations", "approvals", "decide", "org-cli", "join-cli", "--type", "join",
      "--decision", "approve", "--yes", "--json",
    ]),
    (error) => error.code === 2 && JSON.parse(error.stdout).error.code === "INVALID_INPUT",
  );
  await assert.rejects(
    () => run([
      "organizations", "approvals", "decide", "org-cli", "join-cli", "--type", "join",
      "--decision", "approve", "--via", "api", "--json",
    ]),
    (error) => error.code === 2 && JSON.parse(error.stdout).error.code === "INVALID_INPUT",
  );
  await assert.rejects(
    () => run([
      "organizations", "approvals", "decide", "org-cli", "join-cli", "--type", "join",
      "--decision", "approve", "--via", "api", "--yes", "--input", "-", "--json",
    ], { input: '{"message":"CLI同意","time":"2026-10-22","identified":"REJECTION"}' }),
    (error) => error.code === 2 && JSON.parse(error.stdout).error.code === "INVALID_INPUT",
  );
  assert.equal(postCount(), beforeRejects);

  const decided = JSON.parse((await run([
    "organizations", "approvals", "decide", "org-cli", "join-cli",
    "--type", "join", "--decision", "approve", "--via", "api", "--yes",
    "--input", "-", "--json",
  ], { input: '{"message":"CLI同意","time":"2026-10-22"}' })).stdout);
  assert.equal(decided.data.status, "decided");
  assert.equal(decided.data.applicationNoLongerPending, true);
  assert.equal(decided.data.relation.active, true);
  const post = requests.find((request) =>
    request.method === "POST" && request.url.endsWith("/student-organization-apply/approve"),
  );
  assert.equal(post.body.identified, "AGREEMENT");
  assert.equal(post.body.studentOrganizationInfoApproveAddReqDto.schoolInternalField, "school-value");

  postMode = "lost";
  readbackPhase = false;
  await assert.rejects(
    () => run([
      "organizations", "approvals", "decide", "org-cli", "join-cli",
      "--type", "join", "--decision", "reject", "--via", "api", "--yes",
      "--message", "CLI拒绝", "--time", "2026-10-22", "--json",
    ]),
    (error) => error.code === 7 &&
        JSON.parse(error.stdout).error.code === "UNKNOWN_OUTCOME" &&
        JSON.parse(error.stdout).error.recovery.serverAcknowledged === "unknown",
  );

  postMode = "ack";
  readbackPhase = false;
  relationActive = false;
  const exitDecided = JSON.parse((await run([
    "organizations", "approvals", "decide", "org-cli", "exit-cli",
    "--type", "exit", "--decision", "reject", "--via", "api", "--yes",
    "--message", "CLI拒绝退出", "--time", "2026-10-22", "--json",
  ])).stdout);
  assert.equal(exitDecided.data.type, "exit");
  assert.equal(exitDecided.data.decision, "reject");
  assert.equal(exitDecided.data.applicationNoLongerPending, true);
  assert.equal(exitDecided.data.relation.active, false);
  const exitPost = requests.find((request) =>
    request.method === "POST" &&
    request.url.endsWith("/student-organization-apply/approve") &&
    request.body.uuid === "exit-cli",
  );
  assert.equal(exitPost.body.identified, "ADJUSTMENT");
  assert.equal(exitPost.body.studentOrganizationInfoApproveAddReqDto.uuid, "exit-cli");
  readbackPhase = false;
  await assert.rejects(
    () => prepareOrganizationApplicationDecisionInEgo({
      taskSpaceId: 16,
      route: "/mobile/groupManage/studentApprovalJoinDetail?uuid=join-cli",
      applicationId: "other-application",
      type: "join",
      decision: "approve",
      message: "路由不匹配",
    }),
    (error) => error.code === FriendsErrorCode.InvalidInput,
  );

  async function egoFixture(mode) {
    const root = await mkdtemp(join(tmpdir(), `friends-org-approval-ego-${mode}-`));
    const scriptPath = join(root, "ego-script.js");
    const evidencePath = join(root, "evidence.json");
    const runner = new URL("./fixtures/ego-organization-approval-page.mjs", import.meta.url).href;
    const ego = join(root, "ego-browser");
    await writeFile(ego, [
      "#!/bin/sh",
      `cat > ${JSON.stringify(scriptPath)}`,
      `EGO_ORGANIZATION_APPROVAL_FIXTURE_MODE=${JSON.stringify(mode)}`,
      `EGO_ORGANIZATION_APPROVAL_SCRIPT_PATH=${JSON.stringify(scriptPath)}`,
      `EGO_ORGANIZATION_APPROVAL_EVIDENCE_PATH=${JSON.stringify(evidencePath)}`,
      "export EGO_ORGANIZATION_APPROVAL_FIXTURE_MODE EGO_ORGANIZATION_APPROVAL_SCRIPT_PATH EGO_ORGANIZATION_APPROVAL_EVIDENCE_PATH",
      `exec ${JSON.stringify(process.execPath)} -e 'await import(${JSON.stringify(runner)})'`,
      "",
    ].join("\n"), { mode: 0o700 });
    await chmod(ego, 0o700);
    return { root, scriptPath, evidencePath, env: { PATH: `${root}:${process.env.PATH}` } };
  }

  const cleanEgo = await egoFixture("clean");
  const preparedInEgo = JSON.parse((await run([
    "organizations", "approvals", "prepare", "org-cli", "join-cli",
    "--type", "join", "--decision", "approve", "--via", "ego",
    "--ego-task-space", "16", "--ego-page", "p1",
    "--message", "Ego同意", "--time", "2026-10-22", "--json",
  ], { env: cleanEgo.env })).stdout);
  assert.equal(preparedInEgo.data.status, "awaiting-user");
  assert.equal(preparedInEgo.data.submitted, false);
  assert.equal(preparedInEgo.data.ego.decisionAction, "opened-from-snapshot-ref");
  assert.equal(preparedInEgo.data.ego.messageAction, "filled");
  assert.equal(preparedInEgo.data.ego.externalWriteActions, 0);
  assert.equal(preparedInEgo.data.ego.finalSubmitActions, 0);
  const egoScript = await readFile(cleanEgo.scriptPath, "utf8");
  assert.match(egoScript, /task\.handOff\(\)/);
  assert.match(egoScript, /page\.snapshot\(/);
  for (const forbidden of [
    /page\.locator\(/,
    /page\.getByText\(/,
    /\.first\(\)/,
    /\.last\(\)/,
    /waitForTimeout\(/,
    /确认/,
  ]) assert.doesNotMatch(egoScript, forbidden);
  const cleanEvidence = JSON.parse(await readFile(cleanEgo.evidencePath, "utf8"));
  assert.equal(cleanEvidence.gotoCount, 1);
  assert.equal(cleanEvidence.snapshotCount >= 1, true);
  assert.deepEqual(cleanEvidence.clickSelectors, ["@7"]);
  assert.deepEqual(cleanEvidence.fillSelectors, ["textarea[data-friends-cli-approval-message]"]);
  assert.equal(cleanEvidence.inputEvents, 1);
  assert.equal(cleanEvidence.changeEvents, 1);
  assert.equal(cleanEvidence.dialogOpen, true);
  assert.equal(cleanEvidence.dialogTitle, "审批通过");
  assert.equal(cleanEvidence.waitForTimeoutCount, 0);
  assert.equal(cleanEvidence.externalWrites, 0);
  assert.equal(cleanEvidence.finalSubmitActions, 0);
  assert.equal(cleanEvidence.finalMessage, "Ego同意");

  const dirtyEgo = await egoFixture("dirty");
  const preserved = JSON.parse((await run([
    "organizations", "approvals", "prepare", "org-cli", "join-cli",
    "--type", "join", "--decision", "approve", "--via", "ego",
    "--ego-task-space", "16", "--ego-page", "p1",
    "--message", "脚本想覆盖", "--time", "2026-10-22", "--json",
  ], { env: dirtyEgo.env })).stdout);
  assert.equal(preserved.data.status, "awaiting-user");
  assert.equal(preserved.data.submitted, false);
  assert.equal(preserved.data.ego.decisionAction, "already-open");
  assert.equal(preserved.data.ego.messageAction, "human-value-preserved");
  const dirtyEvidence = JSON.parse(await readFile(dirtyEgo.evidencePath, "utf8"));
  assert.equal(dirtyEvidence.gotoCount, 0);
  assert.equal(dirtyEvidence.snapshotCount >= 1, true);
  assert.deepEqual(dirtyEvidence.clickSelectors, []);
  assert.deepEqual(dirtyEvidence.fillSelectors, []);
  assert.equal(dirtyEvidence.finalMessage, "用户正在审核的意见");
  assert.equal(dirtyEvidence.externalWrites, 0);
  assert.equal(dirtyEvidence.finalSubmitActions, 0);
  await rm(cleanEgo.root, { recursive: true, force: true });
  await rm(dirtyEgo.root, { recursive: true, force: true });
});
