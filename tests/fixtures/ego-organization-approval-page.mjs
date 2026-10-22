#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { JSDOM } from "jsdom";

const mode = process.env.EGO_ORGANIZATION_APPROVAL_FIXTURE_MODE ?? "clean";
const scriptPath = process.env.EGO_ORGANIZATION_APPROVAL_SCRIPT_PATH;
const evidencePath = process.env.EGO_ORGANIZATION_APPROVAL_EVIDENCE_PATH;
if (!scriptPath || !evidencePath) throw new Error("organization approval Ego fixture environment is incomplete");

const route = "/mobile/groupManage/studentApprovalJoinDetail?uuid=join-cli";
const targetUrl = `https://friends.cqu.edu.cn${route}`;
const initialUrl = mode === "dirty" ? targetUrl : "about:blank";
const initialMessage = mode === "dirty" ? "用户正在审核的意见" : "";
const html = `<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><title>组织审批受控页面</title>
<style>
body { font: 16px system-ui; margin: 20px; }
.actions { display: flex; gap: 20px; }
.action { padding: 12px; border: 1px solid #ccc; }
.dialog { display: none; padding: 20px; border: 2px solid #888; }
.dialog.open { display: block; }
textarea { display: block; width: 320px; height: 120px; }
</style>
<main>
  <h1>申请详情</h1>
  <div class="actions">
    <button class="approve action" type="button">通过</button>
    <button class="reject action" type="button">拒绝</button>
  </div>
  <section class="dialog${mode === "dirty" ? " open" : ""}" aria-label="审批弹窗">
    <h2 class="title">审批通过</h2>
    <label>审批时间 <output class="time">2026-10-22</output></label>
    <label>审批意见 <textarea>${initialMessage}</textarea></label>
    <button class="final-confirm" type="button">确认</button>
  </section>
</main>
<script>
const actions = [...document.querySelectorAll(".action")];
for (const action of actions) {
  action.addEventListener("click", () => {
    document.querySelector(".dialog").classList.add("open");
    document.querySelector(".title").textContent = action.textContent.includes("通过") ? "审批通过" : "审批拒绝";
  });
}
document.querySelector(".final-confirm").addEventListener("click", () => {
  window.__friendsOrganizationApprovalFinalSubmitActions =
    Number(window.__friendsOrganizationApprovalFinalSubmitActions ?? 0) + 1;
});
</script></html>`;

const state = { currentUrl: initialUrl, handedOff: false };
const evidence = {
  mode,
  methods: [],
  gotoCount: 0,
  snapshotCount: 0,
  clickSelectors: [],
  fillSelectors: [],
  inputEvents: 0,
  changeEvents: 0,
  waitForTimeoutCount: 0,
  externalWrites: 0,
  finalSubmitActions: 0,
};

const dom = new JSDOM(html, {
  url: targetUrl,
  runScripts: "dangerously",
  beforeParse(window) {
    Object.defineProperty(window.HTMLElement.prototype, "innerText", {
      configurable: true,
      get() { return this.textContent?.replace(/\s+/g, " ").trim() ?? ""; },
    });
    window.Element.prototype.getBoundingClientRect = function() {
      let hidden = false;
      for (let current = this; current; current = current.parentElement) {
        if (window.getComputedStyle(current).display === "none") hidden = true;
      }
      return hidden
        ? { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0 }
        : { width: 320, height: 48, top: 10, left: 10, right: 330, bottom: 58, x: 10, y: 10 };
    };
    window.fetch = async(url, init) => {
      if (init?.method && init.method.toUpperCase() !== "GET") evidence.externalWrites += 1;
      throw new Error(`Unexpected browser request during approval preparation: ${init?.method ?? "GET"} ${url}`);
    };
  },
});
const window = dom.window;
const document = window.document;

function active() {
  if (state.handedOff) throw new Error("Browser operation after handOff");
}

function visible(element) {
  for (let current = element; current; current = current.parentElement) {
    if (window.getComputedStyle(current).display === "none") return false;
  }
  return true;
}

