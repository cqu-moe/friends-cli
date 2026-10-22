import * as oauth from "oauth4webapi";

import { FriendsError, FriendsErrorCode } from "./errors.js";
import { createFriendsSdk, type CourseClient, type LoginContext, type VerifiedCourseSession } from "./index.js";

export type { CourseClient, LoginContext, VerifiedCourseSession };

export interface CquDpopKeyPair {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
}

export interface CquOAuthCredentials {
  accessToken: string;
  refreshToken?: string;
  tokenType: "DPoP";
  expiresAt: number | null;
  scopes: string[];
}

export interface CquPendingAuthorization {
  authorizationUrl: string;
  redirectUri: string;
  state: string;
  codeVerifier: string;
  keyPair: CquDpopKeyPair;
  dpopJkt: string;
  scopes: string[];
}

export interface CquAuthGrant {
  credentials: CquOAuthCredentials;
  keyPair: CquDpopKeyPair;
  dpopJkt: string;
}

export interface CquFriendsSession {
  token: string;
  userLevel: string;
  account: { userNo: string; userName: string };
  context: LoginContext;
}

export type PersistCquOAuthCredentials = (credentials: CquOAuthCredentials) => Promise<void> | void;

export interface CquGrantManager {
  getCredentials(): CquOAuthCredentials;
  refresh(): Promise<CquOAuthCredentials>;
  requestFriendsServiceTicket(): Promise<string>;
  exchangeFriendsSession(selector?: { levelNo: string; unitNo: string }): Promise<CquFriendsSession>;
  createCourseClient(session: CquFriendsSession): Promise<CourseClient>;
}

export interface CreateCquAuthClientOptions {
  issuer: string | URL;
  clientId: string;
  redirectUri: string;
  friendsBaseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export interface BeginCquAuthorizationOptions {
  keyPair: CquDpopKeyPair;
  offlineAccess?: boolean;
}

export interface CreateCquGrantManagerOptions {
  credentials: CquOAuthCredentials;
  keyPair: CquDpopKeyPair;
  persist?: PersistCquOAuthCredentials;
}

export interface CquAuthClient {
  beginAuthorization(input: BeginCquAuthorizationOptions): Promise<CquPendingAuthorization>;
  completeAuthorization(pending: CquPendingAuthorization, callback: string | URL): Promise<CquAuthGrant>;
  createGrantManager(input: CreateCquGrantManagerOptions): CquGrantManager;
  requestFriendsServiceTicket(credentials: CquOAuthCredentials, keyPair: CquDpopKeyPair): Promise<string>;
  exchangeFriendsSession(
    ticket: string,
    selector?: { levelNo: string; unitNo: string },
  ): Promise<CquFriendsSession>;
  createCourseClient(session: CquFriendsSession): Promise<CourseClient>;
}

const friendsScope = "cqu:ticket:friends";
const offlineScope = "offline_access";

function error(message: string, code: FriendsErrorCode = FriendsErrorCode.AuthRequired): FriendsError {
  return new FriendsError({ code, message });
}

function parseUrl(value: string | URL, label: string): URL {
  try {
    const url = value instanceof URL ? value : new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash) throw new Error();
    return url;
  } catch {
    throw error(`Invalid ${label}`, FriendsErrorCode.InvalidInput);
  }
}

function validateRedirectUri(value: string): URL {
  const url = parseUrl(value, "native redirect URI");
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    url.pathname !== "/callback" ||
    url.search
  ) {
    throw error("The CQU Auth redirect URI must be http://127.0.0.1[/port]/callback", FriendsErrorCode.InvalidInput);
  }
  return url;
}

function validateTimeout(timeoutMs: number): void {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw error("timeoutMs must be a positive integer", FriendsErrorCode.InvalidInput);
  }
}

