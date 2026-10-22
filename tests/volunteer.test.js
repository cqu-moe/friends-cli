import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  createFriendsSdk,
  FriendsErrorCode,
  volunteerActivityId,
  volunteerRegistrationId,
} from "../dist/index.js";
import {
  prepareVolunteerRegistrationInEgo,
  prepareVolunteerWithdrawalInEgo,
} from "../dist/node.js";

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

async function setupStrictVolunteerEgo(t, fixtureFile) {
  const actualRequests = [];
  const apiRequests = [];
  const html = await readFile(resolve("tests/fixtures", fixtureFile), "utf8");
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
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      if (/^\/(write|quit)$/.test(req.url ?? "") && req.method !== "GET") {
        actualRequests.push({ method: req.method, url: req.url });
        res.destroy();
        return;
      }
      if (req.url.startsWith("/mobile/")) {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(html);
        return;
      }
      const payload = body ? JSON.parse(body) : null;
      apiRequests.push({ method: req.method, url: req.url, body: payload });
      if (req.url.endsWith("/checkUserAndGetUserLevel")) return identity(res);
      if (req.url.endsWith("/user/info")) {
        return json(res, 200, { code: "0", data: { userNo: "20210001", userName: "张三" } });
      }
      if (req.url.endsWith("/enterHall")) {
        return json(res, 200, {
          code: "0",
          data: { account: "20210001", name: "张三", userLoginStateLevel: "XS", departmentNo: "unit-a" },
        });
      }
      if (req.url.endsWith("/school-activity-apply/approve-detail/activity-1")) {
        return json(res, 200, { code: "0", data: { ...activity, studentApplied: null } });
      }
      if (req.url.endsWith("/school-activity-apply/post/activity-1")) {
        return json(res, 200, { code: "0", data: posts });
      }
      if (req.url.endsWith("/schoolActivityStudentApply/can-apply/activity-1")) {
        return json(res, 200, { code: "0", data: true });
      }
      if (req.url.endsWith("/schoolActivityStudentApply/registration-1")) {
        return json(res, 200, { code: "0", data: registration });
      }
      return json(res, 200, { code: "0", data: null });
    });
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });

  const home = await mkdtemp(join(tmpdir(), "friends-volunteer-ego-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const result = join(home, "observed.json");
  const config = join(home, "ego.json");
  const isWithdrawalFixture = fixtureFile.includes("withdraw");
  const pagePath = isWithdrawalFixture
    ? "/mobile/volunteerManage/campusActivityInfo"
    : "/mobile/volunteerManage/campusActivityApplyDetail";
  const url = `http://127.0.0.1:${server.address().port}${pagePath}?uuid=activity-1`;
  await writeFile(config, JSON.stringify({
    html: resolve("tests/fixtures", fixtureFile),
    iframe: true,
    executeSession: true,
    result,
    url,
    token: "ego-fixture-token",
    accountUserNo: "20210001",
  }));
  const previousConfig = process.env.FRIENDS_EGO_FIXTURE_CONFIG;
  process.env.FRIENDS_EGO_FIXTURE_CONFIG = config;
  t.after(() => {
    if (previousConfig === undefined) delete process.env.FRIENDS_EGO_FIXTURE_CONFIG;
    else process.env.FRIENDS_EGO_FIXTURE_CONFIG = previousConfig;
  });
  const command = join(home, "ego-browser");
  await writeFile(command, [
    `#!${process.execPath}`,
    `await import(${JSON.stringify(new URL("fixtures/strict-ego.mjs", import.meta.url).href)});`,
    "",
  ].join("\n"));
  await chmod(command, 0o700);
  return {
    command,
    url,
    baseUrl: `http://127.0.0.1:${server.address().port}/gateway`,
    actualRequests,
    apiRequests,
    async observed() {
      return JSON.parse(await readFile(result, "utf8"));
    },
  };
}

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
  flowOverallState: 7,
  studentApplied: null,
  questionnaires: [
    {
      uuid: "question-text",
      activityId: "activity-1",
      title: "为什么参加",
      itemType: "TEXT",
      isMandatory: true,
      options: [],
    },
    {
      uuid: "question-choice",
      activityId: "activity-1",
      title: "是否同意服务安排",
      itemType: "CHOICE",
      isMandatory: false,
      options: [{ uuid: "option-a", optionName: "选项A" }],
    },
    {
      uuid: "question-multiple",
      activityId: "activity-1",
      title: "可携带物品",
      itemType: "MULTIPLE_CHOICE",
      isMandatory: false,
      options: [{ uuid: "option-b", optionName: "选项B" }, { uuid: "option-c", optionName: "选项C" }],
    },
    {
      uuid: "question-number",
      activityId: "activity-1",
      title: "服务人数",
      itemType: "NUMBER",
      isMandatory: false,
      options: [],
    },
    {
      uuid: "question-date",
      activityId: "activity-1",
      title: "可用日期",
      itemType: "DATE",
      isMandatory: false,
      options: [],
    },
  ],
};

