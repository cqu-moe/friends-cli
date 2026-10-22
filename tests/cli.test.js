import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const run = (file, args, options = {}) =>
  execFileAsync(file, args, { timeout: 15_000, ...options });

test("CLI help and schema are discoverable from the installed entry point", async () => {
  const help = await run(process.execPath, [
    "dist/cli/main.js",
    "courses",
    "--help",
  ]);
  assert.match(help.stdout, /Usage: friends courses/);
  assert.match(help.stdout, /\blist\b/);

  const schema = await run(process.execPath, [
    "dist/cli/main.js",
    "schema",
    "courses.list",
    "--json",
  ]);
  assert.equal(schema.stderr, "");
  const output = JSON.parse(schema.stdout);
  assert.deepEqual(Object.keys(output), ["schemaVersion", "ok", "data", "meta"]);
  assert.equal(output.data.operation, "courses.list");
  assert.equal(output.data.readonly, true);
  assert.equal(output.data.verifiedWith, "controlled-api; live-read-only-evidence");

  const errors = await run(process.execPath, [
    "dist/cli/main.js",
    "schema",
    "errors",
    "--json",
  ]);
  const errorOutput = JSON.parse(errors.stdout);
  assert.deepEqual(errorOutput.data.exitCodes, {
    0: "success",
    2: "INVALID_INPUT",
    3: "AUTH_REQUIRED",
    4: "PERMISSION_DENIED",
    5: "BUSINESS_REJECTED",
    6: "NETWORK_PROTOCOL_ERROR",
    7: "UNKNOWN_OUTCOME",
  });
});

test("schema rejects prototype keys and command input is validated before credential access", async () => {
  for (const operation of ["__proto__", "toString", "constructor"]) {
    await assert.rejects(
      () =>
        run(process.execPath, [
          "dist/cli/main.js",
          "schema",
          operation,
          "--json",
        ]),
      (error) => {
        assert.equal(error.code, 2);
        const output = JSON.parse(error.stdout);
        assert.equal(output.schemaVersion, 1);
        assert.equal(output.ok, false);
        assert.equal(output.error.code, "INVALID_INPUT");
        return true;
      },
    );
  }

  const home = `/friends-cli-must-not-read-${Date.now()}`;
  await assert.rejects(
    () =>
      run(
        process.execPath,
        ["dist/cli/main.js", "courses", "list", "--page", "0", "--json"],
        { env: { ...process.env, FRIENDS_HOME: home } },
      ),
    (error) => {
      assert.equal(error.code, 2);
      assert.equal(JSON.parse(error.stdout).error.code, "INVALID_INPUT");
      return true;
    },
  );
  await assert.rejects(
    () =>
      run(
        process.execPath,
        ["dist/cli/main.js", "courses", "show", "not/a-course-id", "--json"],
        { env: { ...process.env, FRIENDS_HOME: home } },
      ),
    (error) => {
      assert.equal(error.code, 2);
      assert.equal(JSON.parse(error.stdout).error.code, "INVALID_INPUT");
      return true;
    },
  );
});
