import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { controlledCquAuthScenario, clientId, redirectPath } from "./oauth-scenario.js";
import { createCquAuthClient, generateCquDpopKeyPair } from "../dist/auth.js";
import { FriendsErrorCode } from "../dist/errors.js";

async function authorize(auth, keyPair) {
  const pending = await auth.beginAuthorization({ keyPair, offlineAccess: true });
  const response = await fetch(pending.authorizationUrl, { redirect: "manual" });
  assert.equal(response.status, 302);
  return { pending, callbackUrl: response.headers.get("location") };
}

test("CQU Auth SDK completes DPoP authorization to a verified friends course session", async (t) => {
  const scenario = await controlledCquAuthScenario();
  t.after(() => scenario.close());
  const redirectUri = `http://127.0.0.1:9${redirectPath}`;
  const auth = createCquAuthClient({
    issuer: scenario.issuer,
    clientId,
    redirectUri,
    friendsBaseUrl: scenario.friendsBaseUrl,
  });
  const keyPair = await generateCquDpopKeyPair();
  const pending = await auth.beginAuthorization({ keyPair, offlineAccess: true });
  assert.deepEqual(pending.scopes, ["cqu:ticket:friends", "offline_access"]);
  const authorizationUrl = new URL(pending.authorizationUrl);
  assert.equal(authorizationUrl.searchParams.get("code_challenge_method"), "S256");
  assert.equal(
    authorizationUrl.searchParams.get("code_challenge"),
    createHash("sha256").update(pending.codeVerifier).digest("base64url"),
  );
  assert.equal(authorizationUrl.searchParams.get("resource"), scenario.issuer);

  const authorization = await fetch(pending.authorizationUrl, { redirect: "manual" });
  assert.equal(authorization.status, 302);
  const grant = await auth.completeAuthorization(pending, authorization.headers.get("location"));
  assert.equal(grant.credentials.tokenType, "DPoP");
  assert.ok(grant.credentials.refreshToken);

  const manager = auth.createGrantManager({
    credentials: grant.credentials,
    keyPair,
    persist: async () => {},
  });
  const ticket = await manager.requestFriendsServiceTicket();
  const session = await auth.exchangeFriendsSession(ticket);
  assert.equal(session.token, "friends-token-1");
  assert.equal(session.context.unit.unitNo, "unit-a");
  const courses = await auth.createCourseClient(session);
  const page = await courses.list();
  assert.equal(page.items[0].id, "course-1");

  assert.ok(scenario.requests.filter(request => request.url.includes("/token")).every(request =>
    request.headers.authorization === undefined && request.headers.dpop !== undefined &&
    request.body.client_id === clientId && request.body.client_secret === undefined
  ));
  assert.ok(scenario.requests.filter(request => request.url.includes("/service-tickets")).every(request =>
    request.headers.authorization?.startsWith("DPoP ") && request.headers.dpop !== undefined
  ));
  const output = JSON.stringify(page);
  for (const secret of [grant.credentials.accessToken, grant.credentials.refreshToken, ticket, "friends-token"]) {
    assert.equal(output.includes(secret), false);
  }
});