const posts = [
  { uuid: "post-1", postName: "签到岗", duration: 2 },
  { uuid: "post-other", postName: "其他活动岗位", duration: 1 },
];

test("volunteer SDK completes queries, registration, withdrawal, and separate readback", async (t) => {
  const requests = [];
  let mode = "normal";
  let registered = false;
  let lostWriteRequests = 0;
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const payload = body ? JSON.parse(body) : null;
      requests.push({ method: req.method, url: req.url, headers: req.headers, body: payload });
      if (mode === "permission" && req.url.includes("/zovecenter-saip-ek-app-young-volunteers/")) {
        return json(res, 403, { message: "forbidden" });
      }
      if (mode === "teacher" && req.url.endsWith("/checkUserAndGetUserLevel")) {
        return json(res, 200, {
          code: "0",
          data: {
            loginLevels: [{ levelNo: "XS", units: [{ unitNo: "unit-a" }] }],
            userLoginType: "TEACHER",
          },
        });
      }
      if (req.url.endsWith("/checkUserAndGetUserLevel")) return identity(res);
      if (req.url.endsWith("/user/info")) {
        return json(res, 200, { code: "0", data: { userNo: "20210001", userName: "张三" } });
      }
      if (req.url.endsWith("/enterHall")) {
        return json(res, 200, {
          code: "0",
          data: { account: "20210001", name: "张三", userLoginStateLevel: "XS", departmentNo: "unit-a" },
        });
      }
      if (req.url.endsWith("/member/student-view")) {
        return json(res, 200, { code: "0", data: {}, message: "ok" });
      }
      if (req.url.endsWith("/member-apply/can-apply")) {
        return json(res, 200, { code: "0", data: true });
      }
      if (req.url.endsWith("/school-activity-apply/student-apply-page-list")) {
        if (mode === "null-list") return json(res, 200, { code: "0", data: { currentPage: 1, pageSize: 2, pages: 1, data: [null] } });
        return json(res, 200, {
          code: "0",
          data: {
            currentPage: payload.currentPage,
            pageSize: payload.pageSize,
            totalCount: 1,
            pages: 1,
            data: [activity],
          },
        });
      }
      if (req.url.endsWith("/school-activity-apply/manager-activity-list")) {
        if (mode === "null-list") return json(res, 200, { code: "0", data: [null] });
        return json(res, 200, {
          code: "0",
          data: [{ uuid: "activity-1", organizationId: "org-1", name: "示例组织", activityName: "示例志愿活动", positionSetMethod: null }],
        });
      }
      if (req.url.endsWith("/school-activity-apply/approve-detail/activity-1")) {
        if (mode === "closed") return json(res, 200, {
          code: "0",
          data: { ...activity, openTime: "1990-01-01 10:00", deadline: "2000-01-01 10:00" },
        });
        return json(res, 200, { code: "0", data: { ...activity, studentApplied: registered ? {
          uuid: "registration-1",
          activityId: "activity-1",
          studentNo: "20210001",
          postId: "post-1",
          postName: "签到岗",
          postDuration: 2,
          flowOverallState: 7,
          flowCurrMsg: "审核通过",
        } : null }, message: "ok", requestId: "detail-request" });
      }
      if (req.url.endsWith("/school-activity-apply/post/activity-1")) {
        return json(res, 200, { code: "0", data: posts });
      }
      if (req.url.endsWith("/schoolActivityStudentApply/can-apply/activity-1")) {
        return json(res, 200, { code: "0", data: mode === "ineligible" ? false : true });
      }
      if (req.url.endsWith("/school-activity-apply/my-applied-page-list")) {
        return json(res, 200, {
          code: "0",
          data: {
            currentPage: payload.currentPage,
            pageSize: payload.pageSize,
            totalCount: 1,
            pages: 1,
            data: [{
              ...activity,
              studentApplied: {
                uuid: "registration-1",
                activityId: "activity-1",
                studentNo: "20210001",
                postId: "post-1",
                postName: "签到岗",
                postDuration: 2,
                flowOverallState: 7,
                flowCurrMsg: "审核通过",
              },
            }],
          },
        });
      }
      if (req.url.endsWith("/schoolActivityStudentApply/registration-1")) {
        return json(res, 200, {
          code: "0",
          data: {
            uuid: "registration-1",
            activityId: "activity-1",
            studentNo: "20210001",
            postId: "post-1",
            postName: "签到岗",
            postDuration: 2,
            flowOverallState: 7,
            flowCurrMsg: "审核通过",
          },
        });
      }
      if (req.url.endsWith("/schoolActivityStudentApply/apply") && req.method === "POST") {
        if (mode === "lost") {
          lostWriteRequests += 1;
          req.socket.destroy();
          return;
        }
        registered = true;
        return json(res, 200, { code: "0", message: "报名成功", requestId: "register-request", data: null });
      }
      if (req.url.endsWith("/schoolActivityStudentApply/quit/registration-1") && req.method === "DELETE") {
        registered = false;
        return json(res, 200, { code: "0", message: "退出成功", requestId: "withdraw-request", data: null });
      }
      return json(res, 200, { code: "0", data: null });
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const sdk = createFriendsSdk({ baseUrl: `http://127.0.0.1:${server.address().port}/gateway`, timeoutMs: 1000 });
  const client = await sdk.createVolunteerClient({
    token: "token",
    userLevel: "XS",
    account: { userNo: "20210001" },
    context: { levelNo: "XS", unit: { unitNo: "unit-a" } },
  });

  await assert.rejects(
    () => client.register(volunteerActivityId("activity-1"), {
      postId: "post-1",
      questionnaireAnswers: [],
    }),
    (error) => error.code === FriendsErrorCode.InvalidInput &&
      error.message === "SDK volunteer registration requires confirmation: volunteers.register",
  );
  await assert.rejects(
    () => client.withdraw(
      volunteerActivityId("activity-1"),
      volunteerRegistrationId("registration-1"),
      {},
    ),
    (error) => error.code === FriendsErrorCode.InvalidInput &&
      error.message === "SDK volunteer withdrawal requires confirmation: volunteers.withdraw",
  );
  assert.equal(requests.length, 0);

  const identityResult = await client.getIdentity();
  assert.deepEqual(identityResult, {
    memberView: { present: true, interpreted: false },
    membershipApplicationAllowed: true,
  });
  const available = await client.listActivities({ page: 1, pageSize: 2, keyword: "示例" });
  assert.equal(available.items[0].id, "activity-1");
  assert.equal(available.items[0].state.raw, "ENROLLING");
  assert.equal(available.hasMore, false);
  assert.equal(JSON.stringify(available).includes("question-text"), false);
  const manageable = await client.listManageableActivities();
  assert.deepEqual(manageable, [{
    id: "activity-1",
    organizationId: "org-1",
    name: "示例组织",
    activityName: "示例志愿活动",
    positionSetMethod: null,
  }]);
  mode = "permission";
  await assert.rejects(() => client.listActivities({ page: 1, pageSize: 2 }), permissionError);
  await assert.rejects(() => client.listManageableActivities(), permissionError);
  mode = "null-list";
  await assert.rejects(() => client.listActivities({ page: 1, pageSize: 2 }), protocolError);
  await assert.rejects(() => client.listManageableActivities(), protocolError);
  mode = "normal";
  const detail = await client.getActivity(volunteerActivityId("activity-1"));
  assert.equal(detail.questionnaires[0].id, "question-text");
  const requirements = await client.getRegistrationRequirements(volunteerActivityId("activity-1"));
  assert.equal(requirements.canApply, true);
  assert.deepEqual(requirements.posts.map((post) => post.id), ["post-1", "post-other"]);
  assert.equal(requests.filter(({ url }) => url.endsWith("/checkUserAndGetUserLevel")).length, 1);
  mode = "teacher";
  const teacherClient = await sdk.createVolunteerClient({
    token: "token",
    userLevel: "XS",
    account: { userNo: "20210001" },
    context: { levelNo: "XS", unit: { unitNo: "unit-a" } },
  });
  await assert.rejects(
    () => teacherClient.register(volunteerActivityId("activity-1"), {
      postId: "post-1",
      confirmation: "volunteers.register",
    }),
    (error) => error.code === FriendsErrorCode.InvalidInput &&
      error.message === "Volunteer registration operations require a student session",
  );
  mode = "normal";

  await assert.rejects(
    () => client.register(volunteerActivityId("activity-1"), {
      postId: "post-1",
      confirmation: "volunteers.register",
      questionnaireAnswers: [
        { itemUuid: "question-text", type: "TEXT", inputContent: "服务社会" },
        { itemUuid: "question-choice", type: "CHOICE", optionUuid: 7 },
      ],
    }),
    (error) => error.code === FriendsErrorCode.InvalidInput &&
      error.message === "CHOICE questionnaire answer requires optionUuid",
  );
  await assert.rejects(
    () => client.register(volunteerActivityId("activity-1"), {
      postId: "post-1",
      confirmation: "volunteers.register",
      questionnaireAnswers: [
        { itemUuid: "question-text", type: "TEXT", inputContent: "服务社会" },
        { itemUuid: "question-date", type: "DATE", inputContent: 20261022 },
      ],
    }),
    (error) => error.code === FriendsErrorCode.InvalidInput &&
      error.message === "DATE questionnaire answer requires inputContent",
  );

  const receipt = await client.register(volunteerActivityId("activity-1"), {
    postId: "post-1",
    confirmation: "volunteers.register",
    questionnaireAnswers: [
      { itemUuid: "question-text", type: "TEXT", inputContent: "服务社会" },
      { itemUuid: "question-choice", type: "CHOICE", optionUuid: "option-a" },
      { itemUuid: "question-multiple", type: "MULTIPLE_CHOICE", optionUuids: ["option-b", "option-c"] },
      { itemUuid: "question-number", type: "NUMBER", inputContent: "3" },
      { itemUuid: "question-date", type: "DATE", inputContent: "2026-10-22" },
    ],
  });
  assert.equal(receipt.receipt.serverAcknowledged, true);
  assert.equal(receipt.receipt.approved, null);
  assert.equal(receipt.receipt.readbackRequired, true);
  assert.equal(receipt.readback.attempted, true);
  assert.equal(receipt.readback.coverage, "first-page-only");
  assert.equal(receipt.readback.activityFound, true);
  assert.equal(receipt.readback.matchingRegistration.id, "registration-1");
  const registrationPage = await client.listRegistrations({ page: 1, pageSize: 2 });
  assert.equal(registrationPage.items[0].registration.id, "registration-1");
  assert.equal(registrationPage.items[0].registration.state.approved, true);
  const registration = await client.getRegistration(volunteerRegistrationId("registration-1"));
  assert.equal(registration.id, "registration-1");
  const withdrawal = await client.withdraw(
    volunteerActivityId("activity-1"),
    volunteerRegistrationId("registration-1"),
    { confirmation: "volunteers.withdraw" },
  );
  assert.equal(withdrawal.receipt.serverAcknowledged, true);
  assert.equal(withdrawal.readback.attempted, true);
  assert.equal(withdrawal.readback.matchingRegistration.id, "registration-1");

  const writeRequests = requests.filter(({ url, method }) =>
    url.endsWith("/schoolActivityStudentApply/apply") && method === "POST");
  assert.equal(writeRequests.length, 1);
  assert.equal(writeRequests[0].headers["h-zove-appkey"], "zovecenter-saip-ek-app-young-volunteers");
  assert.deepEqual(writeRequests[0].body, {
    activityId: "activity-1",
    postId: "post-1",
    postDuration: 2,
    postName: "签到岗",
    questionnaireResult: [
      {
        activityId: "activity-1",
        itemType: "TEXT",
        itemUuid: "question-text",
        optionUuid: "",
        uuid: "question-text",
        studentNo: "20210001",
        title: "为什么参加",
        multipartChoice: null,
        inputContent: "服务社会",
        attachmentGroupUuid: "",
      },
      {
        activityId: "activity-1",
        itemType: "CHOICE",
        itemUuid: "question-choice",
        optionUuid: "option-a",
        uuid: "question-choice",
        studentNo: "20210001",
        title: "是否同意服务安排",
        multipartChoice: null,
        inputContent: "",
        attachmentGroupUuid: "",
      },
      {
        activityId: "activity-1",
        itemType: "MULTIPLE_CHOICE",
        itemUuid: "question-multiple",
        optionUuid: "",
        uuid: "question-multiple",
        studentNo: "20210001",
        title: "可携带物品",
        multipartChoice: [
          { uuid: "option-b", optionName: "选项B", optionUuid: "option-b" },
          { uuid: "option-c", optionName: "选项C", optionUuid: "option-c" },
        ],
        inputContent: "",
        attachmentGroupUuid: "",
      },
      {
        activityId: "activity-1",
        itemType: "NUMBER",
        itemUuid: "question-number",
        optionUuid: "",
        uuid: "question-number",
        studentNo: "20210001",
        title: "服务人数",
        multipartChoice: null,
        inputContent: "3",
        attachmentGroupUuid: "",
      },
      {
        activityId: "activity-1",
        itemType: "DATE",
        itemUuid: "question-date",
        optionUuid: "",
        uuid: "question-date",
        studentNo: "20210001",
        title: "可用日期",
        multipartChoice: null,
        inputContent: "2026-10-22",
        attachmentGroupUuid: "",
      },
    ],
    studentNo: "20210001",
    uuid: null,
  });
  const quit = requests.find(({ url, method }) =>
    url.endsWith("/schoolActivityStudentApply/quit/registration-1") && method === "DELETE");
  assert.equal(quit.headers["h-zove-appkey"], "zovecenter-saip-ek-app-young-volunteers");

  mode = "lost";
  await assert.rejects(
    () => client.register(volunteerActivityId("activity-1"), {
      postId: "post-1",
      confirmation: "volunteers.register",
      questionnaireAnswers: [{ itemUuid: "question-text", type: "TEXT", inputContent: "再次服务" }],
    }),
    (error) => {
      assert.equal(error.code, FriendsErrorCode.UnknownOutcome);
      assert.equal(error.retryable, false);
      assert.equal(error.recovery.operation, "volunteers.register");
      assert.equal(error.recovery.activityId, "activity-1");
      return true;
    },
  );
  assert.equal(lostWriteRequests, 1);
});

