import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createVolunteerCertificationReviewClient,
  createVolunteerHoursClient,
  FriendsErrorCode,
} from "../dist/index.js";
import { school, session } from "./fixtures/volunteer-review.mjs";

test("SDK exposes authenticated volunteer hours and preserves school values", async (t) => {
  const upstream = await school(t);
  const client = createVolunteerHoursClient({ ...upstream, session });
  const page = await client.list({ page: 2, pageSize: 5, keyword: "示例" });
  assert.deepEqual(page.items, [{ id: "transcript-1" }]);
  assert.equal(page.totalCount, 1);
  assert.equal(page.hasMore, false);
  const detail = await client.get("transcript-1");
  assert.equal(detail.totalDurationHours, 12.5);
  assert.equal(detail.totalIntegral, 2);
  assert.equal(detail.items[0].activityType.raw, "FUTURE_TYPE");
  assert.equal(detail.items[0].activityType.known, false);
  assert.equal(detail.items[0].durationHours.unit, "hours");
  upstream.state.pages = null;
  const unknownPagination = await client.list();
  assert.equal(unknownPagination.hasMore, null);
  const request = upstream.requests.find(({ url }) => url.endsWith("/student-transcript/page"));
  assert.deepEqual(request.body, {
    currentPage: 2,
    pageSize: 5,
    classNo: "",
    collegeNo: "",
    key: "示例",
    specialtyNo: "",
    specialtyType: "",
    poorLevel: "",
    flowStateFormate: "",
    studentGroupKey: "",
    examine: 1,
  });
});

test("SDK reviews real roles and decides through explicit non-retryable API intent", async (t) => {
  const upstream = await school(t);
  const client = createVolunteerCertificationReviewClient({ ...upstream, session });
  const list = await client.list({ page: 2, pageSize: 5, keyword: "示例" });
  assert.equal(list.items[0].id, "review-1");
  assert.equal(list.items[0].state.raw, 9);
  assert.equal(list.items[0].state.known, false);
  const detail = await client.get("review-1");
  assert.equal(detail.activity.id, "activity-1");
  assert.equal(detail.entries[0].attestationDurationHours, 1.5);
  assert.equal(detail.state.raw, 9);
  const listRequest = upstream.requests.find(({ url }) => url.endsWith("/school-activity-attestation-apply/page-list"));
  assert.equal(listRequest.body.handleType, "XJ01");
  assert.equal(listRequest.body.state, "0");

  const intent = {
    via: "api",
    intent: "submit-volunteer-certification-review",
    decision: "pass",
    confirm: true,
    message: "同意认证",
    time: "2026-10-22",
  };
  await assert.rejects(() => client.decide("review-1", { ...intent, decision: "refuse" }), (error) =>
    error.code === FriendsErrorCode.InvalidInput);
  await assert.rejects(() => client.decide("review-1", { ...intent, confirm: false }), (error) =>
    error.code === FriendsErrorCode.InvalidInput);
  assert.equal(upstream.writes.length, 0);
  const dryRun = await client.decide("review-1", { ...intent, dryRun: true });
  assert.equal(dryRun.submitted, false);
  assert.equal(upstream.writes.length, 0);

  upstream.state.mode = "processed";
  await assert.rejects(() => client.decide("review-1", intent), (error) =>
    error.code === FriendsErrorCode.UpstreamBusiness);
  assert.equal(upstream.state.writeAttempts, 1);
  assert.equal(upstream.writes.length, 0);
  upstream.state.mode = "ok";

  const passed = await client.decide("review-1", intent);
  assert.equal(passed.submitted, true);
  assert.equal(passed.serverAcknowledged, true);
  assert.equal(passed.readback.state, "changed");
  assert.equal(passed.readback.detail.state.known, false);
  assert.equal(upstream.writes.length, 1);
  assert.equal(upstream.writes[0].path.endsWith("/pass"), true);
  assert.equal(upstream.writes[0].body.handleType, "XJ01");
  assert.equal(upstream.writes[0].body.callbackActivityId, null);
  assert.equal(upstream.writes[0].body.applyInfo.activityId, "activity-1");
  assert.equal(upstream.writes[0].body.applyInfo.uuid, "review-1");
  assert.equal(upstream.writes[0].body.applyInfo.nameList[0].studentNo, "20210002");
  assert.equal(upstream.writes[0].body.applyInfo.nameList[0].attestationDuration, 1.5);
});

