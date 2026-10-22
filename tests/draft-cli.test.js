import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { chmod, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { saveSession } from "../dist/node.js";

const execFileAsync = promisify(execFile);
const run = (file, args, options = {}) => execFileAsync(file, args, { timeout: 20_000, ...options });

function reply(res, body) {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function quote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

test("real CLI creates, edits, restores, checks, and conflicts-saves local drafts", async (t) => {
  const requests = [];
  const server = createServer((req, res) => {
    if (req.url.endsWith("/checkUserAndGetUserLevel")) {
      return reply(res, { code: "0", data: { loginLevels: [{ levelNo: "XS", levelName: "学生", units: [{ unitType: 2, unitNo: "24080", unitName: "计算机学院" }] }], userLoginType: "STUDENT" } });
    }
    if (req.url.endsWith("/user/info")) return reply(res, { code: "0", data: { userNo: "20210001", userName: "示例" } });
    if (req.url.endsWith("/common-business/query-student?studentNo=20210002")) return reply(res,{code:"0",data:{studentNo:"20210002",studentName:"示例志愿者"}});
    if (req.url.endsWith("/school-activity-apply/manager-activity-list")) {
      requests.push({ method: req.method, url: req.url });
      return reply(res, { code: "0", data: [{ uuid: "activity-1", name: "迎新志愿服务" }] });
    }
    if (req.url.endsWith("/school-activity-apply/approve-detail/activity-1")) {
      requests.push({ method: req.method, url: req.url });
      return reply(res, { code: "0", data: { uuid: "activity-1", activityName: "迎新志愿服务", organizationId: "org-1", organizationName: "示例青协", positionSetMethod: "TIME", posts: [{ uuid: "post-1", postName: "引导岗", duration: 2.5 }] } });
    }
    if (req.url.endsWith("/schoolActivityStudentApply/apply-list-by-activity/activity-1")) {
      requests.push({ method: req.method, url: req.url });
      return reply(res, { code: "0", data: [{ uuid: "registration-1", studentNo: "20210001", studentName: "示例学生", postId: "post-1", postName: "引导岗", postDuration: 2.5, signDuration: null, isApply: true, isAttestation: true }] });
    }
    requests.push({ method: req.method, url: req.url });
    res.writeHead(404); res.end("{}");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });

  const home = join(tmpdir(), `friends-draft-cli-${Date.now()}`);
  const draftRoot = join(home, "drafts");
  await mkdir(draftRoot, { recursive: true, mode: 0o700 });
  const material = join(home, "material.pdf");
  await writeFile(material, "fixture-material", { mode: 0o600 });
  const materialInput = join(home, "materials.json");
  await writeFile(materialInput, `${JSON.stringify({ materials: [{ kind: "local-file", path: material }] })}\n`, { mode: 0o600 });
  const previousHome = process.env.FRIENDS_HOME;
  process.env.FRIENDS_HOME = home;
  await saveSession({
    schemaVersion: 1, loginMethod: "local", storage: "file", token: "token-a", userLevel: "XS",
    account: { userNo: "20210001", userName: "示例" },
    context: { levelNo: "XS", levelName: "学生", unit: { unitType: 2, unitNo: "24080", unitName: "计算机学院" } },
  }, "file");
  if (previousHome === undefined) delete process.env.FRIENDS_HOME; else process.env.FRIENDS_HOME = previousHome;

  const env = {
    ...process.env,
    FRIENDS_HOME: home,
    FRIENDS_DRAFT_HOME: draftRoot,
    FRIENDS_BASE_URL: `http://127.0.0.1:${server.address().port}/gateway`,
  };
  const cli = resolve("dist/cli/main.js");

  const help = await run(process.execPath, [cli, "drafts", "--help"], { env });
  assert.match(help.stdout, /Usage: friends drafts/);
  assert.match(help.stdout, /\b(create|edit|show|validate|check|list)\b/);
  const schema = await run(process.execPath, [cli, "schema", "drafts.create", "--json"], { env });
  const schemaJson = JSON.parse(schema.stdout);
  assert.equal(schemaJson.data.operation, "drafts.create");
  assert.equal(schemaJson.data.remoteReadonly, true);
  assert.equal(schemaJson.data.localWrite, true);

  const created = await run(process.execPath, [cli, "drafts", "create", "--activity-id", "activity-1", "--materials", materialInput, "--json"], { env });
  const createdJson = JSON.parse(created.stdout);
  assert.equal(createdJson.ok, true);
  assert.equal(createdJson.data.draft.revision, 0);
  assert.equal(createdJson.data.draft.binding.accountUserNo, "20210001");
  assert.equal(createdJson.data.draft.activity.posts[0].durationHours, 2.5);
  assert.equal(createdJson.data.draft.materials[0].size, 16);
  assert.equal(created.stdout.includes("token-a"), false);
  const draftId = createdJson.data.draft.id;
  const draftPath = createdJson.data.path;
  assert.equal(JSON.parse(await readFile(draftPath, "utf8")).id, draftId);

  const incomplete = await run(process.execPath, [cli, "drafts", "validate", draftId, "--mode", "complete", "--json"], { env });
  assert.equal(JSON.parse(incomplete.stdout).data.complete, false);

  const editStdin = JSON.stringify({ includedStudentNos: ["20210001"], durations: { "20210001": 2.5 } });
  let edited;
  try {
    edited = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [cli, "drafts", "edit", draftId, "--expected-revision", "0", "--input", "-", "--json"], {env});
      let stdout="", stderr="";
      child.stdout.on("data", data=>stdout+=data); child.stderr.on("data", data=>stderr+=data);
      child.on("error", reject); child.on("close", code=>code===0 ? resolve({stdout,stderr}) : reject(Object.assign(new Error("CLI failed"),{stdout,stderr})));
      child.stdin.end(editStdin);
    });
  } catch (error) {
    throw new Error(`stdin edit failed: ${error.stdout}\n${error.stderr}`);
  }
  assert.equal(JSON.parse(edited.stdout).data.draft.revision, 1);
  const checked = await run(process.execPath, [cli, "drafts", "check", draftId, "--json"], { env });
  assert.deepEqual(JSON.parse(checked.stdout).data, [{ materialId: "material-1", status: "available" }]);
  await writeFile(material, "changed-material", { mode: 0o600 });
  const changed = await run(process.execPath, [cli, "drafts", "check", draftId, "--json"], { env });
  assert.deepEqual(JSON.parse(changed.stdout).data, [{ materialId: "material-1", status: "hash-mismatch" }]);

  const completeInput = join(home, "complete.json");
  await writeFile(completeInput, `${JSON.stringify({ materials: [] })}\n`, { mode: 0o600 });
  const completed = await run(process.execPath, [cli, "drafts", "edit", draftId, "--expected-revision", "1", "--input", completeInput, "--json"], { env });
  assert.equal(JSON.parse(completed.stdout).data.draft.revision, 2);
  const valid = await run(process.execPath, [cli, "drafts", "validate", draftId, "--mode", "complete", "--json"], { env });
  assert.equal(JSON.parse(valid.stdout).data.complete, true);
  const restored = await run(process.execPath, [cli, "drafts", "show", draftId, "--json"], { env });
  assert.equal(JSON.parse(restored.stdout).data.draft.revision, 2);
  const listed = await run(process.execPath, [cli, "drafts", "list", "--json"], { env });
  assert.deepEqual(JSON.parse(listed.stdout).data, [{ id: draftId, revision: 2, activityId: "activity-1", includedCount: 1 }]);

  const beforeConflict = await readFile(draftPath, "utf8");
  await assert.rejects(
    () => run(process.execPath, [cli, "drafts", "edit", draftId, "--expected-revision", "1", "--input", completeInput, "--json"], { env }),
    (error) => {
      assert.equal(error.code, 5);
      assert.match(JSON.parse(error.stdout).error.message, /current revision 2/);
      return true;
    },
  );
  assert.equal(await readFile(draftPath, "utf8"), beforeConflict);
  const conflictFiles = (await readdir(draftRoot)).filter((name) => name.includes(".conflict."));
  assert.ok(conflictFiles.some((name) => name.includes(".conflict.1-2.")), conflictFiles.join(","));

  const beforeInterrupt = await readFile(draftPath, "utf8");
  await assert.rejects(
    () => run("/bin/sh", ["-c", `ulimit -f 0; exec ${quote(process.execPath)} ${quote(cli)} drafts edit ${quote(draftId)} --expected-revision 2 --input ${quote(completeInput)} --json`], { env }),
    () => true,
  );
  assert.equal(await readFile(draftPath, "utf8"), beforeInterrupt);
  assert.equal((await readdir(draftRoot)).some((name) => name.startsWith(".") && name.endsWith(".json")), false);
  const additions = join(home,"additions.json");
  await writeFile(additions, JSON.stringify({addStudentNos:["20210002"],includedStudentNos:["20210002"],postIds:{"20210002":"post-1"},durations:{"20210002":1.5}}));
  const added = JSON.parse((await run(process.execPath,[cli,"drafts","edit",draftId,"--expected-revision","2","--input",additions],{env})).stdout);
  assert.equal(added.data.draft.revision,3);
  assert.equal(added.data.draft.registrations.at(-1).studentName,"示例志愿者");
  assert.equal(added.data.draft.registrations.at(-1).registrationId,null);
  assert.deepEqual(added.data.draft.includedStudentNos,["20210002"]);
  assert.equal(requests.filter((request) => request.method !== "GET").length, 0);
  assert.equal(requests.some((request) => request.url.includes("school-activity-attestation-apply/apply")), false);

  t.after(async () => {
    const { rm } = await import("node:fs/promises");
    await chmod(draftRoot, 0o700);
    await rm(home, { recursive: true, force: true });
  });
});
