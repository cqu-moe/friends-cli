import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { saveSession } from "../dist/node.js";
import {
  courseRegistrationId,
  createFriendsSdk,
  FriendsErrorCode,
} from "../dist/index.js";

const execFileAsync = promisify(execFile);
const run = (file, args, options = {}) =>
  execFileAsync(file, args, { timeout: 20_000, ...options });

function json(res, body) {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function identity(res) {
  json(res, {
    code: "0",
    data: {
      loginLevels: [{
        levelNo: "XS",
        levelName: "学生",
        units: [{ unitType: 2, unitNo: "unit-a", unitName: "示例学院" }],
      }],
      userLoginType: "STUDENT",
    },
  });
}

test("SDK lists personal course registrations with pagination and upstream filters", async (t) => {
  const requests = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      requests.push({ method: req.method, url: req.url, body: body ? JSON.parse(body) : null });
      if (req.url.endsWith("/checkUserAndGetUserLevel")) return identity(res);
      if (req.url.endsWith("/user/info")) {
        return json(res, { code: "0", data: { userNo: "fixture-account", userName: "示例" } });
      }
      if (req.url.endsWith("/enterHall")) {
        return json(res, {
          code: "0",
          data: {
            account: "fixture-account",
            name: "示例",
            userLoginStateLevel: "XS",
            departmentNo: "unit-a",
          },
        });
      }
      if (req.url.endsWith("/apply/my-applied-page-list")) {
        return json(res, {
          code: "0",
          data: {
            currentPage: 2,
            pageSize: 2,
            totalCount: 3,
            pages: 2,
            data: [{
              uuid: "course-fixture",
              curriculumName: "示例课程",
              organizationName: "示例学院",
              beginTime: "2026-11-01 10:00",
              endTime: "2026-11-01 12:00",
              studentApplied: {
                uuid: "registration-fixture",
                studentNo: "fixture-account",
                flowOverallState: 3,
                flowCurrMsg: "等待学院审核",
                flowNextNodeOperateRole: "XY01",
              },
            }],
          },
        });
      }
      res.writeHead(404);
      res.end("{}");
    });
  });
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const sdk = createFriendsSdk({ baseUrl: `http://127.0.0.1:${server.address().port}/gateway` });
  const client = await sdk.createCourseParticipationClient({
    token: "fixture-token",
    userLevel: "XS",
    account: { userNo: "fixture-account" },
    context: { levelNo: "XS", unit: { unitNo: "unit-a" } },
  });

  const page = await client.listMyRegistrations({ page: 2, pageSize: 2, keyword: "示例" });

  assert.equal(page.page, 2);
  assert.equal(page.pageSize, 2);
  assert.equal(page.totalCount, 3);
  assert.equal(page.hasMore, false);
  assert.equal(page.items[0].courseId, "course-fixture");
  assert.equal(page.items[0].courseName, "示例课程");
  assert.equal(page.items[0].registration.id, "registration-fixture");
  assert.equal(page.items[0].registration.state.known, false);
  assert.equal(page.items[0].registration.state.flowOverallState, 3);
  assert.equal(page.items[0].registration.state.message, "等待学院审核");
  assert.equal(JSON.stringify(page).includes("fixture-account"), false);
  assert.equal(requests.at(-1).url, "/gateway/zovecenter-saip-ek-app-curriculum/mob/apply/my-applied-page-list");
  assert.equal(requests.at(-1).body.currentPage, 2);
  assert.equal(requests.at(-1).body.pageSize, 2);
  assert.equal(requests.at(-1).body.key, "示例");
  assert.equal(requests.at(-1).body.classNo, "");
  assert.equal(requests.at(-1).body.isInstructor, false);

  assert.throws(
    () => courseRegistrationId("not/a-registration-id"),
    (error) => error.code === FriendsErrorCode.InvalidInput && error.message === "Invalid course registration ID",
  );
});

