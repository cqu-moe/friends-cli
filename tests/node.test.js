import assert from "node:assert/strict";
import { test } from "node:test";
import { chmod, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadSession, readEgoSession, saveSession } from "../dist/node.js";

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
    "printf '%s\\n' 'ego noise before result'",
    "cat <<'FRIENDS_MARKER' >&2",
    "FRIENDS_CLI_EGO_SESSION:{\"token\":\"{\\\"token\\\":\\\"wrapped-token\\\"}\",\"userLevel\":\"XS\"}",
    "FRIENDS_MARKER",
    "",
  ].join("\n"));
  const managedSession = await readEgoSession({
    command: managed.path,
    timeoutMs: 1000,
  });
  assert.equal(managedSession.token, "wrapped-token");
  assert.equal(managedSession.userLevel, "XS");
  const managedScript = await readFile(managed.log, "utf8");
  assert.match(managedScript, /waitForControl/);
  assert.match(managedScript, /FRIENDS_CLI_EGO_SESSION:/);

  const explicit = await fakeCommand("explicit", (log) => [
    "#!/bin/sh",
    `cat > ${log}`,
    "printf '%s\\n' 'FRIENDS_CLI_EGO_SESSION:{\"token\":\"explicit-token\",\"userLevel\":\"XS\"}'",
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
    (error) =>
      !error.message.includes("leak") &&
      !error.message.includes("ticket") &&
      error.code === "AUTH_REQUIRED",
  );
});

test("file storage uses a dedicated secure directory and rejects invalid session shapes", async () => {
  const parent = join(tmpdir(), `friends-storage-${Date.now()}`);
  const root = join(parent, "friends-state");
  const session = {
    schemaVersion: 1,
    loginMethod: "local",
    storage: "file",
    token: "file-token",
    userLevel: "XS",
    account: { userNo: "20210001", userName: "张三" },
    context: {
      levelNo: "XS",
      levelName: "学生",
      unit: { unitType: 2, unitNo: "24080", unitName: "计算机学院" },
    },
  };
  process.env.FRIENDS_HOME = root;
  try {
    await saveSession(session, "file");
    assert.equal((await stat(root)).mode & 0o777, 0o700);
    assert.equal((await stat(join(root, "session.json"))).mode & 0o777, 0o600);
    const loaded = await loadSession();
    assert.equal(loaded.token, "file-token");

    await writeFile(join(root, "session.json"), "null\n");
    await assert.rejects(
      () => loadSession(),
      (error) => error.code === "NETWORK_PROTOCOL_ERROR",
    );

    const broad = join(parent, "broad-state");
    await mkdir(broad, { mode: 0o755 });
    process.env.FRIENDS_HOME = broad;
    await assert.rejects(
      () => saveSession(session, "file"),
      (error) => error.code === "INVALID_INPUT",
    );
    assert.equal((await stat(broad)).mode & 0o777, 0o755);
  } finally {
    delete process.env.FRIENDS_HOME;
    await rm(parent, { recursive: true, force: true });
  }
});
