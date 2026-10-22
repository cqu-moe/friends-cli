import { createServer } from "node:http";
import assert from "node:assert/strict";
export const searchSession = {
  token: "search-fixture-token", userLevel: "XS",
  account: { userNo: "search-user", userName: "示例搜索用户" },
  context: { levelNo: "XS", levelName: "学生", unit: { unitNo: "search-unit", unitName: "示例学院", unitType: 2 } },
};
export async function searchScenario() {
  const requests = [], violations = [];
  const rows = {
    course: Array.from({ length: 11 }, (_, i) => ({ uuid: i === 0 ? "shared-id" : `course-${i + 1}`, curriculumName: `示例课程${i + 1}`, curriculumState: "FUTURE_COURSE_STATE" })),
    volunteer: [{ uuid: "shared-id", activityName: "示例志愿服务", activityState: "FUTURE_VOLUNTEER_STATE", activityCategory: "SCHOOL_ACTIVITY" }],
    "organization-activity": [{ uuid: "shared-id", activityName: "示例组织活动", organizationId: "example-org", application: true, applicationCode: 999, applicationUuid: "registration-fixture" }],
  };
  const state = { failures: {}, unknownPagination: {}, invalidId: {}, wrongPage: {}, account: "search-user" };
  const routes = {
    "/gateway/zovecenter-saip-ek-app-curriculum/mob/apply/student-apply-page-list": "course",
    "/gateway/zovecenter-saip-ek-app-young-volunteers/mob/school-activity-apply/student-apply-page-list": "volunteer",
    "/gateway/zovecenter-saip-ek-app-team-organization-manage/mob/enroll-info/apply-page-list": "organization-activity",
  };
  const server = createServer(async (req, res) => {
    let raw = ""; for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : null, path = new URL(req.url, "http://fixture").pathname;
    const type = routes[path]; requests.push({ path, method: req.method, body, type, headers: req.headers });
    const reply = (data, code = "0", status = 200) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify({ code, data, message: code === "0" ? "ok" : "fixture-rejection" })); };
    try {
      assert.equal(req.method, "POST");
      assert.equal(req.headers["h-zove-token"], "search-fixture-token"); assert.equal(req.headers["h-zove-userlevel"], "XS");
      const main = path.startsWith("/gateway/ek-agg-mob/");
      const app = type === "course" ? "curriculum" : type === "volunteer" ? "young-volunteers" : "team-organization-manage";
      assert.equal(req.headers["h-zove-appkey"], main ? "zovecenter-saip-ek-agg-mob" : "zovecenter-saip-ek-app-" + app);
      if (path === "/gateway/ek-agg-mob/user/checkUserAndGetUserLevel") return reply({ userLoginType: "STUDENT", loginLevels: [{ levelNo: "XS", levelName: "学生", units: [searchSession.context.unit] }] });
      if (path === "/gateway/ek-agg-mob/user/info") return reply({ userNo: state.account, userName: "示例搜索用户", userLoginStateLevel: "XS" });
      if (path === "/gateway/ek-agg-mob/user/enterHall") { assert.deepEqual(body, { departNo: "search-unit", userStateLevel: "XS", userType: "STUDENT" }); return reply({ account: state.account, name: "示例搜索用户", userLoginStateLevel: "XS", departmentNo: "search-unit" }); }
      assert.ok(type, "Unexpected school request: " + path);
      const failure = state.failures[type];
      if (failure?.page === body.currentPage) {
        if (failure.kind === "denied") return reply(null, "denied", 403);
        if (failure.kind === "business") return reply(null, "business-refusal");
        if (failure.kind === "lost") return req.socket.destroy();
        return reply(null, "unavailable", 503);
      }
      if (type === "organization-activity") assert.equal(body.userNo, "");
      const found = rows[type].slice((body.currentPage - 1) * body.pageSize, body.currentPage * body.pageSize).map(row => ({ ...row }));
      if (state.invalidId[type] && found[0]) found[0].uuid = "../invalid-id";
      const data = { currentPage: state.wrongPage[type] ? body.currentPage + 1 : body.currentPage, pageSize: body.pageSize, totalCount: rows[type].length, pages: Math.ceil(rows[type].length / body.pageSize), data: found };
      if (state.unknownPagination[type]) { delete data.pages; delete data.totalCount; }
      return reply(data);
    } catch (error) { violations.push(error.message); return reply(null, "fixture-contract", 500); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return { baseUrl: `http://127.0.0.1:${server.address().port}/gateway`, rows, state, requests, violations, close: () => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); } };
}