test("SDK prepares course applies from detail without probing or writing", async (t) => {
  const requests = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      requests.push({ method: req.method, url: req.url, body: body ? JSON.parse(body) : null });
      if (req.url.endsWith("/checkUserAndGetUserLevel")) return identity(res);
      if (req.url.endsWith("/user/info")) {
        return json(res, { code: "0", data: { userNo: "fixture-account", userName: "示例" } });
      }
      if (req.url.endsWith("/enterHall")) {
        return json(res, {
          code: "0",
          data: {
            account: "fixture-account",
            name: "示例",
            userLoginStateLevel: "XS",
            departmentNo: "unit-a",
          },
        });
      }
      if (req.url.endsWith("/apply/course-fixture")) {
        return json(res, {
          code: "0",
          data: {
            uuid: "course-fixture",
            curriculumName: "无问卷课程",
            isEnroll: true,
            openTime: "2026-10-01 10:00",
            deadline: "2026-10-30 12:00",
            studentApplied: null,
            roles: [],
            questionnaires: [],
          },
        });
      }
      if (req.url.endsWith("/apply/course-role")) {
        return json(res, {
          code: "0",
          data: {
            uuid: "course-role",
            curriculumName: "角色课程",
            isEnroll: true,
            studentApplied: null,
            roles: [{
              uuid: "role-fixture",
              roleName: "参与者",
              integral: 0.5,
              classHour: 2,
            }],
            questionnaires: [],
          },
        });
      }
      if (req.url.endsWith("/apply/course-questionnaire")) {
        return json(res, {
          code: "0",
          data: {
            uuid: "course-questionnaire",
            curriculumName: "问卷课程",
            isEnroll: true,
            studentApplied: null,
            roles: [],
            questionnaires: [{ title: "联系方式" }],
          },
        });
      }
      res.writeHead(404);
      res.end("{}");
    });
  });
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const sdk = createFriendsSdk({ baseUrl: `http://127.0.0.1:${server.address().port}/gateway` });
  const client = await sdk.createCourseParticipationClient({
    token: "fixture-token",
    userLevel: "XS",
    account: { userNo: "fixture-account" },
    context: { levelNo: "XS", unit: { unitNo: "unit-a" } },
  });

  const prepared = await client.prepareApply("course-fixture");
  const rolePrepared = await client.prepareApply("course-role", { roleId: "role-fixture" });

  assert.equal(prepared.submitted, false);
  assert.equal(prepared.course.id, "course-fixture");
  assert.equal(prepared.course.name, "无问卷课程");
  assert.deepEqual(prepared.payload, {
    curriculumId: "course-fixture",
    questionnaireResult: null,
    studentNo: "fixture-account",
    uuid: null,
  });
  assert.deepEqual(rolePrepared.payload, {
    curriculumId: "course-role",
    questionnaireResult: null,
    studentNo: "fixture-account",
    uuid: null,
    roleId: "role-fixture",
    roleName: "参与者",
    roleClassHour: 2,
    roleIntegral: 0.5,
  });
  await assert.rejects(
    () => client.prepareApply("course-role"),
    (error) => error.code === FriendsErrorCode.InvalidInput &&
      error.message === "This course requires an explicit roleId from course detail",
  );
  await assert.rejects(
    () => client.prepareApply("course-questionnaire"),
    (error) => error.code === FriendsErrorCode.UpstreamBusiness &&
      error.message === "This course has a questionnaire; submit it through the reviewed school flow",
  );
  assert.deepEqual(
    requests.map((request) => `${request.method} ${request.url}`).filter((value) =>
      value.includes("/mob/apply/") || value.includes("/mob/student-apply/"),
    ),
    [
      "GET /gateway/zovecenter-saip-ek-app-curriculum/mob/apply/course-fixture",
      "GET /gateway/zovecenter-saip-ek-app-curriculum/mob/apply/course-role",
      "GET /gateway/zovecenter-saip-ek-app-curriculum/mob/apply/course-role",
      "GET /gateway/zovecenter-saip-ek-app-curriculum/mob/apply/course-questionnaire",
    ],
  );
});

