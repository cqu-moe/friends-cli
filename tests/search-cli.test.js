import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { searchScenario, searchSession } from "./fixtures/search.mjs";
const execute = promisify(execFile);
async function setup(t) {
  const api = await searchScenario(); t.after(api.close);
  const home = await mkdtemp(join(tmpdir(), "friends-search-")); t.after(() => rm(home, { recursive: true, force: true }));
  await writeFile(join(home, "session.json"), JSON.stringify({ ...searchSession, schemaVersion: 1, loginMethod: "local", storage: "file" }), { mode: 0o600 });
  const env = { ...process.env, FRIENDS_HOME: home, FRIENDS_BASE_URL: api.baseUrl };
  async function run(args, input, extraEnv = {}) {
    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["dist/cli/main.js", "search", ...args], { env: { ...env, ...extraEnv }, timeout: 20000 }); let stdout = "", stderr = "";
      child.stdout.on("data", chunk => stdout += chunk); child.stderr.on("data", chunk => stderr += chunk); child.once("error", reject); child.once("close", code => resolve({ code, stdout, stderr })); child.stdin.end(input);
    });
    assert.equal(result.stdout.trim().split("\n").length, 1);
    return { ...result, json: JSON.parse(result.stdout) };
  }
  return { ...api, home, env, run };
}

test("real CLI search exposes its schema and searches all domains with separately budgeted pagination", async t => {
  const cli = await setup(t);
  const help = await execute(process.execPath, ["dist/cli/main.js", "search", "--help"]);
  assert.match(help.stdout, /--max-pages/); assert.match(help.stdout, /--input/);
  const schema = JSON.parse((await execute(process.execPath, ["dist/cli/main.js", "schema", "search"])).stdout);
  assert.equal(schema.data.readonly, true); assert.deepEqual(schema.data.supportedVia, ["api", "ego"]);
  const result = await cli.run(["--keyword", "示例", "--json"]);
  assert.equal(result.code, 0); assert.equal(result.stderr, ""); assert.equal(result.json.schemaVersion, 1);
  assert.equal(result.json.data.sources.length, 3); assert.equal(result.json.data.sources[0].budget.exhausted, true);
  assert.equal(result.json.meta.selectedEntry, "api"); assert.equal(result.json.meta.requestMode, "direct-api");
  const selected = await cli.run(["--type", "course", "--page", "2", "--page-size", "1", "--max-pages", "2"]);
  assert.equal(selected.code, 0); assert.deepEqual(selected.json.data.sources.map(source => source.type), ["course"]);
  assert.deepEqual(selected.json.data.sources[0].pages.map(page => page.page), [2, 3]); assert.equal(selected.json.data.sources[0].complete, false);
  assert.deepEqual(cli.violations, []);
});

test("real CLI accepts file/stdin source budgets and rejects ambiguous or unsupported noninteractive input before requests", async t => {
  const cli = await setup(t), file = join(cli.home, "query.json");
  await writeFile(file, JSON.stringify({ keyword: "文件关键词", types: ["course", "volunteer"], pagination: { course: { page: 2, pageSize: 1, maxPages: 2 }, volunteer: { pageSize: 1 } } }));
  const fromFile = await cli.run(["--input", file]);
  assert.equal(fromFile.code, 0); assert.equal(fromFile.stderr, ""); assert.equal(fromFile.json.data.keyword, "文件关键词");
  assert.deepEqual(fromFile.json.data.sources[0].pages.map(page => page.page), [2, 3]); assert.equal(fromFile.json.data.sources[1].pages[0].pageSize, 1);
  const stdin = await cli.run(["--input", "-"], JSON.stringify({ keyword: "标准输入", types: ["organization-activity"], pagination: { "organization-activity": { pageSize: 2, maxPages: 2 } } }));
  assert.equal(stdin.code, 0); assert.equal(stdin.json.data.sources[0].items[0].type, "organization-activity"); assert.equal(stdin.json.data.complete, true);
  const before = cli.requests.length;
  for (const [args, input] of [[["--input", file, "--keyword", "混用"]], [["--type", "unknown"]], [["--type", "course,course"]], [["--max-pages", "0"]], [["--sort", "relevance"]], [["--input", "-"], '{"state":"approved"}'], [["--input", "-"], 'null'], [["--input", "-"], '{broken'], [["--via", "ego"]], [["--via", "api", "--ego-task-space", "8"]]]) {
    const result = await cli.run(args, input);
    assert.equal(result.code, 2); assert.equal(result.json.error.code, "INVALID_INPUT"); assert.notEqual(result.stderr, "");
    assert.equal(cli.requests.length, before);
  }
  assert.deepEqual(cli.violations, []);
});

