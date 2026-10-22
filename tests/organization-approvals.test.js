import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { createFriendsSdk, FriendsErrorCode } from "../dist/index.js";

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

test("organization SDK reads join and exit applications with their current relations", async (t) => {
  const requests = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      requests.push({
        method: req.method,
        url: req.url,
        body: body === "" ? null : JSON.parse(body),
      });
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
            uuid: "org-fixture",
            organizationName: "示例组织",
            organizationType: "STUDENT_CLUB",
            responsiblePerson: "20219999",
            currentUserIsManager: true,
          }],
        });
      }
      if (req.method === "POST" && req.url.endsWith("/student-organization-apply/approve-list")) {
        const input = JSON.parse(body);
        const targetUuid = input.applyType === 1 ? "join-application" : "exit-application";
        if (input.currentPage === 1) {
          return reply(res, {
            code: "0",
            data: {
              currentPage: 1,
              pageSize: input.pageSize,
              totalCount: 2,
              pages: 2,
              data: [{
                uuid: "first-page-application",
                organizationId: "org-fixture",
                studentNo: "20210002",
                studentName: "示例成员",
                flowCurrMsg: "等待审批",
              }],
            },
          });
        }
        return reply(res, {
          code: "0",
          data: {
            currentPage: input.currentPage,
            pageSize: input.pageSize,
            totalCount: 1,
            pages: 1,
            data: [{
              uuid: targetUuid,
              organizationId: "org-fixture",
              studentNo: "20210002",
              studentName: "示例成员",
              flowCurrMsg: "等待审批",
              privateField: "must-not-project",
            }],
          },
        });
      }
      if (req.method === "GET" && req.url.endsWith("/student-organization-apply/join-application")) {
        return reply(res, {
          code: "0",
          data: {
            uuid: "join-application",
            organizationId: "org-fixture",
            studentNo: "20210002",
            studentName: "示例成员",
            flowCurrMsg: "等待审批",
            privateField: "school-detail-value",
          },
        });
      }
      if (req.url === "/gateway/zovecenter-saip-ek-app-team-organization-manage/mob/student-organization-info/join-exit?organizationId=org-fixture&studentNo=20210002") {
        return reply(res, {
          code: "0",
          data: [{
            uuid: "relation-fixture",
            state: 1,
            joinTime: "2026-01-01",
            exitTime: null,
            privateField: "must-not-project",
          }],
        });
      }
      return reply(res, 404, {});
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });

  const sdk = createFriendsSdk({
    baseUrl: `http://127.0.0.1:${server.address().port}/gateway`,
    timeoutMs: 250,
  });
  const client = await sdk.createOrganizationClient({
    token: "org-token",
    userLevel: "XS",
    account: { userNo: "20210001", userName: "示例管理员" },
    context: {
      levelNo: "XS",
      levelName: "学生",
      unit: { unitType: 2, unitNo: "24080", unitName: "示例学院" },
    },
  });

  const join = await client.listApplications("org-fixture", "join", {
    page: 2,
    pageSize: 5,
    keyword: "示例成员",
  });
  assert.equal(join.page, 2);
  assert.deepEqual(join.items, [{
    id: "join-application",
    organizationId: "org-fixture",
    studentNo: "20210002",
    studentName: "示例成员",
    flowMessage: "等待审批",
  }]);

  const firstExitPage = await client.listApplications("org-fixture", "exit", {});
  assert.equal(firstExitPage.items[0].id, "first-page-application");
  assert.equal(firstExitPage.hasMore, true);
  const exit = await client.listApplications("org-fixture", "exit", { page: 2 });
  assert.equal(exit.items[0].id, "exit-application");
  assert.equal(JSON.stringify(exit).includes("privateField"), false);

  const detail = await client.getApplication("join", "join-application");
  assert.deepEqual(detail, {
    id: "join-application",
    organizationId: "org-fixture",
    studentNo: "20210002",
    studentName: "示例成员",
    flowMessage: "等待审批",
    relation: {
      id: "relation-fixture",
      state: 1,
      active: true,
      joinTime: "2026-01-01",
      exitTime: null,
    },
  });

  const listRequest = requests.find((request) =>
    request.method === "POST" && request.url.endsWith("/student-organization-apply/approve-list") &&
    request.body.applyType === 1,
  );
  assert.deepEqual(listRequest.body, {
    currentPage: 2,
    pageSize: 5,
    applyType: 1,
    organizationId: "org-fixture",
    key: "示例成员",
  });
  const relationRequest = requests.find((request) => request.url.includes("/join-exit?"));
  assert.equal(
    relationRequest.url,
    "/gateway/zovecenter-saip-ek-app-team-organization-manage/mob/student-organization-info/join-exit?organizationId=org-fixture&studentNo=20210002",
  );
});

