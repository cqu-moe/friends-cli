import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";

export const session = {
  token: "review-token",
  userLevel: "XS",
  accountUserNo: "20210001",
  levelNo: "XS",
  unitNo: "24080",
};

const transcriptDetail = {
  uuid: "transcript-1",
  totalDuration: 12.5,
  totalIntegral: 2,
  classRank: 1,
  specialtyGradeRank: null,
  itemList: [{
    uuid: "record-1",
    activityName: "示例志愿活动",
    activityPlace: "示例地点",
    activityType: "FUTURE_TYPE",
    totalDuration: 1.5,
    totalIntegral: 0.2,
  }],
};

const reviewDetail = {
  uuid: "review-1",
  activityId: "activity-1",
  flowOverallState: 9,
  flowCurrNode: "FUTURE_NODE",
  flowCurrMsg: "等待审批",
  activityInfo: { uuid: "activity-1", activityName: "示例活动", organizationName: "示例组织" },
  nameList: [{
    uuid: "registration-1",
    activityId: "activity-1",
    studentNo: "20210002",
    studentName: "示例志愿者",
    postId: "post-1",
    postName: "引导岗",
    postDuration: 2,
    signDuration: 1.5,
    attestationDuration: 1.5,
    isApply: true,
  }],
  approvalRecords: [],
  approvalStateRecords: [],
};

export async function school(t) {
  const requests = [];
  const writes = [];
  const state = {
    mode: "ok",
    role: "XSC",
    pages: 1,
    callbackNodes: [{
      templateActivityRespDto: { name: "上一节点", activityid: "callback-1" },
    }],
  };
  let currentReview = structuredClone(reviewDetail);

  function reply(res, data, code = "0") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ code, data, message: code === "0" ? "ok" : "rejected" }));
  }

  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const input = body === "" ? null : JSON.parse(body);
      requests.push({ method: req.method, url: req.url, body: input });
      if (req.url.endsWith("/ek-agg-mob/user/checkUserAndGetUserLevel")) {
        return reply(res, {
          userLoginType: "STUDENT",
          loginLevels: [{
            levelNo: "XS",
            levelName: "学生",
            units: [{ unitType: 2, unitNo: "24080", unitName: "示例学院" }],
          }],
        });
      }
      if (req.url.endsWith("/ek-agg-mob/user/info")) {
        const info = { userNo: "20210001", userName: "示例" };
        if (state.mode !== "no-role") info.userLoginStateLevel = state.role;
        return reply(res, info);
      }
      if (req.url.endsWith("/ek-agg-mob/user/enterHall")) {
        return reply(res, {
          account: "20210001", name: "示例", userLoginStateLevel: "XS", departmentNo: "24080",
        });
      }
      if (req.url.endsWith("/biz-common/flow/template-activity-state")) {
        return reply(res, [{ code: "0", name: "待处理" }]);
      }
      if (req.url.endsWith("/biz-common/flow/callback-list")) {
        return reply(res, state.callbackNodes);
      }
      if (req.url.endsWith("/student-transcript/page")) {
        return reply(res, {
          currentPage: input.currentPage,
          pageSize: input.pageSize,
          totalCount: 1,
          pages: state.pages,
          data: [{ uuid: "transcript-1" }],
        });
      }
      if (req.url.endsWith("/student-transcript/transcript-1")) {
        return reply(res, transcriptDetail);
      }
      if (req.url.endsWith("/school-activity-attestation-apply/page-list")) {
        return reply(res, {
          currentPage: input.currentPage,
          pageSize: input.pageSize,
          totalCount: 1,
          pages: state.pages,
          data: [{
            uuid: "review-1",
            activityId: "activity-1",
            activityName: "示例活动",
            organizationName: "示例组织",
            beginTime: "2026-10-22 08:00:00",
            endTime: "2026-10-22 10:00:00",
            attestationNumber: 1,
            flowOverallState: 9,
            flowCurrMsg: "等待审批",
          }],
        });
      }
      if (req.url.endsWith("/school-activity-attestation-apply/approve-detail/review-1")) {
        if (state.mode === "ack-readback-failure" && writes.length > 0) {
          res.writeHead(503);
          res.end();
          return;
        }
        return reply(res, currentReview);
      }
      if (req.method === "POST" && /\/school-activity-attestation-apply\/(pass|callback)$/.test(req.url)) {
        if (state.mode === "processed") return reply(res, null, "ALREADY_PROCESSED");
        writes.push({ path: req.url, body: input });
        currentReview = structuredClone(currentReview);
        currentReview.flowOverallState = 10;
        currentReview.flowCurrNode = "NEXT_NODE";
        currentReview.flowCurrMsg = "通过";
        currentReview.approvalRecords.push({ msg: input.msg, time: input.time });
        if (state.mode === "lost" || state.mode === "lost-readback-failure") req.socket.destroy();
        else if (state.mode === "ack-readback-failure") return reply(res, null);
        else if (state.mode === "malformed") {
          res.writeHead(200, { "content-type": "text/plain" });
          res.end("not-json");
        } else return reply(res, null);
        return;
      }
      return reply(res, null);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  return {
    requests,
    writes,
    state,
    baseUrl: `http://127.0.0.1:${server.address().port}/gateway`,
  };
}

export async function executingEgo(root) {
  const runner = `${root}/ego-runner.mjs`;
  const scriptLog = `${root}/generated-script.js`;
  const actionLog = `${root}/ego-actions.jsonl`;
  await writeFile(runner, String.raw`
    import { appendFile, readFile } from "node:fs/promises";
    const [scriptPath, actionPath] = process.argv.slice(2);
    const source = await readFile(scriptPath, "utf8");
    const actions = [];
    const page = {
      async goto(url) { actions.push({ type: "goto", url }); },
      async waitForLoadState(state) { actions.push({ type: "waitForLoadState", state }); },
      async waitForSelector(selector, options) { actions.push({ type: "waitForSelector", selector, options }); },
      async waitForFunction() { actions.push({ type: "waitForFunction" }); },
      async click(selector, options) { actions.push({ type: "click", selector, options }); },
      async fill(selector, value) { actions.push({ type: "fill", selector, value }); },
      async evaluate(callback) {
        actions.push({ type: "evaluate" });
        const source = callback.toString();
        if (source.includes("data-friends-cli-review-action")) return "[data-friends-cli-review-action]";
        if (source.includes("data-friends-cli-review-message")) return "[data-friends-cli-review-message]";
        return { token: "review-token", userLevel: "XS" };
      },
      async snapshot() {
        actions.push({ type: "snapshot" });
        return "visible review dialog\n通过 @3\n审批意见 @7";
      },
    };
    globalThis.taskSpace = async (id) => {
      actions.push({ type: "taskSpace", id });
      return {
        page(label) { actions.push({ type: "page", label }); return page; },
        async handOff() { actions.push({ type: "handOff" }); },
      };
    };
    await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
    await appendFile(actionPath, JSON.stringify({ script: source, actions }) + "\n");
  ` + "\n");
  const command = `${root}/ego-browser`;
  await writeFile(command, `#!/bin/sh\ncat > "${scriptLog}"\nexec node "${runner}" "${scriptLog}" "${actionLog}"\n`, {
    mode: 0o700,
  });
  return { command, scriptLog, actionLog, async actions() {
    return (await readFile(actionLog, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  } };
}
