import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createFriendsSdk, courseId, FriendsErrorCode } from "../dist/index.js";
import { readVerifiedEgoSession } from "../dist/node.js";

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

async function fakeEgo(root, token = "ego-fixture-token") {
  const path = join(root, "ego-browser");
  await writeFile(path, [
    "#!/bin/sh",
    "cat > \"$EGO_SCRIPT_LOG\"",
    `printf '%s\\n' 'FRIENDS_CLI_EGO_SESSION:{\"token\":\"${token}\",\"userLevel\":\"XS\"}'`,
    "",
  ].join("\n"));
  await chmod(path, 0o700);
  return path;
}

function controlledServer() {
  const requests = [];
  let mode = "normal";
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      requests.push({ method: req.method, url: req.url, headers: req.headers, body: body ? JSON.parse(body) : null });
      if (mode === "expired") return json(res, 401, {});
      if (mode === "denied") return json(res, 403, {});
      const account = mode === "other-account" ? "other-account" : "fixture-account";
      if (req.url.endsWith("/checkUserAndGetUserLevel")) {
        if (mode === "other-context") {
          json(res, 200, {
            code: "0",
            data: {
              loginLevels: [{
                levelNo: "XS",
                levelName: "学生",
                units: [{ unitType: 2, unitNo: "unit-b", unitName: "另一个学院" }],
              }],
              userLoginType: "STUDENT_UNACTIVATED",
            },
          });
          return;
        }
        return identity(res);
      }
      if (req.url.endsWith("/user/info")) {
        return json(res, 200, { code: "0", data: { userNo: account, userName: "示例" } });
      }
      if (req.url.endsWith("/enterHall")) {
        return json(res, 200, { code: "0", data: { account, name: "示例", userLoginStateLevel: "XS", departmentNo: "unit-a" } });
      }
      if (req.url.endsWith("student-apply-page-list")) {
        return json(res, 200, {
          code: "0",
          data: {
            currentPage: 2,
            pageSize: 1,
            totalCount: 2,
            pages: 2,
            data: [{ uuid: "course-2", curriculumName: "示例课程", curriculumState: "UNKNOWN" }],
          },
        });
      }
      return json(res, 200, { code: "0", data: { uuid: "course-2", curriculumName: "示例课程", roles: [], questionnaires: [] } });
    });
  });
  return {
    requests,
    server,
    get mode() { return mode; },
    set mode(value) { mode = value; },
  };
}

