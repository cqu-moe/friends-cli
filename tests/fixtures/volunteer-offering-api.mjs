import { createServer } from "node:http";

export const offeringSession = {
  token: "fixture-token",
  userLevel: "XS",
  account: { userNo: "20210001", userName: "示例学生" },
  context: {
    levelNo: "XS",
    levelName: "学生",
    unit: { unitType: 2, unitNo: "24080", unitName: "示例学院" },
  },
};

export function offeringInput() {
  return {
    schemaVersion: 1,
    kind: "volunteer-offering",
    activityCategory: "SCHOOL_ACTIVITY",
    activity: {
      activityName: "虚构图书馆志愿活动",
      activityType: "TYPE_CODE",
      activityLevel: "LEVEL_CODE",
      beginTime: "2026-11-02 09:00",
      endTime: "2026-11-02 12:00",
      activityPlace: "虚构图书馆",
      contacts: "示例联系人",
      phone: "13800138000",
      volunteerNumber: 3,
      totalDuration: 3,
      activityContent: "虚构整理图书服务，共三小时。",
      overview: "虚构活动概述。",
    },
    registration: {
      openType: "AUTO",
      openTime: "2026-11-01 09:00",
      finishType: "AUTO",
      deadline: "2026-11-01 18:00",
      applyNumber: 10,
      isOpenEnrollment: true,
      isEnrollExamine: false,
      isHideList: false,
      isLimitVolunteer: false,
      volunteerStar: [],
      isPrivateCollection: false,
      currentOrganization: false,
      positionSetMethod: "TIME",
      posts: [{ postName: "引导岗", recruitNumber: 2, duration: 1.5 }],
      questionnaires: [{
        title: "为何参加",
        itemType: "CHOICE",
        isMandatory: true,
        sort: 1,
        options: [{ optionName: "服务同学", sort: 1 }],
      }],
    },
    materials: {
      publicityPictures: [new File([new Uint8Array([1, 2, 3])], "banner.png", { type: "image/png" })],
      attachments: [],
    },
  };
}

function json(res, data, code = "0") {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ code, data, message: code === "0" ? "accepted" : "rejected" }));
}

async function requestBody(req) {
  let body = "";
  for await (const chunk of req) body += chunk;
  return body;
}

export async function offeringSchool(t) {
  const state = {
    mode: "ok",
    requests: [],
    uploads: [],
    lostUploadNames: [],
    uploadRejectNames: [],
    groups: new Map(),
    stored: null,
    organizationId: "org-1",
  };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const path = url.pathname;
    const body = await requestBody(req);
    state.requests.push({ method: req.method, path, query: url.searchParams, body });
    if (path.endsWith("/checkUserAndGetUserLevel")) {
      return json(res, {
        loginLevels: [{
          levelNo: "XS",
          levelName: "学生",
          units: [offeringSession.context.unit],
        }],
        userLoginType: "STUDENT",
      });
    }
    if (path.endsWith("/user/info")) {
      return json(res, { userNo: "20210001", userName: "示例学生" });
    }
    if (path.endsWith("/enterHall")) {
      return json(res, { account: "20210001", name: "示例学生", userLoginStateLevel: "XS", departmentNo: "24080" });
    }
    if (path.endsWith("/organization/drop-down")) {
      return json(res, [{
        uuid: state.organizationId,
        organizationName: "虚构青协",
        organizationType: "STUDENT",
      }]);
    }
    if (path === "/gateway/ek-agg-mob/biz-common/system/data-code-list/mulit") {
      return json(res, {
        QNZYZXNHDLX: [{ dataCode: "TYPE_CODE", dataName: "校内服务" }],
        QNZYZXNHDJB: [{ dataCode: "LEVEL_CODE", dataName: "校级" }],
      });
    }
    if (path === "/gateway/ek-agg-mob/biz-common/system/vschool-year-list") {
      return json(res, [{ schoolYear: "2026-2027", schoolYearName: "2026-2027", isCurrentYear: 1 }]);
    }
    if (path === "/gateway/ek-agg-mob/biz-common/term-list") {
      return json(res, [{ termNo: "1", isCurrentTerm: "1" }]);
    }
    if (path === "/gateway/ek-agg-mob/biz-common/protected-file-upload" && req.method === "POST") {
      const match = /name="groupId"\r?\n\r?\n([^\r\n]+)/.exec(body);
      const fileMatch = /filename="([^"]+)"/.exec(body);
      if (!match || !fileMatch) {
        state.mode = "bad-upload";
        return json(res, null, "UPLOAD_INVALID");
      }
      const resourceUuid = `resource-${state.uploads.length + 1}`;
      state.uploads.push({ groupUuid: match[1], fileName: fileMatch[1], resourceUuid, body });
      if (state.lostUploadNames.includes(fileMatch[1])) {
        if (!state.groups.has(match[1])) state.groups.set(match[1], []);
        state.groups.get(match[1]).push({
          uuid: resourceUuid,
          title: fileMatch[1].replace(/\.[^.]+$/, ""),
          fileExtension: `.${fileMatch[1].split(".").pop()}`,
        });
        return req.socket.destroy();
      }
      if (state.uploadRejectNames.includes(fileMatch[1])) return json(res, null, "UPLOAD_REJECTED");
      if (!state.groups.has(match[1])) state.groups.set(match[1], []);
      state.groups.get(match[1]).push({
        uuid: resourceUuid,
        title: fileMatch[1].replace(/\.[^.]+$/, ""),
        fileExtension: `.${fileMatch[1].split(".").pop()}`,
      });
      return json(res, [resourceUuid]);
    }
    if (path === "/gateway/ek-agg-mob/biz-common/list-group-resource" && req.method === "POST") {
      const groupUuid = url.searchParams.get("groupUuid");
      return json(res, state.groups.get(groupUuid) ?? []);
    }
    if (path.endsWith("/school-activity-apply/next-step") && req.method === "POST") {
      const payload = JSON.parse(body);
      if (payload.activityCategory === "TEMP_ACTIVITY") {
        state.requests.at(-1).write = true;
        if (state.mode === "lost-temp") return req.socket.destroy();
        return json(res, null);
      }
      if (state.mode === "lost-next") return req.socket.destroy();
      return json(res, "intermediate-uuid");
    }
    if (path.endsWith("/school-activity-apply/apply") && req.method === "POST") {
      state.requests.at(-1).write = true;
      if (state.mode === "permission") {
        res.writeHead(403);
        return res.end();
      }
      if (state.mode === "business") return json(res, null, "CONFLICT");
      if (state.mode === "lost-final") {
        state.stored = { ...JSON.parse(body), flowOverallState: "FUTURE_STATE" };
        return req.socket.destroy();
      }
      state.stored = { ...JSON.parse(body), flowOverallState: "FUTURE_STATE" };
      return json(res, null);
    }
    if (/\/school-activity-apply\/approve-detail\//.test(path) && req.method === "GET") {
      if (state.mode === "status-failure" && state.stored) {
        res.writeHead(503);
        return res.end();
      }
      if (!state.stored) {
        res.writeHead(404);
        return res.end();
      }
      return json(res, state.stored);
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  return { state, baseUrl: `http://127.0.0.1:${server.address().port}/gateway` };
}
