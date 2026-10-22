import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import type { webcrypto } from "node:crypto";
import { chmod, lstat, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { homedir } from "node:os";
import type { AddressInfo } from "node:net";
import { dirname, join, resolve } from "node:path";
import {
  createCquAuthClient,
  exportCquDpopKeyPair,
  generateCquDpopKeyPair,
  importCquDpopKeyPair,
  type CquAuthGrant,
  type CquDpopKeyPair,
  type CquFriendsSession,
  type CquGrantManager,
  type CquOAuthCredentials,
} from "./auth.js";
import { loadSession, saveSession, type SessionStorageType, type StoredSession } from "./node.js";
import { FriendsError, FriendsErrorCode } from "./errors.js";

type JsonWebKey = webcrypto.JsonWebKey;

export type { CquAuthGrant, CquDpopKeyPair, CquFriendsSession, CquGrantManager, CquOAuthCredentials };

export interface StoredCquAuthState {
  schemaVersion: 1;
  loginMethod: "cqu-auth";
  storage: SessionStorageType;
  issuer: string;
  clientId: string;
  dpopJkt: string;
  credentials?: CquOAuthCredentials;
  keyPair?: { privateJwk: JsonWebKey; publicJwk: JsonWebKey };
}

export interface SaveCquAuthGrantOptions {
  issuer: string;
  clientId: string;
  storage: SessionStorageType;
}

export interface StartCquAuthLoopbackOptions {
  issuer: string;
  clientId: string;
  friendsBaseUrl?: string;
  timeoutMs?: number;
}

export interface CquAuthLoopback {
  authorizationUrl: string;
  redirectUri: string;
  address(): AddressInfo;
  waitForCallback(timeoutMs?: number): Promise<URL>;
  completeAuthorization(): Promise<CquAuthGrant>;
  close(): Promise<void>;
}

export interface LoadCquAuthManagerOptions {
  friendsBaseUrl?: string;
  redirectUri?: string;
  timeoutMs?: number;
}

type CquAuthSecret = Pick<Required<StoredCquAuthState>, "credentials" | "keyPair">;
type CquAuthMetadata = Omit<StoredCquAuthState, "credentials" | "keyPair">;

function safeError(message: string, code: FriendsErrorCode = FriendsErrorCode.AuthRequired): FriendsError {
  return new FriendsError({ code, message });
}

function storageRoot(): string {
  return resolve(process.env.FRIENDS_HOME ?? join(homedir(), ".local", "state", "friends-cli"));
}

export function cquAuthStatePath(): string {
  return join(storageRoot(), "cqu-auth-state.json");
}

function lockPath(): string {
  return join(storageRoot(), ".cqu-auth-refresh-lock");
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
      throw safeError("The CQU Auth state path must be outside a Git repository", FriendsErrorCode.InvalidInput);
    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
}

async function secureDirectory(path: string): Promise<void> {
  if (process.platform === "win32") throw safeError("CQU Auth file storage requires POSIX permissions in this version", FriendsErrorCode.InvalidInput);
  await assertOutsideRepository(path);
  const existing = await lstat(path).catch(() => null);
  if (existing && (!existing.isDirectory() || existing.isSymbolicLink() || (existing.mode & 0o777) !== 0o700)) {
    throw safeError("Use a dedicated CQU Auth state directory with mode 0700", FriendsErrorCode.InvalidInput);
  }
  if (!existing) await mkdir(path, { recursive: true, mode: 0o700 });
}

async function writeState(state: CquAuthMetadata & Partial<CquAuthSecret>, filename = "cqu-auth-state.json"): Promise<string> {
  const root = storageRoot();
  await secureDirectory(root);
  const path = join(root, filename);
  const existing = await lstat(path).catch(() => null);
  if (existing?.isSymbolicLink() || existing?.isFile() === false) {
    throw safeError("The CQU Auth state file is unsafe", FriendsErrorCode.InvalidInput);
  }
  const temporary = join(root, `.${filename}-${randomUUID()}.json`);
  try {
    await writeFile(temporary, `${JSON.stringify(state)}\n`, { mode: 0o600, flag: "wx" });
    await chmod(temporary, 0o600);
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
  return path;
}

async function keyringSecret(action: "get" | "set" | "delete", secret?: string): Promise<string | null> {
  try {
    const { Entry } = await import("@napi-rs/keyring");
    const entry = new Entry("friends-cli", `cqu-auth-session:${createHash("sha256").update(await realpath(storageRoot())).digest("hex")}`, {
      linux: { store: "secret-service" },
    });
    if (action === "set") {
      if (secret === undefined) throw new Error("missing secret");
      entry.setPassword(secret);
      return null;
    }
    if (action === "delete") {
      entry.deletePassword();
      return null;
    }
    return entry.getPassword();
  } catch {
    throw safeError("The system credential store is unavailable");
  }
}

function validateMetadata(value: unknown): CquAuthMetadata {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw safeError("The CQU Auth state file is invalid", FriendsErrorCode.NetworkProtocol);
  }
  const state = value as StoredCquAuthState;
  if (
    state.schemaVersion !== 1 ||
    state.loginMethod !== "cqu-auth" ||
    (state.storage !== "keyring" && state.storage !== "file") ||
    typeof state.issuer !== "string" || state.issuer === "" ||
    typeof state.clientId !== "string" || state.clientId === "" ||
    typeof state.dpopJkt !== "string" || state.dpopJkt === ""
  ) {
    throw safeError("The CQU Auth state file is invalid", FriendsErrorCode.NetworkProtocol);
  }
  if (state.storage === "keyring" && (state.credentials !== undefined || state.keyPair !== undefined)) {
    throw safeError("The keyring CQU Auth state must not contain credentials", FriendsErrorCode.NetworkProtocol);
  }
  return {
    schemaVersion: state.schemaVersion,
    loginMethod: state.loginMethod,
    storage: state.storage,
    issuer: state.issuer,
    clientId: state.clientId,
    dpopJkt: state.dpopJkt,
  };
}

function validateSecret(value: unknown): CquAuthSecret {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw safeError("The CQU Auth credential is invalid", FriendsErrorCode.NetworkProtocol);
  }
  const secret = value as CquAuthSecret;
  if (
    secret.credentials?.tokenType !== "DPoP" ||
    typeof secret.credentials.accessToken !== "string" || secret.credentials.accessToken === "" ||
    (secret.credentials.refreshToken !== undefined && (typeof secret.credentials.refreshToken !== "string" || secret.credentials.refreshToken === "")) ||
    typeof secret.keyPair?.privateJwk !== "object" || secret.keyPair.privateJwk === null ||
    typeof secret.keyPair?.publicJwk !== "object" || secret.keyPair.publicJwk === null
  ) {
    throw safeError("The CQU Auth credential is invalid", FriendsErrorCode.NetworkProtocol);
  }
  return secret;
}