test("public volunteer Node SDK executes visible strict DOM and stops before final requests", async (t) => {
  const register = await setupStrictVolunteerEgo(t, "volunteer-apply-fixture.html");
  const input = {
    postId: "post-1",
    questionnaireAnswers: [
      { itemUuid: "question-text", type: "TEXT", inputContent: "受控验收答案" },
      { itemUuid: "question-choice", type: "CHOICE", optionUuid: "option-a" },
      { itemUuid: "question-multiple", type: "MULTIPLE_CHOICE", optionUuids: ["option-b", "option-c"] },
      { itemUuid: "question-number", type: "NUMBER", inputContent: "3" },
    ],
  };
  const preparation = await prepareVolunteerRegistrationInEgo({
    activityId: "activity-1",
    input,
    taskSpaceId: 7,
    baseUrl: register.baseUrl,
    command: register.command,
    timeoutMs: 5000,
    schoolTimeoutMs: 1000,
  });
  assert.equal(preparation.status, "awaiting-user");
  assert.equal(preparation.activityId, "activity-1");
  assert.equal(preparation.pageLabel, "p1");
  assert.equal(preparation.submitted, false);
  assert.equal(preparation.handoff, true);
  assert.equal(preparation.verification.account.userNo, "20210001");
  assert.ok(preparation.completedActions.includes("session-verified"));
  assert.ok(preparation.completedActions.includes("activity-verified"));
  assert.ok(preparation.completedActions.includes("post:selected"));
  assert.deepEqual(preparation.preservedFields, ["question:为什么参加", "question:是否同意服务安排"]);
  const observed = await register.observed();
  assert.equal(observed.newPages, 1);
  assert.equal(observed.navigations, 1);
  assert.equal(observed.handoffs, 1);
  assert.deepEqual(
    observed.fieldValues.filter((field) => field.value !== "").map((field) => field.value),
    ["post-1", "人工已经填写", "3"],
  );
  assert.equal(observed.html.match(/data-selected="true"|aria-checked="true"/g)?.length, 3);
  assert.equal(observed.clicks.length, 5);
  assert.equal(observed.fills.length, 1);
  assert.match(observed.html, /申请加入/);
  assert.doesNotMatch(observed.html, />提交</);
  assert.equal(observed.finalRequests, 0);
  assert.deepEqual(register.actualRequests, []);
  assert.ok(register.apiRequests.some(({ url }) => url.endsWith("/school-activity-apply/approve-detail/activity-1")));
  assert.ok(register.apiRequests.some(({ url }) => url.endsWith("/school-activity-apply/post/activity-1")));
  assert.ok(register.apiRequests.some(({ url }) => url.endsWith("/schoolActivityStudentApply/can-apply/activity-1")));

  const withdraw = await setupStrictVolunteerEgo(t, "volunteer-withdraw-fixture.html");
  const withdrawal = await prepareVolunteerWithdrawalInEgo({
    activityId: "activity-1",
    registrationId: "registration-1",
    taskSpaceId: 7,
    baseUrl: withdraw.baseUrl,
    command: withdraw.command,
    timeoutMs: 5000,
    schoolTimeoutMs: 1000,
  });
  assert.equal(withdrawal.submitted, false);
  const withdrawalObserved = await withdraw.observed();
  assert.equal(withdrawalObserved.newPages, 1);
  assert.deepEqual(withdrawalObserved.clicks, []);
  assert.equal(withdrawalObserved.handoffs, 1);
  assert.deepEqual(withdraw.actualRequests, []);

  const interrupted = await setupStrictVolunteerEgo(t, "volunteer-apply-interrupted-fixture.html");
  const beforeInvalidInput = interrupted.apiRequests.length;
  await assert.rejects(
    () => prepareVolunteerRegistrationInEgo({
      activityId: "activity-1",
      input: { postId: "post-1", questionnaireAnswers: [{ itemUuid: "question-number", type: "BOOLEAN", inputContent: "x" }] },
      taskSpaceId: 7,
      baseUrl: interrupted.baseUrl,
      command: interrupted.command,
    }),
    (error) => error.code === FriendsErrorCode.InvalidInput && interrupted.apiRequests.length === beforeInvalidInput,
  );
  await assert.rejects(
    () => prepareVolunteerRegistrationInEgo({
      activityId: "not/a-volunteer-activity",
      input,
      taskSpaceId: 7,
      baseUrl: interrupted.baseUrl,
      command: interrupted.command,
    }),
    (error) => error.code === FriendsErrorCode.InvalidInput && interrupted.apiRequests.length === beforeInvalidInput,
  );
  await assert.rejects(
    () => prepareVolunteerRegistrationInEgo({
      activityId: "activity-1",
      input,
      taskSpaceId: 7,
      baseUrl: interrupted.baseUrl,
      command: interrupted.command,
      timeoutMs: 0,
    }),
    (error) => error.code === FriendsErrorCode.InvalidInput && interrupted.apiRequests.length === beforeInvalidInput,
  );
  await assert.rejects(
    () => prepareVolunteerRegistrationInEgo({
      activityId: "activity-1",
      input,
      taskSpaceId: 7,
      baseUrl: interrupted.baseUrl,
      command: interrupted.command,
      timeoutMs: 5000,
      schoolTimeoutMs: 1000,
    }),
    (error) => {
      assert.equal(error.code, FriendsErrorCode.UnknownOutcome);
      assert.equal(error.retryable, false);
      assert.equal(error.recovery.activityId, "activity-1");
      assert.equal(error.recovery.pageLabel, "p1");
      assert.equal(error.recovery.serverAcknowledged, false);
      assert.ok(error.recovery.completed.includes("post:selected"));
      return true;
    },
  );
  const interruptedObserved = await interrupted.observed();
  assert.equal(interruptedObserved.handoffs, 1);
  assert.equal(interruptedObserved.finalRequests, 0);
  assert.deepEqual(interrupted.actualRequests, []);
});

