import { spawn } from "node:child_process";
import { FriendsError, FriendsErrorCode, type WriteRecovery } from "./errors.js";

export interface VisibleVolunteerAnswer {
  title: string;
  type: "TEXT" | "NUMBER" | "CHOICE" | "MULTIPLE_CHOICE";
  inputContent?: string;
  optionLabels?: string[];
}

export interface ExpectedVolunteerPageSession {
  token: string;
  userLevel: string;
  accountUserNo: string;
}

export interface VisibleVolunteerExecution {
  activityId: string;
  pageLabel: string;
  status: "prepared" | "interrupted";
  submitted: false;
  handoff: boolean;
  completedActions: string[];
  preservedFields: string[];
}

function invalid(message: string): never {
  throw new FriendsError({ code: FriendsErrorCode.InvalidInput, message });
}

function validateCommon(options: {
  activityId: string;
  taskSpaceId: number;
  timeoutMs?: number;
  baseUrl: string;
  expectedSession: ExpectedVolunteerPageSession;
}) {
  if (
    typeof options.activityId !== "string" || options.activityId.trim() === "" ||
    options.activityId === "." || options.activityId === ".." || /[\\/?#\s]/.test(options.activityId)
  ) invalid("Invalid volunteer activity ID");
  if (!Number.isSafeInteger(options.taskSpaceId) || options.taskSpaceId < 1) {
    invalid("Ego task space must be a positive integer");
  }
  if (options.timeoutMs !== undefined && (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1)) {
    invalid("Ego timeout must be a positive integer");
  }
  const session = options.expectedSession;
  if (
    typeof session?.token !== "string" || session.token === "" ||
    typeof session.userLevel !== "string" || session.userLevel === "" ||
    typeof session.accountUserNo !== "string" || session.accountUserNo === "" ||
    /[\r\n]/.test(session.token + session.userLevel + session.accountUserNo)
  ) invalid("A verified Ego session is required before visible volunteer preparation");
}

async function runEgo(options: {
  command?: string;
  timeoutMs?: number;
  script: string;
  recovery: WriteRecovery;
}): Promise<VisibleVolunteerExecution> {
  const child = spawn(options.command ?? "ego-browser", ["nodejs"], { stdio: ["pipe", "pipe", "pipe"] });
  let output = "";
  const collect = (chunk: Buffer) => {
    output += chunk.toString();
    if (output.length > 1024 * 1024) child.kill("SIGTERM");
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  child.stdin.on("error", () => child.kill("SIGTERM"));
  const timer = setTimeout(() => child.kill("SIGTERM"), options.timeoutMs ?? 120_000);
  const closed = new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? -1));
  });
  child.stdin.end(options.script);
  let exitCode: number;
  try {
    exitCode = await closed;
  } catch {
    child.kill("SIGTERM");
    throw new FriendsError({ code: FriendsErrorCode.NetworkProtocol, message: "Could not start the Ego browser" });
  } finally {
    clearTimeout(timer);
  }

  const marker = "FRIENDS_CLI_VOLUNTEER_PREPARE:";
  const lines = output.split("\n").filter((line) => line.startsWith(marker));
  let parsed: VisibleVolunteerExecution | null = null;
  if (lines.length === 1) {
    try {
      parsed = JSON.parse(lines[0].slice(marker.length)) as VisibleVolunteerExecution;
    } catch {
      parsed = null;
    }
  }
  if (
    parsed !== null && parsed.status === "prepared" && parsed.submitted === false &&
    parsed.handoff === true && Array.isArray(parsed.completedActions) &&
    Array.isArray(parsed.preservedFields) && typeof parsed.pageLabel === "string" && parsed.pageLabel !== ""
    && parsed.activityId === options.recovery.activityId
  ) return parsed;

  const completedActions = parsed?.completedActions;
  const pageLabel = typeof parsed?.pageLabel === "string" && parsed.pageLabel !== ""
    ? parsed.pageLabel : "unknown";
  throw new FriendsError({
    code: FriendsErrorCode.UnknownOutcome,
    message: "Visible volunteer preparation was interrupted; the dedicated Ego page remains for human review",
    recovery: {
      ...options.recovery,
      completed: Array.isArray(completedActions) ? completedActions : ["page:unknown"],
      pageLabel,
      serverAcknowledged: false,
    },
  });
}

