import assert from "node:assert/strict";
import { test } from "node:test";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readEgoSession } from "../dist/node.js";

async function fakeCommand(name, makeScript) {
  const directory = join(tmpdir(), `friends-node-${Date.now()}-${name}`);
  await mkdir(directory, { recursive: true });
  const path = join(directory, name);
  const log = join(directory, "script.js");
  await writeFile(path, makeScript(log));
  await chmod(path, 0o700);
  return { path, directory, log };
}

test("Ego bridge manages its default space, reuses explicit spaces, and redacts failures", async () => {
  const managed = await fakeCommand("managed", (log) => [
    "#!/bin/sh",
    `cat > ${log}`,
    `printf '%s' '{"token":"{\\"token\\":\\"wrapped-token\\"}","userLevel":"XS"}'`,
    "",
  ].join("\n"));
  const managedSession = await readEgoSession({
    command: managed.path,
    timeoutMs: 1000,
  });
  assert.equal(managedSession.token, "wrapped-token");
  assert.equal(managedSession.userLevel, "XS");
  assert.match(await readFile(managed.log, "utf8"), /waitForControl/);

  const explicit = await fakeCommand("explicit", (log) => [
    "#!/bin/sh",
    `cat > ${log}`,
    "printf '%s' '{\"token\":\"explicit-token\",\"userLevel\":\"XS\"}'",
    "",
  ].join("\n"));
  const explicitSession = await readEgoSession({
    command: explicit.path,
    taskSpaceId: 12,
    timeoutMs: 1000,
  });
  assert.equal(explicitSession.token, "explicit-token");

  const failing = await fakeCommand("failing", () => [
    "#!/bin/sh",
    "cat >/dev/null",
    "printf leak-stdout",
    "printf leak-stderr >&2",
    "exit 9",
    "",
  ].join("\n"));
  await assert.rejects(
    () => readEgoSession({ command: failing.path, timeoutMs: 1000 }),
    (error) => !error.message.includes("leak"),
  );
});
