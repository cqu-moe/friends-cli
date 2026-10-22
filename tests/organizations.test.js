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
