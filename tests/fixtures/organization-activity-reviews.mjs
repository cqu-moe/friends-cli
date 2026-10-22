import { createServer } from "node:http";
import assert from "node:assert/strict";
export const organizationReviewSession = (kind = "offering") => ({
  token: "org-review-fixture", userLevel: kind === "offering" ? "FDY" : "XS",
  account: { userNo: "fixture-user", userName: "示例审核人" },
  context: { levelNo: kind === "offering" ? "FDY" : "XS", levelName: "示例身份", unit: { unitNo: "fixture-unit", unitName: "示例单位", unitType: 2 } },
});
export const offeringInput = { organizationId: "org-1", id: "offering-1", decision: "pass", message: "已审核材料", time: "2026-10-23" };
export const registrationInput = { organizationId: "org-1", activityId: "offering-1", id: "registration-1", decision: "pass", message: "已审核报名", time: "2026-10-23" };
export async function organizationReviewScenario() {
  const requests = [], violations = [];
  const state = { mode: "ok", role: true, organization: true, pending: { offering: true, registration: true }, wrongId: false, wrongOrganization: false, wrongActivity: false, unknownState: false, menus: ["/fuzeren"], writes: 0 };
  const activity = { uuid: "offering-1", organizationId: "org-1", activityName: "示例组织活动", beginYear: "2026", endYear: "2027", termNo: "1", beginTime: "2026-11-01 10:00", endTime: "2026-11-01 12:00", flowOverallState: 1, flowCurrMsg: "等待审核" };
  const registration = { uuid: "registration-1", activityId: "offering-1", studentNo: "fixture-student", studentName: "示例报名人", flowOverallState: 1, flowCurrMsg: "等待审核" };
  const service = "/gateway/zovecenter-saip-ek-app-team-organization-manage/mob";
  const common = "/gateway/ek-agg-mob/biz-common/flow";
  const server = createServer(async (req, res) => {
    let text = ""; for await (const chunk of req) text += chunk;
    const body = text ? JSON.parse(text) : null, path = new URL(req.url, "http://fixture").pathname;
    requests.push({ method: req.method, path, body, headers: req.headers });
    const reply = (data, code = "0", status = 200) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify({ code, data, message: code === "0" ? "ok" : "学校拒绝" })); };
    try {
      assert.equal(req.headers["h-zove-token"], "org-review-fixture");
      assert.equal(req.headers["h-zove-appkey"], path.startsWith("/gateway/ek-agg-mob/") ? "zovecenter-saip-ek-agg-mob" : "zovecenter-saip-ek-app-team-organization-manage");
      if (path === "/gateway/ek-agg-mob/user/checkUserAndGetUserLevel") return reply({ userLoginType: "TEACHER", loginLevels: state.role ? [organizationReviewSession(req.headers["h-zove-userlevel"] === "FDY" ? "offering" : "registration").context].map(c => ({ ...c, units: [c.unit] })) : [] });
      if (path === "/gateway/ek-agg-mob/user/info") return reply({ userNo: "fixture-user", userName: "示例审核人" });
      if (path === "/gateway/ek-agg-mob/user/enterHall") return reply({ account: "fixture-user", name: "示例审核人", userLoginStateLevel: body.userStateLevel, departmentNo: "fixture-unit" });
      if (path === service + "/biz-common/sub-app/mobile-index") return reply({ extMap: { "H-Zove-AppKey": { menus: state.menus.map(path => ({ path })) } } });
      if (path === service + "/student-organization-info/my") return reply(state.organization ? [{ uuid: "org-1", responsiblePerson: "fixture-user", currentUserIsManager: true }] : []);
      if (path === service + "/apply-info/drop-down-list") { assert.deepEqual(body, { isTeacher: true }); return reply(state.organization ? [{ uuid: "org-1", organizationName: "示例组织" }] : []); }
      if (path === service + "/enroll-info/drop-down-list") { assert.deepEqual(body, {}); return reply(state.organization ? [activity] : []); }
      if (path === common + "/template-activity-state") {
        assert.deepEqual(body, body.handleType === "FDY01" ? { businessTypeCode: "组织活动申请流程", handleType: "FDY01" } : { businessTypeCode: "社团加入退出申请", handleType: "XS02" });
        return reply(state.unknownState ? [{ code: "unrecognized", value: "新状态" }] : [{ code: body.handleType === "FDY01" ? "FDY01" : "XS02", value: "等待审核" }]);
      }
      if (path === common + "/callback-list") { assert.deepEqual(body, { businessTypeCode: "组织活动申请流程", compareValue: "", handleType: "FDY01" }); return reply([{ templateActivityRespDto: { activityid: "return-node" } }]); }
      if (path === service + "/apply-info/activity-page-list" || path === service + "/enroll-info/approve-page-list") {
        const kind = path.includes("/apply-info/") ? "offering" : "registration";
        if (state.mode === "readback-lost" && state.writes > 0) return reply(null, "unavailable", 503);
        assert.equal(body.approvalState, kind === "offering" ? "FDY01" : "XS02");
        if (kind === "offering") { assert.equal(body.organizationId, "org-1"); assert.equal(body.userLevel, ""); }
        else assert.equal(body.activityId, "offering-1");
        const row = { ...(kind === "offering" ? activity : registration) };
        if (state.wrongId) row.uuid = kind === "offering" ? "registration-1" : "offering-1";
        if (state.wrongOrganization) row.organizationId = "org-2";
        if (state.wrongActivity) row.activityId = "offering-2";
        return reply({ currentPage: body.currentPage, pageSize: body.pageSize, pages: 1, totalCount: state.pending[kind] ? 1 : 0, data: state.pending[kind] ? [row] : [] });
      }
      if (path === service + "/apply-info/offering-1") return reply({ ...activity, ...(state.wrongOrganization ? { organizationId: "org-2" } : {}) });
      if (path === service + "/enroll-info/flow/registration-1") return reply({ flowApproveRespDto: { evaluationRecords: state.pending.registration ? [] : [{ msg: "已审批" }], nodeList: [] } });
      if (req.method === "PUT" && [service + "/apply-info/next-update", service + "/apply-info/audit", service + "/enroll-info/audit"].includes(path)) {
        state.writes++;
        if (state.mode === "reject") return reply(null, "rejected");
        if (path.endsWith("/next-update")) {
          assert.equal(body.uuid, "offering-1"); assert.equal(body.organizationId, "org-1");
          if (state.mode === "save-lost") { req.socket.destroy(); return; }
          return reply(null);
        }
        const kind = path.includes("/apply-info/") ? "offering" : "registration";
        assert.deepEqual(Object.keys(body).sort(), (kind === "offering" ? ["identified", "msg", "time", "uuid", "activityId"] : ["identified", "msg", "time", "uuid"]).sort());
        assert.equal(body.uuid, kind === "offering" ? "offering-1" : "registration-1");
        if (state.mode !== "stale") { state.pending[kind] = false; (kind === "offering" ? activity : registration).flowOverallState = body.identified === "AGREEMENT" ? 7 : 5; }
        if (state.mode === "lost" || state.mode === "timeout") { if (state.mode === "lost") req.socket.destroy(); return; }
        return reply(null);
      }
      violations.push(`Unexpected ${req.method} ${path}`); return reply(null, "unexpected", 404);
    } catch (error) { violations.push(error.message); return reply(null, "fixture-contract", 500); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return { baseUrl: `http://127.0.0.1:${server.address().port}/gateway`, requests, state, activity, registration, violations, close: () => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); } };
}
