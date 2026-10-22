import assert from "node:assert/strict";
import { test } from "node:test";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { controlledCquAuthScenario, clientId } from "./oauth-scenario.js";
import {
  startCquAuthLoopback,
  saveCquAuthGrant,
  loadCquAuthManager,
  recoverCquFriendsSession,
  cquAuthStatePath,
  openAuthorizationUrl,
} from "../dist/auth-node.js";

async function completeLoopbackLogin(scenario) {
  const loopback = await startCquAuthLoopback({
    issuer: scenario.issuer,
    clientId,
    friendsBaseUrl: scenario.friendsBaseUrl,
    timeoutMs: 5_000,
  });
  try {
    const authorization = await fetch(loopback.authorizationUrl, { redirect: "manual" });
    const callbackResponse = await fetch(authorization.headers.get("location"));
    assert.equal(callbackResponse.status, 200);
    return await loopback.completeAuthorization();
  } finally {
    await loopback.close().catch(() => undefined);
  }
}

test("Node loopback binds locally and persists the DPoP grant separately from the friends session", async (t) => {
  const scenario = await controlledCquAuthScenario();
  const root = await mkdtemp(join(tmpdir(), "friends-cqu-auth-node-"));
  process.env.FRIENDS_HOME = root;
  t.after(async () => {
    delete process.env.FRIENDS_HOME;
    await scenario.close();
    await rm(root, { recursive: true, force: true });
  });

  const loopback = await startCquAuthLoopback({
    issuer: scenario.issuer,
    clientId,
    friendsBaseUrl: scenario.friendsBaseUrl,
    timeoutMs: 5_000,
  });
  const address = loopback.address();
  assert.equal(address.address, "127.0.0.1");
  assert.equal(new URL(loopback.redirectUri).pathname, "/callback");
  const authorization = await fetch(loopback.authorizationUrl, { redirect: "manual" });
  assert.equal(authorization.status, 302);
  const callbackUrl = authorization.headers.get("location");
  const callbackResponse = await fetch(callbackUrl);
  assert.equal(callbackResponse.status, 200);
  const callback = await loopback.waitForCallback(5_000);
  assert.equal(callback.href, callbackUrl);
  const grant = await loopback.completeAuthorization();
  assert.equal(grant.credentials.tokenType, "DPoP");

  await saveCquAuthGrant(grant, { issuer: scenario.issuer, clientId, storage: "file" });
  assert.equal((await stat(root)).mode & 0o777, 0o700);
  assert.equal((await stat(cquAuthStatePath())).mode & 0o777, 0o600);
  const authState = JSON.parse(await readFile(cquAuthStatePath(), "utf8"));
  assert.equal(authState.loginMethod, "cqu-auth");
  assert.equal(authState.storage, "file");
  assert.equal(authState.dpopJkt, grant.dpopJkt);
  const session = await recoverCquFriendsSession({
    friendsBaseUrl: scenario.friendsBaseUrl,
    redirectUri: loopback.redirectUri,
  });
  assert.equal(session.loginMethod, "cqu-auth");
  assert.equal(session.context.unit.unitNo, "unit-a");
  const friendsState = JSON.parse(await readFile(join(root, "session.json"), "utf8"));
  assert.equal(friendsState.loginMethod, "cqu-auth");
  assert.match(friendsState.token, /^friends-token-\d+$/);
  assert.equal(JSON.stringify(friendsState).includes(grant.credentials.refreshToken), false);
  assert.equal(JSON.stringify(friendsState).includes(grant.credentials.accessToken), false);

  const before = scenario.requests.filter(request => request.url.includes("/token") && request.body?.grant_type === "refresh_token").length;
  const manager = await loadCquAuthManager({
    friendsBaseUrl: scenario.friendsBaseUrl,
    redirectUri: loopback.redirectUri,
  });
  const beforeCredentials = manager.getCredentials();
  beforeCredentials.expiresAt = 1;
  const rotated = await manager.refresh();
  assert.ok(rotated);
  assert.notEqual(rotated.refreshToken, beforeCredentials.refreshToken);
  const persisted = JSON.parse(await readFile(cquAuthStatePath(), "utf8"));
  assert.equal(persisted.credentials.refreshToken, rotated.refreshToken);
  assert.equal(scenario.requests.filter(request => request.url.includes("/token") && request.body?.grant_type === "refresh_token").length, before + 2);
});

test("CQU Auth keyring storage keeps metadata free of credentials and restores the bound key", { timeout: 20_000 }, async (t) => {
  if (process.platform !== "darwin") return;
  const scenario = await controlledCquAuthScenario();
  const root = await mkdtemp(join(tmpdir(), "friends-cqu-auth-keyring-"));
  process.env.FRIENDS_HOME = root;
  const { Entry } = await import("@napi-rs/keyring");
  const account = `cqu-auth-session:${createHash("sha256").update(await import("node:fs/promises").then(fs => fs.realpath(root))).digest("hex")}`;
  const entry = new Entry("friends-cli", account, { linux: { store: "secret-service" } });
  t.after(async () => {
    delete process.env.FRIENDS_HOME;
    entry.deletePassword();
    await scenario.close();
    await rm(root, { recursive: true, force: true });
  });
  const grant = await completeLoopbackLogin(scenario);
  await saveCquAuthGrant(grant, { issuer: scenario.issuer, clientId, storage: "keyring" });
  const metadata = JSON.parse(await readFile(cquAuthStatePath(), "utf8"));
  assert.equal(metadata.storage, "keyring");
  assert.equal("credentials" in metadata, false);
  assert.equal("keyPair" in metadata, false);
  const manager = await loadCquAuthManager({ friendsBaseUrl: scenario.friendsBaseUrl });
  assert.equal(manager.getCredentials().refreshToken, grant.credentials.refreshToken);
  assert.equal(entry.getPassword() !== null, true);
});

