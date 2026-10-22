import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { createFriendsSdk, FriendsErrorCode, organizationId } from "../dist/index.js";

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
        units: [{ unitType: 2, unitNo: "24080", unitName: "示例学院" }],
      }],
      userLoginType: "STUDENT",
    },
  });
}

const profile = {
  uuid: "org-fixture",
  organizationName: "示例组织",
  organizationType: "UNIVERSITY_STUDENT_ORGANIZATION",
  responsiblePerson: "20210001",
  currentUserIsManager: false,
  labelCode: "LABEL",
  state: "LOGON",
  logo: "logo-old",
  backgroundGroupUuid: "background-old",
  blurb: "旧简介",
  internalField: "school-internal-value",
};

test("organization SDK uses managed context, whitelisted profile fields, and non-retryable unknown writes", async (t) => {
  const requests = [];
  let putMode = "ok";
  let readbackMode = "ok";
  let managedMode = "initial";
  let currentProfile = { ...profile };
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      requests.push({ method: req.method, url: req.url, body: body === "" ? null : JSON.parse(body) });
      if (req.url.endsWith("/checkUserAndGetUserLevel")) return identity(res);
      if (req.url.endsWith("/user/info")) {
        return json(res, 200, { code: "0", data: { userNo: "20210001", userName: "示例学生" } });
      }
      if (req.url.endsWith("/enterHall")) {
        return json(res, 200, { code: "0", data: { account: "20210001", name: "示例学生", userLoginStateLevel: "XS", departmentNo: "24080" } });
      }
      if (req.url.endsWith("/student-organization-info/my")) {
        if (managedMode === "revoked") {
          return json(res, 200, { code: "0", data: [] });
        }
        return json(res, 200, {
          code: "0",
          data: [{
            uuid: "org-fixture",
            organizationName: "示例组织",
            organizationType: "UNIVERSITY_STUDENT_ORGANIZATION",
            responsiblePerson: "20210001",
            currentUserIsManager: false,
            hiddenContact: "must-not-project",
          }, {
            uuid: "org-manager",
            organizationName: "示例管理组织",
            organizationType: "STUDENT_CLUB",
            responsiblePerson: "20219999",
            currentUserIsManager: true,
          }],
        });
      }
      if (req.method === "GET" && req.url.endsWith("/student-organization-info/org-fixture")) {
        if (readbackMode === "lost") {
          req.destroy();
          return;
        }
        return json(res, 200, { code: "0", data: currentProfile });
      }
      if (req.method === "GET" && req.url.endsWith("/student-organization-info/org-manager")) {
        return json(res, 200, { code: "0", data: { ...profile, uuid: "org-manager", currentUserIsManager: true } });
      }
      if (req.method === "POST" && req.url.endsWith("/student-organization-apply/organizational-members-list")) {
        const input = JSON.parse(body);
        return json(res, 200, {
          code: "0",
          data: {
            currentPage: input.currentPage,
            pageSize: input.pageSize,
            totalCount: 1,
            pages: 1,
            data: [{
              uuid: "member-fixture",
              studentNo: "20210002",
              studentName: "示例成员",
              postUuid: "post-fixture",
              postName: "负责人",
              isManager: true,
              isResponsiblePerson: false,
              privateField: "must-not-project",
            }],
          },
        });
      }
      if (req.method === "PUT" && req.url.endsWith("/student-organization-info")) {
        if (putMode === "lost") {
          currentProfile = { ...currentProfile, ...JSON.parse(body) };
          req.destroy();
          return;
        }
        if (putMode === "stale") {
          return json(res, 200, { code: "0", message: "ok" });
        }
        if (putMode === "readback-lost") {
          currentProfile = { ...currentProfile, ...JSON.parse(body) };
          readbackMode = "lost";
          return json(res, 200, { code: "0", message: "ok" });
        }
        currentProfile = { ...currentProfile, ...JSON.parse(body) };
        return json(res, 200, { code: "0", message: "ok" });
      }
      return json(res, 404, {});
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
    account: { userNo: "20210001", userName: "示例学生" },
    context: {
      levelNo: "XS",
      levelName: "学生",
      unit: { unitType: 2, unitNo: "24080", unitName: "示例学院" },
    },
  });

  assert.deepEqual(await client.listManaged(), [{
    id: "org-fixture",
    name: "示例组织",
    type: "UNIVERSITY_STUDENT_ORGANIZATION",
    access: "principal",
    editableFields: ["logo", "backgroundGroupUuid", "blurb"],
  }, {
    id: "org-manager",
    name: "示例管理组织",
    type: "STUDENT_CLUB",
    access: "manager",
    editableFields: [],
  }]);

  const detail = await client.get(organizationId("org-fixture"));
  assert.equal(detail.id, "org-fixture");
  assert.equal(detail.blurb, "旧简介");
  assert.equal(JSON.stringify(detail).includes("internalField"), false);

  const members = await client.listMembers(organizationId("org-fixture"), {
    page: 2,
    pageSize: 5,
    keyword: "示例",
    postUuid: "post-fixture",
    managerOnly: true,
  });
  assert.equal(members.totalCount, 1);
  assert.deepEqual(members.items, [{
    id: "member-fixture",
    studentNo: "20210002",
    name: "示例成员",
    postUuid: "post-fixture",
    postName: "负责人",
    isManager: true,
    isResponsiblePerson: false,
  }]);

  const beforeSave = requests.length;
  await assert.rejects(
    () => client.prepareProfileUpdate({
      organizationId: organizationId("org-fixture"),
      changes: { blurb: "新简介", organizationName: "越权名称" },
    }),
    (error) => error.code === FriendsErrorCode.InvalidInput && requests.length === beforeSave,
  );
  await assert.rejects(
    () => client.prepareProfileUpdate({
      organizationId: organizationId("org-manager"),
      changes: { blurb: "无权简介" },
    }),
    (error) => error.code === FriendsErrorCode.PermissionDenied,
  );
  await assert.rejects(
    () => client.prepareProfileUpdate({
      organizationId: organizationId("other-org"),
      changes: { blurb: "新简介" },
    }),
    (error) => error.code === FriendsErrorCode.PermissionDenied && requests.length === beforeSave,
  );

  const prepared = await client.prepareProfileUpdate({
    organizationId: organizationId("org-fixture"),
    changes: { blurb: "新简介", logo: "logo-new", backgroundGroupUuid: "background-new" },
  });
  assert.equal(prepared.status, "prepared");
  assert.equal(prepared.submitted, false);
  assert.equal(prepared.editRoute.path, "/groupManage/studentOrgEdit");
  assert.deepEqual(prepared.changes, {
    blurb: "新简介",
    logo: "logo-new",
    backgroundGroupUuid: "background-new",
  });
  assert.equal(prepared.payload.internalField, "school-internal-value");
  assert.equal(prepared.payload.organizationName, "示例组织");

  const writeIntent = {
    via: "api",
    intent: "save-organization-profile",
    confirm: true,
  };
  const beforeIntentCheck = requests.length;
  for (const invalidIntent of [
    undefined,
    { ...writeIntent, via: "ego" },
    { ...writeIntent, intent: "submit-volunteer-certification" },
    { ...writeIntent, confirm: false },
  ]) {
    await assert.rejects(
      () => client.saveProfile(prepared, invalidIntent),
      (error) => error.code === FriendsErrorCode.InvalidInput,
    );
  }
  assert.equal(requests.length, beforeIntentCheck);

  const refreshStart = requests.length;
  managedMode = "revoked";
  await assert.rejects(
    () => client.saveProfile(prepared, writeIntent),
    (error) => error.code === FriendsErrorCode.PermissionDenied,
  );
  assert.deepEqual(
    requests.slice(refreshStart).map((request) => request.url.split("/").slice(-1)[0]),
    ["checkUserAndGetUserLevel", "info", "enterHall", "my"],
  );
  managedMode = "initial";

  const saved = await client.saveProfile(prepared, writeIntent);
  assert.equal(saved.status, "saved");
  assert.equal(saved.profile.blurb, "新简介");
  assert.equal(saved.profile.logo, "logo-new");
  const saveRequest = requests.find((request) => request.method === "PUT");
  assert.equal(saveRequest.body.uuid, "org-fixture");
  assert.equal(saveRequest.body.organizationName, "示例组织");
  assert.equal(saveRequest.body.internalField, "school-internal-value");
  assert.equal(saveRequest.body.blurb, "新简介");

  putMode = "lost";
  const putsBeforeLoss = requests.filter((request) => request.method === "PUT").length;
  await assert.rejects(
    () => client.saveProfile({ ...prepared, changes: { blurb: "结果未知" } }, writeIntent),
    (error) => error.code === FriendsErrorCode.UnknownOutcome &&
      error.retryable === false &&
      error.recovery.organizationId === "org-fixture" &&
      error.recovery.serverAcknowledged === "unknown" &&
      error.recovery.readback === "matched" &&
      requests.filter((request) => request.method === "PUT").length === putsBeforeLoss + 1,
  );

  putMode = "stale";
  const putsBeforeStale = requests.filter((request) => request.method === "PUT").length;
  await assert.rejects(
    () => client.saveProfile({
      ...prepared,
      changes: { blurb: "服务器未回显" },
    }, writeIntent),
    (error) => error.code === FriendsErrorCode.UpstreamBusiness &&
      error.recovery.readback === "unmatched" &&
      requests.filter((request) => request.method === "PUT").length === putsBeforeStale + 1,
  );

  putMode = "readback-lost";
  const putsBeforeReadbackLoss = requests.filter((request) => request.method === "PUT").length;
  await assert.rejects(
    () => client.saveProfile({
      ...prepared,
      changes: { blurb: "确认后回查失败" },
    }, writeIntent),
    (error) => error.code === FriendsErrorCode.UnknownOutcome &&
      error.retryable === false &&
      error.recovery.serverAcknowledged === true &&
      error.recovery.readback === "unavailable" &&
      requests.filter((request) => request.method === "PUT").length === putsBeforeReadbackLoss + 1,
  );
});