function responseCredentials(response: oauth.TokenEndpointResponse, refreshRequired = false): CquOAuthCredentials {
  if (response.token_type !== "dpop") {
    throw error("CQU Auth returned a non-DPoP token; reauthorize the native client with DPoP");
  }
  const scopes = (response.scope ?? "").split(/ +/).filter(Boolean);
  if (!scopes.includes(friendsScope)) {
    throw error("CQU Auth did not grant the friends scope", FriendsErrorCode.PermissionDenied);
  }
  if (response.refresh_token !== undefined && (typeof response.refresh_token !== "string" || !response.refresh_token || !scopes.includes(offlineScope)) || refreshRequired && !response.refresh_token) {
    throw error("CQU Auth did not return a usable refresh grant; reauthorize with offline_access");
  }
  return {
    accessToken: response.access_token,
    refreshToken: response.refresh_token,
    tokenType: "DPoP",
    expiresAt: typeof response.expires_in === "number" ? Math.floor(Date.now() / 1000 + response.expires_in) : null,
    scopes,
  };
}

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function string(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

async function readJson(response: Response, expectedStatus: number, label: string): Promise<Record<string, unknown>> {
  if (response.status === 401 || response.status === 403) {
    throw error(response.status === 403 ? "CQU Auth denied the friends service permission" : "CQU Auth rejected the DPoP credential", response.status === 403 ? FriendsErrorCode.PermissionDenied : FriendsErrorCode.AuthRequired);
  }
  if (response.status !== expectedStatus) throw error(`Unexpected CQU Auth ${label} response`);
  try {
    return object(await response.json()) ?? (() => { throw new Error(); })();
  } catch {
    throw error(`Unexpected CQU Auth ${label} payload`, FriendsErrorCode.NetworkProtocol);
  }
}

export async function generateCquDpopKeyPair(): Promise<CquDpopKeyPair> {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  ) as CryptoKeyPair;
  return { privateKey: pair.privateKey, publicKey: pair.publicKey };
}

export async function exportCquDpopKeyPair(pair: CquDpopKeyPair): Promise<{ privateJwk: JsonWebKey; publicJwk: JsonWebKey }> {
  return {
    privateJwk: await crypto.subtle.exportKey("jwk", pair.privateKey),
    publicJwk: await crypto.subtle.exportKey("jwk", pair.publicKey),
  };
}

export async function importCquDpopKeyPair(input: {
  privateJwk: JsonWebKey;
  publicJwk: JsonWebKey;
}): Promise<CquDpopKeyPair> {
  const algorithm = { name: "ECDSA", namedCurve: "P-256" };
  const privateKey = await crypto.subtle.importKey("jwk", input.privateJwk, algorithm, true, ["sign"]);
  const publicKey = await crypto.subtle.importKey("jwk", input.publicJwk, algorithm, true, ["verify"]);
  return { privateKey, publicKey };
}

