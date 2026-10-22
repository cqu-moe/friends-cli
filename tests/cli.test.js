import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

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
});