async function loadState(): Promise<StoredCquAuthState> {
  const root = storageRoot();
  await assertOutsideRepository(root);
  const rootStat = await lstat(root).catch(() => null);
  if (!rootStat?.isDirectory() || rootStat.isSymbolicLink() || (rootStat.mode & 0o777) !== 0o700) {
    throw safeError("The CQU Auth state directory is unavailable or unsafe", FriendsErrorCode.AuthRequired);
  }
  const path = cquAuthStatePath();
  const fileStat = await lstat(path).catch(() => null);
  if (!fileStat?.isFile() || fileStat.isSymbolicLink() || (fileStat.mode & 0o777) !== 0o600) {
    throw safeError("No usable CQU Auth state exists", FriendsErrorCode.AuthRequired);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw safeError("The CQU Auth state file is invalid", FriendsErrorCode.NetworkProtocol);
  }
  const metadata = validateMetadata(parsed);
  if (metadata.storage === "file") {
    const fileState = parsed as StoredCquAuthState;
    const secret = validateSecret(fileState);
    return { ...metadata, ...secret };
  }
  const secret = await keyringSecret("get");
  if (secret === null || secret === "") throw safeError("The CQU Auth credential is unavailable", FriendsErrorCode.AuthRequired);
  try {
    return { ...metadata, ...validateSecret(JSON.parse(secret)) };
  } catch {
    throw safeError("The CQU Auth credential is invalid", FriendsErrorCode.NetworkProtocol);
  }
}

export async function saveCquAuthGrant(
  grant: CquAuthGrant,
  options: SaveCquAuthGrantOptions,
): Promise<string> {
  if (!grant?.credentials || grant.credentials.tokenType !== "DPoP" || !grant.keyPair) {
    throw safeError("A DPoP-bound CQU Auth grant is required", FriendsErrorCode.AuthRequired);
  }
  if (options.storage !== "keyring" && options.storage !== "file") {
    throw safeError("Invalid CQU Auth storage backend", FriendsErrorCode.InvalidInput);
  }
  const secret: CquAuthSecret = {
    credentials: grant.credentials,
    keyPair: await exportCquDpopKeyPair(grant.keyPair),
  };
  const metadata: CquAuthMetadata = {
    schemaVersion: 1,
    loginMethod: "cqu-auth",
    storage: options.storage,
    issuer: options.issuer,
    clientId: options.clientId,
    dpopJkt: grant.dpopJkt,
  };
  await secureDirectory(storageRoot());
  if (options.storage === "keyring") {
    await keyringSecret("set", JSON.stringify(secret));
    return writeState(metadata);
  }
  return writeState({ ...metadata, ...secret });
}