test("CQU Auth rejects discovery, callback, PKCE, scope, and DPoP binding failures before usable credentials", async (t) => {
  const cases = [
    ["discovery issuer mismatch", async () => {
      const scenario = await controlledCquAuthScenario();
      t.after(() => scenario.close());
      scenario.discoveryIssuer = "https://issuer.example";
      const auth = createCquAuthClient({
        issuer: scenario.issuer,
        clientId,
        redirectUri: `http://127.0.0.1:9${redirectPath}`,
        friendsBaseUrl: scenario.friendsBaseUrl,
      });
      return { scenario, run: async () => auth.beginAuthorization({ keyPair: await generateCquDpopKeyPair() }) };
    }],
    ["denied friends scope", async () => {
      const scenario = await controlledCquAuthScenario();
      t.after(() => scenario.close());
      scenario.authorizationError = "access_denied";
      const auth = createCquAuthClient({ issuer: scenario.issuer, clientId, redirectUri: `http://127.0.0.1:9${redirectPath}` });
      const { pending, callbackUrl } = await authorize(auth, await generateCquDpopKeyPair());
      return { scenario, run: () => auth.completeAuthorization(pending, callbackUrl) };
    }],
    ["wrong callback state", async () => {
      const scenario = await controlledCquAuthScenario();
      t.after(() => scenario.close());
      const auth = createCquAuthClient({ issuer: scenario.issuer, clientId, redirectUri: `http://127.0.0.1:9${redirectPath}` });
      const { pending, callbackUrl } = await authorize(auth, await generateCquDpopKeyPair());
      const callback = new URL(callbackUrl);
      callback.searchParams.set("state", "wrong-state");
      return {
        scenario,
        run: () => auth.completeAuthorization(pending, callback),
        tokenRequests: 0,
      };
    }],
    ["wrong callback target", async () => {
      const scenario = await controlledCquAuthScenario();
      t.after(() => scenario.close());
      const auth = createCquAuthClient({ issuer: scenario.issuer, clientId, redirectUri: `http://127.0.0.1:9${redirectPath}` });
      const { pending, callbackUrl } = await authorize(auth, await generateCquDpopKeyPair());
      const callback = new URL(callbackUrl);
      callback.hostname = "localhost";
      return {
        scenario,
        run: () => auth.completeAuthorization(pending, callback),
        tokenRequests: 0,
        expectedCode: FriendsErrorCode.InvalidInput,
      };
    }],
    ["wrong PKCE verifier", async () => {
      const scenario = await controlledCquAuthScenario();
      t.after(() => scenario.close());
      const auth = createCquAuthClient({ issuer: scenario.issuer, clientId, redirectUri: `http://127.0.0.1:9${redirectPath}` });
      const { pending, callbackUrl } = await authorize(auth, await generateCquDpopKeyPair());
      pending.codeVerifier = "wrong-verifier-wrong-verifier-wrong-verifier-wrong";
      return { scenario, run: () => auth.completeAuthorization(pending, callbackUrl), tokenRequests: 1 };
    }],
    ["wrong DPoP key", async () => {
      const scenario = await controlledCquAuthScenario();
      t.after(() => scenario.close());
      const auth = createCquAuthClient({ issuer: scenario.issuer, clientId, redirectUri: `http://127.0.0.1:9${redirectPath}` });
      const { pending, callbackUrl } = await authorize(auth, await generateCquDpopKeyPair());
      pending.keyPair = await generateCquDpopKeyPair();
      return { scenario, run: () => auth.completeAuthorization(pending, callbackUrl), tokenRequests: 2 };
    }],
  ];

  for (const [name, setup] of cases) {
    const { scenario, run, tokenRequests, expectedCode = FriendsErrorCode.AuthRequired } = await setup();
    const failure = await assert.rejects(run, (error) => {
      assert.equal(error.code, expectedCode);
      assert.equal(JSON.stringify(error).includes("access-"), false);
      assert.equal(JSON.stringify(error).includes("refresh-"), false);
      return true;
    }, name);
    const requests = scenario.requests.filter(request => request.url.includes("/token"));
    if (tokenRequests !== undefined) assert.equal(requests.length, tokenRequests, name);
    assert.ok(requests.every(request => request.status !== 200), name);
  }
});

test("CQU Auth DPoP refresh rotates once, replays fail, and resource nonce retries use the same key", async (t) => {
  const scenario = await controlledCquAuthScenario();
  t.after(() => scenario.close());
  const auth = createCquAuthClient({
    issuer: scenario.issuer,
    clientId,
    redirectUri: `http://127.0.0.1:9${redirectPath}`,
    friendsBaseUrl: scenario.friendsBaseUrl,
  });
  const keyPair = await generateCquDpopKeyPair();
  const { pending, callbackUrl } = await authorize(auth, keyPair);
  const grant = await auth.completeAuthorization(pending, callbackUrl);
  const manager = auth.createGrantManager({ credentials: grant.credentials, keyPair, persist: () => {} });
  scenario.serviceNonceRequired = true;
  scenario.refreshDelayMs = 40;
  await manager.requestFriendsServiceTicket();

  const beforeRefresh = scenario.requests.filter(request => request.url.includes("/token") && request.body?.grant_type === "refresh_token");
  const [first, second, third] = await Promise.all([manager.refresh(), manager.refresh(), manager.refresh()]);
  assert.equal(first.refreshToken, second.refreshToken);
  assert.equal(second.refreshToken, third.refreshToken);
  const refreshRequests = scenario.requests.filter(request => request.url.includes("/token") && request.body?.grant_type === "refresh_token");
  assert.equal(refreshRequests.length - beforeRefresh.length, 2);
  assert.ok(refreshRequests.slice(beforeRefresh.length).every(request => request.headers.dpop !== undefined));
  assert.ok(scenario.requests.every(request => request.headers.authorization === undefined || request.headers.authorization.startsWith("DPoP ")));

  const replay = auth.createGrantManager({ credentials: grant.credentials, keyPair });
  await assert.rejects(replay.refresh(), error => error.code === FriendsErrorCode.AuthRequired);
  const wrongKey = auth.createGrantManager({ credentials: grant.credentials, keyPair: await generateCquDpopKeyPair() });
  await assert.rejects(wrongKey.requestFriendsServiceTicket(), error => {
    assert.equal(error.code, FriendsErrorCode.AuthRequired);
    assert.equal(JSON.stringify(error).includes(grant.credentials.refreshToken), false);
    return true;
  });
  assert.throws(
    () => auth.createGrantManager({ credentials: grant.credentials, keyPair: undefined }),
    error => error.code === FriendsErrorCode.AuthRequired,
  );

  const serviceRequests = scenario.requests.filter(request => request.url.includes("/service-tickets"));
  assert.equal(serviceRequests.length, 4);
  assert.deepEqual(serviceRequests.map(request => request.status), [401, 201, 401, 401]);
  const proofs = serviceRequests.map(request => JSON.parse(Buffer.from(request.headers.dpop.split(".")[1], "base64url")));
  assert.notEqual(proofs[0].jti, proofs[1].jti);
  assert.equal(proofs[0].nonce, undefined);
  assert.equal(typeof proofs[1].nonce, "string");
});

