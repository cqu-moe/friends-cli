import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

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
    account: "20210001",
    pendingMissing: false,
    activityMismatch: false,
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
        const info = { userNo: state.account, userName: "示例" };
        if (state.mode !== "no-role") info.userLoginStateLevel = state.role;
        return reply(res, info);
      }
      if (req.url.endsWith("/ek-agg-mob/user/enterHall")) {
        return reply(res, {
          account: "20210001", name: "示例", userLoginStateLevel: "XS", departmentNo: "24080",
        });
      }
      if (req.url === "/gateway/ek-agg-mob/biz-common/flow/template-activity-state") {
        return reply(res, [{ code: "0", name: "待处理" }]);
      }
      if (req.url === "/gateway/ek-agg-mob/biz-common/flow/callback-list") {
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
        return reply(res, {...transcriptDetail,uuid:state.wrongDetailId?"other-transcript":transcriptDetail.uuid});
      }
      if (req.url.endsWith("/school-activity-attestation-apply/page-list")) {
        const pending = state.pendingMissing ? [] : [{
          uuid: "review-1",
          activityId: "activity-1",
          activityName: "示例活动",
          organizationName: "示例组织",
          beginTime: "2026-10-22 08:00:00",
          endTime: "2026-10-22 10:00:00",
          attestationNumber: 1,
          flowOverallState: 9,
          flowCurrMsg: "等待审批",
        }];
        return reply(res, {
          currentPage: input.currentPage,
          pageSize: input.pageSize,
          totalCount: 1,
          pages: state.pages,
          data: pending,
        });
      }
      if (req.url.endsWith("/school-activity-attestation-apply/approve-detail/review-1")) {
        if ((state.mode === "lost-readback-failure" || state.mode === "ack-readback-failure") && writes.length > 0) {
          res.writeHead(503);
          res.end();
          return;
        }
        const detail = structuredClone(currentReview);
        if(state.wrongDetailId) detail.uuid="other-review";
        if (state.activityMismatch) detail.activityId = "different-activity";
        return reply(res, detail);
      }
      if (req.method === "POST" && /\/school-activity-attestation-apply\/(pass|callback)$/.test(req.url)) {
        state.writeAttempts = (state.writeAttempts ?? 0) + 1;
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

export async function executingEgo(root, { initialMessage = "", currentUrl, browserToken = "review-token", failAfterFill = false } = {}) {
  const runner = `${root}/ego-runner.mjs`;
  const scriptLog = `${root}/generated-script.js`;
  const actionLog = `${root}/ego-actions.jsonl`;
  const targetUrl = "https://friends.cqu.edu.cn/mobile/volunteerManage/campusCerApprovalDetail?uuid=review-1&activityId=activity-1&handleType=XSC";
  const html = `<!doctype html><meta charset="utf-8"><title>认证审批</title>
<style>body{font:16px system-ui;margin:20px}button{padding:10px;margin:4px}textarea{display:block;padding:10px}[data-dialog]{display:none;position:fixed;inset:40px;background:white;padding:20px}[data-dialog].open{display:block}</style>
<main class="action-bar">
  <button type="button" data-action="pass">通过</button>
  <button type="button" data-action="back">打回</button>
  <button type="button" data-action="save">保存</button>
  <section data-dialog class="van-dialog" aria-label="审批对话框"><div class="van-dialog__header"></div>
    <label>审批意见<textarea aria-label="审批意见"></textarea></label>
    <button type="button" data-action="cancel">取消</button>
    <button type="button" data-action="confirm">确认审批</button>
  </section>
</main>
<script>
const dialog=document.querySelector("[data-dialog]");
for(const button of document.querySelectorAll("[data-action]"))button.addEventListener("click",()=>{
  if(button.dataset.action==="pass"||button.dataset.action==="back"){dialog.classList.add("open");dialog.querySelector(".van-dialog__header").textContent=button.dataset.action==="pass"?"审批通过":"审批打回";}
});
document.querySelector("[data-action=confirm]").addEventListener("click",()=>fetch("/school-activity-attestation-apply/pass",{method:"POST"}));
document.querySelector("[data-action=save]").addEventListener("click",()=>fetch("/school-activity-attestation-apply/save",{method:"PUT"}));
document.querySelector("[data-dialog] textarea").value=${JSON.stringify(initialMessage)};
</script>`;
  const config = `${root}/ego.json`;
  await writeFile(config, JSON.stringify({
    html: `${root}/page.html`,
    targetUrl,
    currentUrl: currentUrl ?? targetUrl,
    result: `${root}/observed.json`,
    browserToken, failAfterFill,
  }));
  await writeFile(`${root}/page.html`, html);
  await writeFile(runner, String.raw`
    import { appendFile, readFile } from "node:fs/promises";
    const { JSDOM } = await import(${JSON.stringify(require.resolve("jsdom"))});
    const [scriptPath, actionPath, configPath] = process.argv.slice(2);
    const source = await readFile(scriptPath, "utf8");
    if (source.includes("FRIENDS_CLI_EGO_SESSION:")) {
      console.log("FRIENDS_CLI_EGO_SESSION:" + JSON.stringify({ token: "review-token", userLevel: "XS" }));
      process.exit(0);
    }
    const configuration = JSON.parse(await readFile(configPath, "utf8"));
    const actions = [];
    const stats = {
      events: [], clicks: [], fills: [], snapshots: 0, handoffs: 0,
      navigations: 0, remoteWrites: 0, externalSaves: 0, finalConfirms: 0,
    };
    const contentDom = new JSDOM(await readFile(configuration.html, "utf8"), {
      url: configuration.targetUrl,
      runScripts: "dangerously",
      beforeParse(window) {
        const originalGetBoundingClientRect = window.Element.prototype.getBoundingClientRect;
        window.Element.prototype.getBoundingClientRect = function () {
          const rect = originalGetBoundingClientRect.call(this);
          return rect.width === 0 && rect.height === 0
            ? new window.DOMRect(0, 0, 100, 20)
            : rect;
        };
        window.fetch = async (url, init) => {
          if (init?.method !== "GET") stats.remoteWrites += 1;
          return new Response(null);
        };
      },
    });
    const dom = new JSDOM('<iframe></iframe>', {url: configuration.targetUrl,runScripts: "dangerously"});
    const frame = dom.window.document.querySelector('iframe');
    Object.defineProperty(frame,'contentDocument',{get:()=>contentDom.window.document});
    Object.defineProperty(frame,'contentWindow',{get:()=>contentDom.window});
    const window = dom.window, document = contentDom.window.document;
    for(const w of [window,contentDom.window]){w.localStorage.setItem('token_str',configuration.browserToken);w.localStorage.setItem('userLevel_str','XS');}

    let currentUrl = configuration.currentUrl;
    let handedOff = false;
    function active() { if (handedOff) throw new Error("Browser operation after handOff"); }
    function visible(element) {
      for (let node = element; node; node = node.parentElement) {
        const style = window.getComputedStyle(node);
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          (style.opacity !== "" && Number(style.opacity) === 0)
        ) return false;
      }
      return true;
    }
    let nextRef = 1;
    const refByElement = new WeakMap();
    function capture() {
      const refs = new Map();
      const lines = [];
      for (const element of document.querySelectorAll("button, textarea")) {
        if (!visible(element)) continue;
        let ref = refByElement.get(element);
        if (ref === undefined) {
          ref = "@" + nextRef++;
          refByElement.set(element, ref);
        }
        refs.set(ref, element);
        const label = element instanceof contentDom.window.HTMLTextAreaElement
          ? (element.getAttribute("aria-label") + " " + element.value).trim()
          : element.textContent.trim();
        lines.push((element instanceof contentDom.window.HTMLTextAreaElement ? 'textbox "审批意见"' : "button") + " [ref=" + ref.slice(1) + "]\n  text " + JSON.stringify(label));
      }
      return { text: lines.join("\n"), refs };
    }
    function snapshot() {
      stats.snapshots += 1;
      stats.events.push("snapshot");
      return capture();
    }
    function matches(selector) {
      const css=selector.replace(/^loc=css:/,'');
      const match=css.match(/:has-text\((".*")\)$/);
      return [...document.querySelectorAll(match?css.slice(0,match.index):css)].filter(e=>visible(e)&&(!match||e.textContent.includes(JSON.parse(match[1]))));
    }
    function one(selector){const result=matches(selector);if(result.length!==1)throw new Error('Expected one visible selector: '+selector);return result[0];}
    const page = {
      async url() { active(); return currentUrl; },
      async goto(url) {
        active();
        stats.navigations += 1;
        stats.events.push("goto");
        currentUrl = url;
      },
      async waitForLoadState(state) { active(); actions.push({ type: "waitForLoadState", state }); },
      async waitForSelector(selector, options) {
        active();
        actions.push({ type: "waitForSelector", selector, options });
        for (let attempt = 0; attempt < 30; attempt += 1) {
          const selected = matches(selector);
          if (options?.state === "hidden" ? selected.length === 0 : selected.length > 0) return;
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        throw new Error("Waiting for selector failed: " + selector);
      },
      async waitForFunction(callback, argument, options) {
        active();
        actions.push({ type: "waitForFunction", options });
        window.__argument = structuredClone(argument);
        const body = document.body;
        if (body.innerText === undefined) body.innerText = body.textContent ?? "";
        if (!await window.eval("(" + callback.toString() + ")(__argument)")) {
          throw new Error("Fixture condition was not ready");
        }
      },
      async click(selector, options) {
        active();
        const current = capture();
        const element = selector.startsWith("@") ? current.refs.get(selector) : one(selector);
        if (element === undefined) throw new Error("Unknown snapshot reference: " + selector);
        if (element.dataset.action === "save") stats.externalSaves += 1;
        if (element.dataset.action === "confirm") stats.finalConfirms += 1;
        stats.clicks.push(element.textContent.trim());
        stats.events.push("click");
        actions.push({ type: "click", selector, text: element.textContent.trim(), options });
        element.click();
      },
      async fill(selector, value) {
        active();
        const current = capture();
        const element = selector.startsWith("@") ? current.refs.get(selector) : one(selector);
        if (!(element instanceof contentDom.window.HTMLTextAreaElement)) throw new Error("Fill target is not a textarea");
        stats.fills.push(value);
        stats.events.push("fill");
        actions.push({ type: "fill", selector, value });
        element.value = value;
        element.dispatchEvent(new window.Event("input", { bubbles: true }));
        element.dispatchEvent(new window.Event("change", { bubbles: true }));
        if(configuration.failAfterFill) throw new Error("Lost visible fill receipt");
      },
      async evaluate(callback, argument) {
        active();
        actions.push({ type: "evaluate" });
        window.__argument = structuredClone(argument);
        return JSON.parse(JSON.stringify(await window.eval("(" + callback.toString() + ")(__argument)")));
      },
      async snapshot() {
        active();
        const captured = snapshot();
        actions.push({ type: "snapshot", text: captured.text });
        return captured.text;
      },
    };
    globalThis.taskSpace = async (id) => {
      actions.push({ type: "taskSpace", id });
      return {
        page(label) { actions.push({ type: "page", label }); return page; },
        async handOff() { active(); handedOff=true; stats.handoffs += 1; stats.events.push("handOff"); actions.push({ type: "handOff" }); },
      };
    };
    try {
      await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
    } finally {
      await appendFile(actionPath, JSON.stringify({
        script: source,
        actions,
        stats,
        html: document.body.innerHTML,
      }) + "\n");
      window.close();contentDom.window.close();
    }
  ` + "\n");
  const command = `${root}/ego-browser`;
  await writeFile(
    command,
    `#!/bin/sh\ncat > "${scriptLog}"\nexec node "${runner}" "${scriptLog}" "${actionLog}" "${config}"\n`,
    { mode: 0o700 },
  );
  return { command, scriptLog, actionLog, async actions() {
    return (await readFile(actionLog, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  } };
}