test("volunteer SDK rejects invalid state, ownership, domain IDs, and unsupported questions before writes", async (t) => {
  let mode = "normal";
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      if (req.url.endsWith("/checkUserAndGetUserLevel")) return identity(res);
      if (req.url.endsWith("/user/info")) return json(res, 200, { code: "0", data: { userNo: "20210001", userName: "张三" } });
      if (req.url.endsWith("/enterHall")) {
        return json(res, 200, { code: "0", data: { account: "20210001", name: "张三", userLoginStateLevel: "XS", departmentNo: "unit-a" } });
      }
      const detail = {
        ...activity,
        questionnaires: [{
          uuid: "question-upload",
          activityId: "activity-1",
          title: "上传照片",
          itemType: "PICTURE",
          isMandatory: false,
          options: [],
        }],
      };
      if (mode === "ineligible" && req.url.endsWith("/schoolActivityStudentApply/can-apply/activity-1")) {
        return json(res, 200, { code: "0", data: false });
      }
      if (mode === "duplicate" && req.url.endsWith("/school-activity-apply/approve-detail/activity-1")) {
        return json(res, 200, { code: "0", data: { ...detail, studentApplied: { uuid: "registration-1", studentNo: "20210001" } } });
      }
      if (mode === "closed" && req.url.endsWith("/school-activity-apply/approve-detail/activity-1")) {
        return json(res, 200, {
          code: "0",
          data: { ...detail, openTime: "1990-01-01 10:00", deadline: "2000-01-01 10:00" },
        });
      }
      if (mode === "other-student" && req.url.endsWith("/schoolActivityStudentApply/registration-1")) {
        return json(res, 200, { code: "0", data: { uuid: "registration-1", activityId: "activity-1", studentNo: "20219999", flowOverallState: 7 } });
      }
      if (mode === "unapproved" && req.url.endsWith("/schoolActivityStudentApply/registration-1")) {
        return json(res, 200, { code: "0", data: { uuid: "registration-1", activityId: "activity-1", studentNo: "20210001", flowOverallState: 3 } });
      }
      if (req.url.endsWith("/school-activity-apply/approve-detail/activity-1")) return json(res, 200, { code: "0", data: detail });
      if (req.url.endsWith("/school-activity-apply/post/activity-1")) return json(res, 200, { code: "0", data: posts });
      if (req.url.endsWith("/schoolActivityStudentApply/can-apply/activity-1")) return json(res, 200, { code: "0", data: true });
      return json(res, 200, { code: "0", data: null });
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const sdk = createFriendsSdk({ baseUrl: `http://127.0.0.1:${server.address().port}/gateway` });
  const client = await sdk.createVolunteerClient({
    token: "token",
    userLevel: "XS",
    account: { userNo: "20210001" },
    context: { levelNo: "XS", unit: { unitNo: "unit-a" } },
  });
  const invalidCases = [
    [() => client.register(volunteerActivityId("activity-1"), {
      postId: "post-other-activity",
      confirmation: "volunteers.register",
      questionnaireAnswers: [],
    }), "Post does not belong to this volunteer activity"],
    [() => client.register(volunteerActivityId("activity-1"), {
      postId: "post-1",
      confirmation: "volunteers.register",
      questionnaireAnswers: [{ itemUuid: "question-other-activity", type: "TEXT", inputContent: "无关答案" }],
    }), "Questionnaire answer does not belong to this activity"],
    [() => client.register(volunteerActivityId("activity-1"), {
      postId: "post-1",
      confirmation: "volunteers.register",
      questionnaireAnswers: [],
    }), "Unsupported volunteer questionnaire type PICTURE: uploads are not implemented"],
    [() => client.register(volunteerActivityId("activity-1"), {
      postId: "post-1",
      confirmation: "volunteers.register",
      questionnaireAnswers: [],
    }), "This account already has a volunteer registration for the activity"],
    [() => client.register(volunteerActivityId("activity-1"), {
      postId: "post-1",
      confirmation: "volunteers.register",
      questionnaireAnswers: [],
    }), "Volunteer registration window is closed"],
    [() => client.register(volunteerActivityId("activity-1"), {
      postId: "post-1",
      confirmation: "volunteers.register",
      questionnaireAnswers: [],
    }), "The school API says this account cannot apply now"],
    [() => client.withdraw(
      volunteerActivityId("activity-1"),
      volunteerRegistrationId("registration-1"),
      { confirmation: "volunteers.withdraw" },
    ), "Volunteer registration belongs to another student"],
    [() => client.withdraw(
      volunteerActivityId("activity-1"),
      volunteerRegistrationId("registration-1"),
      { confirmation: "volunteers.withdraw" },
    ), "Only an approved volunteer registration can be quit"],
  ];
  for (let index = 0; index < invalidCases.length; index += 1) {
    if (index === 3) mode = "duplicate";
    if (index === 4) mode = "closed";
    if (index === 5) mode = "ineligible";
    if (index === 6) mode = "other-student";
    if (index === 7) mode = "unapproved";
    await assert.rejects(invalidCases[index][0], (error) => {
      assert.equal(error.code, FriendsErrorCode.InvalidInput);
      assert.equal(error.message, invalidCases[index][1]);
      return true;
    });
  }

  assert.throws(() => volunteerActivityId("not/a-volunteer-activity"), invalidIdError);
  assert.throws(() => volunteerRegistrationId("not/a-volunteer-registration"), invalidIdError);
});

function invalidIdError(error) {
  return error.code === FriendsErrorCode.InvalidInput && error.message.startsWith("Invalid volunteer");
}

function permissionError(error) {
  return error.code === FriendsErrorCode.PermissionDenied;
}

function protocolError(error) {
  return error.code === FriendsErrorCode.NetworkProtocol;
}