test("organization SDK prepares one pending application without submitting it", async (t) => {
  const requests = [];
  let listMode = "pending";
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
            uuid: "org-fixture",
            organizationName: "示例组织",
            organizationType: "STUDENT_CLUB",
            responsiblePerson: "20219999",
            currentUserIsManager: true,
          }],
        });
      }
      if (req.url.endsWith("/biz-common/flow/template-activity-state")) {
        assert.deepEqual(JSON.parse(body), {
          businessTypeCode: "社团加入退出申请",
          handleType: "XS02",
        });
        return reply(res, {
          code: "0",
          data: [
            { code: "DONE", value: "已完成" },
            { code: "WAIT", value: "等待审批" },
          ],
        });
      }
      if (req.method === "POST" && req.url.endsWith("/student-organization-apply/approve-list")) {
        const input = JSON.parse(body);
        if (input.approvalState !== "WAIT" || listMode === "processed") {
          return reply(res, { code: "0", data: { data: [], currentPage: 1, pageSize: 10, pages: 0, totalCount: 0 } });
        }
        return reply(res, {
          code: "0",
          data: {
            data: [{ uuid: "join-application", organizationId: "org-fixture" }],
            currentPage: 1,
            pageSize: 10,
            pages: 1,
            totalCount: 1,
          },
        });
      }
      if (req.method === "GET" && req.url.endsWith("/student-organization-apply/join-application")) {
        return reply(res, {
          code: "0",
          data: {
            uuid: "join-application",
            organizationId: "org-fixture",
            studentNo: "20210002",
            studentName: "示例成员",
            flowCurrMsg: "等待审批",
            specialSkill: "示例技能",
            schoolInternalField: "must-round-trip",
          },
        });
      }
      if (req.url.includes("/student-organization-info/join-exit?")) {
        return reply(res, {
          code: "0",
          data: [{ uuid: "relation-fixture", state: 1, joinTime: "2026-01-01", exitTime: null }],
        });
      }
      return reply(res, 404, {});
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const sdk = createFriendsSdk({
    baseUrl: `http://127.0.0.1:${server.address().port}/gateway`,
    timeoutMs: 250,
  });
  const client = await sdk.createOrganizationClient({
    token: "org-token",
    userLevel: "XS",
    account: { userNo: "20210001", userName: "示例管理员" },
    context: {
      levelNo: "XS",
      levelName: "学生",
      unit: { unitType: 2, unitNo: "24080", unitName: "示例学院" },
    },
  });

  const beforeInvalidCalls = requests.length;
  for (const invalidInput of [
    { organizationId: "org-fixture", applicationId: "join-application", type: "join", decision: "send-back", message: "打回", time: "2026-10-22" },
    { organizationId: "org-fixture", applicationId: "join-application", type: "join", decision: "approve", message: " ", time: "2026-10-22" },
    { organizationId: "org-fixture", applicationId: "join-application", type: "join", decision: "approve", message: "同意", time: "2026/10/22" },
  ]) {
    await assert.rejects(
      () => client.prepareApplicationDecision(invalidInput),
      (error) => error.code === FriendsErrorCode.InvalidInput,
    );
  }
  assert.equal(requests.length, beforeInvalidCalls);

  const prepared = await client.prepareApplicationDecision({
    organizationId: "org-fixture",
    applicationId: "join-application",
    type: "join",
    decision: "approve",
    message: " 同意加入 ",
    time: "2026-10-22",
  });
  assert.equal(prepared.status, "prepared");
  assert.equal(prepared.submitted, false);
  assert.equal(prepared.applicationId, "join-application");
  assert.equal(prepared.organizationId, "org-fixture");
  assert.equal(prepared.type, "join");
  assert.equal(prepared.decision, "approve");
  assert.equal(prepared.message, "同意加入");
  assert.equal(prepared.time, "2026-10-22");
  assert.equal(prepared.relation.active, true);
  assert.equal(prepared.payload.schoolInternalField, "must-round-trip");
  assert.equal(prepared.payload.uuid, "join-application");
  assert.equal(
    requests.some((request) => request.method === "POST" && request.url.endsWith("/student-organization-apply/approve")),
    false,
  );
  const pendingRequest = requests.find((request) =>
    request.method === "POST" && request.url.endsWith("/approve-list") && request.body.key === "20210002",
  );
  assert.equal(pendingRequest.body.approvalState, "WAIT");
  assert.equal(pendingRequest.body.applyType, 1);

  listMode = "processed";
  await assert.rejects(
    () => client.prepareApplicationDecision({
      organizationId: "org-fixture",
      applicationId: "join-application",
      type: "join",
      decision: "approve",
      message: "再次同意",
      time: "2026-10-22",
    }),
    (error) => error.code === FriendsErrorCode.UpstreamBusiness &&
      error.recovery.completed.includes("state:pending-only"),
  );
  assert.equal(
    requests.some((request) => request.method === "POST" && request.url.endsWith("/student-organization-apply/approve")),
    false,
  );
});