function xpathString(value: string): string {
  if (!value.includes("\"")) return JSON.stringify(value);
  if (!value.includes("'")) return `'${value}'`;
  return `concat(${value.split("\"").map((part) => JSON.stringify(part)).join(",")})`;
}

function pickerOptionSelector(value: string): string {
  const label = xpathString(value);
  return `xpath=(//*[contains(concat(" ", normalize-space(@class), " "), " van-picker-column__item ")][.//*[contains(concat(" ", normalize-space(@class), " "), " van-ellipsis ")][normalize-space(.)=${label}]])[1]`;
}

function fieldInputSelector(title: string): string {
  const quoted = xpathString(title);
  return `xpath=(//*[contains(concat(" ", normalize-space(@class), " "), " form-outside ")][.//text()[normalize-space()=${quoted}]]//textarea | //*[contains(concat(" ", normalize-space(@class), " "), " form-outside ")][.//text()[normalize-space()=${quoted}]]//input)[1]`;
}

function optionIconSelector(label: string): string {
  const quoted = xpathString(label);
  return `xpath=(//*[contains(concat(" ", normalize-space(@class), " "), " van-cell ")][.//text()[normalize-space()=${quoted}]]//*[contains(concat(" ", normalize-space(@class), " "), " van-radio__icon ") or contains(concat(" ", normalize-space(@class), " "), " van-checkbox__icon ")])[1]`;
}

function postFieldSelector(): string {
  const label = xpathString("申请岗位");
  return `xpath=(//*[contains(concat(" ", normalize-space(@class), " "), " van-field ")][.//*[contains(concat(" ", normalize-space(@class), " "), " van-field__label ")][normalize-space(.)=${label}]])[1]`;
}

function visibleAnswers(answers: VisibleVolunteerAnswer[]): Array<{
  title: string;
  type: "TEXT" | "NUMBER" | "CHOICE" | "MULTIPLE_CHOICE";
  inputSelector: string;
  inputContent: string;
  optionSelectors: string[];
}> {
  return answers.map((answer) => {
    if (typeof answer.title !== "string" || answer.title.trim() === "") {
      invalid("Visible volunteer answer requires a title");
    }
    if ((answer.type === "TEXT" || answer.type === "NUMBER") && typeof answer.inputContent !== "string") {
      invalid("Visible TEXT and NUMBER answers require inputContent");
    }
    if (answer.type !== "TEXT" && answer.type !== "NUMBER" && !Array.isArray(answer.optionLabels)) {
      invalid("Visible choice answers require optionLabels");
    }
    return {
      title: answer.title,
      type: answer.type,
      inputSelector: fieldInputSelector(answer.title),
      inputContent: answer.inputContent ?? "",
      optionSelectors: (answer.optionLabels ?? []).map((label) => {
        if (typeof label !== "string" || label.trim() === "") {
          invalid("Visible choice answers require non-empty option labels");
        }
        return optionIconSelector(label);
      }),
    };
  });
}

function pageUrl(baseUrl: string, path: string): string {
  try {
    return new URL(path, new URL(baseUrl).origin).toString();
  } catch {
    invalid("Friends base URL must be a valid http(s) URL");
  }
}

function operationRecovery(operation: string, activityId: string): WriteRecovery {
  return { operation, activityId };
}