test("SDK applies explicitly, follows up read-only, and never repeats unknown writes", async (t) => {
  const requests = [];
  let mode = "normal";
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      requests.push({ method: req.method, url: req.url, body: body ? JSON.parse(body) : null });
      if (req.url.endsWith("/checkUserAndGetUserLevel")) return identity(res);
      if (req.url.endsWith("/user/info")) {
        return json(res, { code: "0", data: { userNo: "fixture-account", userName: "示例" } });
      }
      if (req.url.endsWith("/enterHall")) {
        return json(res, {
          code: "0",
          data: {
            account: "fixture-account",
            name: "示例",
            userLoginStateLevel: "XS",
            departmentNo: "unit-a",
          },
        });
      }
      if (req.url.endsWith("/apply/course-fixture")) {
        return json(res, {
          code: "0",
          data: {
            uuid: "course-fixture",
            curriculumName: "示例课程",
            isEnroll: true,
            studentApplied: null,
            roles: [],
            questionnaires: [],
          },
        });
      }
      if (req.url.endsWith("/student-apply/apply")) {
        if (mode === "business") {
          return json(res, { code: "10020", message: "已报名", requestId: "request-apply" });
        }
        if (mode === "unknown") {
          res.writeHead(200, { "content-type": "text/plain" });
          res.end("accepted but response was lost");
          return;
        }
        return json(res, { code: "0", message: "报名成功", data: null });
      }
      if (req.url.endsWith("/apply/my-applied-page-list")) {
        return json(res, {
          code: "0",
          data: {
            currentPage: 1,
            pageSize: 20,
            totalCount: 1,
            pages: 1,
            data: [{
              uuid: "course-fixture",
              curriculumName: "示例课程",
              studentApplied: {
                uuid: "registration-fixture",
                flowOverallState: 3,
                flowCurrMsg: "等待学院审核",
                flowNextNodeOperateRole: "XY01",
              },
            }],
          },
        });
      }
      res.writeHead(404);
      res.end("{}");
    });
  });
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const sdk = createFriendsSdk({ baseUrl: `http://127.0.0.1:${server.address().port}/gateway` });
  const client = await sdk.createCourseParticipationClient({
    token: "fixture-token",
    userLevel: "XS",
    account: { userNo: "fixture-account" },
    context: { levelNo: "XS", unit: { unitNo: "unit-a" } },
  });

  await assert.rejects(
    () => client.apply({ courseId: "course-fixture" }),
    (error) => error.code === FriendsErrorCode.InvalidInput &&
      error.message === "confirm must be exactly \"apply\"",
  );
  assert.deepEqual(
    requests.map((request) => `${request.method} ${request.url}`),
    [
      "POST /gateway/ek-agg-mob/user/checkUserAndGetUserLevel",
      "POST /gateway/ek-agg-mob/user/info",
      "POST /gateway/ek-agg-mob/user/enterHall",
    ],
  );

  const accepted = await client.apply({
    courseId: "course-fixture",
    confirm: "apply",
  });
  assert.equal(accepted.submitted, true);
  assert.equal(accepted.message, "报名成功");
  assert.equal(accepted.registration.id, "registration-fixture");
  assert.equal(accepted.registration.state.message, "等待学院审核");

  mode = "business";
  await assert.rejects(
    () => client.apply({ courseId: "course-fixture", confirm: "apply" }),
    (error) => error.code === FriendsErrorCode.UpstreamBusiness &&
      error.upstreamCode === "10020" &&
      error.requestId === "request-apply",
  );

  mode = "unknown";
  requests.length = 0;
  await assert.rejects(
    () => client.apply({ courseId: "course-fixture", confirm: "apply" }),
    (error) => {
      assert.equal(error.code, FriendsErrorCode.UnknownOutcome);
      assert.equal(error.retryable, false);
      assert.equal(error.message, "Course apply outcome is unknown; inspect read-only results before any human retry");
      assert.deepEqual(error.recovery, {
        operation: "courses.registrations.apply",
        courseId: "course-fixture",
        registrationId: "registration-fixture",
        completed: ["read-only-follow-up"],
      });
      return true;
    },
  );
  const writeRequests = requests.filter((request) =>
    request.url.endsWith("/student-apply/apply"),
  );
  assert.equal(writeRequests.length, 1);
  assert.deepEqual(writeRequests[0].body, {
    curriculumId: "course-fixture",
    questionnaireResult: null,
    studentNo: "fixture-account",
    uuid: null,
  });
  assert.equal(
    requests.filter((request) => request.url.endsWith("/apply/my-applied-page-list")).length,
    1,
  );
});