test("SDK queries directly with a verified Ego session and keeps the read boundary explicit", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "friends-ego-sdk-"));
  const ego = await fakeEgo(root);
  const scenario = controlledServer();
  t.after(async () => {
    scenario.server.closeAllConnections();
    scenario.server.close();
    await rm(root, { recursive: true, force: true });
  });
  await new Promise((resolve) => scenario.server.listen(0, "127.0.0.1", resolve));
  const sdk = createFriendsSdk({ baseUrl: `http://127.0.0.1:${scenario.server.address().port}/gateway` });
  const session = await readVerifiedEgoSession({
    taskSpaceId: 7,
    page: "p2",
    command: ego,
    timeoutMs: 1000,
    baseUrl: `http://127.0.0.1:${scenario.server.address().port}/gateway`,
  });
  const client = await sdk.createCourseClient(session);
  const page = await client.list({ page: 2, pageSize: 1 });
  const detail = await client.get(courseId(page.items[0].id));

  assert.equal(page.page, 2);
  assert.equal(page.totalCount, 2);
  assert.equal(page.hasMore, false);
  assert.equal(page.items[0].state.known, false);
  assert.equal(detail.id, "course-2");
  assert.ok(scenario.requests.every((request) => request.headers["h-zove-token"] === "ego-fixture-token"));
  assert.deepEqual(scenario.requests.map((request) => request.url), [
    "/gateway/ek-agg-mob/user/checkUserAndGetUserLevel",
    "/gateway/ek-agg-mob/user/info",
    "/gateway/ek-agg-mob/user/enterHall",
    "/gateway/ek-agg-mob/user/checkUserAndGetUserLevel",
    "/gateway/ek-agg-mob/user/info",
    "/gateway/ek-agg-mob/user/enterHall",
    "/gateway/zovecenter-saip-ek-app-curriculum/mob/apply/student-apply-page-list",
    "/gateway/zovecenter-saip-ek-app-curriculum/mob/apply/course-2",
  ]);
  assert.ok(scenario.requests.every(({ method, url }) => [
    ["POST", "/gateway/ek-agg-mob/user/checkUserAndGetUserLevel"],
    ["POST", "/gateway/ek-agg-mob/user/info"],
    ["POST", "/gateway/ek-agg-mob/user/enterHall"],
    ["POST", "/gateway/zovecenter-saip-ek-app-curriculum/mob/apply/student-apply-page-list"],
    ["GET", "/gateway/zovecenter-saip-ek-app-curriculum/mob/apply/course-2"],
  ].some(([allowedMethod, allowedUrl]) => `${method} ${url}` === `${allowedMethod} ${allowedUrl}`)));

  scenario.mode = "other-account";
  const before = scenario.requests.length;
  await assert.rejects(
    () => sdk.createCourseClient(session),
    (error) => error.code === FriendsErrorCode.AuthRequired && scenario.requests.length === before + 2,
  );
  scenario.mode = "denied";
  await assert.rejects(() => client.list(), (error) => error.code === FriendsErrorCode.PermissionDenied);
  scenario.mode = "expired";
  await assert.rejects(() => client.list(), (error) => error.code === FriendsErrorCode.AuthRequired);

  scenario.mode = "other-context";
  const queryRequests = scenario.requests.filter((request) => request.url.includes("/mob/apply/")).length;
  await assert.rejects(
    () => sdk.createCourseClient(session),
    (error) => error.code === FriendsErrorCode.InvalidInput &&
      scenario.requests.filter((request) => request.url.includes("/mob/apply/")).length === queryRequests,
  );
});

