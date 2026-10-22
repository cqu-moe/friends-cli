import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "node:http";
import { courseId, createFriendsSdk, FriendsErrorCode } from "../dist/index.js";

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function replyIdentity(res, levelNos = ["XS"]) {
  json(res, 200, {
    code: "0",
    data: {
      loginLevels: levelNos.map((levelNo) => ({
        levelNo,
        levelName: levelNo === "XS" ? "学生" : "教师",
        units: [{ unitType: 2, unitNo: "24080", unitName: "计算机学院" }],
      })),
      userLoginType: "STUDENT_UNACTIVATED",
    },
  });
}

test("course SDK uses the live curriculum endpoint and keeps clients context-isolated", async (t) => {
  const requests = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      requests.push({ url: req.url, headers: req.headers, body: JSON.parse(body) });
      if (req.url.endsWith("/checkUserAndGetUserLevel")) {
        replyIdentity(res, ["XS", "JS"]);
        return;
      }
      if (req.url.endsWith("/user/info")) {
        json(res, 200, { code: "0", data: { userNo: "20210001", userName: "张三" } });
        return;
      }
      if (req.url.endsWith("/enterHall")) {
        json(res, 200, {
          code: "0",
          data: {
            account: "20210001",
            name: "张三",
            userLoginStateLevel: req.headers["h-zove-userlevel"],
            departmentNo: "24080",
          },
        });
        return;
      }
      json(res, 200, {
        code: "0",
        message: "ok",
        requestId: "request-a",
        data: {
          currentPage: 1,
          pageSize: 2,
          totalCount: 3,
          pages: 2,
          data: [
            {
              uuid: "course-1",
              curriculumName: "周周艺",
              organizationName: "艺术学院",
              curriculumLevel: "LEVEL",
              curriculumType: "TYPE",
              curriculumTypeName: "美育",
              curriculumPlace: "音乐厅",
              curriculumContent: "合唱训练",
              beginTime: "2026-10-01 10:00",
              endTime: "2026-10-01 12:00",
              openTime: "2026-09-01 10:00",
              deadline: "2026-09-30 12:00",
              isEnroll: true,
              isEnrollExamine: false,
              limitCollegeNo: ["24080"],
              limitGrade: ["2025"],
              limitSpecialtyTypeOne: ["B"],
              curriculumState: "NEW_LIVE_STATE",
              flowOverallState: 7,
              studentApplied: false,
              cancelByUserNo: "20210001",
            },
          ],
        },
      });
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const sdk = createFriendsSdk({
    baseUrl: `http://127.0.0.1:${server.address().port}/gateway`,
  });
  const student = await sdk.createCourseClient({
    token: "student-token",
    userLevel: "XS",
    account: { userNo: "20210001" },
    context: { levelNo: "XS", unit: { unitNo: "24080" } },
  });
  const teacher = await sdk.createCourseClient({
    token: "teacher-token",
    userLevel: "JS",
    account: { userNo: "20210001" },
    context: { levelNo: "JS", unit: { unitNo: "24080" } },
  });

  const [studentPage, teacherPage] = await Promise.all([
    student.list({ page: 1, pageSize: 2, keyword: "周周艺" }),
    teacher.list({ page: 1, pageSize: 2 }),
  ]);

  assert.equal(studentPage.items.length, 1);
  assert.equal(studentPage.items[0].id, "course-1");
  assert.equal(studentPage.items[0].name, "周周艺");
  assert.equal(studentPage.items[0].organizationName, "艺术学院");
  assert.deepEqual(studentPage.items[0].state.raw, "NEW_LIVE_STATE");
  assert.equal(studentPage.items[0].state.known, false);
  assert.equal(JSON.stringify(studentPage).includes("20210001"), false);
  assert.equal(studentPage.page, 1);
  assert.equal(studentPage.pageSize, 2);
  assert.equal(studentPage.totalCount, 3);
  assert.equal(studentPage.hasMore, true);
  assert.equal(studentPage.hasMoreSource, "derived-from-pages");
  assert.equal(teacherPage.items.length, 1);
  await assert.rejects(
    () =>
      sdk.createCourseClient({
        token: "student-token",
        userLevel: "XS",
        account: { userNo: "20219999" },
        context: { levelNo: "XS", unit: { unitNo: "24080" } },
      }),
    (error) => error.code === FriendsErrorCode.AuthRequired,
  );

  const courseRequests = requests.filter((request) =>
    request.url.endsWith("student-apply-page-list"),
  );
  assert.deepEqual(
   courseRequests
    .map((request) => ({
      token: request.headers["h-zove-token"],
      level: request.headers["h-zove-userlevel"],
      key: request.body.key,
    })),
    [
      { token: "student-token", level: "XS", key: "周周艺" },
      { token: "teacher-token", level: "JS", key: "" },
    ],
  );
  assert.equal(
    courseRequests[0].url,
    "/gateway/zovecenter-saip-ek-app-curriculum/mob/apply/student-apply-page-list",
  );
  assert.equal(courseRequests[0].headers["h-zove-appkey"], "zovecenter-saip-ek-app-curriculum");
  assert.equal(courseRequests[0].headers["h-zove-source"], "30100");
  assert.equal(courseRequests[0].headers["h-zove-clienttype"], "1");
  assert.equal(courseRequests[0].headers["h-zove-tenantid"], "EK");
  server.close();
});