test("SDK withdraws and exits registrations by business effect without unsafe retries", async (t) => {
  const requests = [];
  let listRegistration = true;
  let outcome = "success";
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      requests.push({ method: req.method, url: req.url, body: body ? JSON.parse(body) : null });
      if (req.url.endsWith("/checkUserAndGetUserLevel")) return identity(res);
      if (req.url.endsWith("/user/info")) {
        return json(res, { code: "0", data: { userNo: "fixture-account", userName: "示例" } });
      }
      if (req.url.endsWith("/enterHall")) {
        return json(res, {
          code: "0",
          data: {
            account: "fixture-account",
            name: "示例",
            userLoginStateLevel: "XS",
            departmentNo: "unit-a",
          },
        });
      }
      if (req.url.endsWith("/apply/my-applied-page-list")) {
        return json(res, {
          code: "0",
          data: {
            currentPage: 1,
            pageSize: 20,
            totalCount: listRegistration ? 1 : 0,
            pages: 1,
            data: listRegistration
              ? [{
                  uuid: "course-fixture",
                  curriculumName: "示例课程",
                  studentApplied: {
                    uuid: "registration-fixture",
                    flowOverallState: 3,
                    flowCurrMsg: "等待学院审核",
                    flowNextNodeOperateRole: "XY01",
                  },
                }]
              : [],
          },
        });
      }
      if (req.method === "GET" && req.url.endsWith("/student-apply/registration-fixture")) {
        if (outcome === "business") {
          return json(res, { code: "10030", message: "状态不允许撤销", requestId: "request-withdraw" });
        }
        if (outcome === "unknown") {
          res.writeHead(200, { "content-type": "text/plain" });
          res.end("withdraw response was lost");
          return;
        }
        listRegistration = false;
        return json(res, { code: "0", message: "撤销成功", data: null });
      }
      if (req.method === "DELETE" && req.url.endsWith("/student-apply/quit/registration-fixture")) {
        if (outcome === "business") {
          return json(res, { code: "10030", message: "状态不允许退出", requestId: "request-exit" });
        }
        if (outcome === "unknown") {
          res.writeHead(200, { "content-type": "text/plain" });
          res.end("exit response was lost");
          return;
        }
        listRegistration = false;
        return json(res, { code: "0", message: "退出成功", data: null });
      }
      res.writeHead(404);
      res.end("{}");
    });
  });
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const sdk = createFriendsSdk({ baseUrl: `http://127.0.0.1:${server.address().port}/gateway` });
  const client = await sdk.createCourseParticipationClient({
    token: "fixture-token",
    userLevel: "XS",
    account: { userNo: "fixture-account" },
    context: { levelNo: "XS", unit: { unitNo: "unit-a" } },
  });

  for (const operation of ["withdraw", "exit"]) {
    listRegistration = true;
    outcome = "success";
    requests.length = 0;
    await assert.rejects(
      () => client[operation]({ registrationId: "registration-fixture" }),
      (error) => error.code === FriendsErrorCode.InvalidInput &&
        error.message === `confirm must be exactly "${operation}"`,
    );
    assert.equal(requests.length, 0);

    const removed = await client[operation]({
      registrationId: "registration-fixture",
      confirm: operation,
    });
    assert.equal(removed.submitted, true);
    assert.equal(removed.message, operation === "withdraw" ? "撤销成功" : "退出成功");
    assert.equal(removed.stillListed, false);
    assert.deepEqual(
      requests.map((request) => `${request.method} ${request.url}`),
      [
        "POST /gateway/zovecenter-saip-ek-app-curriculum/mob/apply/my-applied-page-list",
        operation === "withdraw"
          ? "GET /gateway/zovecenter-saip-ek-app-curriculum/mob/student-apply/registration-fixture"
          : "DELETE /gateway/zovecenter-saip-ek-app-curriculum/mob/student-apply/quit/registration-fixture",
        "POST /gateway/zovecenter-saip-ek-app-curriculum/mob/apply/my-applied-page-list",
      ],
    );

    outcome = "business";
    listRegistration = true;
    requests.length = 0;
    await assert.rejects(
      () => client[operation]({ registrationId: "registration-fixture", confirm: operation }),
      (error) => error.code === FriendsErrorCode.UpstreamBusiness &&
        error.upstreamCode === "10030" &&
        error.requestId === `request-${operation}`,
    );
    assert.equal(requests.filter((request) => request.url.includes("/student-apply/")).length, 1);

    outcome = "unknown";
    listRegistration = true;
    requests.length = 0;
    await assert.rejects(
      () => client[operation]({ registrationId: "registration-fixture", confirm: operation }),
      (error) => {
        assert.equal(error.code, FriendsErrorCode.UnknownOutcome);
        assert.equal(error.retryable, false);
        assert.deepEqual(error.recovery, {
          operation: `courses.registrations.${operation}`,
          registrationId: "registration-fixture",
          completed: ["read-only-follow-up"],
        });
        return true;
      },
    );
    assert.equal(
      requests.filter((request) => request.url.includes("/student-apply/")).length,
      1,
    );
    assert.equal(
      requests.filter((request) => request.url.endsWith("/apply/my-applied-page-list")).length,
      2,
    );
  }
});

