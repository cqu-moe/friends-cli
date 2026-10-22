import { FriendsError, FriendsErrorCode } from "./errors.js";

// enterHall mutates server-side identity. Share this reservation across every local SDK client.
// This is a process-local guard; other processes and external sessions are not isolated by it.
const bindings = new Map<string, string>();

export async function reserveSchoolContext(baseUrl: string, token: string, account: string, level: string, unit: string): Promise<void> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const key = new URL(baseUrl).origin + ":" + Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  const binding = JSON.stringify([account, level, unit]);
  if (bindings.has(key) && bindings.get(key) !== binding) {
    throw new FriendsError({code: FriendsErrorCode.UpstreamBusiness, message: "This school token is already bound to another context; use a separate login session"});
  }
  bindings.set(key, binding);
}