test("SDK default entry and public inspect-activate-course chain stay context-bound", async (t) => {
  assert.equal(typeof createFriendsSdk().inspectLocalSession, "function");
  const requests = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      requests.push({ url: req.url, headers: req.headers, body: body ? JSON.parse(body) : null });
      if (req.url.endsWith("/checkUserAndGetUserLevel")) {
        replyIdentity(res);
        return;
      }
      if (req.url.endsWith("/user/info")) {
        json(res, 200, { code: "0", data: { userNo: "20210001", userName: "张三" } });
        return;
      }
      if (req.url.endsWith("/enterHall")) {
        json(res, 200, {
          code: "0",
          data: {
            account: "20210001",
            name: "张三",
            userLoginStateLevel: "XS",
            departmentNo: "24080",
          },
        });
        return;
      }
      json(res, 200, {
        code: "0",
        data: {
          currentPage: 1,
          pageSize: 10,
          totalCount: 1,
          pages: 1,
          data: [{ uuid: "course-1", curriculumName: "周周艺", curriculumState: "NEW" }],
        },
      });
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const sdk = createFriendsSdk({
    baseUrl: `http://127.0.0.1:${server.address().port}/gateway`,
  });

  const inspection = await sdk.inspectLocalSession({ token: "token-a", userLevel: "XS" });
  assert.equal(inspection.account.userNo, "20210001");
  const activated = await sdk.activateLocalContext({
    token: "token-a",
    userLevel: "XS",
  });
  const courseSession = {
    token: "token-a",
    userLevel: activated.context.levelNo,
    account: activated.account,
    context: activated.context,
  };
  const verified = await sdk.verifyLocalSession(courseSession);
  assert.equal(verified.account.userNo, activated.account.userNo);
  assert.equal(verified.contexts[0].unit.unitNo, activated.context.unit.unitNo);
  const client = await sdk.createCourseClient(courseSession);
  courseSession.context.levelNo = "JS";
  const page = await client.list({ keyword: "周周艺" });
  assert.equal(page.items[0].name, "周周艺");

  const courseRequest = requests.find((request) =>
    request.url.endsWith("student-apply-page-list"),
  );
  assert.equal(courseRequest.headers["h-zove-userlevel"], "XS");
  const requestCount = requests.length;
  for (const invalidInput of [null, {}, { token: "token-a" }, {
    token: "token-a",
    userLevel: "XS",
    account: null,
    context: { levelNo: "XS", unit: { unitNo: "24080" } },
  }, {
    token: "token-a",
    userLevel: "XS",
    account: activated.account,
    context: null,
  }]) {
    await assert.rejects(
      () => sdk.createCourseClient(invalidInput),
      (error) => error.code === FriendsErrorCode.InvalidInput,
    );
  }
  await assert.rejects(
    () =>
      sdk.createCourseClient({
        token: "token-a",
        userLevel: "XS",
        account: activated.account,
        context: { levelNo: "JS", unit: { unitNo: "24080" } },
      }),
    (error) => error.code === FriendsErrorCode.InvalidInput && requests.length === requestCount,
  );
});