test("real CLI covers course registration records, dry-run, explicit writes, and Ego boundaries", async (t) => {
  const requests = [];
  let mode = "normal";
  let listRegistration = true;
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      requests.push({ method: req.method, url: req.url, body: body ? JSON.parse(body) : null });
      if (mode === "denied") {
        res.writeHead(403);
        res.end("{}");
        return;
      }
      if (req.url.endsWith("/checkUserAndGetUserLevel")) return identity(res);
      if (req.url.endsWith("/user/info")) {
        return json(res, { code: "0", data: { userNo: "fixture-account", userName: "示例" } });
      }
      if (req.url.endsWith("/enterHall")) {
        return json(res, {
          code: "0",
          data: {
            account: "fixture-account",
            name: "示例",
            userLoginStateLevel: "XS",
            departmentNo: "unit-a",
          },
        });
      }
      if (req.url.endsWith("/apply/course-fixture")) {
        return json(res, {
          code: "0",
          data: {
            uuid: "course-fixture",
            curriculumName: "示例课程",
            isEnroll: true,
            openTime: "2026-10-01 10:00",
            deadline: "2026-10-30 12:00",
            studentApplied: null,
            roles: [],
            questionnaires: [],
          },
        });
      }
      if (req.url.endsWith("/apply/my-applied-page-list")) {
        return json(res, {
          code: "0",
          data: {
            currentPage: Number(req.body?.currentPage ?? 1),
            pageSize: 20,
            totalCount: listRegistration ? 1 : 0,
            pages: 1,
            data: listRegistration
              ? [{
                  uuid: "course-fixture",
                  curriculumName: "示例课程",
                  studentApplied: {
                    uuid: "registration-fixture",
                    flowOverallState: 3,
                    flowCurrMsg: "等待学院审核",
                    flowNextNodeOperateRole: "XY01",
                  },
                }]
              : [],
          },
        });
      }
      if (req.url.endsWith("/student-apply/apply")) {
        if (mode === "business") {
          return json(res, { code: "10020", message: "已报名", requestId: "request-cli" });
        }
        if (mode === "unknown") {
          res.writeHead(200, { "content-type": "text/plain" });
          res.end("response lost");
          return;
        }
        listRegistration = true;
        return json(res, { code: "0", message: "报名成功", data: null });
      }
      if (req.method === "GET" && req.url.endsWith("/student-apply/registration-fixture")) {
        listRegistration = false;
        return json(res, { code: "0", message: "撤销成功", data: null });
      }
      if (req.method === "DELETE" && req.url.endsWith("/student-apply/quit/registration-fixture")) {
        listRegistration = false;
        return json(res, { code: "0", message: "退出成功", data: null });
      }
      res.writeHead(404);
      res.end("{}");
    });
  });
  t.after(async () => {
    server.closeAllConnections();
    server.close();
    await rm(join(tmpdir(), "friends-course-cli-ready"), { recursive: true, force: true }).catch(() => {});
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const home = join(tmpdir(), "friends-course-cli-ready");
  await rm(home, { recursive: true, force: true });
  await mkdir(home, { recursive: true, mode: 0o700 });
  const previousHome = process.env.FRIENDS_HOME;
  process.env.FRIENDS_HOME = home;
  await saveSession({
    schemaVersion: 1,
    loginMethod: "local",
    storage: "file",
    token: "fixture-token",
    userLevel: "XS",
    account: { userNo: "fixture-account", userName: "示例" },
    context: {
      levelNo: "XS",
      levelName: "学生",
      unit: { unitType: 2, unitNo: "unit-a", unitName: "示例学院" },
    },
  }, "file");
  if (previousHome === undefined) delete process.env.FRIENDS_HOME;
  else process.env.FRIENDS_HOME = previousHome;
  const egoRoot = join(home, "ego");
  await mkdir(egoRoot, { recursive: true, mode: 0o700 });
  const egoBin = join(egoRoot, "ego-browser");
  const egoLog = join(egoRoot, "script.js");
  await writeFile(egoBin, [
    "#!/bin/sh",
    `cat > ${egoLog}`,
    `printf '%s\\n' 'FRIENDS_CLI_EGO_SESSION:{\"token\":\"ego-fixture-token\",\"userLevel\":\"XS\"}'`,
    "",
  ].join("\n"));
  await chmod(egoBin, 0o700);
  const env = {
    ...process.env,
    FRIENDS_HOME: home,
    FRIENDS_BASE_URL: `http://127.0.0.1:${server.address().port}/gateway`,
  };
  const egoEnv = {
    ...env,
    PATH: `${egoRoot}:${env.PATH}`,
    EGO_SCRIPT_LOG: egoLog,
  };
  const cli = resolve("dist/cli/main.js");

  const help = await run(process.execPath, [cli, "courses", "registrations", "--help"], { env });
  assert.match(help.stdout, /Usage: friends courses registrations/);
  assert.match(help.stdout, /\b(list|show|apply|withdraw|exit)\b/);
  const listSchema = JSON.parse((await run(process.execPath, [
    cli, "schema", "courses.registrations.list", "--json",
  ], { env })).stdout);
  assert.equal(listSchema.data.readonly, true);
  assert.deepEqual(listSchema.data.supportedVia, ["api", "ego"]);
  const withdrawSchema = JSON.parse((await run(process.execPath, [
    cli, "schema", "courses.registrations.withdraw", "--json",
  ], { env })).stdout);
  assert.equal(withdrawSchema.data.readonly, false);
  assert.equal(withdrawSchema.data.httpMethod, "GET");
  assert.equal(withdrawSchema.data.businessEffect, "withdraw registration");
  assert.equal(withdrawSchema.data.supportedVia.length, 1);
  assert.equal(withdrawSchema.data.supportedVia[0], "api");

  const listed = JSON.parse((await run(process.execPath, [
    cli, "courses", "registrations", "list", "--page", "1", "--page-size", "2",
    "--keyword", "示例", "--json",
  ], { env })).stdout);
  assert.equal(listed.data.items[0].registration.id, "registration-fixture");
  assert.equal(listed.data.items[0].registration.state.message, "等待学院审核");
  assert.equal(listed.meta.selectedEntry, "api");
  assert.equal(listed.meta.requestMode, "direct-api");
  assert.equal(JSON.stringify(listed.data).includes("fixture-account"), false);

  const shown = JSON.parse((await run(process.execPath, [
    cli, "courses", "registrations", "show", "registration-fixture", "--json",
  ], { env })).stdout);
  assert.equal(shown.data.registration.id, "registration-fixture");

  const dryRun = JSON.parse((await run(process.execPath, [
    cli, "courses", "registrations", "apply", "course-fixture", "--dry-run",
    "--via", "ego", "--ego-task-space", "8", "--ego-page", "p4", "--json",
  ], { env: egoEnv })).stdout);
  assert.equal(dryRun.data.submitted, false);
  assert.equal(dryRun.data.payload.curriculumId, "course-fixture");
  assert.equal(dryRun.meta.selectedEntry, "ego");
  assert.equal(dryRun.meta.verification.remoteWrites, 0);
  const egoScript = await readFile(egoLog, "utf8");
  assert.doesNotMatch(egoScript, /page\.goto\(/);
  assert.doesNotMatch(egoScript, /task\.handOff\(/);
  assert.doesNotMatch(egoScript, /task\.finish/);
  assert.equal(
    requests.some((request) => request.url.includes("student-apply/can-apply")),
    false,
  );

  for (const args of [
    ["apply", "course-fixture"],
    ["withdraw", "registration-fixture"],
    ["exit", "registration-fixture"],
  ]) {
    const before = requests.length;
    await assert.rejects(
      () => run(process.execPath, [cli, "courses", "registrations", ...args, "--json"], {
        env: { ...env, FRIENDS_HOME: join(home, "must-not-read") },
      }),
      (error) => error.code === 2 && JSON.parse(error.stdout).error.code === "INVALID_INPUT" &&
        requests.length === before,
    );
  }
  await assert.rejects(
    () => run(process.execPath, [
      cli, "courses", "registrations", "apply", "course-fixture",
      "--via", "ego", "--ego-task-space", "8", "--confirm", "apply", "--json",
    ], { env: egoEnv }),
    (error) => error.code === 2 &&
      JSON.parse(error.stdout).error.message === "Course registration writes require --via api; Ego final submission is human-only",
  );

  listRegistration = false;
  const applied = JSON.parse((await run(process.execPath, [
    cli, "courses", "registrations", "apply", "course-fixture", "--confirm", "apply", "--json",
  ], { env })).stdout);
  assert.equal(applied.data.submitted, true);
  assert.equal(applied.data.registration.id, "registration-fixture");
  assert.equal(applied.meta.selectedEntry, "api");

  mode = "unknown";
  listRegistration = true;
  await assert.rejects(
    () => run(process.execPath, [
      cli, "courses", "registrations", "apply", "course-fixture", "--confirm", "apply", "--json",
    ], { env }),
    (error) => {
      assert.equal(error.code, 7);
      const output = JSON.parse(error.stdout);
      assert.equal(output.error.code, "UNKNOWN_OUTCOME");
      assert.equal(output.error.retryable, false);
      assert.deepEqual(output.error.recovery, {
        operation: "courses.registrations.apply",
        courseId: "course-fixture",
        registrationId: "registration-fixture",
        completed: ["read-only-follow-up"],
      });
      assert.match(output.error.nextAction, /registrations list/);
      assert.ok(error.stderr.trim());
      return true;
    },
  );
  assert.equal(
    requests.filter((request) => request.url.endsWith("/student-apply/apply")).length,
    2,
  );

  mode = "normal";
  const withdrawn = JSON.parse((await run(process.execPath, [
    cli, "courses", "registrations", "withdraw", "registration-fixture", "--confirm", "withdraw", "--json",
  ], { env })).stdout);
  assert.equal(withdrawn.data.message, "撤销成功");
  assert.equal(withdrawn.data.stillListed, false);

  listRegistration = true;
  const exited = JSON.parse((await run(process.execPath, [
    cli, "courses", "registrations", "exit", "registration-fixture", "--confirm", "exit", "--json",
  ], { env })).stdout);
  assert.equal(exited.data.message, "退出成功");
  assert.equal(exited.data.stillListed, false);

  const beforeInvalid = requests.length;
  for (const args of [
    ["show", "not/a-registration-id"],
    ["withdraw", "not/a-registration-id", "--confirm", "withdraw"],
    ["exit", "not/a-registration-id", "--confirm", "exit"],
  ]) {
    await assert.rejects(
      () => run(process.execPath, [cli, "courses", "registrations", ...args, "--json"], {
        env: { ...env, FRIENDS_HOME: join(home, "must-not-read") },
      }),
      (error) => error.code === 2 && requests.length === beforeInvalid,
    );
  }

  const writesBeforeDomainCheck = requests.filter((request) =>
    request.url.includes("/mob/student-apply/"),
  ).length;
  for (const operation of ["withdraw", "exit"]) {
    await assert.rejects(
      () => run(process.execPath, [
        cli, "courses", "registrations", operation, "course-fixture",
        "--confirm", operation, "--json",
      ], { env }),
      (error) => error.code === 5,
    );
  }
  assert.equal(
    requests.filter((request) => request.url.includes("/mob/student-apply/")).length,
    writesBeforeDomainCheck,
  );

  mode = "denied";
  await assert.rejects(
    () => run(process.execPath, [
      cli, "courses", "registrations", "list", "--json",
    ], { env }),
    (error) => error.code === 4 && JSON.parse(error.stdout).error.code === "PERMISSION_DENIED",
  );
  mode = "business";
  listRegistration = false;
  await assert.rejects(
    () => run(process.execPath, [
      cli, "courses", "registrations", "apply", "course-fixture", "--confirm", "apply", "--json",
    ], { env }),
    (error) => error.code === 5 &&
      JSON.parse(error.stdout).error.upstreamCode === "10020",
  );
});
