import { prepareVolunteerActivityReviewPage } from "./volunteer-activity-review-page.js";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import {
  createFriendsSdk,
  courseId,
  createVolunteerCertificationReviewClient,
  type LoginContext,
  type VerifiedVolunteerSession,
} from "./index.js";
import { FriendsError, FriendsErrorCode, type WriteRecovery } from "./errors.js";
import { courseRegistrationId, type CourseParticipationSession, type CourseRegistrationSummary, type CourseQuestionnaireDefinition, type PreparedCourseApply } from "./course-participation.js";
import { loadCourseQuestionnaireFiles } from "./course-questionnaire-files.js";

export * from "./draft-store.js";
export * from "./certification-ego.js";
export * from "./volunteer-offering-ego.js";

export type SessionStorageType = "keyring" | "file";

export interface BrowserSession {
  token: string;
  userLevel: string;
}

export interface StoredSession {
  schemaVersion: 1;
  loginMethod: "local" | "cqu-auth";
  storage: SessionStorageType;
  token: string;
  userLevel: string;
  account: { userNo: string; userName: string };
  context: {
    levelNo: string;
    levelName: string;
    unit: { unitType: number; unitNo: string; unitName: string };
  };
}

export interface VerifiedEgoSession {
  token: string;
  userLevel: string;
  account: { userNo: string; userName: string };
  context: LoginContext;
}

type BrowserOutput = Pick<BrowserSession, "token" | "userLevel">;
type SessionMetadata = Omit<StoredSession, "token"> & { token?: string };

function safeError(message: string, code: FriendsErrorCode = FriendsErrorCode.AuthRequired): FriendsError {
  return new FriendsError({ code, message });
}

function parseToken(value: unknown): string {
  if (typeof value !== "string" || value === "") return "";
  if (!value.startsWith("{")) return value;
  try {
    const wrapped = JSON.parse(value) as Record<string, unknown>;
    const data = wrapped.data;
    const nested = typeof data === "object" && data !== null ? data as Record<string, unknown> : {};
    for (const candidate of [wrapped.token, nested.token, wrapped.data]) {
      if (typeof candidate === "string" && candidate !== "") return candidate;
    }
  } catch {
    return "";
  }
  return "";
}