/** Internal adapter used by the public Node SDK entry points in node.ts. */
export async function prepareVisibleVolunteerRegistration(options: {
  activityId: string;
  activityName: string;
  postName: string;
  answers: VisibleVolunteerAnswer[];
  taskSpaceId: number;
  baseUrl: string;
  expectedSession: ExpectedVolunteerPageSession;
  command?: string;
  timeoutMs?: number;
}): Promise<VisibleVolunteerExecution> {
  validateCommon(options);
  if (typeof options.activityName !== "string" || options.activityName.trim() === "") {
    invalid("Ego volunteer preparation requires a visible activity name");
  }
  if (typeof options.postName !== "string" || options.postName.trim() === "") {
    invalid("A visible volunteer post name is required");
  }
  const answers = visibleAnswers(options.answers);
  const url = pageUrl(
    options.baseUrl,
    `/mobile/volunteerManage/campusActivityApplyDetail?uuid=${encodeURIComponent(options.activityId)}`,
  );
  const postField = postFieldSelector();
  const submitField = 'text="申请加入"';
  const script = `
const task = await taskSpace(${options.taskSpaceId});
// A dedicated page avoids discarding unsaved work in the caller's existing pages.
const page = await task.newPage();
const completedActions = ["page-opened"];
const preservedFields = [];
try {
  await page.goto(${JSON.stringify(url)});
  await page.waitForLoadState("load");
  await page.waitForSelector(${JSON.stringify(postField)}, { state: "visible", timeout: 15000 });
  const identity = await page.evaluate((expected) => {
    const frame = document.querySelector("iframe");
    const frameWindow = frame?.contentWindow;
    const source = frameWindow?.localStorage ?? localStorage;
    const rawValues = ["userInfo_obj", "userInfo_str", "account_str", "account_obj"]
      .map((key) => source.getItem(key))
      .filter((value) => value !== null);
    let accountMatches = false;
    const visit = (value) => {
      if (accountMatches) return;
      if (value === expected.accountUserNo) accountMatches = true;
      else if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object") Object.values(value).forEach(visit);
    };
    for (const value of rawValues) {
      if (value === expected.accountUserNo) accountMatches = true;
      else if (value.startsWith("{") || value.startsWith("[")) {
        try { visit(JSON.parse(value)); } catch {}
      }
    }
    const current = new URL(frameWindow?.location.href ?? location.href);
    return {
      originMatches: current.origin === new URL(expected.baseUrl).origin,
      routeMatches: current.pathname === expected.pagePath,
      activityMatches: current.searchParams.get("uuid") === expected.activityId,
      tokenMatches: source.getItem("token_str") === expected.token,
      userLevelMatches: source.getItem("userLevel_str") === expected.userLevel,
      accountMatches
    };
  }, {
    baseUrl: ${JSON.stringify(options.baseUrl)},
    activityId: ${JSON.stringify(options.activityId)},
    pagePath: "/mobile/volunteerManage/campusActivityApplyDetail",
    token: ${JSON.stringify(options.expectedSession.token)},
    userLevel: ${JSON.stringify(options.expectedSession.userLevel)},
    accountUserNo: ${JSON.stringify(options.expectedSession.accountUserNo)}
  });
  if (!identity.originMatches || !identity.routeMatches || !identity.activityMatches || !identity.tokenMatches ||
      !identity.userLevelMatches || !identity.accountMatches) {
    throw new Error("The dedicated Ego page does not match the verified volunteer session or activity");
  }
  completedActions.push("session-verified");
  const before = await page.snapshot();
  const activityName = ${JSON.stringify(options.activityName)};
  if (!before.includes(activityName)) throw new Error("volunteer activity is not visible");
  completedActions.push("activity-verified");

  const postState = await page.evaluate(() => {
    const field = Array.from(document.querySelectorAll(".van-field")).find((item) =>
      item.querySelector(".van-field__label")?.textContent?.replace(/\\s+/g, " ").trim() === "申请岗位");
    const input = field?.querySelector("input,textarea");
    return {
      found: field !== undefined && input !== null && input !== undefined,
      value: input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement ? input.value : ""
    };
  });
  if (!postState.found) throw new Error("volunteer post field is not editable");
  if (postState.value !== "") {
    preservedFields.push("post:申请岗位");
    completedActions.push("post:preserved");
  } else {
    await page.click(${JSON.stringify(postField)}, { label: "open volunteer post picker" });
    const option = ${JSON.stringify(pickerOptionSelector(options.postName))};
    await page.waitForSelector(option, { state: "visible", timeout: 15000 });
    await page.click(option, { label: "select volunteer post" });
    await page.click("loc=css:.van-picker__confirm", { label: "confirm volunteer post" });
    await page.waitForSelector("loc=css:.van-picker", { state: "hidden", timeout: 15000 });
    completedActions.push("post:selected");
  }

  for (const answer of ${JSON.stringify(answers)}) {
    const state = await page.evaluate((title) => {
      const group = Array.from(document.querySelectorAll(".form-outside")).find((item) =>
        item.querySelector(".item-title")?.textContent?.replace(/\\s+/g, " ").trim() === title);
      const input = group?.querySelector("input,textarea");
      const selected = group ? Array.from(group.querySelectorAll(".van-cell")).filter((cell) => {
        const icon = cell.querySelector(".van-radio__icon,.van-checkbox__icon");
        return icon?.getAttribute("aria-checked") === "true" || icon?.classList.contains("checked") ||
          icon?.getAttribute("data-selected") === "true";
      }).map((cell) => cell.textContent?.replace(/\\s+/g, " ").trim() ?? "") : [];
      return {
        found: group !== undefined,
        hasInput: input !== null && input !== undefined,
        value: input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement ? input.value : "",
        selected
      };
    }, answer.title);
    if (!state.found) throw new Error("volunteer questionnaire is not visible: " + answer.title);
    if (answer.type === "TEXT" || answer.type === "NUMBER") {
      if (!state.hasInput) throw new Error("volunteer questionnaire input is not visible: " + answer.title);
      if (state.value !== "") {
        preservedFields.push("question:" + answer.title);
        completedActions.push("question:" + answer.title + ":preserved");
        continue;
      }
      await page.waitForSelector(answer.inputSelector, { state: "visible", timeout: 15000 });
      await page.fill(answer.inputSelector, answer.inputContent);
      await page.waitForFunction((expected) => {
        const group = Array.from(document.querySelectorAll(".form-outside")).find((item) =>
          item.querySelector(".item-title")?.textContent?.replace(/\\s+/g, " ").trim() === expected.title);
        const input = group?.querySelector("input,textarea");
        return input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement ?
          input.value === expected.value : false;
      }, { title: answer.title, value: answer.inputContent }, { timeout: 15000 });
      completedActions.push("question:" + answer.title + ":filled");
    } else {
      if (state.selected.length > 0) {
        preservedFields.push("question:" + answer.title);
        completedActions.push("question:" + answer.title + ":selection-preserved");
        continue;
      }
      for (const selector of answer.optionSelectors) {
        await page.waitForSelector(selector, { state: "visible", timeout: 15000 });
        await page.click(selector, { label: "select questionnaire option" });
      }
      await page.waitForFunction((expected) => {
        const group = Array.from(document.querySelectorAll(".form-outside")).find((item) =>
          item.querySelector(".item-title")?.textContent?.replace(/\\s+/g, " ").trim() === expected.title);
        return group?.querySelector(".van-radio__icon.checked,.van-radio__icon[aria-checked=true],.van-radio__icon[data-selected=true],.van-checkbox__icon.checked,.van-checkbox__icon[aria-checked=true],.van-checkbox__icon[data-selected=true]") !== null;
      }, { title: answer.title }, { timeout: 15000 });
      completedActions.push("question:" + answer.title + ":selected");
    }
  }
  const prepared = await page.snapshot();
  await page.waitForSelector(${JSON.stringify(submitField)}, { state: "visible", timeout: 15000 });
  if (!prepared.includes("申请加入")) throw new Error("human submit control is not visible");
  completedActions.push("prepare-complete");
  await task.handOff();
  console.log("FRIENDS_CLI_VOLUNTEER_PREPARE:" + JSON.stringify({
    activityId: ${JSON.stringify(options.activityId)}, pageLabel: page.label, status: "prepared",
    submitted: false, handoff: true, completedActions, preservedFields
  }));
} catch (error) {
  let handoff = false;
  try { await task.handOff(); handoff = true; } catch {}
  console.log("FRIENDS_CLI_VOLUNTEER_PREPARE:" + JSON.stringify({
    activityId: ${JSON.stringify(options.activityId)}, pageLabel: page.label, status: "interrupted",
    submitted: false, handoff, completedActions, preservedFields,
    error: error instanceof Error ? error.message : "visible preparation failed"
  }));
}
`;
  const result = await runEgo({
    command: options.command,
    timeoutMs: options.timeoutMs,
    script,
    recovery: operationRecovery("volunteers.register.ego-prepare", options.activityId),
  });
  return { ...result, activityId: options.activityId };
}

