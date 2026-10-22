#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { JSDOM } from "jsdom";

const mode = process.env.EGO_ORGANIZATION_APPROVAL_FIXTURE_MODE ?? "clean";
const scriptPath = process.env.EGO_ORGANIZATION_APPROVAL_SCRIPT_PATH;
const evidencePath = process.env.EGO_ORGANIZATION_APPROVAL_EVIDENCE_PATH;
const origin = new URL(process.env.FRIENDS_BASE_URL).origin;
const route = "/mobile/groupManage/studentApprovalJoinDetail?uuid=join-cli";
const evidence = { mode, gotoCount: 0, snapshotCount: 0, clickSelectors: [], fillSelectors: [],
  inputEvents: 0, changeEvents: 0, externalWrites: 0, finalSubmitActions: 0, attributeMutations: 0, handedOff: false };
const initialRoute = mode === "clean" ? "/mobile/groupManage/studentApprovalJoinList" : mode === "other" ? route.replace("join-cli", "other-cli") : route;
const dom = new JSDOM('<!doctype html><iframe></iframe>', { url: origin + "/mobile/", runScripts: "dangerously" });
const window = dom.window;
for (const [key, value] of Object.entries({ token_str: "ego-token", userLevel_str: "XS", userInfo_obj: "{}", account_str: "fixture", loginModel_str: "STUDENT" })) {
  window.localStorage.setItem(key, value);
}
const iframe = window.document.querySelector("iframe");
function render(path) {
  iframe.src = origin + path;
  const frame = iframe.contentWindow;
  const document = frame.document;
  document.open();
  document.write(`<!doctype html><style>.dialog { display:none } .dialog.open { display:block }</style>
    <h1>申请详情</h1><textarea name="specialSkill">保留人的特长</textarea><input name="phone" value="13900000001">
    <button class="approve">通过</button><button class="reject">拒绝</button>
    <section class="dialog${mode === "dirty" ? " open" : ""}"><h2>审批通过</h2>
      <input name="time" value="2026-10-22"><textarea name="msg">${mode === "dirty" ? "用户正在审核的意见" : ""}</textarea>
      <button class="final">确认</button></section>`);
  if (mode === "clean" && path !== route) document.body.innerHTML = "<h1>申请列表</h1>";
  document.close();
  Object.defineProperty(frame.HTMLElement.prototype, "innerText", { get() { return this.textContent; } });
  frame.Element.prototype.getBoundingClientRect = function() {
    return visible(this) ? { width: 320, height: 48 } : { width: 0, height: 0 };
  };
  const setAttribute = frame.Element.prototype.setAttribute;
  frame.Element.prototype.setAttribute = function(...args) { evidence.attributeMutations++; return setAttribute.apply(this, args); };
  frame.fetch = window.fetch = async(url, init) => { evidence.externalWrites++; throw new Error("Unexpected browser request " + url); };
  frame.XMLHttpRequest.prototype.send = function() { evidence.externalWrites++; throw new Error("Unexpected XHR"); };
  frame.HTMLFormElement.prototype.submit = function() { evidence.finalSubmitActions++; };
  document.querySelector(".final")?.addEventListener("click", () => { evidence.finalSubmitActions++; evidence.externalWrites++; });
  for (const button of document.querySelectorAll(".approve,.reject")) {
    button.addEventListener("click", () => {
      document.querySelector(".dialog").classList.add("open");
      document.querySelector("h2").textContent = button.textContent === "通过" ? "审批通过" : "审批拒绝";
    });
  }
  for (const field of document.querySelectorAll("input,textarea")) {
    field.addEventListener("input", () => evidence.inputEvents++);
    field.addEventListener("change", () => evidence.changeEvents++);
  }
}
function visible(element) {
  for (let current = element; current; current = current.parentElement) {
    if (iframe.contentWindow.getComputedStyle(current).display === "none") return false;
  }
  return true;
}
render(initialRoute);
let references = new Map();
let nextRef = 31;
function active() { if (evidence.handedOff) throw new Error("Browser operation after handoff"); }
async function evaluate(callback, argument) {
  active();
  window.__argument = structuredClone(argument);
  const value = await window.eval(`(${callback.toString()})(__argument)`);
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}
const page = {
  async url() { active(); return window.location.href; },
  async goto(url) {
    active();
    if (url !== origin + route || mode !== "clean") throw new Error("Unexpected navigation " + url);
    evidence.gotoCount++;
    render(route);
  },
  async waitForLoadState() { active(); },
  async waitForFunction(callback, argument) {
    if (!await evaluate(callback, argument)) throw new Error("Observable condition failed");
  },
  async evaluate(callback, argument) { return evaluate(callback, argument); },
  async snapshot() {
    active();
    evidence.snapshotCount++;
    references = new Map();
    const lines = ['iframe [ref=' + nextRef++ + ']'];
    for (const element of iframe.contentDocument.querySelectorAll("button,input,textarea")) {
      if (!visible(element)) continue;
      const ref = nextRef++;
      references.set("@" + ref, element);
      const role = element.tagName === "BUTTON" ? "button" : "textbox";
      const name = element.tagName === "BUTTON" ? element.textContent : element.name === "msg" ? "审批意见" : element.name;
      lines.push('  ' + role + ' [ref=' + ref + ']', '    ' + name);
    }
    return lines.join("\n");
  },
  async click(selector) {
    active();
    const element = references.get(selector);
    if (!element || !visible(element)) throw new Error("Unknown/stale snapshot ref " + selector);
    evidence.clickSelectors.push(selector);
    element.click();
  },
  async fill(selector, value) {
    active();
    const element = references.get(selector);
    if (!element || !visible(element) || element.disabled || element.readOnly) throw new Error("Unknown/stale field ref " + selector);
    evidence.fillSelectors.push(selector);
    element.value = value;
    element.dispatchEvent(new iframe.contentWindow.Event("input", { bubbles: true }));
    element.dispatchEvent(new iframe.contentWindow.Event("change", { bubbles: true }));
  },
};
const strictPage = new Proxy(page, { get(target, key) { if (!(key in target)) throw new Error("Undocumented Page API " + String(key)); return target[key]; } });
const task = { page() { return strictPage; }, async handOff() { active(); evidence.handedOff = true; } };
const originalLog = console.log;
if (mode === "lost-result") console.log = (...args) => {
  if (String(args[0]).startsWith("FRIENDS_CLI_EGO_PREPARED:")) originalLog("FRIENDS_CLI_EGO_PREPARED:{invalid");
  else originalLog(...args);
};
try {
  const source = await readFile(scriptPath, "utf8");
  await new Function("taskSpace", "return (async()=>{" + source + "})()")(async() => task);
} finally {
  console.log = originalLog;
  const document = iframe.contentDocument;
  await writeFile(evidencePath, JSON.stringify({ ...evidence,
    finalMessage: document.querySelector('[name="msg"]')?.value,
    specialSkill: document.querySelector('[name="specialSkill"]')?.value,
    phone: document.querySelector('[name="phone"]')?.value,
    dialogOpen: document.querySelector(".dialog")?.classList.contains("open"),
    dialogTitle: document.querySelector("h2")?.textContent,
  }) + "\n");
  window.close();
}
