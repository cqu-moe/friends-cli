import assert from "node:assert/strict";
import { test } from "node:test";
import { createUnifiedSearchClient } from "../dist/index.js";
import { searchScenario, searchSession } from "./fixtures/search.mjs";

test("public SDK searches all three domains through their query clients, retaining typed IDs, one page per source and unknown states", async t => {
  const api = await searchScenario(); t.after(api.close);
  const client = createUnifiedSearchClient({ baseUrl: api.baseUrl, session: searchSession });
  const result = await client.search({ keyword: "示例" });
  assert.equal(result.status, "ok"); assert.equal(result.complete, false);
  assert.deepEqual(result.sources.map(source => source.type), ["course", "volunteer", "organization-activity"]);
  const [course, volunteer, organization] = result.sources;
  assert.deepEqual(result.sources.map(source => source.pages.length), [1, 1, 1]);
  assert.deepEqual(result.sources.map(source => source.items[0].id), ["shared-id", "shared-id", "shared-id"]);
  assert.deepEqual(result.sources.map(source => source.items[0].detail.operation), ["courses.get", "volunteers.activities.show", "organization-participation.show"]);
  assert.equal(course.items[0].record.state.raw, "FUTURE_COURSE_STATE"); assert.equal(course.items[0].record.state.known, false);
  assert.equal(volunteer.items[0].record.state.raw, "FUTURE_VOLUNTEER_STATE");
  assert.equal(organization.items[0].record.registration.state.raw, 999); assert.equal(organization.items[0].record.registration.state.known, false);
  assert.equal(course.pages[0].totalCount, 11); assert.equal(course.budget.exhausted, true); assert.equal(course.nextPage, 2);
  assert.equal(volunteer.complete, true); assert.equal(organization.complete, true);
  assert.equal(Object.hasOwn(result, "totalCount"), false); assert.equal(Object.hasOwn(result, "nextPage"), false);
  assert.deepEqual(result.context, { levelNo: "XS", unit: { unitNo: "search-unit" } });
  assert.equal(JSON.stringify(result).includes("search-fixture-token"), false);
  assert.deepEqual(api.requests.filter(request => request.type).map(request => request.body.key), ["示例", "示例", "示例"]);
  assert.deepEqual(api.violations, []);
});

test("SDK rejects unsupported conditions and malformed per-type budgets before identity or domain requests", async t => {
  const api = await searchScenario(); t.after(api.close);
  const client = createUnifiedSearchClient({ baseUrl: api.baseUrl, session: searchSession });
  for (const input of [null, { types: [] }, { types: ["course", "course"] }, { types: ["unknown"] }, { keyword: null }, { pagination: null }, { pagination: { course: null } }, { pagination: { course: { page: 0 } } }, { pagination: { course: { pageSize: 101 } } }, { pagination: { course: { maxPages: 21 } } }, { types: ["course"], pagination: { volunteer: {} } }, { sort: "relevance" }, { state: "approved" }]) {
    await assert.rejects(() => client.search(input), error => error.code === "INVALID_INPUT");
    assert.equal(api.requests.length, 0);
  }
});

test("SDK retains a successful page as partial search when a later page fails", async t => {
  const api = await searchScenario(); t.after(api.close); api.state.failures.course = { page: 2, kind: "unavailable" };
  const result = await createUnifiedSearchClient({ baseUrl: api.baseUrl, session: searchSession }).search({ types: ["course"], pagination: { course: { pageSize: 1, maxPages: 3 } } });
  assert.equal(result.status, "partial"); assert.equal(result.complete, false);
  assert.equal(result.sources[0].status, "partial"); assert.equal(result.sources[0].items[0].id, "shared-id");
  assert.equal(result.sources[0].error.code, "NETWORK_PROTOCOL_ERROR");
  assert.equal(result.sources[0].budget.pagesRequested, 2); assert.equal(result.sources[0].budget.pagesRead, 1);
  assert.equal(result.sources[0].nextPage, 2); assert.equal(result.sources[0].stoppedBecause, "failure");
  assert.deepEqual(api.requests.filter(request => request.type).map(request => request.body.currentPage), [1, 2]);
  assert.deepEqual(api.violations, []);
});

