import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { request } from "node:http";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { controlledCquAuthScenario, clientId } from "./oauth-scenario.js";

const execFileAsync = promisify(execFile);
const cli = resolve("dist/cli/main.js");
const exitFor = { INVALID_INPUT: 2, AUTH_REQUIRED: 3 };

function spawnCli(args, env) {
  const child = spawn(process.execPath, [cli, ...args], { env, stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", chunk => stderr += chunk);
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  const closed = new Promise((resolveClose, reject) => {
    child.once("error", reject);
    child.once("close", code => resolveClose(code ?? -1));
  });
  return {
    child,
    lines,
    async json() {
      const line = await lines.next();
      assert.equal(line.done, false);
      return JSON.parse(line.value);
    },
    async done() {
      const code = await closed;
      return { code, stderr };
    },
  };
}

async function expectFailure(args, env, expectedCode) {
  const child = spawnCli(args, env);
  const output = await child.json();
  const result = await child.done();
  assert.equal(result.code, exitFor[expectedCode]);
  assert.equal(output.ok, false);
  assert.equal(output.error.code, expectedCode);
  return output;
}

async function authorizationRedirect(authorizationUrl) {
  const response = await fetch(authorizationUrl, { redirect: "manual" });
  assert.equal(response.status, 302);
  return response.headers.get("location");
}

test("real CLI completes CQU Auth login, separated storage, course query, and one explicit recovery", { timeout: 30_000 }, async (t) => {
  const scenario = await controlledCquAuthScenario();
  const root = await mkdtemp(join(tmpdir(), "friends-cqu-auth-cli-"));
  const env = {
    ...process.env,
    FRIENDS_HOME: root,
    FRIENDS_BASE_URL: scenario.friendsBaseUrl,
  };
  delete env.NODE_TEST_CONTEXT;
  t.after(async () => {
    await scenario.close();
    await rm(root, { recursive: true, force: true });
  });

  const login = spawnCli([
    "auth", "login", "--method", "cqu-auth",
    "--issuer", scenario.issuer,
    "--client-id", clientId,
    "--storage", "file",
    "--no-open", "--json",
  ], env);
  const interim = await login.json();
  assert.equal(interim.ok, true);
  assert.deepEqual(Object.keys(interim.data), ["authorizationUrl"]);
  const authorizationUrl = interim.data.authorizationUrl;
  const callbackUrl = await authorizationRedirect(authorizationUrl);
  const callbackResponse = await fetch(callbackUrl);
  assert.equal(callbackResponse.status, 200);
  assert.equal(callbackResponse.headers.get("cache-control"), "no-store");
  const final = await login.json();
  const closed = await login.done();
  assert.equal(closed.code, 0);
  assert.equal(closed.stderr, "");
  assert.equal(final.ok, true);
  assert.equal(final.data.loginMethod, "cqu-auth");
  assert.equal(final.data.account.userNo, "20210001");
  assert.equal(final.data.context.unit.unitNo, "unit-a");

  const authState = JSON.parse(await readFile(join(root, "cqu-auth-state.json"), "utf8"));
  const friendsState = JSON.parse(await readFile(join(root, "session.json"), "utf8"));
  assert.equal((await stat(root)).mode & 0o777, 0o700);
  assert.equal((await stat(join(root, "cqu-auth-state.json"))).mode & 0o777, 0o600);
  assert.equal((await stat(join(root, "session.json"))).mode & 0o777, 0o600);
  assert.equal(JSON.stringify(friendsState).includes(authState.credentials.refreshToken), false);
  assert.equal(JSON.stringify(friendsState).includes(authState.credentials.accessToken), false);

  const tokenRequests = scenario.requests.filter(item => item.url.includes("/token"));
  assert.ok(tokenRequests.every(item =>
    item.headers.authorization === undefined &&
    item.headers.dpop !== undefined &&
    item.body.client_id === clientId &&
    item.body.client_secret === undefined,
  ));
  assert.ok(scenario.requests.filter(item => item.url.includes("/service-tickets")).every(item =>
    item.headers.authorization?.startsWith("DPoP ") && item.headers.dpop !== undefined,
  ));
  const serviceTickets = [...scenario.issuedTickets.keys()];
  const callback = new URL(callbackUrl);
  const sensitive = [
    ...serviceTickets,
    authState.credentials.accessToken,
    authState.credentials.refreshToken,
    callback.searchParams.get("code"),
    callback.searchParams.get("state"),
    friendsState.token,
    ...Object.values(authState.keyPair.privateJwk),
  ];
  for (const value of sensitive.filter(item => typeof item === "string")) {
    assert.equal(JSON.stringify(final).includes(value), false);
  }

  const status = await execFileAsync(process.execPath, [cli, "auth", "status", "--json"], { env });
  const statusJson = JSON.parse(status.stdout);
  assert.equal(statusJson.data.loginMethod, "cqu-auth");
  assert.equal(status.stdout.includes(friendsState.token), false);

  const courses = await execFileAsync(process.execPath, [cli, "courses", "list", "--json"], { env });
  const coursesJson = JSON.parse(courses.stdout);
  assert.equal(coursesJson.data.items[0].id, "course-1");
  const detail = await execFileAsync(process.execPath, [cli, "courses", "show", "course-1", "--json"], { env });
  assert.equal(JSON.parse(detail.stdout).data.id, "course-1");

  scenario.invalidateFriendsToken(friendsState.token);
  const recovered = await execFileAsync(process.execPath, [cli, "courses", "list", "--json"], { env });
  const recoveredJson = JSON.parse(recovered.stdout);
  assert.equal(recoveredJson.ok, true);
  assert.equal(recoveredJson.meta.verification.account.userNo, "20210001");
  const refreshedFriendsState = JSON.parse(await readFile(join(root, "session.json"), "utf8"));
  assert.notEqual(refreshedFriendsState.token, friendsState.token);
  assert.equal(scenario.requests.filter(item => item.url.split("?")[0].endsWith("/cas/login")).length, 2);
});

test("real CLI reports CQU Auth negative paths without secrets or silent fallback", { timeout: 30_000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "friends-cqu-auth-cli-negative-"));
  const env = {
    ...process.env,
    FRIENDS_HOME: root,
    FRIENDS_BASE_URL: "http://127.0.0.1:9/gateway",
  };
  delete env.NODE_TEST_CONTEXT;
  delete env.CQU_AUTH_ISSUER;
  delete env.CQU_AUTH_CLIENT_ID;
  t.after(() => rm(root, { recursive: true, force: true }));
  await expectFailure(["auth", "login", "--method", "cqu-auth", "--json"], env, "INVALID_INPUT");
  await expectFailure(["auth", "login", "--method", "cqu-auth", "--issuer", "https://auth.invalid", "--json"], env, "INVALID_INPUT");

  const cases = [
    ["denied scope", { authorizationError: "access_denied" }, "AUTH_REQUIRED"],
    ["wrong callback state", {}, "AUTH_REQUIRED"],
    ["invalid DPoP proof", { rejectDpopProof: true }, "AUTH_REQUIRED"],
    ["multi-account without selection", { manyAccount: true }, "INVALID_INPUT"],
  ];
  for (const [name, options, expectedCode] of cases) {
    const scenario = await controlledCquAuthScenario(options);
    scenario.authorizationError = options.authorizationError ?? null;
    scenario.rejectDpopProof = options.rejectDpopProof ?? false;
    const caseEnv = { ...env, FRIENDS_BASE_URL: scenario.friendsBaseUrl };
    const child = spawnCli([
      "auth", "login", "--method", "cqu-auth",
      "--issuer", scenario.issuer, "--client-id", clientId,
      "--storage", "file", "--no-open", "--json",
    ], caseEnv);
    const interim = await child.json();
    let callbackUrl = await authorizationRedirect(interim.data.authorizationUrl);
    if (name === "wrong callback state") {
      const wrongState = new URL(callbackUrl);
      wrongState.searchParams.set("state", "wrong");
      callbackUrl = wrongState.href;
    }
    await fetch(callbackUrl);
    const failure = await child.json();
    const result = await child.done();
    assert.equal(result.code, exitFor[expectedCode], name);
    assert.equal(failure.ok, false, name);
    assert.equal(failure.error.code, expectedCode, name);
    assert.equal(failure.error.message.includes("code="), false, name);
    await scenario.close();
  }

  const mismatch = await controlledCquAuthScenario();
  const child = spawnCli([
    "auth", "login", "--method", "cqu-auth",
    "--issuer", mismatch.issuer, "--client-id", clientId,
    "--storage", "file", "--no-open", "--json",
  ], { ...env, FRIENDS_BASE_URL: mismatch.friendsBaseUrl });
  const interim = await child.json();
  const callbackUrl = new URL(await authorizationRedirect(interim.data.authorizationUrl));
  await Promise.all([
    child.done().then(result => assert.equal(result.code, 2)),
    new Promise((resolve, reject) => {
      request({
        hostname: "127.0.0.1",
        port: callbackUrl.port,
        path: `${callbackUrl.pathname}${callbackUrl.search}`,
        headers: { host: `localhost:${callbackUrl.port}` },
      }, response => {
        response.resume();
        response.on("end", resolve);
      }).on("error", reject).end();
    }),
  ]);
  await mismatch.close();
});
