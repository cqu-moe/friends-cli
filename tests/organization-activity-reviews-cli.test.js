import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { organizationReviewScenario, organizationReviewSession, offeringInput, registrationInput } from "./fixtures/organization-activity-reviews.mjs";
const execute = promisify(execFile);
export async function reviewCli(t, kind, extraEnv = {}) {
  const api = await organizationReviewScenario(); t.after(api.close);
  const home = await mkdtemp(join(tmpdir(), "friends-organization-reviews-")); t.after(() => rm(home, { recursive: true, force: true }));
  await writeFile(join(home, "session.json"), JSON.stringify({ ...organizationReviewSession(kind), schemaVersion: 1, loginMethod: "local", storage: "file" }), { mode: 0o600 });
  const inputFile = join(home, "review.json"), input = kind === "offering" ? offeringInput : registrationInput;
  await writeFile(inputFile, JSON.stringify({ message: input.message, time: input.time }));
  const env = { ...process.env, FRIENDS_HOME: home, FRIENDS_BASE_URL: api.baseUrl, ...extraEnv };
  const command = ["dist/cli/main.js", "organization-activities", kind + "-reviews"];
  const scope = ["--organization", "org-1", ...(kind === "registration" ? ["--activity", "offering-1"] : [])];
  const run = async (args, stdin) => {
    let result;
    if (stdin === undefined) result = await execute(process.execPath, [...command, ...args], { env, timeout: 15000 }).then(v => ({ ...v, code: 0 }), e => ({ stdout: e.stdout, stderr: e.stderr, code: e.code }));
    else result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [...command, ...args], { env, timeout: 15000 }); let stdout = "", stderr = "";
      child.stdout.on("data", chunk => stdout += chunk); child.stderr.on("data", chunk => stderr += chunk); child.once("error", reject); child.once("close", code => resolve({ code, stdout, stderr })); child.stdin.end(stdin);
    });
    assert.equal(result.stdout.trim().split("\n").length, 1);
    return { ...result, json: JSON.parse(result.stdout) };
  };
  return { ...api, home, inputFile, input, scope, run, env };
}

test("real CLI exposes separate offering and registration approvals and executes their API flow with one versioned JSON result", async t => {
  for (const kind of ["offering", "registration"]) {
    const cli = await reviewCli(t, kind);
    const help = await execute(process.execPath, ["dist/cli/main.js", "organization-activities", kind + "-reviews", "--help"]);
    assert.match(help.stdout, /decide/);
    for (const operation of ["list", "show", "prepare", "decide", "verify"]) {
      const schema = await execute(process.execPath, ["dist/cli/main.js", "schema", `organization-activities.${kind}-reviews.${operation}`]);
      assert.equal(JSON.parse(schema.stdout).data.readonly, ["list", "show", "verify"].includes(operation));
    }
    const list = await cli.run(["list", ...cli.scope]);
    assert.equal(list.code, 0); assert.equal(list.json.schemaVersion, 1); assert.equal(list.stderr, ""); assert.equal(list.json.data.items[0].id, cli.input.id);
    const show = await cli.run(["show", cli.input.id, ...cli.scope]); assert.equal(show.json.data.id, cli.input.id);
    const before = await cli.run(["verify", cli.input.id, ...cli.scope]); assert.equal(before.json.data.pending, true);
    const args = ["decide", cli.input.id, ...cli.scope, "--decision", "pass", "--input", cli.inputFile, "--via", "api"];
    const dry = await cli.run([...args, "--dry-run"]); assert.equal(dry.code, 0); assert.equal(dry.json.data.submitted, false); assert.equal(cli.state.writes, 0);
    const result = await cli.run([...args, "--yes"]);
    assert.equal(result.code, 0); assert.equal(result.stderr, ""); assert.equal(result.json.data.readback, "matched"); assert.equal(result.json.meta.requestMode, "api-write");
    const after = await cli.run(["verify", cli.input.id, ...cli.scope]); assert.equal(after.json.data.pending, false);
    assert.equal(cli.state.writes, kind === "offering" ? 2 : 1);
    assert.deepEqual(cli.violations, []);
  }
});

test("real CLI refuses both review kinds through stdin and rejects unsupported, unconfirmed and cross-domain requests without writes", async t => {
  for (const kind of ["offering", "registration"]) {
    const cli = await reviewCli(t, kind), fields = JSON.stringify({ message: "拒绝原因", time: "2026-10-23" });
    const args = ["decide", cli.input.id, ...cli.scope, "--decision", "refuse", "--input", "-"];
    for (const [extra, body] of [[[], fields], [["--yes"], fields], [["--via", "api"], fields], [["--via", "ego", "--yes"], fields], [["--via", "api", "--yes"], '{"message":"原因","time":"2026-10-23","unsupported":true}'], [["--via", "api", "--yes"], '{"message":"","time":"2026-10-23"}']]) {
      const rejected = await cli.run([...args, ...extra], body);
      assert.equal(rejected.code, 2); assert.equal(rejected.json.error.code, "INVALID_INPUT"); assert.notEqual(rejected.stderr, "");
    }
    for (const [field, code] of [["wrongId", 5], ["wrongOrganization", 4]]) {
      cli.state[field] = true;
      assert.equal((await cli.run([...args, "--via", "api", "--yes"], fields)).code, code);
      cli.state[field] = false;
    }
    cli.state.pending[kind] = false;
    assert.equal((await cli.run([...args, "--via", "api", "--yes"], fields)).code, 5);
    cli.state.pending[kind] = true;
    assert.equal(cli.state.writes, 0);
    const result = await cli.run([...args, "--via", "api", "--yes"], fields);
    assert.equal(result.code, 0); assert.equal(result.json.data.readback, "matched"); assert.equal(result.stderr, "");
    const write = cli.requests.find(request => request.method === "PUT");
    assert.equal(write.body.identified, kind === "offering" ? "ADJUSTMENT" : "REJECTION");
    assert.equal(write.body.msg, "拒绝原因"); assert.equal(write.body.time, "2026-10-23");
    assert.equal(cli.state.writes, 1); assert.deepEqual(cli.violations, []);
  }
});

test("real CLI preserves unknown outcomes and partial form saves with exit 7 and never repeats or continues a write", async t => {
  for (const kind of ["offering", "registration"]) for (const mode of ["reject", "lost", "timeout", "readback-lost", ...(kind === "offering" ? ["save-lost"] : [])]) {
    const cli = await reviewCli(t, kind); cli.state.mode = mode;
    const result = await cli.run(["decide", cli.input.id, ...cli.scope, "--decision", "pass", "--input", cli.inputFile, "--via", "api", "--yes", "--timeout", "500"]);
    assert.equal(result.code, mode === "reject" ? 5 : 7);
    assert.equal(result.json.error.code, mode === "reject" ? "BUSINESS_REJECTED" : "UNKNOWN_OUTCOME");
    assert.equal(result.json.error.retryable, false); assert.notEqual(result.stderr, "");
    if (mode !== "reject") {
      assert.equal(result.json.error.recovery.applicationId, cli.input.id);
      assert.equal(result.json.error.recovery.organizationId, "org-1");
      assert.equal(result.json.error.recovery.readback, mode === "save-lost" ? "unmatched" : mode === "readback-lost" ? "unavailable" : "matched");
    }
    assert.equal(cli.state.writes, kind === "offering" && mode !== "save-lost" && mode !== "reject" ? 2 : 1);
    assert.deepEqual(cli.violations, []);
  }
});