test("organization SDK confirms one application decision once and preserves unknown outcomes", async (t) => {
  const requests = [];
  let managedMode = "manager";
  let detailMode = "original";
  let detailOrganizationMode = "same";
  let postMode = "ack";
  let pendingReadbackMode = "removed";
  let relationMode = "active";
  let applicationMode = "join";
  let writeCount = 0;
  let readbackPhase = false;
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
        if (managedMode === "revoked") return reply(res, { code: "0", data: [] });
        if (managedMode === "member") {
          return reply(res, {
            code: "0",
            data: [{
              uuid: "org-fixture",
              organizationName: "示例组织",
              organizationType: "STUDENT_CLUB",
              responsiblePerson: "20219999",
              currentUserIsManager: false,
            }],
          });
        }
        return reply(res, {
          code: "0",
          data: [{
            uuid: "org-fixture",
            organizationName: "示例组织",
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
        if (readbackPhase) {
          if (pendingReadbackMode === "lost") {
            req.destroy();
            return;
          }
          if (pendingReadbackMode === "still-pending") {
            return reply(res, {
              code: "0",
              data: {
                data: [{
                  uuid: applicationMode === "join" ? "join-application" : "exit-application",
                  organizationId: "org-fixture",
                }],
                currentPage: 1,
                pageSize: 10,
                pages: 1,
                totalCount: 1,
              },
            });
          }
          return reply(res, {
            code: "0",
            data: { data: [], currentPage: 1, pageSize: 10, pages: 0, totalCount: 0 },
          });
        }
        if (input.approvalState !== "WAIT") {
          return reply(res, { code: "0", data: { data: [], currentPage: 1, pageSize: 10, pages: 0, totalCount: 0 } });
        }
        if (input.applyType !== (applicationMode === "join" ? 1 : 0)) {
          return reply(res, { code: "0", data: { data: [], currentPage: 1, pageSize: 10, pages: 0, totalCount: 0 } });
        }
        return reply(res, {
          code: "0",
          data: {
            data: [{
              uuid: applicationMode === "join" ? "join-application" : "exit-application",
              organizationId: "org-fixture",
            }],
            currentPage: 1,
            pageSize: 10,
            pages: 1,
            totalCount: 1,
          },
        });
      }
      if (
        req.method === "GET" &&
        (req.url.endsWith("/student-organization-apply/join-application") ||
          req.url.endsWith("/student-organization-apply/exit-application"))
      ) {
        const applicationId = applicationMode === "join" ? "join-application" : "exit-application";
        return reply(res, {
          code: "0",
          data: {
            uuid: applicationId,
            organizationId: detailOrganizationMode === "cross" ? "other-org" : "org-fixture",
            studentNo: "20210002",
            studentName: "示例成员",
            flowCurrMsg: "等待审批",
            specialSkill: detailMode === "changed" ? "并发变化" : "原始技能",
            schoolInternalField: "must-round-trip",
          },
        });
      }
      if (req.method === "POST" && req.url.endsWith("/student-organization-apply/approve")) {
        writeCount += 1;
        readbackPhase = true;
        if (postMode === "lost") {
          req.destroy();
          return;
        }
        return reply(res, { code: "0", message: "操作成功" });
      }
      if (req.url.includes("/student-organization-info/join-exit?")) {
        if (relationMode === "lost") {
          req.destroy();
          return;
        }
        return reply(res, {
          code: "0",
          data: [{
            uuid: "relation-fixture",
            state: applicationMode === "join" ? 1 : 0,
            joinTime: "2026-01-01",
            exitTime: applicationMode === "join" ? null : "2026-10-22",
          }],
        });
      }
      return reply(res, 404, {});
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const sdk = createFriendsSdk({
    baseUrl: `http://127.0.0.1:${server.address().port}/gateway`,
    timeoutMs: 250,
  });
  const client = await sdk.createOrganizationClient({
    token: "org-token",
    userLevel: "XS",
    account: { userNo: "20210001", userName: "示例管理员" },
    context: {
      levelNo: "XS",
      levelName: "学生",
      unit: { unitType: 2, unitNo: "24080", unitName: "示例学院" },
    },
  });
  const input = {
    organizationId: "org-fixture",
    applicationId: "join-application",
    type: "join",
    decision: "approve",
    message: "同意加入",
    time: "2026-10-22",
  };
  const intent = {
    via: "api",
    intent: "decide-organization-application",
    confirm: true,
  };
  readbackPhase = false;
  const prepared = await client.prepareApplicationDecision(input);
  const decisionRequestCount = () =>
    requests.filter((request) => request.url.endsWith("/student-organization-apply/approve")).length;

  const beforeIntentValidation = requests.length;
  for (const invalidIntent of [
    undefined,
    { ...intent, via: "ego" },
    { ...intent, intent: "save-organization-profile" },
    { ...intent, confirm: false },
    { ...intent, extra: "unknown" },
  ]) {
    await assert.rejects(
      () => client.decideApplication(prepared, invalidIntent),
      (error) => error.code === FriendsErrorCode.InvalidInput,
    );
  }
  assert.equal(requests.length, beforeIntentValidation);
  assert.equal(decisionRequestCount(), 0);

  managedMode = "revoked";
  await assert.rejects(
    () => client.decideApplication(prepared, intent),
    (error) => error.code === FriendsErrorCode.PermissionDenied,
  );
  assert.equal(decisionRequestCount(), 0);
  managedMode = "manager";

  managedMode = "member";
  await assert.rejects(
    () => client.prepareApplicationDecision({ ...input, message: "成员无权" }),
    (error) => error.code === FriendsErrorCode.PermissionDenied,
  );
  assert.equal(decisionRequestCount(), 0);
  managedMode = "manager";
  const isolatedClient = await sdk.createOrganizationClient({
    token: "org-token",
    userLevel: "XS",
    account: { userNo: "20210001", userName: "示例管理员" },
    context: {
      levelNo: "XS",
      levelName: "学生",
      unit: { unitType: 2, unitNo: "24080", unitName: "示例学院" },
    },
  });

  detailOrganizationMode = "cross";
  await assert.rejects(
    () => isolatedClient.prepareApplicationDecision({ ...input, message: "跨组织" }),
    (error) => error.code === FriendsErrorCode.PermissionDenied,
  );
  assert.equal(decisionRequestCount(), 0);
  detailOrganizationMode = "same";

  await assert.rejects(
    () => isolatedClient.prepareApplicationDecision({ ...input, type: "exit", message: "类型混淆" }),
    (error) => error.code === FriendsErrorCode.UpstreamBusiness &&
      error.recovery.completed.includes("state:pending-only"),
  );
  assert.equal(decisionRequestCount(), 0);

  detailMode = "changed";
  await assert.rejects(
    () => client.decideApplication(prepared, intent),
    (error) => error.code === FriendsErrorCode.UpstreamBusiness &&
      error.recovery.completed.includes("application:changed"),
  );
  assert.equal(decisionRequestCount(), 0);
  detailMode = "original";

  const decided = await client.decideApplication(prepared, intent);
  assert.equal(decided.status, "decided");
  assert.equal(decided.submitted, true);
  assert.equal(decided.serverAcknowledged, true);
  assert.equal(decided.applicationNoLongerPending, true);
  assert.equal(decided.relation.active, true);
  assert.equal(decisionRequestCount(), 1);
  const decisionRequest = requests.find((request) =>
    request.method === "POST" && request.url.endsWith("/student-organization-apply/approve"),
  );
  assert.equal(decisionRequest.body.identified, "AGREEMENT");
  assert.equal(decisionRequest.body.handleType, "XS02");
  assert.equal(decisionRequest.body.uuid, "join-application");
  assert.equal(decisionRequest.body.msg, "同意加入");
  assert.equal(decisionRequest.body.time, "2026-10-22");
  assert.equal(decisionRequest.body.studentOrganizationInfoApproveAddReqDto.uuid, "join-application");
  assert.equal(
    decisionRequest.body.studentOrganizationInfoApproveAddReqDto.schoolInternalField,
    "must-round-trip",
  );

  postMode = "lost";
  readbackPhase = false;
  const lost = await client.prepareApplicationDecision({ ...input, message: "响应丢失" });
  const writesBeforeLost = decisionRequestCount();
  await assert.rejects(
    () => client.decideApplication(lost, intent),
    (error) => error.code === FriendsErrorCode.UnknownOutcome &&
      error.retryable === false &&
      error.recovery.applicationId === "join-application" &&
      error.recovery.serverAcknowledged === "unknown" &&
      error.recovery.readback === "matched" &&
      decisionRequestCount() === writesBeforeLost + 1,
  );
  postMode = "ack";

  pendingReadbackMode = "lost";
  readbackPhase = false;
  const lostReadback = await client.prepareApplicationDecision({ ...input, message: "回查丢失" });
  const writesBeforeLostReadback = decisionRequestCount();
  await assert.rejects(
    () => client.decideApplication(lostReadback, intent),
    (error) => error.code === FriendsErrorCode.UnknownOutcome &&
      error.retryable === false &&
      error.recovery.serverAcknowledged === true &&
      error.recovery.readback === "unavailable" &&
      decisionRequestCount() === writesBeforeLostReadback + 1,
  );
  pendingReadbackMode = "removed";

  readbackPhase = false;
  const lostRelation = await client.prepareApplicationDecision({ ...input, message: "关系回查丢失" });
  relationMode = "lost";
  const writesBeforeLostRelation = decisionRequestCount();
  await assert.rejects(
    () => client.decideApplication(lostRelation, intent),
    (error) => error.code === FriendsErrorCode.UnknownOutcome &&
      error.retryable === false &&
      error.recovery.serverAcknowledged === true &&
      error.recovery.readback === "unavailable" &&
      decisionRequestCount() === writesBeforeLostRelation + 1,
  );
  relationMode = "active";

  pendingReadbackMode = "still-pending";
  readbackPhase = false;
  const staleResult = await client.prepareApplicationDecision({ ...input, message: "状态未变化" });
  const writesBeforeStaleResult = decisionRequestCount();
  await assert.rejects(
    () => client.decideApplication(staleResult, intent),
    (error) => error.code === FriendsErrorCode.UpstreamBusiness &&
      error.retryable === false &&
      error.recovery.serverAcknowledged === true &&
      error.recovery.readback === "unmatched" &&
      decisionRequestCount() === writesBeforeStaleResult + 1,
  );

  pendingReadbackMode = "removed";
  relationMode = "active";
  readbackPhase = false;
  applicationMode = "exit";
  const exitPrepared = await client.prepareApplicationDecision({
    organizationId: "org-fixture",
    applicationId: "exit-application",
    type: "exit",
    decision: "reject",
    message: "拒绝退出",
    time: "2026-10-22",
  });
  const exitDecided = await client.decideApplication(exitPrepared, intent);
  assert.equal(exitDecided.type, "exit");
  assert.equal(exitDecided.decision, "reject");
  assert.equal(exitDecided.applicationNoLongerPending, true);
  assert.equal(exitDecided.relation.active, false);
  assert.equal(exitDecided.relation.exitTime, "2026-10-22");
  const exitDecisionRequest = requests.find((request) =>
    request.method === "POST" &&
    request.url.endsWith("/student-organization-apply/approve") &&
    request.body.uuid === "exit-application",
  );
  assert.equal(exitDecisionRequest.body.identified, "ADJUSTMENT");
  assert.equal(exitDecisionRequest.body.studentOrganizationInfoApproveAddReqDto.uuid, "exit-application");
});
