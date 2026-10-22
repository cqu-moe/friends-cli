import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";

export const clientId = "friends-public-client";
export const redirectPath = "/callback";

function b64u(value) {
  return Buffer.from(value).toString("base64url");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("base64url");
}

function json(res, status, body, headers = {}) {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

function decodeProof(request) {
  const proof = request.headers.dpop;
  if (typeof proof !== "string" || proof.split(".").length !== 3) return null;
  const [encodedHeader, encodedPayload, signature] = proof.split(".");
  try {
    const header = JSON.parse(Buffer.from(encodedHeader, "base64url"));
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url"));
    return { header, payload, signature, encodedHeader, encodedPayload };
  } catch {
    return null;
  }
}

async function verifyProof(proof, expected) {
  if (!proof || proof.header.alg !== "ES256" || proof.header.typ !== "dpop+jwt") return false;
  if (!proof.header.jwk || proof.header.jwk.kty !== "EC" || proof.header.jwk.crv !== "P-256") return false;
  if (proof.payload.htm !== expected.method || proof.payload.htu !== expected.url) return false;
  if (expected.nonce !== undefined && proof.payload.nonce !== expected.nonce) return false;
  if (Date.now() / 1000 - proof.payload.iat > 60) return false;
  if (expected.accessToken !== undefined && proof.payload.ath !== sha256(expected.accessToken)) return false;
  const key = await crypto.subtle.importKey(
    "jwk",
    proof.header.jwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    Buffer.from(proof.signature, "base64url"),
    Buffer.from(`${proof.encodedHeader}.${proof.encodedPayload}`),
  );
}

function jkt(jwk) {
  const canonical = { crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y };
  return sha256(JSON.stringify(canonical));
}

function identity(mode) {
  if (mode === "changed") {
    return {
      userNo: "20219999",
      userName: "另一示例",
      levelNo: "JS",
      levelName: "教师",
      unitType: 1,
      unitNo: "unit-b",
      unitName: "另一示例单位",
    };
  }
  return {
    userNo: "20210001",
    userName: "示例",
    levelNo: "XS",
    levelName: "学生",
    unitType: 2,
    unitNo: "unit-a",
    unitName: "示例学院",
  };
}

export async function controlledCquAuthScenario(options = {}) {
  const manyAccount = options.manyAccount ?? false;
  const requests = [];
  const issuedTickets = new Map();
  const grants = new Map();
  const authorizationCodes = new Map();
  const proofIdentifiers = new Set();
  const nonces = new Map();
  const accessTokens = new Map();
  const activeFriendsTokens = new Set();
  const state = {
    discoveryIssuer: null,
    authorizationError: null,
    tokenNonceRequired: true,
    tokenNonceChallenge: false,
    serviceNonceRequired: false,
    rejectDpopProof: false,
    refreshDelayMs: 0,
    identityMode: "primary",
    accessSerial: 1,
    refreshSerial: 1,
    codeSerial: 1,
    friendsTokenSerial: 1,
  };
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const requestOrigin = `http://${req.headers.host}`;
    const url = new URL(req.url, requestOrigin);
    const parsedBody = body === "" ? null : (
      req.headers["content-type"]?.startsWith("application/json")
        ? JSON.parse(body)
        : Object.fromEntries(new URLSearchParams(body))
    );
    const record = {
      method: req.method,
      url: req.url,
      headers: { ...req.headers },
      body: parsedBody,
      startedAt: Date.now(),
    };
    res.on("finish", () => {
      record.status = res.statusCode;
      record.finishedAt = Date.now();
    });
    requests.push(record);
    try {
      if (url.pathname === "/api/auth/.well-known/openid-configuration") {
        json(res, 200, {
          issuer: state.discoveryIssuer ?? `${url.origin}/api/auth`,
          authorization_endpoint: `${url.origin}/api/v1/auth/oauth2/authorize`,
          token_endpoint: `${url.origin}/api/v1/auth/oauth2/token`,
          jwks_uri: `${url.origin}/api/v1/auth/jwks`,
          scopes_supported: ["cqu:ticket:friends", "offline_access"],
          code_challenge_methods_supported: ["S256"],
          token_endpoint_auth_methods_supported: ["none"],
        });
        return;
      }

      if (url.pathname === "/api/v1/auth/oauth2/authorize") {
        const expectedScope = ["cqu:ticket:friends", "offline_access"];
        if (
          url.searchParams.get("client_id") !== clientId ||
          url.searchParams.get("redirect_uri")?.startsWith(`http://127.0.0.1:`) !== true || new URL(url.searchParams.get("redirect_uri")).pathname !== redirectPath ||
          url.searchParams.get("response_type") !== "code" ||
          url.searchParams.get("scope")?.split(" ").join(" ") !== expectedScope.join(" ") ||
          url.searchParams.get("resource") !== `${url.origin}/api/auth` ||
          url.searchParams.get("code_challenge_method") !== "S256" ||
          url.searchParams.get("code_challenge")?.length < 43 ||
          !url.searchParams.get("state") ||
          !url.searchParams.get("dpop_jkt")
        ) {
          json(res, 400, { error: "invalid_request" });
          return;
        }
        if (state.authorizationError) {
          const callback = new URL(url.searchParams.get("redirect_uri"));
          callback.searchParams.set("state", url.searchParams.get("state"));
          callback.searchParams.set("error", state.authorizationError);
          res.writeHead(302, { location: callback.href });
          res.end();
          return;
        }
        const code = `auth-code-${state.codeSerial++}`;
        authorizationCodes.set(code, {
          clientId: url.searchParams.get("client_id"),
          redirectUri: url.searchParams.get("redirect_uri"),
          challenge: url.searchParams.get("code_challenge"),
          dpopJkt: url.searchParams.get("dpop_jkt"),
          used: false,
        });
        const callback = new URL(url.searchParams.get("redirect_uri"));
        callback.searchParams.set("code", code);
        callback.searchParams.set("state", url.searchParams.get("state"));
        res.writeHead(302, { location: callback.href });
        res.end();
        return;
      }

      if (url.pathname === "/api/v1/auth/oauth2/token") {
        if (record.body.grant_type === "authorization_code") {
          const codeRecord = authorizationCodes.get(record.body.code);
          if (!codeRecord || codeRecord.used || record.body.client_id !== clientId || record.body.redirect_uri !== codeRecord.redirectUri) {
            return json(res, 400, { error: "invalid_grant" });
          }
          const verifier = record.body.code_verifier ?? "";
          if (sha256(verifier) !== codeRecord.challenge) return json(res, 400, { error: "invalid_grant" });
          return await finishToken(res, url, record, proof => {
            const authorizationJkt = jkt(proof.header.jwk);
            return authorizationJkt === codeRecord.dpopJkt;
          }, () => {
            const accessToken = `access-${state.accessSerial++}`;
            const refreshToken = `refresh-${state.refreshSerial++}`;
            const scopes = new Set(["cqu:ticket:friends", "offline_access"]);
            grants.set(refreshToken, { jkt: codeRecord.dpopJkt, current: true, scopes });
            accessTokens.set(accessToken, { jkt: codeRecord.dpopJkt, scopes });
            return { accessToken, refreshToken };
          }, "authorization_code");
        }

        if (record.body.grant_type === "refresh_token") {
          const old = grants.get(record.body.refresh_token);
          if (!old?.current || record.body.client_id !== clientId) return json(res, 400, { error: "invalid_grant" });
          if (state.refreshDelayMs) await new Promise(resolve => setTimeout(resolve, state.refreshDelayMs));
          return await finishToken(res, url, record, proof => jkt(proof.header.jwk) === old.jkt, () => {
            old.current = false;
            const accessToken = `access-${state.accessSerial++}`;
            const refreshToken = `refresh-${state.refreshSerial++}`;
            grants.set(refreshToken, { jkt: old.jkt, current: true, scopes: old.scopes });
            accessTokens.set(accessToken, { jkt: old.jkt, scopes: old.scopes });
            return { accessToken, refreshToken };
          }, "refresh_token");
        }
        return json(res, 400, { error: "unsupported_grant_type" });
      }

      if (url.pathname === "/api/v1/cqu/service-tickets") {
        const authorization = req.headers.authorization ?? "";
        const accessToken = authorization.startsWith("DPoP ") ? authorization.slice(5) : null;
        const token = accessToken && accessTokens.get(accessToken);
        if (!token || !token.scopes.has("cqu:ticket:friends") || record.body?.service !== "friends") {
          return json(res, 403, { error: "forbidden" });
        }
        const proof = decodeProof(record);
        if (state.serviceNonceRequired) {
          const existingNonce = nonces.get(url.origin) ?? randomUUID();
          nonces.set(url.origin, existingNonce);
          if (proof?.payload.nonce !== existingNonce) {
            state.tokenNonceChallenge = true;
            return json(res, 401, { error: "use_dpop_nonce" }, {
              "www-authenticate": `DPoP error="use_dpop_nonce"`,
              "dpop-nonce": existingNonce,
            });
          }
        }
        const nonce = state.serviceNonceRequired ? nonces.get(url.origin) : undefined;
        const proofValid = await verifyProof(proof, {
          method: "POST",
          url: `${url.origin}${url.pathname}`,
          nonce,
          accessToken,
        });
        if (!proofValid || jkt(proof.header.jwk) !== token.jkt || proofIdentifiers.has(proof.payload.jti)) {
          res.setHeader("www-authenticate", 'DPoP error="invalid_dpop_proof"');
          return json(res, 401, { error: "invalid_dpop_proof" });
        }
        proofIdentifiers.add(proof.payload.jti);
        const ticket = `ST-${randomUUID()}`;
        issuedTickets.set(ticket, { used: false });
        return json(res, 201, { data: { ticket } }, { "cache-control": "no-store" });
      }

      if (url.pathname === "/gateway/ek-agg-mob/cas/login") {
        const ticket = url.searchParams.get("ticket");
        const recordTicket = issuedTickets.get(ticket);
        if (!recordTicket || recordTicket.used) return json(res, 200, { code: "1001", message: "ticket invalid" });
        recordTicket.used = true;
        const token = `friends-token-${state.friendsTokenSerial++}`;
        activeFriendsTokens.add(token);
        return json(res, 200, { code: "0", data: { token, manyAccount } });
      }

      const friendsToken = req.headers["h-zove-token"];
      if (typeof friendsToken === "string" && !activeFriendsTokens.has(friendsToken)) {
        return json(res, 401, { code: "401", message: "session expired" });
      }
      const current = identity(state.identityMode);
      if (url.pathname.endsWith("/checkUserAndGetUserLevel")) {
        return json(res, 200, {
          code: "0",
          data: {
            loginLevels: [{
              levelNo: current.levelNo,
              levelName: current.levelName,
              units: [{ unitType: current.unitType, unitNo: current.unitNo, unitName: current.unitName }],
            }],
            userLoginType: "STUDENT",
          },
        });
      }
      if (url.pathname.endsWith("/user/info")) {
        return json(res, 200, { code: "0", data: { userNo: current.userNo, userName: current.userName } });
      }
      if (url.pathname.endsWith("/enterHall")) {
        return json(res, 200, { code: "0", data: {
          account: current.userNo,
          name: current.userName,
          userLoginStateLevel: current.levelNo,
          departmentNo: current.unitNo,
        } });
      }
      if (url.pathname.endsWith("/student-apply-page-list")) {
        return json(res, 200, { code: "0", data: { currentPage: 1, pageSize: 10, totalCount: 1, pages: 1, data: [{ uuid: "course-1", curriculumName: "示例课程" }] } });
      }
      if (url.pathname.endsWith("/mob/apply/course-1")) {
        return json(res, 200, { code: "0", data: {
          uuid: "course-1",
          curriculumName: "示例课程",
          organizationName: "示例学院",
          curriculumState: "NEW_LIVE_STATE",
          roles: [{ uuid: "role-1", roleName: "讲师", integral: 0.5, classHour: 2 }],
          questionnaires: [{ reviewerName: "示例审核人" }],
        } });
      }
      return json(res, 404, { error: "not_found" });
    } catch (error) {
      json(res, 500, { error: "scenario_failure", message: error.message });
    }

    async function finishToken(res, url, record, keyMatches, issueTokens, grantType) {
      const proof = decodeProof(record);
      if (state.tokenNonceRequired) {
        const existingNonce = nonces.get(url.origin) ?? randomUUID();
        nonces.set(url.origin, existingNonce);
        if (proof?.payload.nonce !== existingNonce) {
          state.tokenNonceChallenge = true;
          return json(res, 400, { error: "use_dpop_nonce" }, { "dpop-nonce": existingNonce });
        }
      }
      if (state.rejectDpopProof) {
        res.setHeader("www-authenticate", 'DPoP error="invalid_dpop_proof"');
        return json(res, 401, { error: "invalid_dpop_proof" });
      }
      const nonce = state.tokenNonceRequired ? nonces.get(url.origin) : undefined;
      const proofValid = await verifyProof(proof, {
        method: "POST",
        url: `${url.origin}${url.pathname}`,
        nonce,
      });
      if (!proofValid || proofIdentifiers.has(proof.payload.jti) || !keyMatches(proof)) {
        res.setHeader("www-authenticate", 'DPoP error="invalid_dpop_proof"');
        return json(res, 401, { error: "invalid_dpop_proof" });
      }
      proofIdentifiers.add(proof.payload.jti);
      const { accessToken, refreshToken } = issueTokens();
      if (record.body.grant_type === "authorization_code") authorizationCodes.get(record.body.code).used = true;
      return json(res, 200, {
        access_token: accessToken,
        refresh_token: refreshToken,
        token_type: "DPoP",
        expires_in: 900,
        scope: "cqu:ticket:friends offline_access",
      });
    }
  });

  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    issuer: `${origin}/api/auth`,
    friendsBaseUrl: `${origin}/gateway`,
    requests,
    grants,
    accessTokens,
    issuedTickets,
    async close() {
      server.closeAllConnections();
      await server.close();
    },
    set authorizationError(value) { state.authorizationError = value; },
    set discoveryIssuer(value) { state.discoveryIssuer = value; },
    set serviceNonceRequired(value) { state.serviceNonceRequired = value; },
    set refreshDelayMs(value) { state.refreshDelayMs = value; },
    set rejectDpopProof(value) { state.rejectDpopProof = value; },
    set identityMode(value) { state.identityMode = value; },
    invalidateFriendsToken(token) { activeFriendsTokens.delete(token); },
  };
}
