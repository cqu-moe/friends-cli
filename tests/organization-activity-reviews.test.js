import assert from "node:assert/strict";
import { test } from "node:test";
import { createOrganizationActivityReviewClient } from "../dist/index.js";
import { organizationReviewScenario, organizationReviewSession, offeringInput, registrationInput } from "./fixtures/organization-activity-reviews.mjs";

test("public SDK independently approves existing offering and registration applications with source payloads and readback", async t => {
  for (const kind of ["offering", "registration"]) {
    const api = await organizationReviewScenario(); t.after(api.close);
    const client = createOrganizationActivityReviewClient({ baseUrl: api.baseUrl, session: organizationReviewSession(kind) })[kind];
    const input = kind === "offering" ? offeringInput : registrationInput;
    const page = await client.list({ organizationId: "org-1", ...(kind === "registration" ? { activityId: "offering-1" } : {}) });
    assert.equal(page.items[0].id, input.id);
    const detail = await client.get(input);
    assert.equal(detail.id, input.id);
    const plan = await client.prepare(input);
    assert.equal(plan.submitted, false);
    assert.equal(api.state.writes, 0);
    const result = await client.decide(plan, { via: "api", intent: "decide-organization-" + kind + "-review", confirm: true });
    assert.equal(result.submitted, true);
    assert.equal(result.serverAcknowledged, true);
    assert.equal(result.readback, "matched");
    assert.equal(result.decisionVerified, false);
    assert.equal(api.state.writes, kind === "offering" ? 2 : 1);
    assert.deepEqual(api.requests.find(r => r.path.endsWith("/audit")).body, { identified: "AGREEMENT", msg: input.message, time: "2026-10-23", uuid: input.id, ...(kind === "offering" ? { activityId: "" } : {}) });
    assert.deepEqual(api.violations, []);
  }
});

test("SDK denies wrong domains, cross-organization records, processed or unknown states and invalid review input before writes", async t => {
  for (const kind of ["offering", "registration"]) {
    const api = await organizationReviewScenario(); t.after(api.close);
    const client = createOrganizationActivityReviewClient({ baseUrl: api.baseUrl, session: organizationReviewSession(kind) })[kind];
    const input = kind === "offering" ? offeringInput : registrationInput;
    await assert.rejects(() => client.prepare(null), e => e.code === "INVALID_INPUT");
    for (const changes of [{ message: "" }, { time: "2026-02-30" }, { unknown: true }, { isSafeEducation: 1 }, { activityId: kind === "offering" ? "unrelated" : undefined }, ...(kind === "registration" ? [{ decision: "back" }] : [])]) {
      await assert.rejects(() => client.prepare({ ...input, ...changes }), e => e.code === "INVALID_INPUT");
    }
    for (const [field, expected] of [["wrongId", "BUSINESS_REJECTED"], ["wrongOrganization", "PERMISSION_DENIED"], ["unknownState", "NETWORK_PROTOCOL_ERROR"]]) {
      api.state[field] = true;
      await assert.rejects(() => client.prepare(input), e => e.code === expected);
      api.state[field] = false;
    }
    api.state.pending[kind] = false;
    await assert.rejects(() => client.prepare(input), e => e.code === "BUSINESS_REJECTED");
    api.state.pending[kind] = true;
    let plan = await client.prepare(input);
    for (const intent of [undefined, { via: "ego", intent: "decide-organization-" + kind + "-review", confirm: true }, { via: "api", intent: "wrong-kind", confirm: true }, { via: "api", intent: "decide-organization-" + kind + "-review", confirm: false }]) {
      await assert.rejects(() => client.decide(plan, intent), e => e.code === "INVALID_INPUT");
    }
    api.state.organization = false;
    await assert.rejects(() => client.decide(plan, { via: "api", intent: "decide-organization-" + kind + "-review", confirm: true }), e => e.code === "PERMISSION_DENIED");
    api.state.organization = true;
    plan = await client.prepare(input);
    api.state.role = false;
    await assert.rejects(() => client.decide(plan, { via: "api", intent: "decide-organization-" + kind + "-review", confirm: true }), e => e.code === "PERMISSION_DENIED");
    assert.equal(api.state.writes, 0);
    assert.deepEqual(api.violations, []);
  }
});