async function saveCredentialsUnlocked(credentials: CquOAuthCredentials): Promise<void> {
  const state = await loadState();
  if (state.storage === "keyring") {
    await keyringSecret("set", JSON.stringify({ credentials, keyPair: state.keyPair }));
    return;
  }
  await writeState({ ...state, credentials });
}

interface RefreshLock { token: string }

async function acquireRefreshLock(waitMs = 70_000): Promise<RefreshLock> {
  await secureDirectory(storageRoot());
  const path = lockPath();
  const token = randomUUID();
  const started = Date.now();
  for (;;) {
    try {
      await mkdir(path, { mode: 0o700 });
      await writeFile(join(path, "owner"), `${token}\n`, { mode: 0o600, flag: "wx" });
      return { token };
    } catch {
      const stat = await lstat(path).catch(() => null);
      if (stat && Date.now() - stat.mtimeMs > 120_000) {
        await rm(path, { recursive: true, force: true });
        continue;
      }
      if (Date.now() - started >= waitMs) {
        throw safeError("Another friends CQU Auth refresh is still running", FriendsErrorCode.AuthRequired);
      }
      await new Promise(resolveDelay => setTimeout(resolveDelay, 50));
    }
  }
}

async function releaseRefreshLock(lock: RefreshLock): Promise<void> {
  const owner = await readFile(join(lockPath(), "owner"), "utf8").catch(() => null);
  if (owner?.trim() !== lock.token) return;
  await rm(lockPath(), { recursive: true, force: true });
}

async function withRefreshLock<T>(operation: (manager: CquGrantManager) => Promise<T>): Promise<T> {
  const lock = await acquireRefreshLock();
  try {
    const state = await loadState();
    const keyPair = await importCquDpopKeyPair(state.keyPair!);
    const manager = createCquAuthClient({
      issuer: state.issuer,
      clientId: state.clientId,
      redirectUri: "http://127.0.0.1:1/callback",
    }).createGrantManager({
      credentials: state.credentials!,
      keyPair,
      persist: saveCredentialsUnlocked,
    });
    return await operation(manager);
  } finally {
    await releaseRefreshLock(lock);
  }
}

function authClient(state: StoredCquAuthState, options: LoadCquAuthManagerOptions) {
  return createCquAuthClient({
    issuer: state.issuer,
    clientId: state.clientId,
    redirectUri: options.redirectUri ?? "http://127.0.0.1:1/callback",
    friendsBaseUrl: options.friendsBaseUrl,
    timeoutMs: options.timeoutMs,
  });
}

export async function loadCquAuthManager(options: LoadCquAuthManagerOptions = {}): Promise<CquGrantManager> {
  const initial = await loadState();
  return {
    getCredentials: () => ({ ...initial.credentials! }),
    refresh: () => withRefreshLock(manager => manager.refresh()),
    requestFriendsServiceTicket: () => withRefreshLock(manager => manager.requestFriendsServiceTicket()),
    exchangeFriendsSession(selector?: { levelNo: string; unitNo: string }) {
      return withRefreshLock(manager => manager.exchangeFriendsSession(selector));
    },
    async createCourseClient(session: CquFriendsSession) {
      const state = await loadState();
      return authClient(state, options).createCourseClient(session);
    },
  };
}

function sameStoredIdentity(session: StoredSession, recovered: CquFriendsSession): boolean {
  return session.account.userNo === recovered.account.userNo &&
    session.context.levelNo === recovered.context.levelNo &&
    session.context.unit.unitNo === recovered.context.unit.unitNo;
}

export async function recoverCquFriendsSession(options: LoadCquAuthManagerOptions & {
  selector?: { levelNo: string; unitNo: string };
} = {}): Promise<StoredSession> {
  const previous = await loadSession().catch(error => {
    if (error instanceof FriendsError && error.code === FriendsErrorCode.AuthRequired) return null;
    throw error;
  });
  if (previous !== null && previous.loginMethod !== "cqu-auth") {
    throw safeError("A local login session exists; run friends auth login --method cqu-auth to switch explicitly");
  }
  const state = await loadState();
  const selector = options.selector ?? (previous === null ? undefined : {
    levelNo: previous.context.levelNo,
    unitNo: previous.context.unit.unitNo,
  });
  const recovered = await authClient(state, options).exchangeFriendsSession(
    await withRefreshLock(manager => manager.requestFriendsServiceTicket()),
    selector,
  );
  if (previous !== null && !sameStoredIdentity(previous, recovered)) {
    throw safeError("The CQU school binding changed; log in explicitly before switching accounts");
  }
  const stored: StoredSession = {
    schemaVersion: 1,
    loginMethod: "cqu-auth",
    storage: state.storage,
    token: recovered.token,
    userLevel: recovered.userLevel,
    account: recovered.account,
    context: recovered.context,
  };
  await saveSession(stored, state.storage);
  return stored;
}