async function runEgoProcess(options: {
  script: string;
  command: string;
  timeoutMs: number;
}): Promise<string> {
  const child = spawn(options.command, ["nodejs"], { stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  const collect = (stream: "stdout" | "stderr", chunk: Buffer) => {
    if (stream === "stdout") stdout += chunk.toString(); else stderr += chunk.toString();
    if (stdout.length + stderr.length > 1024 * 1024) child.kill("SIGTERM");
  };
  child.stdout.on("data", (chunk: Buffer) => collect("stdout", chunk));
  child.stderr.on("data", (chunk: Buffer) => collect("stderr", chunk));
  child.stdin.on("error", () => child.kill("SIGTERM"));
  const timer = setTimeout(() => child.kill("SIGTERM"), options.timeoutMs);
  const closed = new Promise<number>((resolveChild, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolveChild(code ?? -1));
  });
  child.stdin.end(options.script);
  let exitCode: number;
  try {
    exitCode = await closed;
  } catch {
    child.kill("SIGTERM");
    throw safeError("Could not start the configured Ego browser command");
  } finally {
    clearTimeout(timer);
  }
  if (exitCode !== 0) {
    throw safeError("The Ego friends login bridge failed");
  }
  return `${stdout}\n${stderr}`;
}

function singleMarker(output: string, marker: string): unknown {
  const lines = output.split("\n").filter(line => line.startsWith(marker));
  return lines.length === 1 ? JSON.parse(lines[0].slice(marker.length)) : null;
}

async function runEgoCommand(options: {
  script: string;
  command: string;
  timeoutMs: number;
  marker: string;
}): Promise<Record<string, unknown>> {
  const output = await runEgoProcess(options);
  if (!output.split("\n").some(line => line.startsWith(options.marker))) return {};
  try {
    const parsed = singleMarker(output, options.marker) as Record<string, unknown> | null;
    return parsed ?? {};
  } catch {
    throw safeError("The Ego browser bridge returned invalid output");
  }
}

async function runEgo(options: {
  script: string;
  command: string;
  timeoutMs: number;
  missingSessionMessage?: string;
}): Promise<BrowserOutput> {
  const output = await runEgoProcess(options);
  const marker = "FRIENDS_CLI_EGO_SESSION:";
  const hasMarker = output.split("\n").some(line => line.startsWith(marker));
  if (!hasMarker && options.missingSessionMessage !== undefined) {
    throw safeError(options.missingSessionMessage);
  }
  try {
    const parsed = singleMarker(output, marker) as Record<string, unknown> | null;
    if (parsed?.error === "NO_EXISTING_FRIENDS_SESSION") {
      throw safeError(options.missingSessionMessage ?? "No existing Ego friends session is ready");
    }
    const token = parseToken(parsed?.token);
    const userLevel = parsed?.userLevel;
    if (
      typeof parsed === "object" && parsed !== null &&
      token !== "" && typeof userLevel === "string" && userLevel !== ""
    ) {
      return { token, userLevel };
    }
  } catch {
    // Use the safe generic error below.
  }
  throw safeError("The Ego friends login bridge returned an invalid session");
}

export async function prepareOrganizationProfileInEgo(options: {
  taskSpaceId: number;
  page?: string;
  route: string;
  blurb?: string;
  timeoutMs?: number;
  command?: string;
}): Promise<{
  route: string;
  navigated: boolean;
  dialogAction: "opened-from-snapshot-ref" | "already-open";
  blurbAction: "filled" | "already-matching" | "human-value-preserved" | "left-empty";
  externalWriteActions: 0;
  finalSubmitActions: 0;
}> {
  if (!Number.isSafeInteger(options.taskSpaceId) || options.taskSpaceId < 1) {
    throw safeError("Invalid Ego task space", FriendsErrorCode.InvalidInput);
  }
  const page = options.page ?? "p1";
  if (!/^p[1-9][0-9]*$/.test(page)) {
    throw safeError("Invalid Ego page label", FriendsErrorCode.InvalidInput);
  }
  const userWaitMs = options.timeoutMs ?? 300_000;
  if (!Number.isSafeInteger(userWaitMs) || userWaitMs < 1) {
    throw safeError("Invalid Ego timeout", FriendsErrorCode.InvalidInput);
  }
  if (!options.route.startsWith("/mobile/groupManage/") || /[\\\r\n\0]/.test(options.route)) {
    throw safeError("Invalid organization profile edit route", FriendsErrorCode.InvalidInput);
  }
  const targetUrl = `https://friends.cqu.edu.cn${options.route}`;
  const script = `
const task = await taskSpace(${options.taskSpaceId});
const page = task.page(${JSON.stringify(page)});
const targetUrl = ${JSON.stringify(targetUrl)};
const currentUrl = await page.url();
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
const navigated = !sameEditRoute(currentUrl);
if (navigated) await page.goto(targetUrl);
await page.waitForLoadState("load");
await page.waitForFunction((label) => document.body.innerText.includes(label), "组织简介及Logo", { timeout: 15000 });
const snapshot = await page.snapshot({ scope: "full_page" });
async function visibleTextareaState() {
  return page.evaluate(() => ({
    count: Array.from(document.querySelectorAll("textarea")).filter((field) => {
      const rect = field.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && !field.disabled && !field.readOnly;
    }).length,
    values: Array.from(document.querySelectorAll("textarea")).filter((field) => {
      const rect = field.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && !field.disabled && !field.readOnly;
    }).map((field) => field.value)
  }));
}
const beforeDialog = await visibleTextareaState();
let dialogAction;
if (beforeDialog.count === 0) {
  const entryLine = snapshot.split("\\n").find((line) =>
    line.includes("组织简介及Logo") && /@\\d+/.test(line)
  );
  if (!entryLine) throw new Error("组织简介及Logo entry was not found in the page snapshot");
  await page.click(entryLine.match(/@\\d+/)[0], { label: "open profile dialog" });
  await page.waitForSelector("textarea", { state: "visible", timeout: 15000 });
  dialogAction = "opened-from-snapshot-ref";
} else if (beforeDialog.count === 1) {
  dialogAction = "already-open";
} else {
  throw new Error("Multiple organization profile textareas are visible");
}
const visible = await visibleTextareaState();
if (visible.count !== 1) throw new Error("Exactly one organization profile textarea must be visible");
await page.evaluate(() => {
  const fields = Array.from(document.querySelectorAll("textarea")).filter((field) => {
    const rect = field.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && !field.disabled && !field.readOnly;
  });
  if (fields.length !== 1) throw new Error("Expected one visible organization profile textarea");
  fields[0].setAttribute("data-friends-cli-blurb", "");
  return null;
});
const currentValue = visible.values[0];
const requestedBlurb = ${JSON.stringify(options.blurb ?? null)};
let blurbAction;
if (currentValue !== "" && requestedBlurb !== null && currentValue === requestedBlurb) {
  blurbAction = "already-matching";
} else if (currentValue !== "") {
  blurbAction = "human-value-preserved";
} else if (requestedBlurb === null) {
  blurbAction = "left-empty";
} else {
  await page.fill("textarea[data-friends-cli-blurb]", requestedBlurb);
  await page.waitForFunction((expected) => {
    const fields = Array.from(document.querySelectorAll("textarea"));
    return fields.length === 1 && fields[0].value === expected;
  }, requestedBlurb, { timeout: 15000 });
  blurbAction = "filled";
}
await task.handOff();
console.log("FRIENDS_CLI_EGO_PREPARED:" + JSON.stringify({
  route: ${JSON.stringify(options.route)},
  navigated,
  dialogAction,
  blurbAction,
  externalWriteActions: 0,
  finalSubmitActions: 0
}));
`;
  const output = await runEgoProcess({
    script,
    command: options.command ?? "ego-browser",
    timeoutMs: userWaitMs + 30_000,
  });
  try {
    const parsed = singleMarker(output, "FRIENDS_CLI_EGO_PREPARED:") as {
      route?: unknown;
      navigated?: unknown;
      dialogAction?: unknown;
      blurbAction?: unknown;
      externalWriteActions?: unknown;
      finalSubmitActions?: unknown;
    } | null;
    const blurbAction = parsed?.blurbAction;
    if (
      parsed?.route === options.route &&
      typeof parsed.navigated === "boolean" &&
      (parsed.dialogAction === "opened-from-snapshot-ref" || parsed.dialogAction === "already-open") &&
      (blurbAction === "filled" || blurbAction === "already-matching" ||
        blurbAction === "human-value-preserved" || blurbAction === "left-empty") &&
      parsed.externalWriteActions === 0 &&
      parsed.finalSubmitActions === 0
    ) {
      return {
        route: parsed.route,
        navigated: parsed.navigated,
        dialogAction: parsed.dialogAction,
        blurbAction,
        externalWriteActions: 0,
        finalSubmitActions: 0,
      };
    }
  } catch {
    // Return the generic bridge failure below.
  }
  throw safeError("The Ego organization profile preparation did not return its route");
}

export async function prepareVolunteerCertificationReviewInEgo(options: {
  taskSpaceId: number;
  page?: string;
  reviewId: string;
  session: VerifiedVolunteerSession;
  baseUrl?: string;
  decision: "pass" | "back";
  message: string;
  allowBlankNavigation?: boolean;
  timeoutMs?: number;
  command?: string;
}): Promise<{
  route: string;
  review: {
    id: string;
    activityId: string;
    schoolRole: string;
    handleType: string;
  };
  navigated: boolean;
  decision: "pass" | "back";
  messageAction: "filled" | "human-value-preserved";
  status: "awaiting-user";
  submitted: false;
  handedOff: true;
  manualFields: string[];
}> {
  if (!Number.isSafeInteger(options.taskSpaceId) || options.taskSpaceId < 1) {
    throw safeError("Invalid Ego task space", FriendsErrorCode.InvalidInput);
  }
  const page = options.page ?? "p1";
  if (!/^p[1-9][0-9]*$/.test(page)) {
    throw safeError("Invalid Ego page label", FriendsErrorCode.InvalidInput);
  }
  const userWaitMs = options.timeoutMs ?? 300_000;
  if (!Number.isSafeInteger(userWaitMs) || userWaitMs < 1) {
    throw safeError("Invalid Ego timeout", FriendsErrorCode.InvalidInput);
  }
  if (
    options.decision !== "pass" && options.decision !== "back" ||
    typeof options.message !== "string" || options.message.trim() === "" || options.message.length > 100 ||
    [options.reviewId]
      .some((value) => typeof value !== "string" || value === "" || /[\\/?#\s\r\n]/.test(value))
  ) {
    throw safeError("Invalid certification review preparation input", FriendsErrorCode.InvalidInput);
  }
  const client = createVolunteerCertificationReviewClient({
    baseUrl: options.baseUrl ?? "https://friends.cqu.edu.cn/gateway",
    session: options.session,
  });
  const detail = await client.getPending(options.reviewId);
  if (detail.activity.id === null || detail.schoolRole === "") {
    throw safeError("The pending certification review does not expose its page binding", FriendsErrorCode.PermissionDenied);
  }
  const query = new URLSearchParams({
    uuid: detail.id,
    activityId: detail.activity.id,
    handleType: detail.schoolRole,
  });
  const route = `/mobile/volunteerManage/campusCerApprovalDetail?${query.toString()}`;
  const runtime = new URL("./errors.js", import.meta.url).href;
  const script = `
const {FriendsError, FriendsErrorCode} = await import(${JSON.stringify(runtime)});
const task = await taskSpace(${options.taskSpaceId});
const page = task.page(${JSON.stringify(page)});
const route = ${JSON.stringify(route)};
let started = false;
let completed = [];
try {
  const target = new URL("https://friends.cqu.edu.cn" + route);
  const current = new URL(await page.url());
  let navigated = false;
  const same = current.origin === target.origin && current.pathname === target.pathname && [...target.searchParams].every(([key,value])=>current.searchParams.get(key)===value);
  if (!same) {
    if (current.href !== "about:blank" || !${options.allowBlankNavigation === true}) throw new FriendsError({code:FriendsErrorCode.PermissionDenied,message:"The Ego page is not the requested certification review page"});
    await page.goto(target.href);navigated=true;
  }
  const storage = await page.evaluate(() => ({token:localStorage.getItem("token_str"),userLevel:localStorage.getItem("userLevel_str")}));
  if ((${parseToken.toString()})(storage.token) !== ${JSON.stringify(options.session.token)} || storage.userLevel !== ${JSON.stringify(options.session.userLevel)}) throw new FriendsError({code:FriendsErrorCode.PermissionDenied,message:"The visible Ego account changed"});
  started=true;
  const result = await (${prepareVolunteerActivityReviewPage.toString()})(page,{url:target.href,decision:${JSON.stringify(options.decision)},message:${JSON.stringify(options.message)},time:""});
  completed=result.completed;
  if (result.executionError) {await task.handOff();throw new Error("Visible certification review preparation stopped partway; inspect the form");}
  if (result.status !== "awaiting-user") throw new FriendsError({code:FriendsErrorCode.PermissionDenied,message:result.manualFields.join(", ")});
  await task.handOff();
  console.log("FRIENDS_CLI_EGO_REVIEW_PREPARED:"+JSON.stringify({route,navigated,decision:${JSON.stringify(options.decision)},messageAction:completed.includes("filled-message")?"filled":"human-value-preserved",manualFields:result.manualFields,status:"awaiting-user",submitted:false,handedOff:true}));
} catch(error) {
  console.log("FRIENDS_CLI_EGO_REVIEW_PREPARED:"+JSON.stringify({error:error.message,errorCode:error.code??(started?FriendsErrorCode.UnknownOutcome:FriendsErrorCode.NetworkProtocol),completed}));
}
`;
  let output: string;
  try { output = await runEgoProcess({script, command: options.command ?? "ego-browser", timeoutMs: userWaitMs + 30_000}); }
  catch { throw new FriendsError({code:FriendsErrorCode.UnknownOutcome,message:"Ego review preparation may be partial; inspect the existing page before retrying",recovery:{operation:"volunteer-certification-reviews.prepare",applicationId:detail.id,activityId:detail.activity.id,completed:["visible-preparation-started"]}}); }
  let bridgeError: { message: string; code?: FriendsErrorCode; completed?: string[] } | undefined;
  try {
    const parsed = singleMarker(output, "FRIENDS_CLI_EGO_REVIEW_PREPARED:") as {
      route?: unknown;
      navigated?: unknown;
      decision?: unknown;
      messageAction?: unknown;
      status?: unknown;
      submitted?: unknown;
      handedOff?: unknown;
      error?: unknown;
      errorCode?: unknown;
      completed?: unknown;
      manualFields?: unknown;
    } | null;
    if (typeof parsed?.error !== "string") {
      if (
        parsed?.route === route &&
        typeof parsed.navigated === "boolean" &&
        parsed.decision === options.decision &&
        (parsed.messageAction === "filled" || parsed.messageAction === "human-value-preserved") &&
        parsed.status === "awaiting-user" &&
        parsed.submitted === false &&
        parsed.handedOff === true
      ) {
        return {
          route: parsed.route,
          review: {
            id: detail.id,
            activityId: detail.activity.id,
            schoolRole: detail.schoolRole,
            handleType: detail.handleType,
          },
          navigated: parsed.navigated,
          decision: options.decision,
          messageAction: parsed.messageAction,
          status: "awaiting-user",
          submitted: false,
          handedOff: true,
          manualFields: Array.isArray(parsed.manualFields) ? parsed.manualFields.filter((x): x is string => typeof x === "string") : [],
        };
      }
    } else if (typeof parsed?.error === "string") {
      bridgeError = {
        message: parsed.error,
        code: Object.values(FriendsErrorCode).find((value) => value === parsed.errorCode),
        completed: Array.isArray(parsed.completed) ? parsed.completed.filter((x): x is string => typeof x === "string") : [],
      };
    } else {
      bridgeError = { message: "The Ego certification review preparation returned an invalid result" };
    }
  } catch {
    // Return the generic bridge failure below.
  }
  if (bridgeError !== undefined) {
    throw new FriendsError({code:bridgeError.code ?? FriendsErrorCode.UnknownOutcome,message:bridgeError.message,recovery:bridgeError.code===FriendsErrorCode.UnknownOutcome?{operation:"volunteer-certification-reviews.prepare",applicationId:detail.id,activityId:detail.activity.id,completed:bridgeError.completed}:undefined});
  }
  throw safeError("The Ego certification review preparation did not return its route");
}

export async function readEgoSession(options: {
  taskSpaceId?: number;
  page?: string;
  timeoutMs?: number;
  command?: string;
} = {}): Promise<BrowserSession> {
  if (options.taskSpaceId !== undefined && (!Number.isSafeInteger(options.taskSpaceId) || options.taskSpaceId < 1)) {
    throw safeError("Invalid Ego task space", FriendsErrorCode.InvalidInput);
  }
  const page = options.page ?? "p1";
  if (!/^p[1-9][0-9]*$/.test(page)) throw safeError("Invalid Ego page label", FriendsErrorCode.InvalidInput);
  const userWaitMs = options.timeoutMs ?? 300_000;
  if (!Number.isSafeInteger(userWaitMs) || userWaitMs < 1) throw safeError("Invalid Ego timeout", FriendsErrorCode.InvalidInput);
  const taskExpression = options.taskSpaceId === undefined
    ? 'taskSpace("friends-cli local login")'
    : `taskSpace(${options.taskSpaceId})`;
  const finishExpression = options.taskSpaceId === undefined
    ? 'await task.finish({ keep: [] });'
    : "";
  const script = `
const task = await ${taskExpression};
const page = task.page(${JSON.stringify(page)});
await page.goto("https://friends.cqu.edu.cn/mobile/sso");
await page.waitForLoadState("load");
async function sessionReady() {
  return page.waitForFunction(() => location.origin === "https://friends.cqu.edu.cn" &&
    (() => {
      try {
      const frame = document.querySelector("iframe");
      const frameWindow = frame?.contentWindow;
      const frameDocument = frameWindow?.document;
      if (!frameWindow || !frameDocument || frameWindow.origin !== location.origin) return false;
      const frameUrl = new URL(frameWindow.location.href);
      if (!frameUrl.pathname.startsWith("/mobile/") || /login|sso|roles/i.test(frameUrl.pathname) || frameUrl.searchParams.has("ticket") || frameDocument.readyState !== "complete") return false;
      const local = localStorage;
      const frameLocal = frameWindow.localStorage;
      return ["token_str", "userLevel_str", "userInfo_obj", "account_str", "loginModel_str"]
        .every((key) => Boolean(local.getItem(key)) && local.getItem(key) === frameLocal.getItem(key));
      } catch { return false; }
    })(), undefined, { timeout: 15000 });
}
try {
  await sessionReady();
} catch {
  await task.handOff();
  await task.waitForControl({ timeout: ${userWaitMs} });
  await sessionReady();
}
const raw = await page.evaluate(() => ({
  token: localStorage.getItem("token_str"),
  userLevel: localStorage.getItem("userLevel_str")
}));
${finishExpression}
console.log("FRIENDS_CLI_EGO_SESSION:" + JSON.stringify(raw));
`;
  return runEgo({
    script,
    command: options.command ?? "ego-browser",
    timeoutMs: userWaitMs + 30_000,
  });
}

async function readExistingEgoSession(options: {
  taskSpaceId?: number;
  page?: string;
  timeoutMs?: number;
  command?: string;
  baseUrl?: string;
} = {}): Promise<BrowserSession> {
  if (options.taskSpaceId !== undefined && (!Number.isSafeInteger(options.taskSpaceId) || options.taskSpaceId < 1)) {
    throw safeError("Invalid Ego task space", FriendsErrorCode.InvalidInput);
  }
  const page = options.page ?? "p1";
  if (!/^p[1-9][0-9]*$/.test(page)) throw safeError("Invalid Ego page label", FriendsErrorCode.InvalidInput);
  const userWaitMs = options.timeoutMs ?? 300_000;
  if (!Number.isSafeInteger(userWaitMs) || userWaitMs < 1) throw safeError("Invalid Ego timeout", FriendsErrorCode.InvalidInput);
  const taskExpression = options.taskSpaceId === undefined
    ? 'taskSpace("friends-cli local login")'
    : `taskSpace(${options.taskSpaceId})`;
  const script = `
const task = await ${taskExpression};
const page = task.page(${JSON.stringify(page)});
async function existingSessionReady() {
  return page.waitForFunction((expectedOrigin) => location.origin === expectedOrigin &&
    (() => {
      try {
        const frame = document.querySelector("iframe");
        const frameWindow = frame?.contentWindow;
        const target = frameWindow ?? window;
        if (target.origin !== location.origin) return false;
        const url = new URL(target.location.href);
        if (!url.pathname.startsWith("/mobile/") || /login|sso|roles/i.test(url.pathname) || url.searchParams.has("ticket") || target.document.readyState !== "complete") return false;
        if (!["token_str", "userLevel_str"].every(key => Boolean(target.localStorage.getItem(key)))) return false;
        return !frameWindow || ["token_str", "userLevel_str", "userInfo_obj", "account_str", "loginModel_str"]
          .every(key => Boolean(localStorage.getItem(key)) && localStorage.getItem(key) === frameWindow.localStorage.getItem(key));
      } catch { return false; }
    })(), ${JSON.stringify(new URL(options.baseUrl ?? "https://friends.cqu.edu.cn/gateway").origin)}, { timeout: 15000 });
}
let raw;
try {
  await existingSessionReady();
  raw = await page.evaluate(() => ({
    token: localStorage.getItem("token_str"),
    userLevel: localStorage.getItem("userLevel_str")
  }));
} catch {
  raw = { error: "NO_EXISTING_FRIENDS_SESSION" };
}
console.log("FRIENDS_CLI_EGO_SESSION:" + JSON.stringify(raw));
`;
  return runEgo({
    script,
    command: options.command ?? "ego-browser",
    timeoutMs: userWaitMs + 30_000,
    missingSessionMessage: "No existing Ego friends session is ready",
  });
}

export async function readVerifiedEgoSession(options: {
  taskSpaceId?: number;
  page?: string;
  timeoutMs?: number;
  command?: string;
  baseUrl?: string;
  selector?: { levelNo?: string; unitNo?: string };
} = {}): Promise<VerifiedEgoSession> {
  const browserSession = await readExistingEgoSession(options);
  const activated = await createFriendsSdk({ baseUrl: options.baseUrl }).activateLocalContext({
    token: browserSession.token,
    userLevel: browserSession.userLevel,
    selector: options.selector ? { ...options.selector } : undefined,
  });
  return {
    token: browserSession.token,
    userLevel: activated.context.levelNo,
    account: activated.account,
    context: activated.context,
  };
}

export interface CourseRegistrationEgoPreparation {
  operation: string;
  execution: "ego-visible-prepare";
  submitted: false;
  status: "awaiting-user";
  taskSpaceId: number;
  page: string;
  target:
    | { kind: "course"; courseId: string; route: string }
    | { kind: "registration"; registrationId: string; courseName: string; route: string };
  userAction: string;
  finalSubmissionBy: "human";
  automaticSubmit: false;
  remoteFinalWrites: 0;
  role: { id: string; name: string; status: string } | null;
  completedActions: string[];
  preservedInputs: string[];
  pendingInputs: string[];
  pendingQuestionnaires: CourseQuestionnaireDefinition[];
  course?: PreparedCourseApply["course"];
  registration?: CourseRegistrationSummary["registration"];
}

export async function prepareCourseRegistrationInEgo(options: {
  operation: "apply" | "withdraw" | "exit";
  taskSpaceId: number;
  session: CourseParticipationSession;
  page?: string;
  timeoutMs?: number;
  command?: string;
  baseUrl?: string;
  courseId?: string;
  registrationId?: string;
  courseName: string;
  roleId?: string;
  questionnaire?: unknown;
}): Promise<CourseRegistrationEgoPreparation> {
  const invalid = (message: string): never => { throw safeError(message, FriendsErrorCode.InvalidInput); };
  if (!["apply", "withdraw", "exit"].includes(options.operation)) invalid("Invalid course operation");
  if (!Number.isSafeInteger(options.taskSpaceId) || options.taskSpaceId < 1) invalid("Invalid Ego task space");
  const page = options.page ?? "p1", timeoutMs = options.timeoutMs ?? 30_000;
  if (!/^p[1-9][0-9]*$/.test(page) || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1) invalid("Invalid Ego page or timeout");
  if (typeof options.courseName !== "string" || !options.courseName.trim()) invalid("A non-empty course name is required");
  if (options.operation === "apply") {
    if (options.courseId === undefined || options.registrationId !== undefined) invalid("One courseId is required for apply");
    courseId(options.courseId!);
  } else {
    if (options.registrationId === undefined || options.courseId !== undefined || options.roleId !== undefined || options.questionnaire !== undefined) invalid("One registrationId is required for withdrawal or exit");
    courseRegistrationId(options.registrationId!);
  }
  const session = structuredClone(options.session);
  const client = await createFriendsSdk({ baseUrl: options.baseUrl }).createCourseParticipationClient(session);
  let prepared: PreparedCourseApply | undefined;
  let registration: CourseRegistrationSummary["registration"] | undefined;
  const files = await loadCourseQuestionnaireFiles(options.questionnaire);
  for (const answer of files.answers ?? []) if ("attachments" in answer) {
    if (answer.attachments.some((file, index) => (file.content as File).name !== basename(files.paths[answer.questionId][index]))) {
      invalid("Ego uploads preserve local filenames; filename overrides require the API path");
    }
  }
  if (options.operation === "apply") {
    prepared = files.answers === undefined
      ? await client.inspectApply(options.courseId!)
      : await client.prepareApply(options.courseId!, { roleId: options.roleId, questionnaire: files.answers });
    if (prepared.course.name !== options.courseName) invalid("The course name differs from current school detail");
    if (options.roleId !== undefined && !prepared.roles.some(role => role.id === options.roleId)) invalid("roleId was not returned by course detail");
  } else {
    const summary = await client.getMyRegistration(courseRegistrationId(options.registrationId!));
    if (summary.courseName !== options.courseName) invalid("The course name differs from the current personal record");
    registration = summary.registration;
    let matches = 0;
    for (let page = 1; ; page++) {
      const records = await client.listMyRegistrations({ page, pageSize: 20, keyword: options.courseName });
      matches += records.items.filter(item => item.courseName === options.courseName).length;
      if (matches > 1 || records.hasMore === null || page > 100) invalid("The personal course name is ambiguous; select the exact school record manually");
      if (!records.hasMore) break;
    }
    if (matches !== 1) invalid("The selected personal course is no longer visible");
  }
  const origin = new URL(options.baseUrl ?? "https://friends.cqu.edu.cn/gateway").origin;
  const route = options.operation === "apply"
    ? `${origin}/mobile/course/stuCourseDetail?uuid=${encodeURIComponent(options.courseId!)}&type=Apply`
    : `${origin}/mobile/course/stuCourseQuery`;
  const runtime = new URL("./course-participation-page.js", import.meta.url).href;
  const input = { operation: options.operation, page, route, session, courseId: options.courseId,
    registrationId: options.registrationId, courseName: options.courseName, prepared, roleId: options.roleId,
    answers: files.answers?.map(answer => "attachments" in answer ? { questionId: answer.questionId, attachments: [] } : answer), paths: files.paths };
  const script = `
const task = await taskSpace(${options.taskSpaceId});
const {prepareCourseParticipationPage} = await import(${JSON.stringify(runtime)});
try {
 const result = await prepareCourseParticipationPage(task, ${JSON.stringify(input)});
 console.log("FRIENDS_CLI_EGO_RESULT:" + JSON.stringify({ok:true,...result}));
} catch(error) {
 console.log("FRIENDS_CLI_EGO_RESULT:" + JSON.stringify({error:error.message,errorCode:error.code,recovery:error.recovery}));
}
`;
  let output: Record<string, unknown>;
  try {
    output = await runEgoCommand({ script, command: options.command ?? "ego-browser", timeoutMs: timeoutMs + 30_000, marker: "FRIENDS_CLI_EGO_RESULT:" });
  } catch (cause) {
    throw new FriendsError({ code: FriendsErrorCode.UnknownOutcome, message: "Course preparation response was lost; inspect the visible page before retrying", cause,
      recovery: { operation: `courses.registrations.${options.operation}.prepare`, courseId: options.courseId, registrationId: options.registrationId } });
  }
  if (output.error || output.ok !== true || ![output.completedActions, output.preservedInputs, output.pendingInputs].every(value => Array.isArray(value) && value.every(item => typeof item === "string")) ||
    !(output.role === null || typeof output.role === "object" && output.role !== null && typeof (output.role as Record<string, unknown>).id === "string" && typeof (output.role as Record<string, unknown>).status === "string")) {
    const code = Object.values(FriendsErrorCode).find(code => code === output.errorCode) ?? FriendsErrorCode.UnknownOutcome;
    throw new FriendsError({ code, message: typeof output.error === "string" ? output.error : "Course preparation returned no receipt",
      recovery: output.recovery as WriteRecovery | undefined ?? { operation: `courses.registrations.${options.operation}.prepare`, courseId: options.courseId, registrationId: options.registrationId } });
  }
  return {
    operation: `courses.registrations.${options.operation}.prepare`, execution: "ego-visible-prepare", submitted: false,
    status: "awaiting-user", taskSpaceId: options.taskSpaceId, page,
    target: options.operation === "apply" ? { kind: "course", courseId: options.courseId!, route }
      : { kind: "registration", registrationId: options.registrationId!, courseName: options.courseName, route },
    userAction: "Review the preserved form and pending inputs, then personally make the final decision",
    finalSubmissionBy: "human", automaticSubmit: false, remoteFinalWrites: 0,
    role: output.role as CourseRegistrationEgoPreparation["role"], completedActions: output.completedActions as string[],
    preservedInputs: output.preservedInputs as string[], pendingInputs: output.pendingInputs as string[],
    pendingQuestionnaires: prepared?.questionnaires ?? [], course: prepared?.course, registration,
  };
}

function storageRoot(): string {
  return resolve(process.env.FRIENDS_HOME ?? join(homedir(), ".local", "state", "friends-cli"));
}

export function sessionPath(): string {
  return join(storageRoot(), "session.json");
}

async function assertOutsideRepository(path: string): Promise<void> {
  let existing = path;
  const missing: string[] = [];
  while (!(await lstat(existing).catch(() => null))) {
    missing.unshift(existing.slice(dirname(existing).length + 1));
    existing = dirname(existing);
  }
  let directory = resolve(await realpath(existing), ...missing);
  while (true) {
    if (await lstat(join(directory, ".git")).catch(() => null)) {
      throw safeError("The friends session path must be outside a Git repository", FriendsErrorCode.InvalidInput);
    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
}

async function secureDirectory(path: string): Promise<void> {
  if (process.platform === "win32") throw safeError("Local session storage requires POSIX permissions in this version", FriendsErrorCode.InvalidInput);
  await assertOutsideRepository(path);
  const existing = await lstat(path).catch(() => null);
  if (existing && (!existing.isDirectory() || existing.isSymbolicLink() || (existing.mode & 0o777) !== 0o700)) {
    throw safeError("Use a dedicated session directory with mode 0700", FriendsErrorCode.InvalidInput);
  }
  if (!existing) await mkdir(path, { recursive: true, mode: 0o700 });
}

async function writeMetadata(session: SessionMetadata): Promise<string> {
  const root = storageRoot();
  await assertOutsideRepository(root);
  await secureDirectory(root);
  const path = join(root, "session.json");
  const existing = await lstat(path).catch(() => null);
  if (existing?.isSymbolicLink() || existing?.isFile() === false) {
    throw safeError("The friends session file is unsafe", FriendsErrorCode.InvalidInput);
  }
  const temporary = join(root, `.session-${randomUUID()}.json`);
  try {
    await writeFile(temporary, `${JSON.stringify(session)}\n`, { mode: 0o600, flag:"wx" });
    await chmod(temporary, 0o600);
    await rename(temporary, path);
  } finally { await rm(temporary, {force:true}); }
  return path;
}

async function keyringToken(action: "get" | "set", token?: string): Promise<string | null> {
  try {
    const { Entry } = await import("@napi-rs/keyring");
    const entry = new Entry("friends-cli", `local-session:${createHash("sha256").update(await realpath(storageRoot())).digest("hex")}`, {
      linux: { store: "secret-service" },
    });
    if (action === "set") {
      if (token === undefined) throw new Error("missing token");
      entry.setPassword(token);
      return null;
    }
    return entry.getPassword();
  } catch {
    throw safeError("The system credential store is unavailable");
  }
}

export async function saveSession(
  session: StoredSession,
  storage: SessionStorageType = "keyring",
): Promise<string> {
  if (storage !== "keyring" && storage !== "file") throw safeError("Invalid storage backend", FriendsErrorCode.InvalidInput);
  validateMetadata({...session, storage:"file"});
  await secureDirectory(storageRoot());
  const metadataStat = await lstat(sessionPath()).catch(() => null);
  if (metadataStat && (!metadataStat.isFile() || metadataStat.isSymbolicLink())) throw safeError("Unsafe session metadata", FriendsErrorCode.InvalidInput);
  if (storage === "keyring") {
    await keyringToken("set", session.token);
    return writeMetadata({ ...session, storage, token: "" });
  }
  return writeMetadata({ ...session, storage: "file", token: session.token });
}

function validateMetadata(value: unknown): SessionMetadata {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw safeError("The friends session file is invalid", FriendsErrorCode.NetworkProtocol);
  }
  const session = value as StoredSession;
  if (
    session.schemaVersion !== 1 ||
    (session.loginMethod !== "local" && session.loginMethod !== "cqu-auth") ||
    (session.storage !== "keyring" && session.storage !== "file") ||
    typeof session.userLevel !== "string" ||
    session.userLevel === "" ||
    session.userLevel !== session.context?.levelNo ||
    typeof session.account?.userNo !== "string" || session.account.userNo === "" ||
    typeof session.account?.userName !== "string" ||
    typeof session.context?.levelNo !== "string" ||
    typeof session.context?.levelName !== "string" ||
    typeof session.context?.unit?.unitNo !== "string" || session.context.unit.unitNo === "" ||
    typeof session.context?.unit?.unitName !== "string" ||
    typeof session.context?.unit?.unitType !== "number"
  ) {
    throw safeError("The friends session file is invalid", FriendsErrorCode.NetworkProtocol);
  }
  if (session.storage === "file" && (typeof session.token !== "string" || session.token === "")) {
    throw safeError("The file friends session is missing its token", FriendsErrorCode.NetworkProtocol);
  }
  if (session.storage === "keyring" && session.token !== undefined && session.token !== "") {
    throw safeError("The keyring friends session must not contain a token", FriendsErrorCode.NetworkProtocol);
  }
  return session;
}

export async function loadSession(): Promise<StoredSession> {
  const root = storageRoot();
  await assertOutsideRepository(root);
  const rootStat = await lstat(root).catch(() => null);
  if (
    rootStat === null || !rootStat.isDirectory() || rootStat.isSymbolicLink() ||
    (rootStat.mode & 0o777) !== 0o700
  ) {
    throw safeError("The friends session directory is unavailable or unsafe", FriendsErrorCode.AuthRequired);
  }
  const path = join(root, "session.json");
  const fileStat = await lstat(path).catch(() => null);
  if (
    fileStat === null || !fileStat.isFile() || fileStat.isSymbolicLink() ||
    (fileStat.mode & 0o777) !== 0o600
  ) {
    throw safeError("No usable local friends session exists", FriendsErrorCode.AuthRequired);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw safeError("The friends session file is invalid", FriendsErrorCode.NetworkProtocol);
  }
  const metadata = validateMetadata(parsed);
  const token = metadata.storage === "keyring"
    ? await keyringToken("get")
    : metadata.token ?? "";
  if (token === null || token === "") {
    throw safeError("The friends credential is unavailable", FriendsErrorCode.AuthRequired);
  }
  return { ...metadata, token };
}

export * from "./certification-capture.js";
export {prepareVolunteerActivityReviewInEgo} from './volunteer-activity-review-ego.js';

export { prepareOrganizationActivityReviewInEgo } from "./organization-activity-review-ego.js";

export {prepareCourseReviewInEgo} from './course-review-ego.js';
