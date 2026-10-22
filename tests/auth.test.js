import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { controlledCquAuthScenario, clientId, redirectPath } from "./oauth-scenario.js";
import { createCquAuthClient, generateCquDpopKeyPair } from "../dist/auth.js";

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
  assert.equal(session.token, "friends-token");
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