test("real CLI explicitly reports partial source failures, unknown pages, empty results and all-failed exit codes", async t => {
  const cli = await setup(t);
  cli.state.failures.volunteer = { page: 1, kind: "denied" };
  const partial = await cli.run([]);
  assert.equal(partial.code, 0); assert.equal(partial.json.ok, true); assert.equal(partial.json.data.status, "partial"); assert.match(partial.stderr, /Some search sources failed/);
  assert.equal(partial.json.data.sources[1].error.code, "PERMISSION_DENIED");
  const denied = await cli.run(["--type", "volunteer"]);
  assert.equal(denied.code, 4); assert.equal(denied.json.ok, false); assert.equal(denied.json.data.status, "failed"); assert.equal(denied.json.error.code, "PERMISSION_DENIED");
  cli.state.failures = {};
  cli.state.unknownPagination.course = true;
  const unknown = await cli.run(["--type", "course", "--max-pages", "3"]);
  assert.equal(unknown.code, 0); assert.equal(unknown.json.data.sources[0].complete, null); assert.equal(unknown.json.data.sources[0].pages.length, 1); assert.equal(unknown.json.data.sources[0].items[0].record.state.known, false);
  cli.rows.volunteer.length = 0;
  const empty = await cli.run(["--type", "volunteer"]);
  assert.equal(empty.code, 0); assert.equal(empty.json.data.complete, true); assert.deepEqual(empty.json.data.sources[0].items, []);
  cli.state.invalidId.course = true;
  const bad = await cli.run(["--type", "course"]);
  assert.equal(bad.code, 6); assert.equal(bad.json.error.code, "NETWORK_PROTOCOL_ERROR"); assert.deepEqual(bad.json.data.sources[0].items, []);
  cli.state.account = "other-user";
  const changed = await cli.run([]);
  assert.equal(changed.code, 3); assert.equal(changed.json.error.code, "AUTH_REQUIRED");
  assert.deepEqual(cli.violations, []);
});

test("real CLI Ego search uses the verified existing iframe session for API queries without any DOM click or local credential fallback", async t => {
  const cli = await setup(t);
  const html = join(cli.home, "page.html"), config = join(cli.home, "ego.json"), evidence = join(cli.home, "ego-evidence.json");
  await writeFile(html, '<input name="human-input" value="保留人工内容"><button onclick="fetch(\'/unsafe\',{method:\'POST\'})">提交</button>');
  await writeFile(config, JSON.stringify({ html, url: new URL("/mobile/home/index", cli.baseUrl).href, outerUrl: new URL("/mobile/main/index", cli.baseUrl).href, result: evidence, frame: true, executeSession: true, token: searchSession.token, userLevel: "XS", accountUserNo: "search-user" }));
  const runner = new URL("./fixtures/strict-ego.mjs", import.meta.url).pathname;
  await writeFile(join(cli.home, "ego-browser"), `#!/bin/sh\nexec '${process.execPath}' '${runner}' "$@"\n`, { mode: 0o755 });
  await rm(join(cli.home, "session.json"));
  const result = await cli.run(["--keyword", "Ego关键词", "--via", "ego", "--ego-task-space", "8", "--ego-page", "p2"], undefined, { PATH: cli.home + ":" + process.env.PATH, FRIENDS_EGO_FIXTURE_CONFIG: config });
  assert.equal(result.code, 0); assert.equal(result.stderr, ""); assert.equal(result.json.data.sources.length, 3);
  assert.equal(result.json.meta.selectedEntry, "ego"); assert.equal(result.json.meta.credentialSource, "existing-ego-session"); assert.equal(result.json.meta.requestMode, "direct-api");
  const observed = JSON.parse(await readFile(evidence, "utf8"));
  assert.deepEqual(observed.clicks, []); assert.deepEqual(observed.fills, []); assert.equal(observed.navigations, 0); assert.equal(observed.newPages, 0); assert.equal(observed.handoffs, 0); assert.equal(observed.submits, 0);
  assert.ok(observed.fieldValues.some(field => field.value === "保留人工内容"));
  assert.deepEqual(cli.requests.filter(request => request.type).map(request => request.body.key), ["Ego关键词", "Ego关键词", "Ego关键词"]);
  assert.deepEqual(cli.violations, []);
});