test("organization SDK prepares and submits leader changes without conflating application and responsible-person state", async (t) => {
  const requests = [];
  let managedMode = "principal";
  let postMode = "ok";
  let applicationMode = "ok";
  let candidateMode = "valid";
  let application = null;
  const profile = {
    uuid: "leader-org",
    organizationName: "负责人组织",
    organizationType: "UNIVERSITY_STUDENT_ORGANIZATION",
    labelCode: "LEADER-LABEL",
    responsiblePerson: "20210001",
    responsiblePersonName: "现任负责人",
    responsiblePhone: "13900139000",
    postUuid: "old-post",
    postName: "旧职务",
    privateField: "school-internal",
  };
  const candidate = {
    uuid: "candidate-fixture",
    studentNo: "20210002",
    studentName: "新负责人",
    postUuid: "new-post",
    postName: "新职务",
    isManager: true,
    phone: "13800138000",
    collegeName: "不投影",
  };
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      requests.push({ method: req.method, url: req.url, body: body === "" ? null : JSON.parse(body) });
      if (req.url.endsWith("/checkUserAndGetUserLevel")) return identity(res);
      if (req.url.endsWith("/user/info")) {
        return json(res, 200, { code: "0", data: { userNo: "20210001", userName: "示例学生" } });
      }
      if (req.url.endsWith("/enterHall")) {
        return json(res, 200, {
          code: "0",
          data: { account: "20210001", name: "示例学生", userLoginStateLevel: "XS", departmentNo: "24080" },
        });
      }
      if (req.url.endsWith("/student-organization-info/my")) {
        return json(res, 200, {
          code: "0",
          data: managedMode === "principal"
            ? [{ uuid: "leader-org", organizationName: "负责人组织", responsiblePerson: "20210001" }]
            : [{ uuid: "leader-org", organizationName: "负责人组织", responsiblePerson: "20219999", currentUserIsManager: true }],
        });
      }
      if (req.method === "GET" && req.url.endsWith("/student-organization-info/leader-org")) {
        return json(res, 200, { code: "0", data: profile });
      }
      if (req.method === "GET" && req.url.includes("/responsiblePersonChangeInfo/new-response-person/leader-org")) {
        const keyword = new URL(req.url, "https://friends.invalid").searchParams.get("key") ?? "";
        return json(res, 200, {
          code: "0",
          data: (candidateMode === "valid"
            ? [candidate, { ...candidate, uuid: "other", studentNo: "20219998" }]
            : [{ ...candidate, uuid: "other", studentNo: "20219998" }]
          ).filter((item) => item.studentName.includes(keyword) || item.studentNo.includes(keyword)),
        });
      }
      if (req.method === "GET" && req.url.endsWith("/student-organization-info/post-list/LEADER-LABEL")) {
        return json(res, 200, { code: "0", data: [{ uuid: "new-post", postName: "新职务" }] });
      }
      if (req.method === "GET" && req.url.endsWith("/labelInfo/code/LEADER-LABEL")) {
        return json(res, 200, { code: "0", data: { isJobDivision: true, other: "ignored" } });
      }
      if (req.method === "GET" && req.url.endsWith("/responsiblePersonChangeInfo/organization/leader-org")) {
        if (applicationMode === "lost") {
          req.destroy();
          return;
        }
        return json(res, 200, { code: "0", data: application });
      }
      if (req.method === "POST" && req.url.endsWith("/responsiblePersonChangeInfo/apply")) {
        if (postMode === "denied") return json(res, 200, { code: "10000", message: "审批业务拒绝" });
        if (postMode === "lost" || postMode === "timeout") {
          application = {
            ...JSON.parse(body),
            uuid: JSON.parse(body).uuid || "change-fixture",
            flowCurrMsg: "",
            flowCurrNodeOperateRole: "XS01",
            flowCurrNodeState: 3,
            flowNextNodeOperateRole: "XS01",
            flowOverallState: 3,
            flowTemplateBranchNo: 1,
            flowTemplateUuid: "flow-template",
          };
          if (postMode === "lost") req.destroy();
          return;
        }
        if (postMode === "readback-lost") applicationMode = "lost";
        if (postMode === "unchanged") {
          return json(res, 200, { code: "0", message: "ok" });
        }
        application = {
          ...JSON.parse(body),
          uuid: JSON.parse(body).uuid || "change-fixture",
          flowCurrMsg: "",
          flowCurrNodeOperateRole: "XS01",
          flowCurrNodeState: 3,
          flowNextNodeOperateRole: "XS01",
          flowOverallState: 3,
          flowTemplateBranchNo: 1,
          flowTemplateUuid: "flow-template",
        };
        return json(res, 200, { code: "0", message: "ok" });
      }
      return json(res, 404, {});
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
    token: "leader-token",
    userLevel: "XS",
    account: { userNo: "20210001" },
    context: { levelNo: "XS", unit: { unitNo: "24080" } },
  });

  assert.deepEqual(await client.listLeaderChangeCandidates(organizationId("leader-org"), "20210002"), [{
    id: "candidate-fixture",
    studentNo: "20210002",
    name: "新负责人",
    postUuid: "new-post",
    postName: "新职务",
    isManager: true,
    phone: "13800138000",
  }]);

  const state = await client.getLeaderChangeState(organizationId("leader-org"));
  assert.equal(state.currentResponsiblePerson, "20210001");
  assert.equal(state.currentPostName, "旧职务");
  assert.equal(state.application, null);
  assert.equal(state.jobDivisionEnabled, true);
  assert.deepEqual(state.posts, [{ id: "new-post", name: "新职务" }]);

  const beforeDenials = requests.length;
  await assert.rejects(
    () => client.prepareLeaderChange({
      organizationId: organizationId("leader-org"),
      candidateStudentNo: "20218888",
      newResponsiblePhone: "13800138000",
      newResponsiblePolitical: "共青团员",
      newPostUuid: "new-post",
    }),
    (error) => error.code === FriendsErrorCode.UpstreamBusiness,
  );
  for (const input of [
    { newResponsiblePhone: "138001380" },
    { newResponsiblePolitical: "" },
    { newPostUuid: "unknown-post" },
    { reason: "长".repeat(257) },
  ]) {
    await assert.rejects(
      () => client.prepareLeaderChange({
        organizationId: organizationId("leader-org"),
        candidateStudentNo: "20210002",
        newResponsiblePhone: "13800138000",
        newResponsiblePolitical: "共青团员",
        newPostUuid: "new-post",
        ...input,
      }),
      (error) => error.code === FriendsErrorCode.InvalidInput,
    );
  }
  managedMode = "manager";
  await assert.rejects(
    () => client.prepareLeaderChange({
      organizationId: organizationId("leader-org"),
      candidateStudentNo: "20210002",
      newResponsiblePhone: "13800138000",
      newResponsiblePolitical: "共青团员",
      newPostUuid: "new-post",
    }),
    (error) => error.code === FriendsErrorCode.PermissionDenied,
  );
  managedMode = "principal";

  application = {
    uuid: "active-application",
    newPostUuid: "new-post",
    newResponsiblePerson: "20210002",
    newResponsiblePhone: "13800138000",
    newResponsiblePolitical: "共青团员",
    organizationUuid: "leader-org",
    postName: "旧职务",
    reason: "",
    responsiblePerson: "20210001",
    responsiblePhone: "13900139000",
    flowCurrMsg: "等待审核",
    flowCurrNodeOperateRole: "FDY01",
    flowCurrNodeState: 2,
    flowNextNodeOperateRole: "FDY01",
    flowOverallState: 1,
    flowTemplateBranchNo: 1,
    flowTemplateUuid: "flow-template",
  };
  const conflict = await client.getLeaderChangeState(organizationId("leader-org"));
  assert.equal(conflict.application.id, "active-application");
  assert.equal(conflict.application.canSubmit, false);
  await assert.rejects(
    () => client.prepareLeaderChange({
      organizationId: organizationId("leader-org"),
      candidateStudentNo: "20210002",
      newResponsiblePhone: "13800138000",
      newResponsiblePolitical: "共青团员",
      newPostUuid: "new-post",
    }),
    (error) => error.code === FriendsErrorCode.UpstreamBusiness &&
      error.recovery.applicationId === "active-application",
  );
  application = null;

  const prepared = await client.prepareLeaderChange({
    organizationId: organizationId("leader-org"),
    candidateStudentNo: "20210002",
    newResponsiblePhone: "13800138000",
    newResponsiblePolitical: "共青团员",
    newPostUuid: "new-post",
    reason: "毕业交接",
  });
  assert.equal(prepared.submitted, false);
  assert.equal(prepared.candidate.name, "新负责人");
  assert.deepEqual(prepared.payload, {
    newPostUuid: "new-post",
    newResponsiblePerson: "20210002",
    newResponsiblePhone: "13800138000",
    newResponsiblePolitical: "共青团员",
    organizationUuid: "leader-org",
    postName: "旧职务",
    reason: "毕业交接",
    responsiblePerson: "20210001",
    responsiblePhone: "13900139000",
    uuid: "",
  });
  assert.equal(requests.some((request) => request.url.endsWith("/responsiblePersonChangeInfo/apply")), false);

  await assert.rejects(() => client.prepareLeaderChange({ ...prepared.input, organizationId: organizationId("other-org") }), error => error.code === FriendsErrorCode.PermissionDenied);
  application = { uuid: "wrong-org-application", organizationUuid: "other-org", flowCurrMsg: "" };
  await assert.rejects(() => client.getLeaderChangeState(organizationId("leader-org")), error => error.code === FriendsErrorCode.PermissionDenied);
  application = { uuid: "unknown-state", organizationUuid: "leader-org", flowCurrNodeState: 999 };
  const unknownState = await client.getLeaderChangeState(organizationId("leader-org"));
  assert.equal(unknownState.application.canSubmit, false);
  assert.equal(unknownState.application.flow.currentNodeState, 999);
  await assert.rejects(() => client.prepareLeaderChange({ ...prepared.input, organizationId: organizationId("leader-org") }), error => error.code === FriendsErrorCode.UpstreamBusiness);
  application = null;
  const intent = { via: "api", intent: "submit-organization-leader-change", confirm: true };
  const beforeIntent = requests.length;
  for (const invalidIntent of [undefined, { ...intent, via: "ego" }, { ...intent, confirm: false }]) {
    await assert.rejects(
      () => client.submitLeaderChange(prepared, invalidIntent),
      (error) => error.code === FriendsErrorCode.InvalidInput,
    );
  }
  assert.equal(requests.length, beforeIntent);

  candidateMode = "stale";
  await assert.rejects(
    () => client.submitLeaderChange(prepared, intent),
    (error) => error.code === FriendsErrorCode.UpstreamBusiness,
  );
  assert.equal(requests.some((request) => request.url.endsWith("/responsiblePersonChangeInfo/apply")), false);
  candidateMode = "valid";

  postMode = "denied";
  await assert.rejects(() => client.submitLeaderChange(prepared, intent), error => error.code === FriendsErrorCode.UpstreamBusiness);
  postMode = "ok";
  const submitted = await client.submitLeaderChange(prepared, intent);
  assert.equal(submitted.status, "submitted");
  assert.equal(submitted.application.newResponsiblePerson, "20210002");
  assert.equal(submitted.currentResponsiblePerson, "20210001");
  assert.equal(submitted.responsiblePersonChanged, false);
  const post = requests.find((request) => request.method === "POST" && request.url.endsWith("/responsiblePersonChangeInfo/apply"));
  assert.deepEqual(post.body, prepared.payload);

  for (const mode of ["lost", "timeout"]) {
    application = null;
    postMode = mode;
    let postsBeforeLoss = requests.filter((request) => request.method === "POST" && request.url.endsWith("/responsiblePersonChangeInfo/apply")).length;
    await assert.rejects(
      () => client.submitLeaderChange(prepared, intent),
      (error) => error.code === FriendsErrorCode.UnknownOutcome &&
        error.retryable === false &&
        error.recovery.serverAcknowledged === "unknown" &&
        error.recovery.applicationReadback === "matched" &&
        error.recovery.applicationId === "change-fixture" &&
        requests.filter((request) => request.method === "POST" && request.url.endsWith("/responsiblePersonChangeInfo/apply")).length === postsBeforeLoss + 1,
    );

  }
  application = null;
  postMode = "readback-lost";
  applicationMode = "ok";
  let postsBeforeReadbackLoss = requests.filter((request) => request.method === "POST" && request.url.endsWith("/responsiblePersonChangeInfo/apply")).length;
  await assert.rejects(
    () => client.submitLeaderChange(prepared, intent),
    (error) => error.code === FriendsErrorCode.UnknownOutcome &&
      error.retryable === false &&
      error.recovery.serverAcknowledged === true &&
      error.recovery.applicationReadback === "unavailable" &&
      requests.filter((request) => request.method === "POST" && request.url.endsWith("/responsiblePersonChangeInfo/apply")).length === postsBeforeReadbackLoss + 1,
  );

  application = null;
  applicationMode = "ok";
  postMode = "unchanged";
  let postsBeforeBusinessRejection = requests.filter((request) => request.method === "POST" && request.url.endsWith("/responsiblePersonChangeInfo/apply")).length;
  await assert.rejects(
    () => client.submitLeaderChange(prepared, intent),
    (error) => error.code === FriendsErrorCode.UnknownOutcome &&
      error.recovery.serverAcknowledged === true &&
      error.recovery.applicationReadback === "unmatched" &&
      requests.filter((request) => request.method === "POST" && request.url.endsWith("/responsiblePersonChangeInfo/apply")).length === postsBeforeBusinessRejection + 1,
  );
});
