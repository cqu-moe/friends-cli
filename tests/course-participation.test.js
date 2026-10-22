import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { basename, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { prepareCourseRegistrationInEgo, saveSession } from "../dist/node.js";
import {
  courseRegistrationId,
  createFriendsSdk,
  FriendsErrorCode,
} from "../dist/index.js";

const execFileAsync = promisify(execFile);
const run = (file, args, options = {}) =>
  execFileAsync(file, args, { timeout: 20_000, ...options });

function runWithStdin(file, args, input, options = {}) {
  return new Promise((resolveTest, rejectTest) => {
    const child = spawn(file, args, { ...options, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), 20_000);
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      rejectTest(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const error = code === 0 ? null : new Error(`Command failed: ${file} ${args.join(" ")}\n${stderr}`);
      if (error) {
        error.code = code;
        error.signal = signal;
        error.stdout = stdout;
        error.stderr = stderr;
        rejectTest(error);
      } else {
        resolveTest({ stdout, stderr });
      }
    });
    child.stdin.end(input);
  });
}

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
      if (req.url.endsWith("/apply/approve-detail/course-fixture")) {
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
      if (req.url.endsWith("/apply/approve-detail/course-role")) {
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
              classHour: 2,
              integral: 0.5,
            }],
            questionnaires: [],
          },
        });
      }
      if (req.url.endsWith("/apply/approve-detail/course-questionnaire")) {
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
      error.message === "The course questionnaire contract is unknown",
  );
  assert.deepEqual(
    requests.map((request) => `${request.method} ${request.url}`).filter((value) =>
      value.includes("/mob/apply/") || value.includes("/mob/student-apply/"),
    ),
    [
      "GET /gateway/zovecenter-saip-ek-app-curriculum/mob/apply/approve-detail/course-fixture",
      "GET /gateway/zovecenter-saip-ek-app-curriculum/mob/apply/approve-detail/course-role",
      "GET /gateway/zovecenter-saip-ek-app-curriculum/mob/apply/approve-detail/course-role",
      "GET /gateway/zovecenter-saip-ek-app-curriculum/mob/apply/approve-detail/course-questionnaire",
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
      if (req.url.endsWith("/apply/approve-detail/course-fixture")) {
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
        "POST /gateway/ek-agg-mob/user/checkUserAndGetUserLevel",
        "POST /gateway/ek-agg-mob/user/info",
        "POST /gateway/ek-agg-mob/user/enterHall",
        "POST /gateway/zovecenter-saip-ek-app-curriculum/mob/apply/my-applied-page-list",
        "POST /gateway/ek-agg-mob/user/checkUserAndGetUserLevel",
        "POST /gateway/ek-agg-mob/user/info",
        "POST /gateway/ek-agg-mob/user/enterHall",
        operation === "withdraw"
          ? "GET /gateway/zovecenter-saip-ek-app-curriculum/mob/student-apply/registration-fixture"
          : "DELETE /gateway/zovecenter-saip-ek-app-curriculum/mob/student-apply/quit/registration-fixture",
        "POST /gateway/ek-agg-mob/user/checkUserAndGetUserLevel",
        "POST /gateway/ek-agg-mob/user/info",
        "POST /gateway/ek-agg-mob/user/enterHall",
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
  let uploadCount = 0;
  const server = createServer((req, res) => {
    let body = [];
    req.on("data", (chunk) => body.push(chunk));
    req.on("end", async () => {
      const rawBody = Buffer.concat(body);
      let parsedBody = null;
      if (req.headers["content-type"]?.startsWith("multipart/form-data")) {
        const form = await new Request("http://fixture.test" + req.url, {
          method: req.method,
          headers: req.headers,
          body: rawBody,
        }).formData();
        parsedBody = {
          groupId: form.get("groupId"),
          filename: form.get("files")?.name,
          type: form.get("files")?.type,
        };
      } else if (rawBody.length > 0) {
        parsedBody = JSON.parse(rawBody.toString("utf8"));
      }
      requests.push({ method: req.method, url: req.url, contentType: req.headers["content-type"], body: parsedBody });
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
      if (req.url.endsWith("/apply/approve-detail/course-fixture")) {
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
      if (req.url.endsWith("/apply/approve-detail/course-role")) {
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
              classHour: 2,
              integral: 0.5,
            }],
            questionnaires: [],
          },
        });
      }
      if (req.url.endsWith("/apply/approve-detail/course-questionnaire")) {
        return json(res, {
          code: "0",
          data: {
            uuid: "course-questionnaire",
            curriculumName: "问卷课程",
            isEnroll: true,
            studentApplied: null,
            roles: [],
            questionnaires: [{ uuid: "question-text", title: "备注", itemType: "TEXT", isMandatory: true }],
          },
        });
      }
      if (req.url.endsWith("/apply/approve-detail/course-attachment")) {
        return json(res, {
          code: "0",
          data: {
            uuid: "course-attachment",
            curriculumName: "附件课程",
            isEnroll: true,
            studentApplied: null,
            roles: [],
            questionnaires: [
              { uuid: "question-image", title: "活动照片", itemType: "PICTURE", isMandatory: true },
              { uuid: "question-images", title: "多张照片", itemType: "MULTIPLE_PICTURE", isMandatory: true },
              { uuid: "question-file", title: "证明材料", itemType: "FILE", isMandatory: true },
              { uuid: "question-files", title: "多份证明", itemType: "MULTIPLE_FILE", isMandatory: true },
            ],
          },
        });
      }
      if (req.method === "POST" && req.url === "/gateway/ek-agg-mob/biz-common/protected-file-upload" &&
        req.headers["h-zove-appkey"] === "zovecenter-saip-ek-agg-mob") {
        uploadCount += 1;
        if (mode === "upload-unknown" && uploadCount === 2) { res.writeHead(200, { "content-type": "text/plain" }); res.end("receipt lost"); return; }
        return json(res, { code: "0", data: [`cli-resource-${uploadCount}`] });
      }
      if (req.method === "POST" && new URL(req.url, "http://fixture.test").pathname === "/gateway/ek-agg-mob/biz-common/list-group-resource" &&
        req.headers["h-zove-appkey"] === "zovecenter-saip-ek-agg-mob") {
        return json(res, {
          code: "0",
          data: Array.from({ length: uploadCount }, (_, index) => ({
            uuid: `cli-resource-${index + 1}`,
            title: `fixture-${index + 1}`,
            fileExtension: ".pdf",
          })),
        });
      }
      if (req.url.endsWith("/apply/my-applied-page-list")) {
        if (mode === "readback-failed") {
          res.writeHead(500);
          res.end("{}");
          return;
        }
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
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const home = await mkdtemp(join(tmpdir(), "friends-course-cli-"));
  t.after(() => rm(home, { recursive: true, force: true }));
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
  const egoResult = join(egoRoot, "result.json");
  const egoConfig = join(egoRoot, "config.json");
  const sourceForm = (name, contents = "") => `<div class="app-container"><div class="activity-info"><div class="van-cell"><span class="van-cell__title">课程名称</span><span class="van-cell__value">${name}</span></div></div><div class="report-info-set">${contents}</div><div class="footer"><button>申请加入</button></div></div>`;
  const setEgoPage = async (id, name, contents = "", extra = {}) => writeFile(egoConfig, JSON.stringify({
    url: `http://127.0.0.1:${server.address().port}/mobile/course/stuCourseDetail?uuid=${id}&type=Apply`,
    html: sourceForm(name, contents), result: egoResult, page: "p4", gateway: `http://127.0.0.1:${server.address().port}/gateway`, ...extra,
  }));
  await setEgoPage("course-fixture", "示例课程");
  await writeFile(egoBin, `#!/bin/sh\nexec '${process.execPath}' '${resolve("tests/fixtures/course-participation-ego.mjs")}'\n`);
  await chmod(egoBin, 0o700);
  const questionnaireInput = join(home, "course-questionnaire.json");
  await writeFile(questionnaireInput, `${JSON.stringify({
    questionnaire: [{ questionId: "question-text", text: "示例备注" }],
  })}\n`, { mode: 0o600 });
  const imagePath = join(home, "fixture-photo.png");
  const secondImagePath = join(home, "fixture-photo-2.png");
  const pdfPath = join(home, "fixture-proof.pdf");
  await writeFile(imagePath, Buffer.from([1, 2, 3]), { mode: 0o600 });
  await writeFile(secondImagePath, Buffer.from([2, 3]), { mode: 0o600 });
  await writeFile(pdfPath, Buffer.from([4, 5]), { mode: 0o600 });
  const attachmentInput = join(home, "course-attachment.json");
  await writeFile(attachmentInput, `${JSON.stringify({
    questionnaire: [
      { questionId: "question-image", attachments: [{ path: imagePath, mimeType: "image/png" }] },
      {
        questionId: "question-images",
        attachments: [
          { path: imagePath, mimeType: "image/png" },
          { path: secondImagePath, mimeType: "image/png" },
        ],
      },
      { questionId: "question-file", attachments: [{ path: pdfPath, mimeType: "application/pdf" }] },
      { questionId: "question-files", attachments: [{ path: pdfPath, mimeType: "application/pdf" }, { path: pdfPath, mimeType: "application/pdf" }] },
    ],
  })}\n`, { mode: 0o600 });
  const env = {
    ...process.env,
    FRIENDS_HOME: home,
    FRIENDS_BASE_URL: `http://127.0.0.1:${server.address().port}/gateway`,
  };
  const egoEnv = {
    ...env,
    PATH: `${egoRoot}:${env.PATH}`,
    EGO_SCRIPT_LOG: egoLog,
    FRIENDS_COURSE_EGO_CONFIG: egoConfig,
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
  assert.deepEqual(withdrawSchema.data.supportedVia, ["api", "ego"]);
  assert.equal(withdrawSchema.data.finalSubmissionBy, "api or human-via-ego");
  assert.equal(withdrawSchema.data.input.via.required, true);
  const applySchema = JSON.parse((await run(process.execPath, [
    cli, "schema", "courses.registrations.apply", "--json",
  ], { env })).stdout);
  assert.match(
    JSON.stringify(applySchema.data.input.questionnaire),
    /attachments.*path.*mimeType/,
  );

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

  const stdinDryRun = JSON.parse((await runWithStdin(process.execPath, [
    cli, "courses", "registrations", "apply", "course-questionnaire", "--dry-run",
    "--via", "api", "--input", "-", "--json",
  ], `${JSON.stringify({
    questionnaire: [{ questionId: "question-text", text: "stdin 示例" }],
  })}\n`, { env })).stdout);
  assert.equal(stdinDryRun.data.submitted, false);
  assert.equal(stdinDryRun.data.payload.questionnaireResult[0].inputContent, "stdin 示例");
  const uploadsBeforeAttachmentDryRun = requests.filter((request) =>
    request.url.endsWith("/protected-file-upload"),
  ).length;
  const attachmentDryRun = JSON.parse((await run(process.execPath, [
    cli, "courses", "registrations", "apply", "course-attachment", "--dry-run",
    "--via", "api", "--input", attachmentInput, "--json",
  ], { env })).stdout);
  assert.equal(attachmentDryRun.data.submitted, false);
  assert.deepEqual(attachmentDryRun.data.attachmentPlans.map((plan) => plan.files[0].filename), [
    basename(imagePath),
    basename(imagePath),
    basename(pdfPath),
    basename(pdfPath),
  ]);
  assert.equal(
    requests.filter((request) => request.url.endsWith("/protected-file-upload")).length,
    uploadsBeforeAttachmentDryRun,
  );
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
    ["apply", "course-fixture", "--via", "ego", "--confirm", "apply", "--yes"],
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

  const beforeRoleRequired = requests.filter((request) =>
    request.url.includes("/mob/student-apply/"),
  ).length;
  await assert.rejects(
    () => run(process.execPath, [
      cli, "courses", "registrations", "apply", "course-role", "--via", "api",
      "--confirm", "apply", "--json",
    ], { env }),
    (error) => error.code === 2 &&
      JSON.parse(error.stdout).error.message === "This course requires an explicit roleId from course detail",
  );
  assert.equal(
    requests.filter((request) => request.url.includes("/mob/student-apply/")).length,
    beforeRoleRequired,
  );

  listRegistration = false;
  const applied = JSON.parse((await run(process.execPath, [
    cli, "courses", "registrations", "apply", "course-fixture", "--via", "api",
    "--confirm", "apply", "--json",
  ], { env })).stdout);
  assert.equal(applied.data.submitted, true);
  assert.equal(applied.data.registration.id, "registration-fixture");
  assert.equal(applied.meta.selectedEntry, "api");

  listRegistration = true;
  const roleApplied = JSON.parse((await run(process.execPath, [
    cli, "courses", "registrations", "apply", "course-role", "--via", "api",
    "--role-id", "role-fixture", "--confirm", "apply", "--json",
  ], { env })).stdout);
  assert.equal(roleApplied.data.submitted, true);
  assert.equal(roleApplied.data.serverAck.accepted, true);
  const roleSubmission = requests.find((request) =>
    request.url.endsWith("/student-apply/apply") &&
    request.body?.curriculumId === "course-role",
  );
  assert.deepEqual({
    roleId: roleSubmission.body.roleId,
    roleName: roleSubmission.body.roleName,
    roleClassHour: roleSubmission.body.roleClassHour,
    roleIntegral: roleSubmission.body.roleIntegral,
  }, {
    roleId: "role-fixture",
    roleName: "参与者",
    roleClassHour: 2,
    roleIntegral: 0.5,
  });

  listRegistration = true;
  uploadCount = 0;
  const attachmentApplied = JSON.parse((await run(process.execPath, [
    cli, "courses", "registrations", "apply", "course-attachment", "--via", "api",
    "--input", attachmentInput, "--confirm", "apply", "--json",
  ], { env })).stdout);
  assert.equal(attachmentApplied.data.submitted, true);
  assert.equal(attachmentApplied.data.serverAck.accepted, true);
  assert.equal(attachmentApplied.data.attachments.length, 4);
  assert.equal(attachmentApplied.meta.verification.remoteWrites, 7);
  assert.equal(attachmentApplied.data.attachments[0].readback.status, "verified");
  const attachmentUploads = requests.filter((request) =>
    request.url.endsWith("/protected-file-upload"),
  );
  assert.equal(attachmentUploads.length, 6);
  assert.match(attachmentUploads[0].contentType, /^multipart\/form-data; boundary=/);
  assert.equal(attachmentUploads[0].body.filename, basename(imagePath));
  assert.equal(attachmentUploads[0].body.type, "image/png");
  const attachmentSubmission = requests.find((request) =>
    request.url.endsWith("/student-apply/apply") &&
    request.body?.curriculumId === "course-attachment",
  );
  assert.equal(
    attachmentUploads[0].body.groupId,
    attachmentSubmission.body.questionnaireResult[0].attachmentGroupUuid,
  );
  assert.equal(
    attachmentUploads[1].body.groupId,
    attachmentSubmission.body.questionnaireResult[1].attachmentGroupUuid,
  );
  assert.equal(
    attachmentUploads[2].body.groupId,
    attachmentSubmission.body.questionnaireResult[1].attachmentGroupUuid,
  );
  assert.equal(
    attachmentUploads[3].body.groupId,
    attachmentSubmission.body.questionnaireResult[2].attachmentGroupUuid,
  );

  mode = "upload-unknown"; uploadCount = 0;
  const beforePartialUpload = requests.length;
  await assert.rejects(() => run(process.execPath, [
    cli, "courses", "registrations", "apply", "course-attachment", "--via", "api", "--input", attachmentInput, "--confirm", "apply", "--json",
  ], { env }), error => {
    const output = JSON.parse(error.stdout); assert.equal(error.code, 7); assert.equal(output.error.code, "UNKNOWN_OUTCOME");
    assert.equal(output.error.retryable, false); assert.deepEqual(output.error.recovery.resourceIds, ["cli-resource-1"]);
    assert.equal(output.error.recovery.attachmentGroupUuids.length, 4); assert.ok(error.stderr.trim()); return true;
  });
  assert.equal(uploadCount, 2);
  assert.equal(requests.slice(beforePartialUpload).filter(req => req.url.includes("/mob/student-apply/")).length, 0);

  mode = "unknown";
  listRegistration = true;
  await assert.rejects(
    () => run(process.execPath, [
      cli, "courses", "registrations", "apply", "course-fixture", "--via", "api",
      "--confirm", "apply", "--json",
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
    4,
  );

  mode = "normal";
  const withdrawn = JSON.parse((await run(process.execPath, [
    cli, "courses", "registrations", "withdraw", "registration-fixture", "--via", "api",
    "--confirm", "withdraw", "--json",
  ], { env })).stdout);
  assert.equal(withdrawn.data.message, "撤销成功");
  assert.equal(withdrawn.data.stillListed, false);

  listRegistration = true;
  const exited = JSON.parse((await run(process.execPath, [
    cli, "courses", "registrations", "exit", "registration-fixture", "--via", "api",
    "--confirm", "exit", "--json",
  ], { env })).stdout);
  assert.equal(exited.data.message, "退出成功");
  assert.equal(exited.data.stillListed, false);

  const beforeInvalid = requests.length;
  for (const args of [
    ["apply", "course-fixture", "--confirm", "apply"],
    ["withdraw", "registration-fixture", "--confirm", "withdraw"],
    ["exit", "registration-fixture", "--confirm", "exit"],
    ["show", "not/a-registration-id"],
    ["withdraw", "not/a-registration-id", "--confirm", "withdraw"],
    ["exit", "not/a-registration-id", "--confirm", "exit"],
  ]) {
    await assert.rejects(
      () => run(process.execPath, [cli, "courses", "registrations", ...args, "--json"], {
        env: { ...env, FRIENDS_HOME: join(home, "must-not-read") },
      }),
      (error) => error.code === 2 &&
        JSON.parse(error.stdout).error.code === "INVALID_INPUT" &&
        requests.length === beforeInvalid,
    );
  }

  const writesBeforeDomainCheck = requests.filter((request) =>
    request.url.includes("/mob/student-apply/"),
  ).length;
  for (const operation of ["withdraw", "exit"]) {
    await assert.rejects(
      () => run(process.execPath, [
        cli, "courses", "registrations", operation, "course-fixture",
        "--via", "api",
        "--confirm", operation, "--json",
      ], { env }),
      (error) => error.code === 5,
    );
  }
  assert.equal(
    requests.filter((request) => request.url.includes("/mob/student-apply/")).length,
    writesBeforeDomainCheck,
  );

  const writesBeforeEgo = requests.filter((request) =>
    request.url.includes("/mob/student-apply/")
  ).length;
  listRegistration = true;
  await setEgoPage("course-role", "角色课程");
  const egoRole = JSON.parse((await run(process.execPath, [
    cli, "courses", "registrations", "apply", "course-role", "--role-id", "role-fixture",
    "--via", "ego", "--ego-task-space", "8", "--ego-page", "p4", "--confirm", "apply", "--json",
  ], { env: egoEnv })).stdout);
  assert.equal(egoRole.data.role.id, "role-fixture");
  assert.equal(egoRole.data.role.status, "human-required");
  assert.equal(egoRole.data.submitted, false);
  const attachmentControls = ["活动照片", "多张照片", "证明材料", "多份证明"].map((title, i) => `<div class="form-content"><div class="top-title">${i + 1}.${title}</div><div class="form-uploader"><input type="file"></div></div>`).join("");
  await setEgoPage("course-attachment", "附件课程", attachmentControls);
  const egoQuestionnaire = JSON.parse((await run(process.execPath, [
    cli, "courses", "registrations", "apply", "course-attachment",
    "--via", "ego", "--ego-task-space", "8", "--ego-page", "p4",
    "--confirm", "apply", "--json",
  ], { env: egoEnv })).stdout);
  assert.equal(egoQuestionnaire.data.submitted, false);
  assert.equal(egoQuestionnaire.data.status, "awaiting-user");
  assert.equal(egoQuestionnaire.data.pendingQuestionnaires[0].required, true);
  assert.equal(egoQuestionnaire.data.pendingQuestionnaires[0].itemType, "PICTURE");
  assert.equal(egoQuestionnaire.data.remoteFinalWrites, 0);
  const beforeVisibleUploads = requests.filter(req => req.url === "/gateway/ek-agg-mob/biz-common/protected-file-upload").length;
  const egoAttachmentApply = JSON.parse((await run(process.execPath, [
    cli, "courses", "registrations", "apply", "course-attachment", "--input", attachmentInput,
    "--via", "ego", "--ego-task-space", "8", "--ego-page", "p4", "--confirm", "apply", "--json",
  ], { env: egoEnv })).stdout);
  assert.equal(egoAttachmentApply.data.submitted, false);
  assert.equal(requests.filter(req => req.url === "/gateway/ek-agg-mob/biz-common/protected-file-upload").length - beforeVisibleUploads, 6);
  let observedEgo = JSON.parse(await readFile(egoResult, "utf8"));
  assert.deepEqual(observedEgo.uploads, [basename(imagePath), basename(imagePath), basename(secondImagePath), basename(pdfPath), basename(pdfPath), basename(pdfPath)]);
  assert.equal(observedEgo.finalWrites, 0); assert.equal(observedEgo.handoffs, 1);
  await setEgoPage("course-attachment", "附件课程", attachmentControls, { uploadLostAt: 2 });
  const beforeLostVisible = requests.length;
  await assert.rejects(() => run(process.execPath, [
    cli, "courses", "registrations", "apply", "course-attachment", "--input", attachmentInput,
    "--via", "ego", "--ego-task-space", "8", "--ego-page", "p4", "--confirm", "apply", "--json",
  ], { env: egoEnv }), error => {
    const output = JSON.parse(error.stdout); assert.equal(error.code, 7); assert.equal(output.error.code, "UNKNOWN_OUTCOME");
    assert.equal(output.error.retryable, false); assert.equal(output.error.recovery.courseId, "course-attachment");
    assert.equal(output.error.recovery.completed.length, 2); return true;
  });
  observedEgo = JSON.parse(await readFile(egoResult, "utf8"));
  assert.equal(observedEgo.uploads.length, 2); assert.equal(observedEgo.handoffs, 1); assert.equal(observedEgo.finalWrites, 0);
  assert.equal(requests.slice(beforeLostVisible).filter(req => req.url.includes("/mob/student-apply/")).length, 0);
  await setEgoPage("course-fixture", "示例课程");
  const egoApply = JSON.parse((await run(process.execPath, [
    cli, "courses", "registrations", "apply", "course-fixture",
    "--via", "ego", "--ego-task-space", "8", "--ego-page", "p4",
    "--confirm", "apply", "--json",
  ], { env: egoEnv })).stdout);
  assert.equal(egoApply.data.submitted, false);
  assert.equal(egoApply.data.status, "awaiting-user");
  assert.equal(egoApply.data.finalSubmissionBy, "human");
  assert.equal(egoApply.data.remoteFinalWrites, 0);
  assert.equal(egoApply.meta.selectedEntry, "ego");
  assert.equal(egoApply.meta.requestMode, "ego-visible-prepare");
  assert.equal(egoApply.meta.verification.remoteFinalWrites, 0);

  for (const operation of ["withdraw", "exit"]) {
    await setEgoPage("course-fixture", "示例课程", "", {
      url: `http://127.0.0.1:${server.address().port}/mobile/course/stuCourseQuery`,
      html: `<div class="app-container"><div class="list-group"><div class="list-item-bottom-line">示例课程</div><div class="list-action"><div>撤销</div><div>退出报名</div></div></div></div>`,
    });
    const prepared = JSON.parse((await run(process.execPath, [
      cli, "courses", "registrations", operation, "registration-fixture",
      "--via", "ego", "--ego-task-space", "8", "--ego-page", "p4",
      "--confirm", operation, "--json",
    ], { env: egoEnv })).stdout);
    assert.equal(prepared.data.submitted, false);
    assert.equal(prepared.data.status, "awaiting-user");
    assert.equal(prepared.data.remoteFinalWrites, 0);
  }
  observedEgo = JSON.parse(await readFile(egoResult, "utf8"));
  assert.equal(observedEgo.finalWrites, 0);
  assert.equal(observedEgo.handoffs, 1);
  assert.deepEqual(observedEgo.callbacks, ["open-dialog"]);
  assert.equal(
    requests.filter((request) => request.url.includes("/mob/student-apply/")).length,
    writesBeforeEgo,
  );

  mode = "readback-failed";
  const questionnaireApplied = JSON.parse((await run(process.execPath, [
    cli, "courses", "registrations", "apply", "course-questionnaire",
    "--via", "api", "--input", questionnaireInput, "--confirm", "apply", "--json",
  ], { env })).stdout);
  assert.equal(questionnaireApplied.data.submitted, true);
  assert.equal(questionnaireApplied.data.serverAck.accepted, true);
  assert.equal(questionnaireApplied.data.readback.status, "unavailable");
  assert.equal(questionnaireApplied.data.registration, null);
  assert.equal(
    requests.find((request) => request.url.endsWith("/student-apply/apply") &&
      request.body.curriculumId === "course-questionnaire"
    ).body.questionnaireResult[0].inputContent,
    "示例备注",
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
      cli, "courses", "registrations", "apply", "course-fixture", "--via", "api",
      "--confirm", "apply", "--json",
    ], { env }),
    (error) => error.code === 5 &&
      JSON.parse(error.stdout).error.upstreamCode === "10020",
  );
});

test("SDK re-verifies before writes and keeps definitive server acknowledgements when readback fails", async (t) => {
  const requests = [];
  let mode = "normal";
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      requests.push({ method: req.method, url: req.url, body: body ? JSON.parse(body) : null });
      if (req.url.endsWith("/checkUserAndGetUserLevel")) return identity(res);
      if (req.url.endsWith("/user/info")) {
        return json(res, {
          code: "0",
          data: { userNo: mode === "other-account" ? "other-account" : "fixture-account", userName: "示例" },
        });
      }
      if (req.url.endsWith("/enterHall")) {
        return json(res, {
          code: "0",
          data: {
            account: mode === "other-account" ? "other-account" : "fixture-account",
            name: "示例",
            userLoginStateLevel: "XS",
            departmentNo: "unit-a",
          },
        });
      }
      if (req.url.endsWith("/apply/approve-detail/course-fixture")) {
        return json(res, {
          code: "0",
          data: {
            uuid: "course-fixture",
            curriculumName: "问卷课程",
            isEnroll: true,
            studentApplied: null,
            roles: [],
            questionnaires: [
              { uuid: "question-choice", title: "选择参加原因", itemType: "CHOICE", isMandatory: true, options: [{ uuid: "option-a", itemUuid: "item-a", optionName: "兴趣" }] },
              { uuid: "question-multi", title: "选择可用时间", itemType: "MULTIPLE_CHOICE", isMandatory: true, options: [
                { uuid: "option-b", itemUuid: "item-b", optionName: "周五" },
                { uuid: "option-c", itemUuid: "item-c", optionName: "周六" },
              ] },
              { uuid: "question-text", title: "备注", itemType: "TEXT", isMandatory: true },
              { uuid: "question-number", title: "每周次数", itemType: "NUMBER", isMandatory: true },
              { uuid: "question-date", title: "开始日期", itemType: "DATE", isMandatory: true },
              { uuid: "question-optional", title: "选答备注", itemType: "TEXT", isMandatory: false },
            ],
          },
        });
      }
      if (req.url.endsWith("/apply/approve-detail/course-attachment")) {
        return json(res, {
          code: "0",
          data: {
            uuid: "course-attachment",
            curriculumName: "附件课程",
            isEnroll: true,
            studentApplied: null,
            roles: [],
            questionnaires: [{ uuid: "question-file", title: "证明材料", itemType: "FILE" }],
          },
        });
      }
      if (req.url.endsWith("/student-apply/apply")) {
        return json(res, { code: "0", message: "报名成功", data: null });
      }
      if (req.url.endsWith("/apply/my-applied-page-list")) {
        if (mode === "readback-failed") {
          res.writeHead(500);
          res.end("{}");
          return;
        }
        return json(res, {
          code: "0",
          data: {
            currentPage: 1,
            pageSize: 20,
            totalCount: 1,
            pages: 1,
            data: [{
              uuid: "course-fixture",
              curriculumName: "问卷课程",
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

  const reviewed = await client.inspectApply("course-fixture");
  assert.equal(reviewed.submitted, false);
  assert.equal(reviewed.rolesRequired, false);
  assert.equal(reviewed.payload.questionnaireResult, null);
  assert.equal(reviewed.questionnaires.length, 6);
  assert.equal(reviewed.questionnaires[5].required, false);

  mode = "other-account";
  const identityReverification = [
    "POST /gateway/ek-agg-mob/user/checkUserAndGetUserLevel",
    "POST /gateway/ek-agg-mob/user/info",
  ];
  const requiredQuestionnaire = [
    { questionId: "question-choice", choiceOptionId: "option-a" },
    { questionId: "question-multi", choiceOptionIds: ["option-b", "option-c"] },
    { questionId: "question-text", text: "示例备注" },
    { questionId: "question-number", text: "2" },
    { questionId: "question-date", text: "2026-11-01 09:00" },
  ];
  const sensitiveAttempts = [
    () => client.listMyRegistrations(),
    () => client.inspectApply("course-fixture"),
    () => client.apply({
      courseId: "course-fixture",
      questionnaire: requiredQuestionnaire,
      confirm: "apply",
    }),
    () => client.withdraw({ registrationId: "registration-fixture", confirm: "withdraw" }),
    () => client.exit({ registrationId: "registration-fixture", confirm: "exit" }),
  ];
  for (const attempt of sensitiveAttempts) {
    const beforeSensitiveWrite = requests.length;
    await assert.rejects(
      attempt,
      (error) => error.code === FriendsErrorCode.AuthRequired,
    );
    assert.equal(
      requests.slice(beforeSensitiveWrite).some((request) => request.url.includes("/mob/student-apply/")),
      false,
    );
    assert.deepEqual(
      requests.slice(-2).map((request) => `${request.method} ${request.url}`),
      identityReverification,
    );
  }

  mode = "readback-failed";
  const acknowledged = await client.apply({
    courseId: "course-fixture",
    confirm: "apply",
    questionnaire: requiredQuestionnaire,
  });
  assert.equal(acknowledged.submitted, true);
  assert.equal(acknowledged.message, "报名成功");
  assert.equal(acknowledged.serverAck.accepted, true);
  assert.equal(acknowledged.readback.status, "unavailable");
  assert.equal(acknowledged.registration, null);
  const submitted = requests.find((request) => request.url.endsWith("/student-apply/apply"));
  assert.equal(submitted.body.questionnaireResult.length, 6);
  assert.deepEqual(submitted.body.questionnaireResult[0], {
    curriculumId: "course-fixture",
    attachmentGroupUuid: null,
    inputContent: "",
    itemType: "CHOICE",
    itemUuid: "item-a",
    optionUuid: "option-a",
    uuid: "question-choice",
    studentNo: "fixture-account",
    title: "选择参加原因",
    multipartChoice: null,
  });
  assert.equal(submitted.body.questionnaireResult[1].itemUuid, "item-b");
  assert.deepEqual(submitted.body.questionnaireResult[1].multipartChoice, [
    { optionUuid: "option-b", optionName: "周五" },
    { optionUuid: "option-c", optionName: "周六" },
  ]);
  assert.equal(submitted.body.questionnaireResult[2].inputContent, "示例备注");
  assert.equal(submitted.body.questionnaireResult[3].inputContent, "2");
  assert.equal(submitted.body.questionnaireResult[4].inputContent, "2026-11-01 09:00");
  assert.equal(submitted.body.questionnaireResult[5].inputContent, "");
  await assert.rejects(
    () => client.prepareApply("course-attachment", {
      questionnaire: [{ questionId: "question-file", text: "not-an-attachment" }],
    }),
    (error) => error.code === FriendsErrorCode.InvalidInput &&
      error.message === "Questionnaire FILE requires attachments",
  );
});

test("SDK uploads verified course questionnaire attachments before one explicit apply", async (t) => {
  const requests = [];
  let outcome = "normal";
  let uploadCount = 0;
  let groupReadFails = false;
  const groups = new Map();
  const server = createServer((req, res) => {
    let body = [];
    req.on("data", (chunk) => body.push(chunk));
    req.on("end", async () => {
      const rawBody = Buffer.concat(body);
      let parsedBody = null;
      let form = null;
      if (req.headers["content-type"]?.startsWith("multipart/form-data")) {
        form = await new Request("http://fixture.test" + req.url, {
          method: req.method,
          headers: req.headers,
          body: rawBody,
        }).formData();
        parsedBody = {
          groupId: form.get("groupId"),
          filename: form.get("files")?.name,
          type: form.get("files")?.type,
        };
      } else if (rawBody.length > 0) {
        parsedBody = JSON.parse(rawBody.toString("utf8"));
      }
      requests.push({
        method: req.method,
        url: req.url,
        contentType: req.headers["content-type"],
        body: parsedBody,
      });
      if (req.url.endsWith("/checkUserAndGetUserLevel")) return identity(res);
      if (req.url.endsWith("/user/info")) {
        return json(res, { code: "0", data: { userNo: outcome === "identity-drift" && uploadCount > 0 ? "other-account" : "fixture-account", userName: "示例" } });
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
      if (req.url.endsWith("/apply/approve-detail/course-attachment")) {
        return json(res, {
          code: "0",
          data: {
            uuid: "course-attachment",
            curriculumName: "附件课程",
            isEnroll: true,
            studentApplied: null,
            roles: [],
            questionnaires: [
              { uuid: "question-image", title: "活动照片", itemType: "PICTURE", isMandatory: true },
              { uuid: "question-images", title: "多张照片", itemType: "MULTIPLE_PICTURE", isMandatory: true },
              { uuid: "question-file", title: "证明材料", itemType: "FILE", isMandatory: true },
              { uuid: "question-files", title: "证明材料", itemType: "MULTIPLE_FILE", isMandatory: true },
            ],
          },
        });
      }
      if (req.method === "POST" && req.url === "/gateway/ek-agg-mob/biz-common/protected-file-upload" &&
        req.headers["h-zove-appkey"] === "zovecenter-saip-ek-agg-mob") {
        uploadCount += 1;
        const resources = groups.get(form.get("groupId")) ?? [];
        resources.push(`resource-${uploadCount}`);
        groups.set(form.get("groupId"), resources);
        if (outcome === "upload-empty" && uploadCount === 2) return json(res, { code: "0", data: [] });
        if (outcome === "upload-lost" && uploadCount === 2) {
          res.writeHead(200, { "content-type": "text/plain" });
          res.end("upload response was lost");
          return;
        }
        return json(res, { code: "0", data: [`resource-${uploadCount}`] });
      }
      if (req.method === "POST" && new URL(req.url, "http://fixture.test").pathname === "/gateway/ek-agg-mob/biz-common/list-group-resource" &&
        req.headers["h-zove-appkey"] === "zovecenter-saip-ek-agg-mob") {
        if (groupReadFails) {
          res.writeHead(500);
          res.end("{}");
          return;
        }
        return json(res, {
          code: "0",
          data: (groups.get(new URL(req.url, "http://fixture.test").searchParams.get("groupUuid")) ?? [])
            .map(uuid => ({ uuid, title: "fixture", fileExtension: ".pdf" })),
        });
      }
      if (req.url.endsWith("/student-apply/apply")) {
        if (outcome === "apply-business") return json(res, { code: "10020", message: "报名已截止", requestId: "partial-denial" });
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
              uuid: "course-attachment",
              curriculumName: "附件课程",
              studentApplied: {
                uuid: "registration-fixture",
                flowOverallState: 3,
                flowCurrMsg: "等待学院审核",
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
  const attachments = [
    {
      questionId: "question-image",
      attachments: [{ content: new File([new Uint8Array([1, 2, 3])], "photo.png", { type: "image/png" }) }],
    },
    {
      questionId: "question-images",
      attachments: [
        { content: new File([new Uint8Array([2, 3])], "photo-2.png", { type: "image/png" }) },
        { content: new File([new Uint8Array([3, 4])], "photo-3.png", { type: "image/png" }) },
      ],
    },
    {
      questionId: "question-file",
      attachments: [{ content: new File([new Uint8Array([4, 5])], "proof.pdf", { type: "application/pdf" }) }],
    },
    {
      questionId: "question-files",
      attachments: [
        { content: new File([new Uint8Array([6])], "extra.pdf", { type: "application/pdf" }) },
        { content: new File([new Uint8Array([7])], "extra-2.pdf", { type: "application/pdf" }) },
      ],
    },
  ];

  const prepared = await client.prepareApply("course-attachment", { questionnaire: attachments });
  assert.equal(prepared.attachmentPlans.length, 4);
  assert.equal(prepared.attachmentPlans[0].itemType, "PICTURE");
  assert.match(prepared.attachmentPlans[0].groupUuid, /^[0-9a-f]{32}$/);
  assert.equal(prepared.payload.questionnaireResult[0].attachmentGroupUuid, prepared.attachmentPlans[0].groupUuid);
  assert.equal(prepared.attachmentPlans[1].maxCount, null);
  assert.equal(prepared.attachmentPlans[2].maxCount, 1);
  assert.equal(prepared.attachmentPlans[3].maxCount, null);

  await assert.rejects(
    () => client.prepareApply("course-attachment", {
      questionnaire: [{
        questionId: "question-image",
        attachments: [{ content: new File(["pdf"], "proof.pdf", { type: "application/pdf" }) }],
      }],
    }),
    (error) => {
      assert.equal(error.code, FriendsErrorCode.InvalidInput);
      assert.equal(
        error.message,
        "Questionnaire PICTURE accepts image/png, image/jpg, image/jpeg, image/gif, image/bmp files",
      );
      return true;
    },
  );
  await assert.rejects(
    () => client.prepareApply("course-attachment", {
      questionnaire: [{
        questionId: "question-image",
        attachments: [{ content: new File(["image"], "photo.png", { type: "image/png" }) }],
      }, {
        questionId: "question-images",
        attachments: [{ content: new File(["image-2"], "photo-2.png", { type: "image/png" }) }],
      }, {
        questionId: "question-file",
        attachments: [
          { content: new File(["one"], "one.pdf", { type: "application/pdf" }) },
          { content: new File(["two"], "two.pdf", { type: "application/pdf" }) },
        ],
      }],
    }),
    (error) => error.code === FriendsErrorCode.InvalidInput &&
      error.message === "Questionnaire FILE accepts one file only",
  );

  requests.length = 0;
  outcome = "upload-lost";
  await assert.rejects(
    () => client.apply({ courseId: "course-attachment", questionnaire: attachments, confirm: "apply" }),
    (error) => {
      assert.equal(error.code, FriendsErrorCode.UnknownOutcome);
      assert.equal(error.retryable, false);
      assert.equal(error.recovery.operation, "courses.registrations.apply.attachments");
      assert.equal(error.recovery.attachmentGroupUuids.length, 4);
      assert.deepEqual(error.recovery.resourceIds, ["resource-1"]);
      assert.equal(error.recovery.serverAcknowledged, "unknown");
      assert.equal(error.recovery.readback, "matched");
      return true;
    },
  );
  assert.equal(requests.filter((request) => request.url.endsWith("/student-apply/apply")).length, 0);
  assert.equal(requests.filter((request) => request.url.includes("protected-delete")).length, 0);

  requests.length = 0;
  uploadCount = 0;
  outcome = "upload-empty";
  await assert.rejects(
    () => client.apply({ courseId: "course-attachment", questionnaire: attachments, confirm: "apply" }),
    error => error.code === FriendsErrorCode.UnknownOutcome && error.retryable === false &&
      error.recovery.resourceIds.join() === "resource-1" && error.recovery.readback === "matched",
  );
  assert.equal(uploadCount, 2);
  assert.equal(requests.filter(request => request.url.endsWith("/student-apply/apply")).length, 0);

  requests.length = 0;
  uploadCount = 0;
  outcome = "normal";
  groupReadFails = true;
  const applied = await client.apply({
    courseId: "course-attachment",
    questionnaire: attachments,
    confirm: "apply",
  });
  assert.equal(applied.submitted, true);
  assert.equal(applied.registration.id, "registration-fixture");
  assert.equal(applied.attachments.length, 4);
  assert.equal(applied.attachments[0].readback.status, "unavailable");
  assert.equal(applied.attachments[0].serverAck.accepted, true);
  const submitted = requests.find((request) => request.url.endsWith("/student-apply/apply"));
  assert.equal(submitted.body.questionnaireResult[0].itemType, "PICTURE");
  assert.match(submitted.body.questionnaireResult[0].attachmentGroupUuid, /^[0-9a-f]{32}$/);
  assert.equal(submitted.body.questionnaireResult[1].itemType, "MULTIPLE_PICTURE");
  assert.match(submitted.body.questionnaireResult[1].attachmentGroupUuid, /^[0-9a-f]{32}$/);
  assert.equal(submitted.body.questionnaireResult[2].itemType, "FILE");
  assert.match(submitted.body.questionnaireResult[2].attachmentGroupUuid, /^[0-9a-f]{32}$/);
  assert.equal(submitted.body.questionnaireResult[3].itemType, "MULTIPLE_FILE");
  assert.match(submitted.body.questionnaireResult[3].attachmentGroupUuid, /^[0-9a-f]{32}$/);
  const uploads = requests.filter((request) => request.url.endsWith("/protected-file-upload"));
  assert.equal(uploads.length, 6);
  assert.equal(uploads[0].body.groupId, submitted.body.questionnaireResult[0].attachmentGroupUuid);
  assert.equal(uploads[0].body.filename, "photo.png");
  assert.equal(uploads[0].body.type, "image/png");
  assert.equal(uploads[1].body.groupId, submitted.body.questionnaireResult[1].attachmentGroupUuid);
  assert.equal(uploads[2].body.groupId, submitted.body.questionnaireResult[1].attachmentGroupUuid);
  assert.equal(uploads[3].body.groupId, submitted.body.questionnaireResult[2].attachmentGroupUuid);
  assert.equal(uploads[4].body.groupId, submitted.body.questionnaireResult[3].attachmentGroupUuid);
  assert.equal(uploads[5].body.groupId, submitted.body.questionnaireResult[3].attachmentGroupUuid);
  assert.match(uploads[0].contentType, /^multipart\/form-data; boundary=/);
  assert.equal(requests.filter((request) => request.url.includes("protected-delete")).length, 0);
  for (const scenario of ["identity-drift", "apply-business"]) {
    outcome = scenario; uploadCount = 0; requests.length = 0;
    await assert.rejects(() => client.apply({ courseId: "course-attachment", questionnaire: attachments, confirm: "apply" }), error => {
      assert.equal(error.code, scenario === "identity-drift" ? FriendsErrorCode.AuthRequired : FriendsErrorCode.UpstreamBusiness);
      assert.equal(error.recovery.resourceIds.length, scenario === "identity-drift" ? 1 : 6);
      assert.equal(error.recovery.attachmentGroupUuids.length, 4);
      if (scenario === "apply-business") assert.equal(error.upstreamCode, "10020");
      return true;
    });
    assert.equal(uploadCount, scenario === "identity-drift" ? 1 : 6);
    assert.equal(requests.filter(request => request.url.endsWith("/student-apply/apply")).length, scenario === "identity-drift" ? 0 : 1);
    assert.equal(requests.filter(request => request.url.includes("protected-delete")).length, 0);
  }
});

test("Node public SDK verifies live context and prepares actual iframe controls without submitting", async (t) => {
  const root = join(tmpdir(), `friends-course-ego-node-${Date.now()}`);
  await mkdir(root, { recursive: true });
  t.after(() => rm(root, { recursive: true, force: true }));
  const finalWrites = [], uploaded = [];
  let enrollment = true;
  let questionnaires = [{ uuid: "question-text", title: "备注", itemType: "TEXT", isMandatory: true }];
  const server = createServer((req, res) => {
    const chunks = []; req.on("data", chunk => chunks.push(chunk));
    req.on("end", async () => {
      if (req.url === "/gateway/ek-agg-mob/user/checkUserAndGetUserLevel") return identity(res);
      if (req.url === "/gateway/ek-agg-mob/user/info") return json(res, { code: "0", data: { userNo: "fixture-account", userName: "示例" } });
      if (req.url === "/gateway/ek-agg-mob/user/enterHall") return json(res, { code: "0", data: { account: "fixture-account", userLoginStateLevel: "XS", departmentNo: "unit-a", name: "示例" } });
      if (req.url === "/gateway/zovecenter-saip-ek-app-curriculum/mob/apply/approve-detail/course-fixture") return json(res, { code: "0", data: {
        uuid: "course-fixture", curriculumName: "示例课程", isEnroll: enrollment, studentApplied: null,
        roles: [{ uuid: "role-a", roleName: "参与者", classHour: 2, integral: 0.5 }],
        questionnaires,
      } });
      if (req.method === "POST" && req.url === "/gateway/ek-agg-mob/biz-common/protected-file-upload" && req.headers["h-zove-appkey"] === "zovecenter-saip-ek-agg-mob") {
        const form = await new Request("http://fixture.test" + req.url, { method: "POST", headers: req.headers, body: Buffer.concat(chunks) }).formData();
        uploaded.push({ groupId: form.get("groupId"), filename: form.get("files").name });
        return json(res, { code: "0", data: [`ego-resource-${uploaded.length}`] });
      }
      if (req.url === "/gateway/zovecenter-saip-ek-app-curriculum/mob/apply/my-applied-page-list") return json(res, { code: "0", data: { currentPage: 1, pageSize: 20, pages: 1, totalCount: 1, data: [{ uuid: "course-fixture", curriculumName: "示例课程", studentApplied: { uuid: "registration-fixture", flowOverallState: 3 } }] } });
      finalWrites.push(req.url); res.writeHead(404); res.end("{}");
    });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const fixture = resolve("tests/fixtures/course-participation-ego.mjs");
  const launcher = join(root, "ego-browser");
  await writeFile(launcher, `#!/bin/sh\nexec '${process.execPath}' '${fixture}'\n`); await chmod(launcher, 0o700);
  const configPath = join(root, "config.json"), resultPath = join(root, "result.json");
  const previousConfig = process.env.FRIENDS_COURSE_EGO_CONFIG;
  process.env.FRIENDS_COURSE_EGO_CONFIG = configPath;
  t.after(() => { if (previousConfig === undefined) delete process.env.FRIENDS_COURSE_EGO_CONFIG; else process.env.FRIENDS_COURSE_EGO_CONFIG = previousConfig; });
  const html = `<div class="app-container"><div class="activity-info"><div class="van-cell"><span class="van-cell__title">课程名称</span><span class="van-cell__value">示例课程</span></div></div><div class="report-info-set"><div class="form-content"><div class="top-title">1.备注</div><div class="options"><textarea></textarea></div></div></div><div class="footer"><button>申请加入</button></div></div>`;
  const config = { url: `http://127.0.0.1:${server.address().port}/mobile/course/stuCourseDetail?uuid=course-fixture&type=Apply`, html, result: resultPath, gateway: `http://127.0.0.1:${server.address().port}/gateway` };
  await writeFile(configPath, JSON.stringify(config));
  const options = { operation: "apply", taskSpaceId: 8, page: "p2", courseId: "course-fixture", courseName: "示例课程", roleId: "role-a", command: launcher,
    baseUrl: `http://127.0.0.1:${server.address().port}/gateway`,
    session: { token: "ego-fixture-token", userLevel: "XS", account: { userNo: "fixture-account" }, context: { levelNo: "XS", unit: { unitNo: "unit-a" } } },
    questionnaire: [{ questionId: "question-text", text: "sdk answer" }],
  };
  const prepared = await prepareCourseRegistrationInEgo(options);
  assert.equal(prepared.submitted, false);
  assert.equal(prepared.status, "awaiting-user");
  assert.equal(prepared.finalSubmissionBy, "human");
  assert.equal(prepared.role.id, "role-a");
  assert.equal(prepared.role.status, "human-required");
  let observed = JSON.parse(await readFile(resultPath, "utf8"));
  assert.deepEqual(observed.values, ["sdk answer"]);
  assert.deepEqual(observed.callbacks, ["input:sdk answer"]);
  assert.equal(observed.finalWrites, 0); assert.equal(observed.handoffs, 1); assert.equal(observed.navigations, 0);
  assert.deepEqual(finalWrites, []);
  await writeFile(configPath, JSON.stringify({ ...config, html: html.replace("<textarea>", "<textarea>human answer" ) }));
  await prepareCourseRegistrationInEgo(options);
  observed = JSON.parse(await readFile(resultPath, "utf8"));
  assert.deepEqual(observed.values, ["human answer"]); assert.deepEqual(observed.fills, []);
  await writeFile(configPath, JSON.stringify({ ...config, account: "other-account" }));
  await assert.rejects(() => prepareCourseRegistrationInEgo(options), error => error.code === FriendsErrorCode.PermissionDenied);
  observed = JSON.parse(await readFile(resultPath, "utf8")); assert.deepEqual(observed.fills, []); assert.equal(observed.finalWrites, 0);
  await writeFile(configPath, JSON.stringify({ ...config, outerHtml: '<div class="report-info-set"><div class="form-content"><textarea></textarea></div></div>' }));
  await assert.rejects(() => prepareCourseRegistrationInEgo(options), error => error.code === FriendsErrorCode.PermissionDenied);
  observed = JSON.parse(await readFile(resultPath, "utf8")); assert.deepEqual(observed.fills, []); assert.equal(observed.finalWrites, 0);
  await writeFile(configPath, JSON.stringify({ ...config, changeOnSnapshot: true }));
  await prepareCourseRegistrationInEgo(options);
  observed = JSON.parse(await readFile(resultPath, "utf8")); assert.deepEqual(observed.values, ["human-late-edit"]); assert.deepEqual(observed.fills, []);
  await writeFile(configPath, JSON.stringify({ ...config, url: config.url.replace("course-fixture", "other-course") }));
  await assert.rejects(() => prepareCourseRegistrationInEgo(options), error => error.code === FriendsErrorCode.PermissionDenied);
  await assert.rejects(() => prepareCourseRegistrationInEgo({ ...options, roleId: "foreign-role" }), error => error.code === FriendsErrorCode.InvalidInput);
  enrollment = false;
  await assert.rejects(() => prepareCourseRegistrationInEgo(options), error => error.code === FriendsErrorCode.UpstreamBusiness);
  enrollment = true;

  questionnaires = [
    { uuid: "choice", title: "单选", itemType: "CHOICE", isMandatory: true, options: [{ uuid: "choice-a", itemUuid: "choice-item", optionName: "甲" }, { uuid: "choice-b", itemUuid: "choice-item", optionName: "乙" }] },
    { uuid: "multi", title: "多选", itemType: "MULTIPLE_CHOICE", isMandatory: true, options: [{ uuid: "multi-a", itemUuid: "multi-item", optionName: "周五" }, { uuid: "multi-b", itemUuid: "multi-item", optionName: "周六" }] },
    { uuid: "number", title: "次数", itemType: "NUMBER", isMandatory: true },
    { uuid: "date", title: "日期", itemType: "DATE", isMandatory: true },
  ];
  const questionBody = `<div class="form-content"><div class="top-title">1.单选</div><div class="options"><div class="van-cell"><span class="van-cell__title">甲</span><div role="radio" aria-checked="false"></div></div><div class="van-cell"><span class="van-cell__title">乙</span><div role="radio" aria-checked="false"></div></div></div></div><div class="form-content"><div class="top-title">2.多选</div><div class="options"><div class="van-cell"><span class="van-cell__title">周五</span><div role="checkbox" aria-checked="false"></div></div><div class="van-cell"><span class="van-cell__title">周六</span><div role="checkbox" aria-checked="false"></div></div></div></div><div class="form-content"><div class="top-title">3.次数</div><input name="requiredCourseCount"></div><div class="form-content"><div class="top-title">4.日期</div><input name="deadline" readonly></div>`;
  const questionConfig = { ...config, html: html.replace(/<div class="report-info-set">.*<div class="footer">/, `<div class="report-info-set">${questionBody}</div><div class="footer">`) };
  await writeFile(configPath, JSON.stringify(questionConfig));
  const questionOptions = { ...options, questionnaire: [
    { questionId: "choice", choiceOptionId: "choice-b" }, { questionId: "multi", choiceOptionIds: ["multi-a", "multi-b"] },
    { questionId: "number", text: "3" }, { questionId: "date", text: "2026-11-01 09:00" },
  ] };
  const answered = await prepareCourseRegistrationInEgo(questionOptions);
  assert.ok(answered.pendingInputs.includes("date"));
  observed = JSON.parse(await readFile(resultPath, "utf8"));
  assert.deepEqual(observed.values, ["3", ""]);
  assert.deepEqual(observed.callbacks, ["choice:乙", "choice:周五", "choice:周六", "input:3"]); assert.equal(observed.finalWrites, 0);
  await writeFile(configPath, JSON.stringify({ ...questionConfig, html: questionConfig.html.replace('role="radio" aria-checked="false"', 'role="radio" aria-checked="true"') }));
  const preservedChoice = await prepareCourseRegistrationInEgo(questionOptions);
  assert.ok(preservedChoice.preservedInputs.includes("choice"));
  observed = JSON.parse(await readFile(resultPath, "utf8")); assert.equal(observed.callbacks.includes("choice:乙"), false);

  const image = join(root, "proof.png"), pdf = join(root, "proof.pdf");
  await writeFile(image, "image fixture"); await writeFile(pdf, "pdf fixture");
  questionnaires = [
    { uuid: "picture", title: "照片", itemType: "PICTURE", isMandatory: true },
    { uuid: "pictures", title: "多张照片", itemType: "MULTIPLE_PICTURE", isMandatory: true },
    { uuid: "file", title: "材料", itemType: "FILE", isMandatory: true },
    { uuid: "files", title: "多份材料", itemType: "MULTIPLE_FILE", isMandatory: true },
  ];
  const controls = questionnaires.map((q, i) => `<div class="form-content"><div class="top-title">${i + 1}.${q.title}</div><div class="form-uploader"><input type="file"></div></div>`).join("");
  const uploadConfig = { ...config, html: html.replace(/<div class="report-info-set">.*<div class="footer">/, `<div class="report-info-set">${controls}</div><div class="footer">`) };
  await writeFile(configPath, JSON.stringify(uploadConfig));
  const uploadOptions = { ...options, questionnaire: [
    { questionId: "picture", attachments: [{ path: image, mimeType: "image/png" }] },
    { questionId: "pictures", attachments: [{ path: image, mimeType: "image/png" }, { path: image, mimeType: "image/png" }] },
    { questionId: "file", attachments: [{ path: pdf, mimeType: "application/pdf" }] },
    { questionId: "files", attachments: [{ path: pdf, mimeType: "application/pdf" }, { path: pdf, mimeType: "application/pdf" }] },
  ] };
  await assert.rejects(() => prepareCourseRegistrationInEgo({ ...uploadOptions, questionnaire: uploadOptions.questionnaire.map((answer, index) => index === 0 ? { ...answer, attachments: [{ ...answer.attachments[0], filename: "renamed.png" }] } : answer) }), error => error.code === FriendsErrorCode.InvalidInput);
  const uploadedForm = await prepareCourseRegistrationInEgo(uploadOptions);
  assert.equal(uploadedForm.submitted, false); assert.equal(uploadedForm.completedActions.length, 6);
  observed = JSON.parse(await readFile(resultPath, "utf8"));
  assert.equal(observed.uploads.length, 6); assert.equal(observed.finalWrites, 0); assert.equal(uploaded.length, 6);
  await writeFile(configPath, JSON.stringify({ ...uploadConfig, loseBridgeAfterUpload: true }));
  await assert.rejects(() => prepareCourseRegistrationInEgo(uploadOptions), error => {
    assert.equal(error.code, FriendsErrorCode.UnknownOutcome); assert.equal(error.retryable, false);
    assert.equal(error.recovery.completed.length, 1); assert.match(error.recovery.completed[0], /^attempted:upload:picture:/); return true;
  });
  observed = JSON.parse(await readFile(resultPath, "utf8")); assert.equal(observed.uploads.length, 1); assert.equal(observed.handoffs, 1); assert.equal(observed.finalWrites, 0); assert.equal(uploaded.length, 7);
  for (const operation of ["withdraw", "exit"]) {
    const listConfig = { ...config, url: `http://127.0.0.1:${server.address().port}/mobile/course/stuCourseQuery`, html: `<div class="app-container"><div class="list-group"><div class="list-item-bottom-line">示例课程</div><div class="list-action"><div>撤销</div><div>退出报名</div></div></div></div>` };
    await writeFile(configPath, JSON.stringify(listConfig));
    const preparedDialog = await prepareCourseRegistrationInEgo({ operation, taskSpaceId: 8, page: "p2", registrationId: "registration-fixture", courseName: "示例课程", command: launcher, baseUrl: options.baseUrl, session: options.session });
    assert.equal(preparedDialog.submitted, false);
    observed = JSON.parse(await readFile(resultPath, "utf8")); assert.deepEqual(observed.callbacks, ["open-dialog"]); assert.equal(observed.finalWrites, 0);
    await writeFile(configPath, JSON.stringify({ ...listConfig, html: listConfig.html.replace('</div></div>', '</div></div><div class="list-group"><div class="list-item-bottom-line">示例课程</div></div>') }));
    await assert.rejects(() => prepareCourseRegistrationInEgo({ operation, taskSpaceId: 8, page: "p2", registrationId: "registration-fixture", courseName: "示例课程", command: launcher, baseUrl: options.baseUrl, session: options.session }), error => error.code === FriendsErrorCode.UpstreamBusiness);
  }
  assert.deepEqual(finalWrites, []);
});