test("SDK refuses both application kinds with their distinct source-specific decisions and callback binding", async t => {
  for (const [kind, decision, identified] of [["offering", "refuse", "ADJUSTMENT"], ["offering", "back", "REJECTION"], ["registration", "refuse", "REJECTION"]]) {
    const api = await organizationReviewScenario(); t.after(api.close);
    const client = createOrganizationActivityReviewClient({ baseUrl: api.baseUrl, session: organizationReviewSession(kind) })[kind];
    const input = { ...(kind === "offering" ? offeringInput : registrationInput), decision };
    const plan = await client.prepare(input);
    const result = await client.decide(plan, { via: "api", intent: "decide-organization-" + kind + "-review", confirm: true });
    assert.equal(result.readback, "matched");
    assert.equal(api.state.writes, 1);
    const write = api.requests.find(r => r.method === "PUT");
    assert.equal(write.body.identified, identified);
    if (kind === "offering") assert.equal(write.body.activityId, "return-node");
    assert.deepEqual(api.violations, []);
  }
});

test("SDK never retries uncertain writes, never continues after a lost form save and preserves matching readback as UNKNOWN_OUTCOME", async t => {
  for (const [kind, mode, expectedWrites] of [["offering", "readback-lost", 2], ["registration", "readback-lost", 1], ["offering", "save-lost", 1], ["offering", "lost", 2], ["registration", "timeout", 1], ["registration", "lost", 1], ["offering", "reject", 1], ["registration", "reject", 1]]) {
    const api = await organizationReviewScenario(); t.after(api.close);
    const client = createOrganizationActivityReviewClient({ baseUrl: api.baseUrl, session: organizationReviewSession(kind), timeoutMs: 120 })[kind];
    const input = kind === "offering" ? offeringInput : registrationInput;
    const plan = await client.prepare(input), intent = { via: "api", intent: "decide-organization-" + kind + "-review", confirm: true };
    api.state.mode = mode;
    await assert.rejects(() => client.decide(plan, intent), e => {
      assert.equal(e.code, mode === "reject" ? "BUSINESS_REJECTED" : "UNKNOWN_OUTCOME");
      if (mode !== "reject") {
        assert.equal(e.retryable, false);
        assert.equal(e.recovery.serverAcknowledged, mode === "readback-lost" ? true : "unknown");
        assert.equal(e.recovery.readback, mode === "save-lost" ? "unmatched" : mode === "readback-lost" ? "unavailable" : "matched");
        assert.deepEqual(e.recovery.completed, [...(kind === "offering" && ["lost", "readback-lost"].includes(mode) ? ["saved-activity-form"] : []), ...(mode === "readback-lost" ? ["approval-acknowledged"] : [])]);
      }
      return true;
    });
    if (mode !== "reject") await assert.rejects(() => client.decide(plan, intent), e => e.code === "UNKNOWN_OUTCOME");
    assert.equal(api.state.writes, expectedWrites);
    assert.deepEqual(api.violations, []);
  }
});

test("SDK rejects a processed state even if a stale pending page still includes it", async t => {
  const api = await organizationReviewScenario(); t.after(api.close);
  const client = createOrganizationActivityReviewClient({ baseUrl: api.baseUrl, session: organizationReviewSession("registration") }).registration;
  api.registration.flowOverallState = 7;
  await assert.rejects(() => client.prepare(registrationInput), e => e.code === "BUSINESS_REJECTED");
  assert.equal(api.state.writes, 0);
});

test("SDK writes its verified snapshot even when caller mutates the plan while the fresh permission request is in flight", async t => {
  const api = await organizationReviewScenario(); t.after(api.close);
  let plan;
  const client = createOrganizationActivityReviewClient({ baseUrl: api.baseUrl, session: organizationReviewSession("registration"), fetch: async (url, init) => {
    if (plan && String(url).endsWith("/checkUserAndGetUserLevel")) plan.payload.uuid = "wrong-object";
    return fetch(url, init);
  } }).registration;
  plan = await client.prepare(registrationInput);
  const result = await client.decide(plan, { via: "api", intent: "decide-organization-registration-review", confirm: true });
  assert.equal(result.id, "registration-1");
  assert.equal(api.requests.find(request => request.method === "PUT").body.uuid, "registration-1");
  assert.deepEqual(api.violations, []);
});

test("SDK refuses overlapping decisions instead of dispatching a second write", async t => {
  const api = await organizationReviewScenario(); t.after(api.close);
  const client = createOrganizationActivityReviewClient({ baseUrl: api.baseUrl, session: organizationReviewSession("registration") }).registration;
  const one = await client.prepare(registrationInput), two = await client.prepare(registrationInput);
  const intent = { via: "api", intent: "decide-organization-registration-review", confirm: true };
  const results = await Promise.allSettled([client.decide(one, intent), client.decide(two, intent)]);
  assert.equal(results.filter(r => r.status === "rejected" && r.reason.code === "INVALID_INPUT").length, 1);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(api.state.writes, 1);
});