test("CQU Auth rejects unsafe loopback callbacks and discovery startup failures close the listener", async (t) => {
  const scenario = await controlledCquAuthScenario();
  t.after(() => scenario.close());
  const loopback = await startCquAuthLoopback({ issuer: scenario.issuer, clientId, timeoutMs: 5_000 });
  t.after(() => loopback.close().catch(() => undefined));
  const address = loopback.address();
  await Promise.all([
    assert.rejects(() => loopback.waitForCallback(2_000)),
    new Promise((resolve, reject) => {
      request({
        hostname: "127.0.0.1",
        port: address.port,
        path: "/callback?code=not-authorized&state=not-authorized",
        headers: { host: `localhost:${address.port}` },
      }, response => {
        response.resume();
        response.on("end", resolve);
      }).on("error", reject).end();
    }),
  ]);
  await loopback.close();

  await assert.rejects(
    startCquAuthLoopback({ issuer: "http://127.0.0.1:9/api/auth", clientId, timeoutMs: 250 }),
    error => error.code !== undefined,
  );
  await assert.rejects(
    openAuthorizationUrl("http://127.0.0.1/callback", { command: join(tmpdir(), `friends-missing-opener-${randomUUID()}`) }),
    error => error instanceof Error,
  );
});

test("competing CLI processes serialize durable CQU Auth refresh rotation", { timeout: 30_000 }, async (t) => {
  const scenario = await controlledCquAuthScenario();
  scenario.refreshDelayMs = 100;
  const root = await mkdtemp(join(tmpdir(), "friends-cqu-auth-lock-"));
  process.env.FRIENDS_HOME = root;
  t.after(async () => {
    delete process.env.FRIENDS_HOME;
    await scenario.close();
    await rm(root, { recursive: true, force: true });
  });
  const grant = await completeLoopbackLogin(scenario);
  await saveCquAuthGrant(grant, { issuer: scenario.issuer, clientId, storage: "file" });
  const before = scenario.requests.filter(request => request.url.includes("/token") && request.body?.grant_type === "refresh_token");
  const modulePath = fileURLToPath(new URL("../dist/auth-node.js", import.meta.url));
  const children = Array.from({ length: 2 }, () => spawn(process.execPath, [
    "--input-type=module",
    "--eval",
    "const {pathToFileURL}=await import('node:url');const {loadCquAuthManager}=await import(pathToFileURL(process.env.AUTH_NODE_MODULE).href);await (await loadCquAuthManager()).refresh();",
  ], { env: { ...process.env, FRIENDS_HOME: root, AUTH_NODE_MODULE: modulePath }, stdio: ["ignore", "ignore", "pipe"] }));
  const exits = children.map(child => new Promise((resolve, reject) => {
    let stderr = "";
    child.stderr.on("data", chunk => stderr += chunk);
    child.once("error", reject);
    child.once("close", code => code === 0 ? resolve(null) : reject(new Error(`refresh subprocess exited ${code}: ${stderr}`)));
  }));
  await Promise.all(exits);
  const requests = scenario.requests.filter(request => request.url.includes("/token") && request.body?.grant_type === "refresh_token").slice(before.length);
  assert.equal(requests.length, 4);
  assert.deepEqual(requests.map(request => request.status), [400, 200, 400, 200]);
  for (let index = 1; index < requests.length; index += 1) {
    assert.ok(requests[index - 1].finishedAt <= requests[index].startedAt, "refresh requests must not overlap");
  }
});

test("CQU Auth recovery preserves the selected school identity and fails closed without its key", async (t) => {
  const scenario = await controlledCquAuthScenario();
  const root = await mkdtemp(join(tmpdir(), "friends-cqu-auth-recovery-"));
  process.env.FRIENDS_HOME = root;
  t.after(async () => {
    delete process.env.FRIENDS_HOME;
    await scenario.close();
    await rm(root, { recursive: true, force: true });
  });
  const grant = await completeLoopbackLogin(scenario);
  await saveCquAuthGrant(grant, { issuer: scenario.issuer, clientId, storage: "file" });
  const first = await recoverCquFriendsSession({ friendsBaseUrl: scenario.friendsBaseUrl });
  scenario.invalidateFriendsToken(first.token);
  scenario.identityMode = "changed";
  await assert.rejects(
    recoverCquFriendsSession({ friendsBaseUrl: scenario.friendsBaseUrl }),
    error => error.code !== undefined,
  );
  const unchanged = JSON.parse(await readFile(join(root, "session.json"), "utf8"));
  assert.equal(unchanged.account.userNo, first.account.userNo);
  assert.equal(unchanged.context.unit.unitNo, first.context.unit.unitNo);

  await rm(cquAuthStatePath(), { force: true });
  await assert.rejects(
    loadCquAuthManager({ friendsBaseUrl: scenario.friendsBaseUrl }),
    error => error.code !== undefined,
  );
});
