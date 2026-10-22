import { readFile, writeFile } from "node:fs/promises";

const mode = process.env.EGO_ORGANIZATION_FIXTURE_MODE ?? "clean";
const scriptPath = process.env.EGO_ORGANIZATION_SCRIPT_PATH;
const evidencePath = process.env.EGO_ORGANIZATION_EVIDENCE_PATH;
const route = "/mobile/groupManage/studentClubEdit?uuid=org-cli&type=isPrincipal";
const targetUrl = `https://friends.cqu.edu.cn${route}`;
const state = {
  url: mode === "dirty" ? targetUrl : "about:blank",
  dialogOpen: mode === "dirty",
  value: mode === "dirty" ? "用户正在编辑的简介" : "",
  handedOff: false,
};
const evidence = {
  mode,
  methods: [],
  gotoCount: 0,
  snapshotCount: 0,
  clickSelectors: [],
  fillSelectors: [],
  waitForTimeoutCount: 0,
  externalWrites: 0,
  finalSubmitActions: 0,
};

function fakeTextarea() {
  return {
    value: state.value,
    disabled: false,
    readOnly: false,
    setAttribute(name, value) {
      if (name !== "data-friends-cli-blurb" || value !== "") {
        throw new Error(`Unexpected test attribute: ${name}=${value}`);
      }
      this.datasetValue = value;
    },
    getBoundingClientRect() {
      return { width: 300, height: 120, top: 40, left: 10 };
    },
  };
}

function installDom() {
  globalThis.location = new URL(state.url);
  globalThis.document = {
    body: { innerText: state.dialogOpen ? "组织简介及Logo 组织简介" : "组织简介及Logo" },
    querySelectorAll(selector) {
      if (selector === "textarea") return state.dialogOpen ? [fakeTextarea()] : [];
      return [];
    },
  };
}

class StrictPage {
  label = "p1";
  spaceId = 16;

  async url() {
    evidence.methods.push("url");
    return state.url;
  }

  async goto(url) {
    evidence.methods.push("goto");
    evidence.gotoCount += 1;
    const target = new URL(url);
    const current = new URL(state.url);
    if (
      current.pathname === target.pathname &&
      current.searchParams.get("uuid") === target.searchParams.get("uuid") &&
      current.searchParams.get("type") === target.searchParams.get("type")
    ) {
      throw new Error("fixture refused to navigate the same dirty form");
    }
    state.url = target.href;
  }

  async waitForLoadState() {
    evidence.methods.push("waitForLoadState");
  }

  async waitForFunction(callback, argument, options) {
    evidence.methods.push("waitForFunction");
    installDom();
    if (!await callback(argument)) throw new Error("observable condition failed");
    return options;
  }

  async waitForSelector(selector) {
    evidence.methods.push("waitForSelector");
    installDom();
    if (selector !== "textarea" || !state.dialogOpen) throw new Error(`selector not observed: ${selector}`);
  }

  async snapshot() {
    evidence.methods.push("snapshot");
    evidence.snapshotCount += 1;
    return [
      'cell "组织简介及Logo" [@7]',
      state.dialogOpen ? 'textbox "组织简介" [@8]' : "",
    ].filter(Boolean).join("\n");
  }

  async evaluate(callback, argument) {
    evidence.methods.push("evaluate");
    installDom();
    return callback(argument);
  }

  async click(selector) {
    evidence.methods.push("click");
    evidence.clickSelectors.push(selector);
    if (selector !== "@7") throw new Error(`unexpected click selector: ${selector}`);
    if (state.dialogOpen) throw new Error("dialog was already open");
    state.dialogOpen = true;
  }

  async fill(selector, value) {
    evidence.methods.push("fill");
    evidence.fillSelectors.push(selector);
    if (selector !== "textarea[data-friends-cli-blurb]") {
      throw new Error(`unexpected fill selector: ${selector}`);
    }
    if (state.value !== "") throw new Error("fixture refused to overwrite a human value");
    state.value = value;
  }
}

const basePage = new StrictPage();
const page = new Proxy(basePage, {
  get(target, property, receiver) {
    if (!(property in target)) throw new Error(`undocumented Ego Page API: ${String(property)}`);
    return Reflect.get(target, property, receiver);
  },
});

globalThis.taskSpace = async () => ({
  spaceId: 16,
  page() {
    return page;
  },
  async handOff() {
    state.handedOff = true;
  },
});

const source = await readFile(scriptPath, "utf8");
if (!source.includes("FRIENDS_CLI_EGO_PREPARED")) {
  console.log('FRIENDS_CLI_EGO_SESSION:{"token":"ego-token","userLevel":"XS"}');
} else {
  await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`);
  if (!state.handedOff) throw new Error("script did not hand off");
  await writeFile(evidencePath, `${JSON.stringify({
    ...evidence,
    handedOff: state.handedOff,
    finalValue: state.value,
  }, null, 2)}\n`);
}