function matches(selector) {
  if (selector === "@7") return [...document.querySelectorAll(".approve")].filter(visible);
  if (selector === "@8") return [...document.querySelectorAll(".reject")].filter(visible);
  if (selector === "@9") return [...document.querySelectorAll(".dialog textarea")].filter(visible);
  if (selector.startsWith("@")) throw new Error(`Unknown fixture snapshot ref: ${selector}`);
  if (!/^[a-z]+(?:\[[^\s=[]+\])?$/.test(selector)) {
    throw new Error(`Approval fixture only accepts snapshot refs or simple CSS selectors: ${selector}`);
  }
  return [...document.querySelectorAll(selector)].filter(visible);
}

function one(selector) {
  const elements = matches(selector);
  if (elements.length !== 1) throw new Error(`Expected exactly one visible match: ${selector}, got ${elements.length}`);
  return elements[0];
}

function browserValue(value) {
  return JSON.parse(JSON.stringify(value));
}

async function evaluateBrowser(callback, argument) {
  window.__friendsOrganizationApprovalArgument = structuredClone(argument);
  return browserValue(await window.eval(`(${callback.toString()})(__friendsOrganizationApprovalArgument)`));
}

class StrictPage {
  label = "p1";
  spaceId = 16;

  async url() {
    active();
    evidence.methods.push("url");
    return state.currentUrl;
  }

  async goto(url) {
    active();
    evidence.methods.push("goto");
    if (url !== targetUrl || state.currentUrl === targetUrl) {
      throw new Error(`Unexpected navigation would discard fixture edits: ${state.currentUrl} -> ${url}`);
    }
    evidence.gotoCount += 1;
    state.currentUrl = url;
  }

  async waitForLoadState() {
    active();
    evidence.methods.push("waitForLoadState");
  }

  async waitForFunction(callback, argument, options) {
    active();
    evidence.methods.push("waitForFunction");
    const deadline = Date.now() + (options?.timeout ?? 30_000);
    for (;;) {
      if (browserValue(await evaluateBrowser(callback, argument))) return options;
      if (Date.now() >= deadline) throw new Error("observable condition failed");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  async waitForSelector(selector, options = {}) {
    active();
    evidence.methods.push("waitForSelector");
    const deadline = Date.now() + (options.timeout ?? 30_000);
    for (;;) {
      const elements = matches(selector);
      if (options.state === "hidden" ? elements.length === 0 : elements.length === 1) return;
      if (Date.now() >= deadline) throw new Error(`Waiting for selector failed: ${selector}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  async snapshot() {
    active();
    evidence.methods.push("snapshot");
    evidence.snapshotCount += 1;
    return [
      'heading "申请详情" [@6]',
      'button "通过" [@7]',
      'button "拒绝" [@8]',
      ...matches("@9").length === 1 ? ['textbox "审批意见" [@9]'] : [],
    ].join("\n");
  }

  async evaluate(callback, argument) {
    active();
    evidence.methods.push("evaluate");
    return evaluateBrowser(callback, argument);
  }

  async click(selector) {
    active();
    evidence.methods.push("click");
    const element = one(selector);
    evidence.clickSelectors.push(selector);
    element.click();
  }

  async fill(selector, value) {
    active();
    evidence.methods.push("fill");
    const element = one(selector);
    if (element.disabled || element.readOnly) throw new Error("Cannot fill a disabled or read-only field");
    evidence.fillSelectors.push(selector);
    element.value = value;
    element.dispatchEvent(new window.Event("input", { bubbles: true }));
    element.dispatchEvent(new window.Event("change", { bubbles: true }));
    evidence.inputEvents += 1;
    evidence.changeEvents += 1;
  }

  async waitForTimeout() {
    active();
    evidence.waitForTimeoutCount += 1;
    throw new Error("Fixed waits are forbidden");
  }
}

const basePage = new StrictPage();
const page = new Proxy(basePage, {
  get(target, property, receiver) {
    if (!(property in target)) throw new Error(`undocumented Ego Page API: ${String(property)}`);
    return Reflect.get(target, property, receiver);
  },
});
const task = {
  spaceId: 16,
  page() { return page; },
  async handOff() {
    active();
    state.handedOff = true;
  },
};
globalThis.taskSpace = async () => task;

const source = await readFile(scriptPath, "utf8");
if (!source.includes("FRIENDS_CLI_EGO_PREPARED")) {
  console.log('FRIENDS_CLI_EGO_SESSION:{"token":"ego-token","userLevel":"XS"}');
} else {
  try {
    await new Function("taskSpace", "return (async()=>{" + source + "})()")(globalThis.taskSpace);
    if (!state.handedOff) throw new Error("script did not hand off");
    evidence.finalSubmitActions = Number(window.__friendsOrganizationApprovalFinalSubmitActions ?? 0);
  } finally {
    await writeFile(evidencePath, JSON.stringify({
      ...evidence,
      handedOff: state.handedOff,
      finalMessage: document.querySelector(".dialog textarea").value,
      dialogOpen: document.querySelector(".dialog").classList.contains("open"),
      dialogTitle: document.querySelector(".title").textContent,
    }, null, 2) + "\n");
    window.close();
  }
}