test("CQU Auth one-time service tickets and multi-account identity require explicit selection", async (t) => {
  const scenario = await controlledCquAuthScenario({ manyAccount: true });
  t.after(() => scenario.close());
  const auth = createCquAuthClient({ issuer: scenario.issuer, clientId, redirectUri: `http://127.0.0.1:9${redirectPath}`, friendsBaseUrl: scenario.friendsBaseUrl });
  const keyPair = await generateCquDpopKeyPair();
  const { pending, callbackUrl } = await authorize(auth, keyPair);
  const grant = await auth.completeAuthorization(pending, callbackUrl);
  const manager = auth.createGrantManager({ credentials: grant.credentials, keyPair });
  const ticket = await manager.requestFriendsServiceTicket();
  await assert.rejects(
    auth.exchangeFriendsSession(ticket),
    error => error.code === FriendsErrorCode.InvalidInput,
  );
  const secondTicket = await manager.requestFriendsServiceTicket();
  const session = await auth.exchangeFriendsSession(secondTicket, { levelNo: "XS", unitNo: "unit-a" });
  assert.equal(session.context.unit.unitNo, "unit-a");
  await assert.rejects(
    auth.exchangeFriendsSession(secondTicket, { levelNo: "XS", unitNo: "unit-a" }),
    error => error.code === FriendsErrorCode.AuthRequired,
  );
});


test("CQU Auth SDK distinguishes blocked discovery from issuer mismatch", async (t) => {
  for (const response of [
    { status: 403, headers: { "content-type": "text/html", "cf-mitigated": "challenge" }, body: "<html>private challenge details</html>", message: /Cloudflare.*challenge/i },
    { status: 503, headers: { "content-type": "application/json" }, body: "{}", message: /HTTP 503/ },
    { status: 200, headers: { "content-type": "text/html" }, body: "<html>private response</html>", message: /JSON/ },
  ]) {
    const scenario = await controlledCquAuthScenario({ discoveryFailure: response });
    t.after(() => scenario.close());
    const auth = createCquAuthClient({ issuer: scenario.issuer, clientId, redirectUri: `http://127.0.0.1:9${redirectPath}` });
    const keyPair = await generateCquDpopKeyPair();
    await assert.rejects(() => auth.beginAuthorization({ keyPair }), error => {
      assert.equal(error.code, FriendsErrorCode.NetworkProtocol);
      assert.match(error.message, response.message);
      assert.equal(error.message.includes("private"), false);
      return true;
    });
    assert.equal(scenario.requests.length, 1);
  }
});


test('friends-only DPoP grants exchange tickets without refresh and require reauthorization on expiry', async t=>{
 const scenario=await controlledCquAuthScenario({accessOnly:true,expectedOfflineAccess:false});t.after(()=>scenario.close());
 const auth=createCquAuthClient({issuer:scenario.issuer,clientId,redirectUri:'http://127.0.0.1:9/callback',friendsBaseUrl:scenario.friendsBaseUrl});
 const pending=await auth.beginAuthorization({keyPair:await generateCquDpopKeyPair(),offlineAccess:false});
 assert.deepEqual(pending.scopes,['cqu:ticket:friends']);
 const redirect=await fetch(pending.authorizationUrl,{redirect:'manual'});
 const grant=await auth.completeAuthorization(pending,redirect.headers.get('location'));
 assert.equal(grant.credentials.refreshToken,undefined);
 const manager=auth.createGrantManager({credentials:grant.credentials,keyPair:grant.keyPair});
 const session=await manager.exchangeFriendsSession();
 assert.equal((await (await manager.createCourseClient(session)).list()).items[0].id,'course-1');
 const ticket=await auth.requestFriendsServiceTicket(grant.credentials,grant.keyPair);
 await auth.exchangeFriendsSession(ticket);
 await assert.rejects(()=>auth.exchangeFriendsSession(ticket),{code:'AUTH_REQUIRED'});
 const count=scenario.requests.length;
 await assert.rejects(()=>manager.refresh(),{code:'AUTH_REQUIRED'});
 const expired=auth.createGrantManager({credentials:{...grant.credentials,expiresAt:0},keyPair:grant.keyPair});
 await assert.rejects(()=>expired.requestFriendsServiceTicket(),{code:'AUTH_REQUIRED'});
 assert.equal(scenario.requests.length,count,'no refresh, ticket replay or fallback is allowed after expiry');
});
