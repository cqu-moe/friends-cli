#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { JSDOM } from "jsdom";

const mode = process.env.EGO_ORGANIZATION_FIXTURE_MODE ?? "clean";
const scriptPath = process.env.EGO_ORGANIZATION_SCRIPT_PATH;
const evidencePath = process.env.EGO_ORGANIZATION_EVIDENCE_PATH;
if (!scriptPath || !evidencePath) throw new Error("organization Ego fixture environment is incomplete");

const route = "/mobile/groupManage/studentClubEdit?uuid=org-cli&type=isPrincipal";
const targetUrl = `https://friends.cqu.edu.cn${route}`;
const initialUrl = mode === "dirty" ? targetUrl : "about:blank";
const initialBlurb = mode === "dirty" ? "用户正在编辑的简介" : "";
const html = `<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><title>组织资料受控页面</title>
<style>
body { font: 16px system-ui; margin: 20px; }
.entry { display: block; padding: 12px; border: 1px solid #ccc; }
.dialog { display: none; padding: 20px; border: 2px solid #888; }
.dialog.open { display: block; }
textarea { display: block; width: 320px; height: 120px; }
</style>
<button class="entry" type="button">组织简介及Logo</button>
<section class="dialog${mode === "dirty" ? " open" : ""}" aria-label="组织简介及Logo">
  <label>组织简介 <textarea>${initialBlurb}</textarea></label>
  <button class="final-save" type="button">保存</button>
</section>
<script>
const entry = document.querySelector(".entry");
const dialog = document.querySelector(".dialog");
entry.addEventListener("click", () => dialog.classList.add("open"));
document.querySelector(".final-save").addEventListener("click", () => {
  window.__friendsOrganizationFinalSubmitActions = Number(window.__friendsOrganizationFinalSubmitActions ?? 0) + 1;
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
      const hidden = (() => {
        for (let current = this; current; current = current.parentElement) {
          if (window.getComputedStyle(current).display === "none") return true;
        }
        return false;
      })();
      return hidden
        ? { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0 }
        : { width: 320, height: 48, top: 10, left: 10, right: 330, bottom: 58, x: 10, y: 10 };
    };
    window.fetch = async (url, init) => {
      if (init?.method && init.method.toUpperCase() !== "GET") evidence.externalWrites += 1;
      throw new Error(`Unexpected browser request during organization preparation: ${init?.method ?? "GET"} ${url}`);
    };
  },
});
const window = dom.window;
const document = window.document;

function sameEditRoute(value) {
  try {
    const current = new URL(value);
    const target = new URL(targetUrl);
    return current.pathname === target.pathname &&
      current.searchParams.get("uuid") === target.searchParams.get("uuid") &&
      current.searchParams.get("type") === target.searchParams.get("type");
  } catch {
    return false;
  }
}

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
  if (selector === "@7") return [...document.querySelectorAll(".entry")].filter(visible);
  if (selector === "@8") return [...document.querySelectorAll(".dialog textarea")].filter(visible);
  if (selector.startsWith("@")) throw new Error(`Unknown fixture snapshot ref: ${selector}`);
  if (!/^(?:[a-zA-Z][\w-]*|\*)?(?:[.#[][^\s>]*)?$/.test(selector)) {
    throw new Error(`Organization fixture only accepts snapshot refs or simple CSS selectors: ${selector}`);
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
  window.__friendsOrganizationArgument = structuredClone(argument);
  return browserValue(await window.eval(`(${callback.toString()})(__friendsOrganizationArgument)`));
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
    if (url !== targetUrl || sameEditRoute(state.currentUrl)) {
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
      'button "组织简介及Logo" [@7]',
      ...matches("@8").length === 1 ? ['textbox "组织简介" [@8]'] : [],
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
    evidence.finalSubmitActions = Number(window.__friendsOrganizationFinalSubmitActions ?? 0);
  } finally {
    await writeFile(evidencePath, JSON.stringify({
      ...evidence,
      handedOff: state.handedOff,
      finalValue: document.querySelector(".dialog textarea").value,
      dialogOpen: document.querySelector(".dialog").classList.contains("open"),
    }, null, 2) + "\n");
    window.close();
  }
}