export async function startCquAuthLoopback(options: StartCquAuthLoopbackOptions): Promise<CquAuthLoopback> {
  let callbackResolve: ((value: URL) => void) | undefined;
  let callbackReject: ((error: Error) => void) | undefined;
  const callbackPromise = new Promise<URL>((resolveCallback, rejectCallback) => {
    callbackResolve = resolveCallback;
    callbackReject = rejectCallback;
  });
  let callbackFinished = false;

  const keyPair = await generateCquDpopKeyPair();
  const server: Server = createServer((request, response) => {
    request.on("error", () => response.destroy());
    response.on("error", () => response.destroy());
    if (request.method !== "GET" || request.url === undefined) {
      response.writeHead(400, { "content-type": "text/plain", "cache-control": "no-store" });
      response.end("Invalid callback");
      return;
    }
    const address = server.address() as AddressInfo;
    const origin = `http://127.0.0.1:${address.port}`;
    const expectedHost = `127.0.0.1:${address.port}`;
    let callback: URL;
    try {
      if (request.headers.host !== expectedHost) throw new Error();
      callback = new URL(request.url, origin);
      if (callback.pathname !== "/callback" || callback.username || callback.password || callback.hash) throw new Error();
    } catch {
      response.writeHead(400, { "content-type": "text/plain", "cache-control": "no-store" });
      response.end("Invalid callback");
      if (!callbackFinished) {
        callbackFinished = true;
        callbackReject?.(safeError("CQU Auth returned an invalid callback target", FriendsErrorCode.InvalidInput));
      }
      return;
    }
    response.writeHead(200, { "content-type": "text/plain", "cache-control": "no-store" });
    response.end("Authorization complete. You may close this window.");
    if (!callbackFinished) {
      callbackFinished = true;
      callbackResolve?.(callback);
    }
  });

  await new Promise<void>((resolveListening, rejectListening) => {
    server.once("error", rejectListening);
    server.listen(0, "127.0.0.1", resolveListening);
  });
  const address = server.address() as AddressInfo;
  const redirectUri = `http://127.0.0.1:${address.port}/callback`;
  const client = createCquAuthClient({
    issuer: options.issuer,
    clientId: options.clientId,
    redirectUri,
    friendsBaseUrl: options.friendsBaseUrl,
    timeoutMs: options.timeoutMs,
  });

  async function close(): Promise<void> {
    server.closeAllConnections();
    await new Promise<void>((resolveClosed, rejectClosed) => {
      if (!server.listening) return resolveClosed();
      server.close(error => error ? rejectClosed(error) : resolveClosed());
    });
  }

  let pending: Awaited<ReturnType<typeof client.beginAuthorization>>;
  try {
    pending = await client.beginAuthorization({ keyPair, offlineAccess: true });
  } catch (error) {
    await close().catch(() => undefined);
    throw error;
  }

  return {
    authorizationUrl: pending.authorizationUrl,
    redirectUri,
    address: () => ({ ...address }),
    waitForCallback(timeoutMs = 300_000) {
      const timer = setTimeout(() => {
        if (!callbackFinished) {
          callbackFinished = true;
          callbackReject?.(safeError("Timed out waiting for the CQU Auth callback"));
        }
        void close().catch(() => undefined);
      }, timeoutMs);
      return callbackPromise.finally(() => clearTimeout(timer));
    },
    async completeAuthorization(): Promise<CquAuthGrant> {
      const callback = await callbackPromise;
      await close().catch(() => undefined);
      return client.completeAuthorization(pending, callback);
    },
    close,
  };
}

export async function openAuthorizationUrl(
  url: string,
  options: { command?: string } = {},
): Promise<void> {
  const command = options.command ?? process.env.FRIENDS_BROWSER ??
    (process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open");
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  await new Promise<void>((resolveOpen, rejectOpen) => {
    const child = spawn(command, args, { stdio: "ignore" });
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (error) rejectOpen(error); else resolveOpen();
    };
    child.once("error", error => finish(error));
    child.once("close", code => finish(code === 0 ? undefined : new Error(`browser opener exited ${code}`)));
  });
}