/** Internal adapter used by the public Node SDK entry points in node.ts. */
export async function prepareVisibleVolunteerWithdrawal(options: {
  activityId: string;
  activityName: string;
  taskSpaceId: number;
  baseUrl: string;
  expectedSession: ExpectedVolunteerPageSession;
  command?: string;
  timeoutMs?: number;
}): Promise<VisibleVolunteerExecution> {
  validateCommon(options);
  if (typeof options.activityName !== "string" || options.activityName.trim() === "") {
    invalid("Ego volunteer preparation requires a visible activity name");
  }
  const url = pageUrl(
    options.baseUrl,
    `/mobile/volunteerManage/campusActivityInfo?uuid=${encodeURIComponent(options.activityId)}`,
  );
  const script = `
const task = await taskSpace(${options.taskSpaceId});
const page = await task.newPage();
const completedActions = ["page-opened"];
const preservedFields = [];
try {
  await page.goto(${JSON.stringify(url)});
  await page.waitForLoadState("load");
  const identity = await page.evaluate((expected) => {
    const frame = document.querySelector("iframe");
    const frameWindow = frame?.contentWindow;
    const source = frameWindow?.localStorage ?? localStorage;
    let accountMatches = false;
    const visit = (value) => {
      if (accountMatches) return;
      if (value === expected.accountUserNo) accountMatches = true;
      else if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object") Object.values(value).forEach(visit);
    };
    for (const key of ["userInfo_obj", "userInfo_str", "account_str", "account_obj"]) {
      const value = source.getItem(key);
      if (value === expected.accountUserNo) accountMatches = true;
      else if (value && (value.startsWith("{") || value.startsWith("["))) {
        try { visit(JSON.parse(value)); } catch {}
      }
    }
    const current = new URL(frameWindow?.location.href ?? location.href);
    return {
      originMatches: current.origin === new URL(expected.baseUrl).origin,
      routeMatches: current.pathname === expected.pagePath,
      activityMatches: current.searchParams.get("uuid") === expected.activityId,
      tokenMatches: source.getItem("token_str") === expected.token,
      userLevelMatches: source.getItem("userLevel_str") === expected.userLevel,
      accountMatches
    };
  }, {
    baseUrl: ${JSON.stringify(options.baseUrl)},
    activityId: ${JSON.stringify(options.activityId)},
    pagePath: "/mobile/volunteerManage/campusActivityInfo",
    token: ${JSON.stringify(options.expectedSession.token)},
    userLevel: ${JSON.stringify(options.expectedSession.userLevel)},
    accountUserNo: ${JSON.stringify(options.expectedSession.accountUserNo)}
  });
  if (!identity.originMatches || !identity.routeMatches || !identity.activityMatches || !identity.tokenMatches ||
      !identity.userLevelMatches || !identity.accountMatches) {
    throw new Error("The dedicated Ego page does not match the verified volunteer session or activity");
  }
  completedActions.push("session-verified");
  const before = await page.snapshot();
  if (!before.includes(${JSON.stringify(options.activityName)})) throw new Error("volunteer activity is not visible");
  completedActions.push("activity-verified");
  await page.waitForSelector("text=退出报名", { state: "visible", timeout: 15000 });
  completedActions.push("withdrawal-control-verified");
  await task.handOff();
  console.log("FRIENDS_CLI_VOLUNTEER_PREPARE:" + JSON.stringify({
    activityId: ${JSON.stringify(options.activityId)}, pageLabel: page.label, status: "prepared",
    submitted: false, handoff: true, completedActions, preservedFields
  }));
} catch (error) {
  let handoff = false;
  try { await task.handOff(); handoff = true; } catch {}
  console.log("FRIENDS_CLI_VOLUNTEER_PREPARE:" + JSON.stringify({
    activityId: ${JSON.stringify(options.activityId)}, pageLabel: page.label, status: "interrupted",
    submitted: false, handoff, completedActions, preservedFields,
    error: error instanceof Error ? error.message : "visible preparation failed"
  }));
}
`;
  const result = await runEgo({
    command: options.command,
    timeoutMs: options.timeoutMs,
    script,
    recovery: operationRecovery("volunteers.withdraw.ego-prepare", options.activityId),
  });
  return { ...result, activityId: options.activityId };
}