test("real CLI uses an Ego-selected query without reading local credentials", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "friends-ego-cli-"));
  const ego = await fakeEgo(root);
  const scenario = controlledServer();
  t.after(async () => {
    scenario.server.closeAllConnections();
    scenario.server.close();
    await rm(root, { recursive: true, force: true });
  });
  await new Promise((resolve) => scenario.server.listen(0, "127.0.0.1", resolve));
  const env = {
    ...process.env,
    PATH: `${root}:${process.env.PATH}`,
    EGO_SCRIPT_LOG: join(root, "ego-script.js"),
    FRIENDS_HOME: join(root, "must-not-exist"),
    FRIENDS_BASE_URL: `http://127.0.0.1:${scenario.server.address().port}/gateway`,
  };
  const cli = process.env.FRIENDS_TEST_CLI ?? resolve("dist/cli/main.js");
  const list = await run(process.execPath, [
    cli, "courses", "list", "--via", "ego", "--ego-task-space", "7",
    "--ego-page", "p2", "--page", "2", "--page-size", "1", "--json",
  ], { env });
  const listJson = JSON.parse(list.stdout);
  assert.equal(listJson.data.items[0].id, "course-2");
  assert.equal(listJson.meta.selectedEntry, "ego");
  assert.equal(listJson.meta.requestMode, "direct-api");
  assert.equal(listJson.meta.verification.identityAndContext, "school-api-verified");
  assert.equal(listJson.meta.verification.account.userNo, "fixture-account");
  assert.equal(listJson.meta.verification.context.unit.unitNo, "unit-a");
  assert.equal(JSON.stringify(listJson).includes("ego-fixture-token"), false);
  const script = await readFile(join(root, "ego-script.js"), "utf8");
  assert.match(script, /taskSpace\(7\)/);
  assert.match(script, /task\.page\("p2"\)/);
  assert.doesNotMatch(script, /page\.goto\(/);
  assert.doesNotMatch(script, /task\.handOff\(/);
  assert.doesNotMatch(script, /task\.waitForControl\(/);
  assert.doesNotMatch(script, /task\.finish/);

  const show = await run(process.execPath, [
    cli, "courses", "show", "course-2", "--via", "ego",
    "--ego-task-space", "7", "--ego-page", "p2", "--json",
  ], { env });
  const showJson = JSON.parse(show.stdout);
  assert.equal(showJson.data.id, "course-2");
  assert.equal(showJson.meta.selectedEntry, "ego");
  assert.equal(showJson.meta.requestMode, "direct-api");

  scenario.mode = "denied";
  await assert.rejects(
    () => run(process.execPath, [
      cli, "courses", "list", "--via", "ego", "--ego-task-space", "7",
      "--ego-page", "p2", "--json",
    ], { env }),
    (error) => error.code === 4 && JSON.parse(error.stdout).error.code === "PERMISSION_DENIED",
  );

  for (const args of [
    ["--via", "invalid"],
    ["--via", "ego"],
    ["--via", "api", "--ego-task-space", "7"],
    ["--via", "local"],
  ]) {
    await assert.rejects(
      () => run(process.execPath, [cli, "courses", "list", ...args, "--json"], { env }),
      (error) => error.code === 2 && JSON.parse(error.stdout).error.code === "INVALID_INPUT",
    );
  }
});

test("verified Ego queries require an existing school page and never navigate it", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "friends-ego-existing-"));
  const ready = join(root, "ego-ready");
  const readyLog = join(root, "ready.js");
  const missing = join(root, "ego-missing");
  const missingLog = join(root, "missing.js");
  await writeFile(ready, [
    "#!/bin/sh",
    `cat > ${readyLog}`,
    `printf '%s\\n' 'FRIENDS_CLI_EGO_SESSION:{\"token\":\"existing-token\",\"userLevel\":\"XS\"}'`,
    "",
  ].join("\n"));
  await writeFile(missing, [
    "#!/bin/sh",
    `cat > ${missingLog}`,
    "exit 0",
    "",
  ].join("\n"));
  await chmod(ready, 0o700);
  await chmod(missing, 0o700);
  const scenario = controlledServer();
  t.after(async () => {
    scenario.server.closeAllConnections();
    scenario.server.close();
    await rm(root, { recursive: true, force: true });
  });
  await new Promise((resolve) => scenario.server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${scenario.server.address().port}/gateway`;

  const session = await readVerifiedEgoSession({
    taskSpaceId: 9,
    page: "p3",
    command: ready,
    timeoutMs: 1000,
    baseUrl,
  });
  const script = await readFile(readyLog, "utf8");
  assert.equal(session.account.userNo, "fixture-account");
  assert.equal(session.context.unit.unitNo, "unit-a");
  assert.match(script, /NO_EXISTING_FRIENDS_SESSION/);
  assert.doesNotMatch(script, /page\.goto\(/);
  assert.doesNotMatch(script, /task\.handOff\(/);
  assert.doesNotMatch(script, /task\.waitForControl\(/);
  assert.doesNotMatch(script, /task\.finish/);

  await assert.rejects(
    () => readVerifiedEgoSession({
      taskSpaceId: 9,
      page: "p3",
      command: missing,
      timeoutMs: 1000,
      baseUrl,
    }),
    (error) => error.code === FriendsErrorCode.AuthRequired &&
      error.message === "No existing Ego friends session is ready",
  );
  const missingScript = await readFile(missingLog, "utf8");
  assert.doesNotMatch(missingScript, /page\.goto\(/);
  assert.doesNotMatch(missingScript, /task\.handOff\(/);
  assert.doesNotMatch(missingScript, /task\.waitForControl\(/);
  assert.doesNotMatch(missingScript, /task\.finish/);
});
