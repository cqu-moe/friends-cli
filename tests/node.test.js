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


test("default keyring stores isolated secrets or fails without a file fallback", {timeout:15000}, async () => {
  const {mkdtemp,realpath}=await import("node:fs/promises");
  const {createHash}=await import("node:crypto");
  const parent=await mkdtemp(join(tmpdir(),"friends-keyring-test-"));
  const previousHome=process.env.FRIENDS_HOME;
  const previousBus=process.env.DBUS_SESSION_BUS_ADDRESS;
  const homes=[join(parent,"one"),join(parent,"two")];
  const session={schemaVersion:1,loginMethod:"local",storage:"keyring",token:"synthetic-one",userLevel:"XS",account:{userNo:"fixture",userName:"示例"},context:{levelNo:"XS",levelName:"学生",unit:{unitNo:"unit",unitName:"院系",unitType:2}}};
  const written=[];
  try {
    process.env.FRIENDS_HOME=homes[0];
    if (process.platform==="linux") {
      process.env.DBUS_SESSION_BUS_ADDRESS="unix:path=/nonexistent/friends-keyring-test";
      await assert.rejects(()=>saveSession(session),e=>e.code==="AUTH_REQUIRED");
      await assert.rejects(()=>readFile(join(homes[0],"session.json")),e=>e.code==="ENOENT");
    } else if(process.platform==="darwin") {
      for (let i=0;i<homes.length;i++) {
        process.env.FRIENDS_HOME=homes[i];
        await saveSession({...session,token:`synthetic-${i}`});written.push(homes[i]);
        const metadata=JSON.parse(await readFile(join(homes[i],"session.json"),"utf8"));
        assert.equal(metadata.storage,"keyring");assert.ok(!metadata.token);
      }
      for (let i=0;i<homes.length;i++) {
        process.env.FRIENDS_HOME=homes[i];assert.equal((await loadSession()).token,`synthetic-${i}`);
      }
    } else {
      await assert.rejects(()=>saveSession(session),e=>e.code==="INVALID_INPUT");
    }
  } finally {
    if(written.length) {
      const {Entry}=await import("@napi-rs/keyring");
      for (const home of written) new Entry("friends-cli","local-session:"+createHash("sha256").update(await realpath(home)).digest("hex")).deletePassword();
    }
    if(previousHome===undefined) delete process.env.FRIENDS_HOME; else process.env.FRIENDS_HOME=previousHome;
    if(previousBus===undefined) delete process.env.DBUS_SESSION_BUS_ADDRESS; else process.env.DBUS_SESSION_BUS_ADDRESS=previousBus;
    await rm(parent,{recursive:true,force:true});
  }
});
