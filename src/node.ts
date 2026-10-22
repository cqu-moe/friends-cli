import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createFriendsSdk, type LoginContext } from "./index.js";
import { FriendsError, FriendsErrorCode } from "./errors.js";

export * from "./draft-store.js";
export * from "./certification-ego.js";

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