export function createCquAuthClient(options: CreateCquAuthClientOptions) {
  const issuer = parseUrl(options.issuer, "CQU Auth issuer");
  if (typeof options.clientId !== "string" || options.clientId === "") {
    throw error("A CQU Auth public client ID is required", FriendsErrorCode.InvalidInput);
  }
  const redirectUri = validateRedirectUri(options.redirectUri).href;
  const friendsBaseUrl = (options.friendsBaseUrl ?? "https://friends.cqu.edu.cn/gateway").replace(/\/$/, "");
  const fetchImpl = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 60_000;
  validateTimeout(timeoutMs);
  const client: oauth.Client = { client_id: options.clientId, token_endpoint_auth_method: "none" };
  const insecureLocalIssuer = issuer.protocol === "http:" && ["127.0.0.1", "localhost"].includes(issuer.hostname);
  if (issuer.protocol === "http:" && !insecureLocalIssuer) {
    throw error("A non-loopback CQU Auth issuer must use HTTPS", FriendsErrorCode.InvalidInput);
  }
  let discovered: oauth.AuthorizationServer | undefined;

  function httpOptions(): Record<PropertyKey, unknown> {
    return {
      [oauth.customFetch]: fetchImpl,
      ...(insecureLocalIssuer ? { [oauth.allowInsecureRequests]: true } : {}),
      signal: AbortSignal.timeout(timeoutMs),
    };
  }

  async function discover(): Promise<oauth.AuthorizationServer> {
    if (discovered) return discovered;
    let response: Response;
    try {
      response = await oauth.discoveryRequest(issuer, httpOptions() as Parameters<typeof oauth.discoveryRequest>[1]);
    } catch {
      throw error("Could not discover CQU Auth", FriendsErrorCode.NetworkProtocol);
    }
    if (response.headers.get("cf-mitigated") === "challenge") {
      throw error("CQU Auth discovery was blocked by a Cloudflare browser challenge; the Auth operator must allow native OAuth requests", FriendsErrorCode.NetworkProtocol);
    }
    if (response.status !== 200) {
      throw error(`CQU Auth discovery returned HTTP ${response.status}`, FriendsErrorCode.NetworkProtocol);
    }
    if (!response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
      throw error("CQU Auth discovery did not return JSON metadata", FriendsErrorCode.NetworkProtocol);
    }
    try {
      discovered = await oauth.processDiscoveryResponse(issuer, response);
      return discovered;
    } catch {
      throw error("CQU Auth discovery did not match the configured issuer", FriendsErrorCode.AuthRequired);
    }
  }

  function assertCallbackTarget(callback: URL, expected: string): void {
    const actual = new URL(callback.href);
    const target = new URL(expected);
    actual.search = "";
    actual.hash = "";
    target.search = "";
    target.hash = "";
    if (actual.href !== target.href) {
      throw error("The CQU Auth callback target does not match this authorization request", FriendsErrorCode.InvalidInput);
    }
  }

  async function completeWithDpopRetry<T>(process: () => Promise<T>): Promise<T> {
    try {
      return await process();
    } catch (cause) {
      if (oauth.isDPoPNonceError(cause)) return process();
      throw cause;
    }
  }

  const auth: CquAuthClient = {
    async beginAuthorization(input: BeginCquAuthorizationOptions): Promise<CquPendingAuthorization> {
      if (!input?.keyPair?.privateKey || !input?.keyPair?.publicKey) {
        throw error("A CQU Auth DPoP key pair is required", FriendsErrorCode.InvalidInput);
      }
      const as = await discover();
      const endpoint = string(as.authorization_endpoint);
      if (!endpoint) throw error("CQU Auth discovery has no authorization endpoint", FriendsErrorCode.NetworkProtocol);
      const scopes = input.offlineAccess === false ? [friendsScope] : [friendsScope, offlineScope];
      const state = oauth.generateRandomState();
      const codeVerifier = oauth.generateRandomCodeVerifier();
      const challenge = await oauth.calculatePKCECodeChallenge(codeVerifier);
      const dpop = oauth.DPoP(client, input.keyPair);
      const dpopJkt = await dpop.calculateThumbprint();
      const url = new URL(endpoint);
      url.searchParams.set("client_id", client.client_id);
      url.searchParams.set("redirect_uri", redirectUri);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", scopes.join(" "));
      url.searchParams.set("state", state);
      url.searchParams.set("code_challenge", challenge);
      url.searchParams.set("code_challenge_method", "S256");
      url.searchParams.set("resource", issuer.href);
      url.searchParams.set("dpop_jkt", dpopJkt);
      return { authorizationUrl: url.href, redirectUri, state, codeVerifier, keyPair: input.keyPair, dpopJkt, scopes };
    },

    async completeAuthorization(
      pending: CquPendingAuthorization,
      callback: string | URL,
    ): Promise<CquAuthGrant> {
      if (!pending?.state || !pending?.codeVerifier) {
        throw error("A pending CQU Auth authorization is required", FriendsErrorCode.InvalidInput);
      }
      validateRedirectUri(pending.redirectUri);
      const callbackUrl = parseUrl(callback, "CQU Auth callback");
      assertCallbackTarget(callbackUrl, pending.redirectUri);
      const as = await discover();
      let parameters: URLSearchParams;
      try {
        parameters = oauth.validateAuthResponse(as, client, callbackUrl, pending.state);
      } catch {
        throw error("CQU Auth rejected the authorization callback or state", FriendsErrorCode.AuthRequired);
      }
      const keyPair = pending.keyPair;
      if (!keyPair) throw error("The pending CQU Auth authorization has no DPoP key", FriendsErrorCode.AuthRequired);
      const dpop = oauth.DPoP(client, keyPair);
      let response: oauth.TokenEndpointResponse;
      try {
        response = await completeWithDpopRetry(async () => {
          const raw = await oauth.authorizationCodeGrantRequest(
            as,
            client,
            oauth.None(),
            parameters,
            pending.redirectUri,
            pending.codeVerifier,
            { DPoP: dpop, ...httpOptions() } as Parameters<typeof oauth.authorizationCodeGrantRequest>[6],
          );
          return oauth.processAuthorizationCodeResponse(as, client, raw);
        });
      } catch {
        throw error("CQU Auth rejected the public authorization-code or DPoP request", FriendsErrorCode.AuthRequired);
      }
      return { credentials: responseCredentials(response), keyPair, dpopJkt: pending.dpopJkt };
    },

    createGrantManager(input: CreateCquGrantManagerOptions): CquGrantManager {
      if (!input?.credentials || input.credentials.tokenType !== "DPoP" || !input.credentials.accessToken || !Array.isArray(input.credentials.scopes) || !input.credentials.scopes.includes(friendsScope)) {
        throw error("A DPoP-bound friends access grant is required", FriendsErrorCode.AuthRequired);
      }
      if (!input.keyPair?.privateKey || !input.keyPair?.publicKey) {
        throw error("The DPoP key bound to the CQU Auth grant is missing; log in again", FriendsErrorCode.AuthRequired);
      }
      let credentials = { ...input.credentials, scopes: [...input.credentials.scopes] };
      let refreshInFlight: Promise<CquOAuthCredentials> | undefined;

      async function refreshLocked(): Promise<CquOAuthCredentials> {
        const current = credentials;
        const refreshToken = current.refreshToken;
        if (!refreshToken || !current.scopes.includes(offlineScope)) throw error("This access-only grant cannot refresh; reauthorize explicitly", FriendsErrorCode.AuthRequired);
        const as = await discover();
        const dpop = oauth.DPoP(client, input.keyPair);
        let response: oauth.TokenEndpointResponse;
        try {
          response = await completeWithDpopRetry(async () => {
            const raw = await oauth.refreshTokenGrantRequest(
              as,
              client,
              oauth.None(),
              refreshToken,
              { DPoP: dpop, ...httpOptions() } as Parameters<typeof oauth.refreshTokenGrantRequest>[4],
            );
            return oauth.processRefreshTokenResponse(as, client, raw);
          });
        } catch {
          throw error("CQU Auth rejected the refresh token or DPoP proof; log in again", FriendsErrorCode.AuthRequired);
        }
        const next = responseCredentials(response, true);
        if (input.persist) await input.persist(next);
        credentials = next;
        return { ...credentials };
      }

      async function ensureFreshAccessToken(): Promise<CquOAuthCredentials> {
        if (credentials.expiresAt !== null && credentials.expiresAt <= Math.floor(Date.now() / 1000) + 5) {
          await refresh();
        }
        return credentials;
      }

      function refresh(): Promise<CquOAuthCredentials> {
        refreshInFlight ??= refreshLocked().finally(() => {
          refreshInFlight = undefined;
        });
        return refreshInFlight;
      }

      return {
        getCredentials: () => ({ ...credentials }),
        refresh,
        async requestFriendsServiceTicket(): Promise<string> {
          const token = await ensureFreshAccessToken();
          const as = await discover();
          const ticketUrl = new URL("/api/v1/cqu/service-tickets", issuer);
          const dpop = oauth.DPoP(client, input.keyPair);
          let response: Response;
          try {
            response = await completeWithDpopRetry(async () => {
            return oauth.protectedResourceRequest(
              token.accessToken,
              "POST",
              ticketUrl,
              new Headers({ "content-type": "application/json", accept: "application/json" }),
              JSON.stringify({ service: "friends" }),
              { DPoP: dpop, ...httpOptions() } as Parameters<typeof oauth.protectedResourceRequest>[5],
            );
          });
          } catch {
            throw error("CQU Auth rejected the friends service-ticket DPoP proof or authorization", FriendsErrorCode.AuthRequired);
          }
          const payload = await readJson(response, 201, "service-ticket");
          const data = object(payload.data);
          const ticket = string(data?.ticket);
          if (!ticket) throw error("CQU Auth returned no friends service ticket", FriendsErrorCode.NetworkProtocol);
          return ticket;
        },
        async exchangeFriendsSession(selector?: { levelNo: string; unitNo: string }): Promise<CquFriendsSession> {
          const ticket = await this.requestFriendsServiceTicket();
          return auth.exchangeFriendsSession(ticket, selector);
        },
        async createCourseClient(session: CquFriendsSession): Promise<CourseClient> {
          return auth.createCourseClient(session);
        },
      };
    },

    async requestFriendsServiceTicket(credentials: CquOAuthCredentials, keyPair: CquDpopKeyPair): Promise<string> {
      return auth.createGrantManager({ credentials, keyPair }).requestFriendsServiceTicket();
    },

    async exchangeFriendsSession(
      ticket: string,
      selector?: { levelNo: string; unitNo: string },
    ): Promise<CquFriendsSession> {
      if (typeof ticket !== "string" || ticket === "") {
        throw error("A one-time friends service ticket is required", FriendsErrorCode.InvalidInput);
      }
      if (selector && (typeof selector.levelNo !== "string" || typeof selector.unitNo !== "string")) {
        throw error("A multi-account friends login requires both level-no and unit-no", FriendsErrorCode.InvalidInput);
      }
      const url = new URL(`${friendsBaseUrl}/ek-agg-mob/cas/login`);
      url.searchParams.set("ticket", ticket);
      let response: Response;
      try {
        response = await fetchImpl(url, {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        throw error("Could not exchange the friends service ticket", FriendsErrorCode.NetworkProtocol);
      }
      if (!response.ok) throw error("Friends rejected the service-ticket exchange", FriendsErrorCode.AuthRequired);
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw error("Unexpected friends service-ticket response", FriendsErrorCode.NetworkProtocol);
      }
      const envelope = object(payload);
      const data = object(envelope?.data);
      const token = string(data?.token);
      if (envelope?.code !== "0") {
        throw error("Friends rejected the service-ticket exchange", FriendsErrorCode.AuthRequired);
      }
      if (!token || typeof data?.manyAccount !== "boolean") {
        throw error("Friends returned an invalid current CAS login response", FriendsErrorCode.NetworkProtocol);
      }
      if (data.manyAccount && (!selector || selector.levelNo === "" || selector.unitNo === "")) {
        throw error("Friends returned multiple accounts; specify level-no and unit-no", FriendsErrorCode.InvalidInput);
      }
      const activated = await createFriendsSdk({ baseUrl: friendsBaseUrl, fetch: fetchImpl, timeoutMs })
        .activateLocalContext({ token, userLevel: "", selector });
      return { token, userLevel: activated.context.levelNo, account: activated.account, context: activated.context };
    },

    async createCourseClient(session: CquFriendsSession): Promise<CourseClient> {
      return createFriendsSdk({ baseUrl: friendsBaseUrl, fetch: fetchImpl, timeoutMs }).createCourseClient(session);
    },
  };
  return auth;
}
