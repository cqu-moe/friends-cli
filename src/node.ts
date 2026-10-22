import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FriendsError, FriendsErrorCode } from "./errors.js";

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

async function runEgo(options: {
  script: string;
  command: string;
  timeoutMs: number;
}): Promise<BrowserOutput> {
  const child = spawn(options.command, ["nodejs"], { stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  child.stdout.on("data", (chunk: Buffer) => (stdout += chunk));
  child.stderr.on("data", () => {});
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
  const lastLine = stdout.split("\n").map((line) => line.trim()).filter(Boolean).at(-1);
  try {
    const parsed = lastLine === undefined ? null : JSON.parse(lastLine) as Record<string, unknown>;
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

export async function readEgoSession(options: {
  taskSpaceId?: number;
  page?: string;
  timeoutMs?: number;
  command?: string;
} = {}): Promise<BrowserSession> {
  const page = options.page ?? "p1";
  const userWaitMs = options.timeoutMs ?? 300_000;
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
      const frame = document.querySelector("iframe");
      const frameWindow = frame?.contentWindow;
      const frameDocument = frameWindow?.document;
      if (!frameWindow || !frameDocument || frameWindow.origin !== location.origin) return false;
      const frameUrl = new URL(frameWindow.location.href);
      if (frameUrl.pathname === "/mobile/sso" || frameUrl.searchParams.has("ticket")) return false;
      const local = localStorage;
      const frameLocal = frameWindow.localStorage;
      return ["token_str", "userLevel_str", "userInfo_obj", "account_str", "loginModel_str"]
        .every((key) => Boolean(local.getItem(key)) && local.getItem(key) === frameLocal.getItem(key));
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
console.log(JSON.stringify(raw));
`;
  return runEgo({
    script,
    command: options.command ?? "ego-browser",
    timeoutMs: userWaitMs + 30_000,
  });
}

function storageRoot(): string {
  return resolve(process.env.FRIENDS_HOME ?? join(homedir(), ".local", "state", "friends-cli"));
}

export function sessionPath(): string {
  return join(storageRoot(), "session.json");
}

function assertOutsideRepository(path: string): void {
  const packageRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
  const relation = relative(packageRoot, path);
  if (relation === "" || (!relation.startsWith("..") && !relation.startsWith("/"))) {
    throw safeError("The friends session path must be outside the repository", FriendsErrorCode.InvalidInput);
  }
}

async function secureDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw safeError("The friends session directory is unsafe", FriendsErrorCode.InvalidInput);
  }
  await chmod(path, 0o700);
}

async function writeMetadata(session: SessionMetadata): Promise<string> {
  const root = storageRoot();
  assertOutsideRepository(root);
  await secureDirectory(root);
  const path = join(root, "session.json");
  const existing = await lstat(path).catch(() => null);
  if (existing?.isSymbolicLink() || existing?.isFile() === false) {
    throw safeError("The friends session file is unsafe", FriendsErrorCode.InvalidInput);
  }
  const temporary = join(root, `.session-${randomUUID()}.json`);
  await writeFile(temporary, `${JSON.stringify(session)}\n`, { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
  return path;
}

async function keyringToken(action: "get" | "set", token?: string): Promise<string | null> {
  try {
    const { Entry } = await import("@napi-rs/keyring");
    const entry = new Entry("friends-cli", "local-session", {
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
  if (storage === "keyring") {
    await keyringToken("set", session.token);
    return writeMetadata({ ...session, storage, token: "" });
  }
  return writeMetadata({ ...session, storage: "file", token: session.token });
}

function validateMetadata(value: unknown): SessionMetadata {
  const session = value as StoredSession;
  if (
    session.schemaVersion !== 1 ||
    session.loginMethod !== "local" ||
    (session.storage !== "keyring" && session.storage !== "file") ||
    typeof session.userLevel !== "string" ||
    session.userLevel === "" ||
    typeof session.account?.userNo !== "string" ||
    typeof session.account?.userName !== "string" ||
    typeof session.context?.levelNo !== "string" ||
    typeof session.context?.levelName !== "string" ||
    typeof session.context?.unit?.unitNo !== "string" ||
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
  assertOutsideRepository(root);
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