test("SDK rejects HTTP 200 business failures and invalid pagination locally", async (t) => {
  const server = createServer((req, res) => {
    if (req.url.endsWith("/checkUserAndGetUserLevel")) {
      replyIdentity(res);
      return;
    }
    if (req.url.endsWith("/user/info")) {
      json(res, 200, { code: "0", data: { userNo: "20210001", userName: "张三" } });
      return;
    }
    if (req.url.endsWith("/enterHall")) {
      json(res, 200, {
        code: "0",
        data: {
          account: "20210001",
          name: "张三",
          userLoginStateLevel: "XS",
          departmentNo: "24080",
        },
      });
      return;
    }
    json(res, 200, { code: "10030", message: "missing resource", requestId: "request-b", data: null });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const sdk = createFriendsSdk({
    baseUrl: `http://127.0.0.1:${server.address().port}/gateway`,
  });
  const client = await sdk.createCourseClient({
    token: "token",
    userLevel: "XS",
    account: { userNo: "20210001" },
    context: { levelNo: "XS", unit: { unitNo: "24080" } },
  });

  await assert.rejects(
    () => client.list({ page: 1, pageSize: 2 }),
    (error) =>
      error.code === FriendsErrorCode.UpstreamBusiness &&
      error.upstreamCode === "10030" &&
      error.requestId === "request-b",
  );
  await assert.rejects(
    () => client.list({ page: 0, pageSize: 2 }),
    (error) => error.code === FriendsErrorCode.InvalidInput,
  );
  server.close();
});

test("course detail projects only public course data", async (t) => {
  const server = createServer((req, res) => {
    if (req.url.endsWith("/checkUserAndGetUserLevel")) {
      replyIdentity(res);
      return;
    }
    if (req.url.endsWith("/user/info")) {
      json(res, 200, { code: "0", data: { userNo: "20210001", userName: "张三" } });
      return;
    }
    if (req.url.endsWith("/enterHall")) {
      json(res, 200, {
        code: "0",
        data: {
          account: "20210001",
          name: "张三",
          userLoginStateLevel: "XS",
          departmentNo: "24080",
        },
      });
      return;
    }
    if (req.url.endsWith("/course-empty")) {
      json(res, 200, {
        code: "0",
        data: {
          uuid: "course-empty",
          curriculumName: "空问卷课程",
          roles: [],
          questionnaires: [],
          approvalRecords: [{ reviewerName: "赵六" }],
        },
      });
      return;
    }
    assert.equal(req.url, "/gateway/zovecenter-saip-ek-app-curriculum/mob/apply/course-1");
    json(res, 200, {
      code: "0",
      message: "ok",
      data: {
        uuid: "course-1",
        curriculumName: "周周艺",
        organizationName: "艺术学院",
        curriculumLevel: "LEVEL",
        curriculumType: "TYPE",
        curriculumTypeName: "美育",
        curriculumPlace: "音乐厅",
        curriculumContent: "合唱训练",
        beginTime: "2026-10-01 10:00",
        endTime: "2026-10-01 12:00",
        openTime: "2026-09-01 10:00",
        deadline: "2026-09-30 12:00",
        isEnroll: true,
        isEnrollExamine: false,
        limitCollegeNo: ["24080"],
        limitGrade: ["2025"],
        limitSpecialtyTypeOne: ["B"],
        curriculumState: "NEW_LIVE_STATE",
        flowOverallState: 7,
        roles: [{ uuid: "role-1", roleName: "讲师", integral: 0.5, classHour: 2, reviewerName: "王五" }],
        questionnaires: [{ reviewerName: "张三" }],
        approvalStateRecords: [{ reviewerName: "李四" }],
        approvalRecords: [{ reviewerName: "王五" }],
      },
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const sdk = createFriendsSdk({ baseUrl: `http://127.0.0.1:${server.address().port}/gateway` });
  const client = await sdk.createCourseClient({
    token: "token",
    userLevel: "XS",
    account: { userNo: "20210001" },
    context: { levelNo: "XS", unit: { unitNo: "24080" } },
  });
  const detail = await client.get(courseId("course-1"));
  const emptyDetail = await client.get(courseId("course-empty"));

  assert.equal(detail.id, "course-1");
  assert.equal(detail.name, "周周艺");
  assert.deepEqual(detail.roles, [
    { uuid: "role-1", roleName: "讲师", integral: 0.5, classHour: 2 },
  ]);
  assert.deepEqual(detail.questionnaires, { count: 1, content: "unverified" });
  assert.deepEqual(emptyDetail.questionnaires, { count: 0, content: "none" });
  assert.deepEqual(emptyDetail.roles, []);
  assert.equal(JSON.stringify(detail).includes("reviewerName"), false);
  server.close();
});

test("SDK preserves the gateway prefix and rejects unsafe or invalid transport responses", async (t) => {
  let mode = "identity";
  let requests = 0;
  const server = createServer((req, res) => {
    requests += 1;
    if (mode === "identity" && req.url.endsWith("/checkUserAndGetUserLevel")) {
      replyIdentity(res);
      return;
    }
    if (mode === "identity" && req.url.endsWith("/user/info")) {
      json(res, 200, { code: "0", data: { userNo: "20210001", userName: "张三" } });
      return;
    }
    if (mode === "identity" && req.url.endsWith("/enterHall")) {
      json(res, 200, {
        code: "0",
        data: {
          account: "20210001",
          name: "张三",
          userLoginStateLevel: "XS",
          departmentNo: "24080",
        },
      });
      return;
    }
    if (mode === "non-2xx") {
      json(res, 502, { code: "0", message: "misleading success", data: {} });
    } else {
      res.writeHead(302, { location: "https://example.invalid/steal-token" });
      res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}/gateway`;
  const sdk = createFriendsSdk({ baseUrl });
  const client = await sdk.createCourseClient({
    token: "token",
    userLevel: "XS",
    account: { userNo: "20210001" },
    context: { levelNo: "XS", unit: { unitNo: "24080" } },
  });

  mode = "non-2xx";
  await assert.rejects(
    () => client.list({ page: 1, pageSize: 1 }),
    (error) => error.code === FriendsErrorCode.NetworkProtocol,
  );
  mode = "redirect";
  await assert.rejects(
    () => client.list({ page: 1, pageSize: 1 }),
    (error) => error.code === FriendsErrorCode.NetworkProtocol,
  );
  await assert.rejects(
    () => client.get("not/a-course-id"),
    (error) =>
      error.code === FriendsErrorCode.InvalidInput && requests === 5,
  );
  server.closeAllConnections();
  server.close();
});

test("SDK rejects unknown login types and verifies the entered level and unit", async (t) => {
  let loginType = "ON_PROXY";
  let enteredLevel = "WRONG";
  const server = createServer((req, res) => {
    if (req.url.endsWith("/user/info")) {
      json(res, 200, { code: "0", data: { userNo: "20210001", userName: "张三" } });
      return;
    }
    if (req.url.endsWith("/enterHall")) {
      json(res, 200, {
        code: "0",
        data: { account: "20210001", name: "张三", userLoginStateLevel: enteredLevel, departmentNo: "99999" },
      });
      return;
    }
    json(res, 200, {
      code: "0",
      data: {
        loginLevels: [{ levelNo: "XS", levelName: "学生", units: [{ unitType: 1, unitNo: "24080", unitName: "计算机学院" }] }],
        userLoginType: loginType,
      },
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const sdk = createFriendsSdk({ baseUrl: `http://127.0.0.1:${server.address().port}/gateway` });
  const input = { token: "token", userLevel: "XS" };

  await assert.rejects(
    () => sdk.activateLocalContext(input),
    (error) => error.code === FriendsErrorCode.NetworkProtocol,
  );
  loginType = "STUDENT_UNACTIVATED";
  enteredLevel = "XS";
  await assert.rejects(
    () => sdk.activateLocalContext(input),
    (error) => error.code === FriendsErrorCode.NetworkProtocol,
  );
  server.closeAllConnections();
  server.close();
});
