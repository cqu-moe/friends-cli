import { createServer } from "node:http";

export async function leaderScenario(t) {
  const requests = [];
  const prefix = "/gateway/zovecenter-saip-ek-app-team-organization-manage/mob";
  const state = {
    manager: false, application: null, postMode: "ok", candidates: true,
    profile: { uuid: "leader-org", labelCode: "LEADER-LABEL", organizationName: "示例组织",
      organizationType: "STUDENT_CLUB", responsiblePerson: "20210001", responsiblePhone: "13900000001", postName: "原职务" },
  };
  const server = createServer(async(req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const input = body ? JSON.parse(body) : null;
    requests.push({ method: req.method, url: req.url, body: input, headers: req.headers });
    function reply(data, code = "0") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ code, data, message: code === "0" ? "ok" : "拒绝" })); }
    const url = new URL(req.url, "http://fixture.invalid");
    if (req.method === "POST" && req.url === "/gateway/ek-agg-mob/user/checkUserAndGetUserLevel") return reply({ loginLevels: [{ levelNo: "XS", levelName: "学生", units: [{ unitType: 2, unitNo: "24080", unitName: "示例学院" }] }], userLoginType: "STUDENT" });
    if (req.method === "POST" && req.url === "/gateway/ek-agg-mob/user/info") return reply({ userNo: "20210001", userName: "示例学生" });
    if (req.method === "POST" && req.url === "/gateway/ek-agg-mob/user/enterHall") return reply({ account: "20210001", name: "示例学生", userLoginStateLevel: "XS", departmentNo: "24080" });
    if (req.method === "POST" && req.url === prefix + "/student-organization-info/my") return reply([{ uuid: "leader-org", responsiblePerson: state.manager ? "20219999" : "20210001", currentUserIsManager: state.manager }]);
    if (req.method === "GET" && req.url === prefix + "/student-organization-info/leader-org") return reply(state.profile);
    if (req.method === "GET" && url.pathname === prefix + "/responsiblePersonChangeInfo/new-response-person/leader-org") return reply(state.candidates ? [{ uuid: "candidate-fixture", studentNo: "20210002", studentName: "新负责人", postUuid: "new-post", postName: "新职务", isManager: false, phone: "13800000002" }].filter(c => c.studentNo.includes(url.searchParams.get("key") ?? "")) : []);
    if (req.method === "GET" && req.url === prefix + "/student-organization-info/post-list/LEADER-LABEL") return reply([{ uuid: "new-post", postName: "新职务" }]);
    if (req.method === "GET" && req.url === prefix + "/labelInfo/code/LEADER-LABEL") return reply({ isJobDivision: true });
    if (req.method === "GET" && req.url === prefix + "/responsiblePersonChangeInfo/organization/leader-org") return reply(state.application);
    if (req.method === "POST" && req.url === prefix + "/responsiblePersonChangeInfo/apply") {
      if (state.postMode === "denied") return reply(null, "10000");
      state.application = { ...input, uuid: input.uuid || "change-fixture", flowCurrMsg: "等待审核", flowCurrNodeOperateRole: "FDY01", flowCurrNodeState: 2, flowNextNodeOperateRole: "FDY01", flowOverallState: 1 };
      if (state.postMode === "lost") return req.socket.destroy();
      return reply(null);
    }
    res.writeHead(404); res.end();
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  return { state, requests, baseUrl: `http://127.0.0.1:${server.address().port}/gateway`, writes() { return requests.filter(r => r.url === prefix + "/responsiblePersonChangeInfo/apply"); } };
}
