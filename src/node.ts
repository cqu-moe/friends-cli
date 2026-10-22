import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createFriendsSdk, type LoginContext } from "./index.js";
import { FriendsError, FriendsErrorCode } from "./errors.js";

export * from "./draft-store.js";

export type SessionStorageType = "keyring" | "file";

export interface BrowserSession {
  token: string;
  userLevel: string;
}

export interface StoredSession {
  schemaVersion: 1;
  loginMethod: "local";
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

async function runEgoCommand(options: {
  script: string;
  command: string;
  timeoutMs: number;
  marker: string;
}): Promise<Record<string, unknown>> {
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
  const marker = options.marker;
  const lines = `${stdout}\n${stderr}`.split("\n").filter(line => line.startsWith(marker));
  const lastLine = lines.length === 1 ? lines[0].slice(marker.length) : undefined;
  if (lastLine === undefined) return {};
  try {
    return JSON.parse(lastLine) as Record<string, unknown>;
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
  const parsed = await runEgoCommand({
    script: options.script,
    command: options.command,
    timeoutMs: options.timeoutMs,
    marker: "FRIENDS_CLI_EGO_SESSION:",
  });
  if (parsed.error === "NO_EXISTING_FRIENDS_SESSION") {
    throw safeError(options.missingSessionMessage ?? "No existing Ego friends session is ready");
  }
  const token = parseToken(parsed.token);
  const userLevel = parsed.userLevel;
  if (token !== "" && typeof userLevel === "string" && userLevel !== "") {
    return { token, userLevel };
  }
  throw safeError("The Ego friends login bridge returned an invalid session");
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
}

export async function prepareCourseRegistrationInEgo(options: {
  operation: "apply" | "withdraw" | "exit";
  taskSpaceId: number;
  page?: string;
  timeoutMs?: number;
  command?: string;
  courseId?: string;
  registrationId?: string;
  courseName: string;
}): Promise<CourseRegistrationEgoPreparation> {
  if (!Number.isSafeInteger(options.taskSpaceId) || options.taskSpaceId < 1) {
    throw safeError("Invalid Ego task space", FriendsErrorCode.InvalidInput);
  }
  const page = options.page ?? "p1";
  if (!/^p[1-9][0-9]*$/.test(page)) {
    throw safeError("Invalid Ego page label", FriendsErrorCode.InvalidInput);
  }
  const userWaitMs = options.timeoutMs ?? 30_000;
  if (!Number.isSafeInteger(userWaitMs) || userWaitMs < 1) {
    throw safeError("Invalid Ego timeout", FriendsErrorCode.InvalidInput);
  }
  if (options.courseName.trim() === "") {
    throw safeError("A non-empty course name is required", FriendsErrorCode.InvalidInput);
  }
  if (options.operation === "apply" && options.courseId === undefined) {
    throw safeError("courseId is required", FriendsErrorCode.InvalidInput);
  }
  if (options.operation !== "apply" && options.registrationId === undefined) {
    throw safeError("registrationId is required", FriendsErrorCode.InvalidInput);
  }

  const applyUrl = options.courseId === undefined
    ? null
    : `https://friends.cqu.edu.cn/mobile/course/stuCourseDetail?uuid=${encodeURIComponent(options.courseId)}&type=Apply`;
  const listUrl = "https://friends.cqu.edu.cn/mobile/course/stuCourseQuery";
  const route = applyUrl ?? listUrl;
  const actionText = options.operation === "withdraw" ? "撤销" : "退出报名";
  const script = `
const task = await taskSpace(${options.taskSpaceId});
const page = task.page(${JSON.stringify(page)});
await page.goto(${JSON.stringify(route)});
await page.waitForLoadState("load");
await page.waitForSelector(".app-container", { state: "visible", timeout: ${userWaitMs} });
${
  options.operation === "apply"
    ? `await page.waitForSelector(".form-container, .footer", { state: "visible", timeout: ${userWaitMs} });`
    : `await page.fill(".van-search input", ${JSON.stringify(options.courseName)});
await page.click("text=搜索");
await page.waitForFunction((courseName) => document.body.innerText.includes(courseName), ${JSON.stringify(options.courseName)}, { timeout: ${userWaitMs} });
const actionSelector = await page.evaluate(({ courseName, actionText }) => {
  const card = [...document.querySelectorAll(".list-group")].find((node) => node.textContent?.includes(courseName));
  if (!card) return null;
  const target = [...card.querySelectorAll("button, [role=button], .list-action *")]
    .find((node) => node.textContent?.trim() === actionText);
  if (!target) return null;
  target.setAttribute("data-friends-cli-action", "prepared");
  return "[data-friends-cli-action=prepared]";
}, { courseName: ${JSON.stringify(options.courseName)}, actionText: ${JSON.stringify(actionText)} });
if (!actionSelector) {
  console.log("FRIENDS_CLI_EGO_RESULT:" + JSON.stringify({ error: "COURSE_ACTION_NOT_FOUND" }));
} else {
  await page.click(actionSelector, { label: ${JSON.stringify(`open ${options.operation} review`)} });
  await page.waitForSelector(".van-dialog", { state: "visible", timeout: ${userWaitMs} });
  console.log("FRIENDS_CLI_EGO_RESULT:" + JSON.stringify({ ok: true }));
}`
}
${
  options.operation === "apply"
    ? `console.log("FRIENDS_CLI_EGO_RESULT:" + JSON.stringify({ ok: true }));`
    : ""
}
await task.handOff();
`;
  const output = await runEgoCommand({
    script,
    command: options.command ?? "ego-browser",
    timeoutMs: userWaitMs + 30_000,
    marker: "FRIENDS_CLI_EGO_RESULT:",
  });
  if (output.error === "COURSE_ACTION_NOT_FOUND") {
    throw safeError(
      "The course action was not visible in the Ego page; no write was attempted",
      FriendsErrorCode.UpstreamBusiness,
    );
  }
  if (output.ok !== true) {
    throw safeError("The Ego course preparation bridge failed");
  }
  return {
    operation: `courses.registrations.${options.operation}.prepare`,
    execution: "ego-visible-prepare",
    submitted: false,
    status: "awaiting-user",
    taskSpaceId: options.taskSpaceId,
    page,
    target: options.operation === "apply"
      ? { kind: "course", courseId: options.courseId ?? "", route }
      : { kind: "registration", registrationId: options.registrationId ?? "", courseName: options.courseName, route },
    userAction: options.operation === "apply"
      ? "Review and complete the visible course form, then personally click the final apply button"
      : `Review the visible ${actionText} confirmation, edit or cancel if needed, and personally make the final decision`,
    finalSubmissionBy: "human",
    automaticSubmit: false,
    remoteFinalWrites: 0,
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
    throw safeError("The local friends session file is invalid", FriendsErrorCode.NetworkProtocol);
  }
  const session = value as StoredSession;
  if (
    session.schemaVersion !== 1 ||
    session.loginMethod !== "local" ||
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
    throw safeError("The local friends session file is invalid", FriendsErrorCode.NetworkProtocol);
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
    throw safeError("The local friends session file is invalid", FriendsErrorCode.NetworkProtocol);
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