test("SDK keeps per-type page ranges and budgets, distinguishes unknown pagination and does not scan empty sources", async t => {
  const api = await searchScenario(); t.after(api.close);
  const client = createUnifiedSearchClient({ baseUrl: api.baseUrl, session: searchSession });
  const result = await client.search({ types: ["organization-activity", "course"], pagination: { "organization-activity": { page: 2 }, course: { maxPages: 2 } } });
  assert.deepEqual(result.sources.map(source => source.type), ["organization-activity", "course"]);
  assert.equal(result.sources[0].pages[0].page, 2); assert.equal(result.sources[0].complete, false);
  assert.deepEqual(result.sources[1].pages.map(page => page.page), [1, 2]); assert.equal(result.sources[1].items.length, 11); assert.equal(result.sources[1].complete, true);
  assert.equal(api.requests.some(request => request.type === "volunteer"), false);
  api.state.unknownPagination.course = true;
  const unknown = (await client.search({ types: ["course"], pagination: { course: { maxPages: 3 } } })).sources[0];
  assert.equal(unknown.complete, null); assert.equal(unknown.stoppedBecause, "unknown-pagination");
  assert.equal(unknown.pages.length, 1); assert.equal(unknown.pages[0].totalCount, null); assert.equal(unknown.nextPage, null); assert.equal(unknown.budget.exhausted, false);
  api.rows.volunteer.length = 0;
  const empty = await client.search({ types: ["volunteer"], keyword: "不存在", pagination: { volunteer: { maxPages: 3 } } });
  assert.equal(empty.complete, true); assert.equal(empty.sources[0].pages.length, 1); assert.deepEqual(empty.sources[0].items, []);
  assert.equal(empty.sources[0].pages[0].totalCount, 0); assert.equal(empty.sources[0].budget.exhausted, false);
  assert.deepEqual(api.violations, []);
});

test("SDK reports source permission/business/network failures and malformed IDs without fallback, while identity changes stop every domain", async t => {
  const api = await searchScenario(); t.after(api.close);
  const client = createUnifiedSearchClient({ baseUrl: api.baseUrl, session: searchSession });
  api.state.failures.volunteer = { page: 1, kind: "denied" };
  api.state.failures["organization-activity"] = { page: 1, kind: "business" };
  const partial = await client.search({ keyword: "示例" });
  assert.equal(partial.status, "partial"); assert.equal(partial.sources[0].items.length, 10);
  assert.equal(partial.sources[1].error.code, "PERMISSION_DENIED");
  assert.equal(partial.sources[2].error.code, "BUSINESS_REJECTED"); assert.equal(partial.sources[2].error.upstreamCode, "business-refusal");
  api.state.failures.course = { page: 1, kind: "lost" };
  assert.equal((await client.search({ types: ["course"] })).sources[0].error.code, "NETWORK_PROTOCOL_ERROR");
  api.state.failures = {};
  for (const type of ["course", "volunteer", "organization-activity"]) {
    api.state.invalidId[type] = true;
    const result = await client.search({ types: [type] });
    assert.equal(result.status, "failed"); assert.equal(result.sources[0].items.length, 0); assert.ok(result.sources[0].error);
    api.state.invalidId[type] = false;
  }
  api.state.wrongPage.course = true;
  const wrong = await client.search({ types: ["course"] });
  assert.equal(wrong.sources[0].error.code, "NETWORK_PROTOCOL_ERROR"); assert.deepEqual(wrong.sources[0].pages, []);
  const before = api.requests.filter(request => request.type).length;
  api.state.account = "other-user";
  await assert.rejects(() => client.search(), error => error.code === "AUTH_REQUIRED");
  assert.equal(api.requests.filter(request => request.type).length, before);
  assert.deepEqual(api.violations, []);
});