test("SDK keeps lost review writes unknown and separates acknowledgement from failed readback", async (t) => {
  for (const mode of ["lost", "malformed"]) await t.test(mode, async (t) => {
    const upstream = await school(t);
    upstream.state.mode = mode;
    const client = createVolunteerCertificationReviewClient({ ...upstream, session });
    const intent = {
      via: "api",
      intent: "submit-volunteer-certification-review",
      decision: "pass",
      confirm: true,
      message: "同意认证",
      time: "2026-10-22",
    };
    await assert.rejects(() => client.decide("review-1", intent), (error) => {
      assert.equal(error.code, FriendsErrorCode.UnknownOutcome);
      assert.equal(error.retryable, false);
      assert.equal(error.recovery.applicationId, "review-1");
      assert.ok(error.recovery.completed.includes("readback:changed"));
      return true;
    });
    assert.equal(upstream.writes.length, 1);
  });

  await t.test("lost-readback-failure", async (t) => {
    const upstream = await school(t);
    upstream.state.mode = "lost-readback-failure";
    const client = createVolunteerCertificationReviewClient({ ...upstream, session });
    await assert.rejects(() => client.decide("review-1", {
      via: "api",
      intent: "submit-volunteer-certification-review",
      decision: "pass",
      confirm: true,
      message: "同意认证",
      time: "2026-10-22",
    }), (error) => {
      assert.equal(error.code, FriendsErrorCode.UnknownOutcome);
      assert.equal(error.retryable, false);
      assert.ok(error.recovery.completed.includes("readback:unavailable"));
      return true;
    });
    assert.equal(upstream.writes.length, 1);
    assert.equal(upstream.state.writeAttempts, 1);
  });

  const upstream = await school(t);
  upstream.state.mode = "ack-readback-failure";
  const client = createVolunteerCertificationReviewClient({ ...upstream, session });
  const result = await client.decide("review-1", {
    via: "api",
    intent: "submit-volunteer-certification-review",
    decision: "pass",
    confirm: true,
    message: "同意认证",
    time: "2026-10-22",
  });
  assert.equal(result.serverAcknowledged, true);
  assert.equal(result.readback.state, "unavailable");
  assert.equal(upstream.writes.length, 1);
});

test("SDK verifies current account, pending membership, and activity binding before a decision", async (t) => {
  const intent = {
    via: "api",
    intent: "submit-volunteer-certification-review",
    decision: "pass",
    confirm: true,
    message: "同意认证",
    time: "2026-10-22",
  };

  await t.test("rejects a changed school account", async (t) => {
    const upstream = await school(t);
    upstream.state.account = "20219999";
    const client = createVolunteerCertificationReviewClient({ ...upstream, session });
    await assert.rejects(() => client.decide("review-1", intent), (error) =>
      error.code === FriendsErrorCode.AuthRequired);
    assert.equal(upstream.state.writeAttempts ?? 0, 0);
    assert.equal(upstream.writes.length, 0);
  });

  await t.test("rejects an application outside the pending set", async (t) => {
    const upstream = await school(t);
    upstream.state.pendingMissing = true;
    const client = createVolunteerCertificationReviewClient({ ...upstream, session });
    await assert.rejects(() => client.decide("review-1", intent), (error) =>
      error.code === FriendsErrorCode.UpstreamBusiness);
    assert.equal(upstream.state.writeAttempts ?? 0, 0);
    assert.equal(upstream.writes.length, 0);
  });

  await t.test("rejects a list/detail activity mismatch", async (t) => {
    const upstream = await school(t);
    upstream.state.activityMismatch = true;
    const client = createVolunteerCertificationReviewClient({ ...upstream, session });
    await assert.rejects(() => client.decide("review-1", intent), (error) =>
      error.code === FriendsErrorCode.NetworkProtocol);
    assert.equal(upstream.state.writeAttempts ?? 0, 0);
    assert.equal(upstream.writes.length, 0);
  });
});

test("SDK uses real callback nodes for BACK and rejects missing real review roles", async (t) => {
  const upstream = await school(t);
  const client = createVolunteerCertificationReviewClient({ ...upstream, session });
  const back = await client.decide("review-1", {
    via: "api",
    intent: "submit-volunteer-certification-review",
    decision: "back",
    confirm: true,
    message: "退回补充",
    time: "2026-10-22",
  });
  assert.equal(back.serverAcknowledged, true);
  assert.equal(upstream.writes[0].path.endsWith("/callback"), true);
  assert.equal(upstream.writes[0].body.callbackActivityId, "callback-1");
  assert.equal(upstream.writes[0].body.applyInfo, null);

  upstream.state.mode = "no-role";
  await assert.rejects(() => client.list(), (error) =>
    error.code === FriendsErrorCode.PermissionDenied);
});
