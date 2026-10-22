import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { saveSession, prepareVolunteerOfferingInEgo } from "../dist/node.js";
import { offeringInput, offeringSchool, offeringSession } from "./fixtures/volunteer-offering-api.mjs";
import { setupOfferingEgo } from "./fixtures/volunteer-offering-ego.mjs";

const execFileAsync = promisify(execFile);

function run(cli, env, args, input) {
  if (input === undefined) return execFileAsync(process.execPath, [cli, ...args], { timeout: 30_000, env });
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { env });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (chunk) => stdout += chunk);
    child.stderr.on("data", (chunk) => stderr += chunk);
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolveRun({ stdout, stderr }) : reject(Object.assign(new Error("CLI failed"), { code, stdout, stderr })));
    child.stdin.end(input);
  });
}

async function sessionHome() {
  const home = await mkdtemp(join(tmpdir(), "friends-offering-cli-"));
  const previous = process.env.FRIENDS_HOME;
  process.env.FRIENDS_HOME = home;
  await saveSession({ ...offeringSession, schemaVersion: 1, loginMethod: "local", storage: "file" }, "file");
  if (previous === undefined) delete process.env.FRIENDS_HOME; else process.env.FRIENDS_HOME = previous;
  return home;
}

test("real CLI validates file/stdin input, uploads, submits, and queries status through the SDK", async (t) => {
  const upstream = await offeringSchool(t);
  const home = await sessionHome();
  const material = join(home, "banner.png");
  await writeFile(material, new Uint8Array([1, 2, 3]), { mode: 0o600 });
  const raw = offeringInput();
  raw.materials = { publicityPictures: [{ path: material }] };
  const inputPath = join(home, "offering.json");
  await writeFile(inputPath, `${JSON.stringify(raw)}\n`, { mode: 0o600 });
  const env = { ...process.env, FRIENDS_HOME: home, FRIENDS_BASE_URL: upstream.baseUrl };
  const cli = resolve("dist/cli/main.js");
  const help = await run(cli, env, ["offerings", "--help"]);
  assert.match(help.stdout, /Validate an offering|Upload validated offering materials/);
  const schema = JSON.parse((await run(cli, env, ["schema", "offerings.submit", "--json"])).stdout);
  assert.equal(schema.data.submittedViaEgo, "never");
  assert.equal(schema.data.input.publicityGroupUuid.required === "for confirmed submission", true);

  const preparedStdin = JSON.parse((await run(cli, env, ["offerings", "prepare", "--input", "-", "--via", "api", "--json"], JSON.stringify(raw))).stdout);
  assert.equal(preparedStdin.ok, true);
  assert.equal(preparedStdin.data.payload.organizationId, "org-1");
  assert.equal(preparedStdin.data.payload.applyReason, undefined);

  await assert.rejects(() => run(cli, env, ['offerings','prepare','--input','-','--via','api','--json'], JSON.stringify({...raw,registration:{...raw.registration,isEnrollExamine:'true'}})), error => error.code===2 && JSON.parse(error.stdout).error.code==='INVALID_INPUT');
  const beforeUploads = upstream.state.uploads.length;
  await assert.rejects(() => run(cli, env, ["offerings", "materials", "--input", inputPath, "--via", "api", "--json"]), (error) => {
    assert.equal(error.code, 2); assert.equal(JSON.parse(error.stdout).error.code, "INVALID_INPUT"); return true;
  });
  assert.equal(upstream.state.uploads.length, beforeUploads);
  const dryMaterials = JSON.parse((await run(cli, env, ["offerings", "materials", "--input", inputPath, "--via", "api", "--dry-run", "--json"])).stdout);
  assert.equal(dryMaterials.data.uploaded, false);
  assert.equal(upstream.state.uploads.length, beforeUploads);
  const materials = JSON.parse((await run(cli, env, ["offerings", "materials", "--input", inputPath, "--via", "api", "--confirm", "--json"])).stdout);
  assert.equal(materials.data.state, "complete");
  const publicityGroupUuid = materials.data.publicityPictures.groupUuid;

  await assert.rejects(() => run(cli, env, ["offerings", "submit", "--input", inputPath, "--via", "ego", "--publicity-group-uuid", publicityGroupUuid, "--confirm", "--json"]), (error) => {
    assert.equal(error.code, 2); assert.match(error.stderr, /Ego requires human final submission/); return true;
  });
  const submitDry = JSON.parse((await run(cli, env, ["offerings", "submit", "--input", inputPath, "--via", "api", "--dry-run", "--json"])).stdout);
  assert.equal(submitDry.data.submitted, false);
  const submitted = JSON.parse((await run(cli, env, ["offerings", "submit", "--input", inputPath, "--via", "api", "--publicity-group-uuid", publicityGroupUuid, "--confirm", "--json"])).stdout);
  assert.equal(submitted.data.applicationId, "intermediate-uuid");
  assert.equal(submitted.data.readback.state, "matched");
  const status = JSON.parse((await run(cli, env, ["offerings", "status", "intermediate-uuid", "--via", "api", "--json"])).stdout);
  assert.equal(status.data.raw.flowOverallState, "FUTURE_STATE");
  assert.equal([submitted, status].some((document) => JSON.stringify(document).includes("fixture-token")), false);
  await (await import("node:fs/promises")).rm(home, { recursive: true, force: true });
});

test("real CLI executes generated Ego preparation, preserves human values, and hands off with zero submits", async (t) => {
  const upstream = await offeringSchool(t);
  const fixture = await setupOfferingEgo(t, { humanName: "人工保留活动", baseUrl: upstream.baseUrl });
  const home = await sessionHome();
  const raw = offeringInput();
  raw.materials = { publicityPictures: [{ path: join(fixture.root, "banner.png") }] };
  await writeFile(join(fixture.root, "banner.png"), new Uint8Array([1]), { mode: 0o600 });
  const inputPath = join(fixture.root, "offering.json");
  await writeFile(inputPath, JSON.stringify(raw), "utf8");
  const env = { ...process.env, FRIENDS_HOME: home, FRIENDS_BASE_URL: upstream.baseUrl, PATH: `${fixture.root}:${process.env.PATH}` };
  const cli = resolve("dist/cli/main.js");
  const dryRun = JSON.parse((await run(cli, env, ["offerings", "prepare", "--input", inputPath, "--via", "ego", "--ego-task-space", "16", "--ego-page", "p1", "--dry-run", "--json"])).stdout);
  assert.equal(dryRun.data.status, "ready");
  assert.equal(dryRun.data.submitted, false);
  assert.equal(dryRun.data.handoff, undefined);
  const dryObserved = await fixture.observed();
  assert.deepEqual(dryObserved.clicks, []);
  assert.deepEqual(dryObserved.fills, []);
  assert.equal(dryObserved.handoffs, 0);
  assert.equal(dryObserved.submits, 0);
  const prepared = JSON.parse((await run(cli, env, ["offerings", "prepare", "--input", inputPath, "--via", "ego", "--ego-task-space", "16", "--ego-page", "p1", "--json"])).stdout);
  assert.equal(prepared.data.status, "awaiting-user");
  assert.equal(prepared.data.submitted, false);
  assert.equal(prepared.data.handoff, "completed");
  assert.ok(prepared.data.actions.some((action) => action.field === "活动名称" && action.action === "human-value-preserved"));
  assert.ok(prepared.data.missing.includes("materials:publicityPictures"));
  const observed = await fixture.observed();
  assert.ok(prepared.data.page.fields.some(field=>field.name==="活动联系人"&&field.value==="人工联系人"));
  assert.ok(prepared.data.page.fields.some(field=>field.name==="活动开始时间"&&field.value==="2026-11-02 09:00"));
  assert.equal(observed.submits, 0);
  assert.equal(observed.handoffs, 1);
  assert.equal(observed.navigations, 0);
  assert.equal(observed.clicks.some((click) => click.includes("下一步") || click.includes("提交申请")), false);
  assert.match(observed.html, /人工保留活动/);
  assert.ok(prepared.data.page.fields.some((field) => field.name === "活动名称" && field.value === "人工保留活动"));
  upstream.state.stored = { uuid: "intermediate-uuid", flowOverallState: "FUTURE_STATE" };

  assert.ok(prepared.data.page.fields.some((field) => field.name === "活动地点" && field.value === "虚构图书馆"));
  const egoStatus = JSON.parse((await run(cli, env, ["offerings", "status", "intermediate-uuid", "--via", "ego", "--ego-task-space", "16", "--ego-page", "p1", "--json"])).stdout);
  assert.equal(egoStatus.meta.selectedEntry, "ego");
  assert.equal(egoStatus.meta.requestMode, "direct-api");
  assert.equal(egoStatus.data.applicationId, "intermediate-uuid");

  await (await import("node:fs/promises")).rm(home, { recursive: true, force: true });
});


test("public Node SDK visibly prepares actual iframe controls, preserves user values, and never submits", async (t) => {
  const upstream = await offeringSchool(t);
  const fixture = await setupOfferingEgo(t, {humanName:"人工活动名称",baseUrl:upstream.baseUrl});
  const result = await prepareVolunteerOfferingInEgo({value:offeringInput(),taskSpaceId:16,page:"p1",baseUrl:upstream.baseUrl,command:fixture.command});
  assert.equal(result.submitted,false);
  assert.equal(result.executionError,null);
  assert.ok(result.actions.some(a=>a.field==="活动名称"&&a.action==="human-value-preserved"));
  assert.ok(result.actions.some(a=>a.field==="活动联系人"&&a.action==="human-value-preserved"));
  assert.equal(result.page.fields.find(f=>f.name==="活动结束时间").value,"2026-11-02 12:00");
  const seen=await fixture.observed();assert.equal(seen.submits,0);assert.equal(seen.handoffs,1);
  await assert.rejects(()=>prepareVolunteerOfferingInEgo({value:offeringInput(),taskSpaceId:0,baseUrl:upstream.baseUrl,command:fixture.command}),e=>e.code==="INVALID_INPUT");
});


test("real CLI preserves UNKNOWN_OUTCOME after lost material response, with no repeat upload",async t=>{
 const upstream=await offeringSchool(t);upstream.state.lostUploadNames=["banner.png"];
 const home=await sessionHome();t.after(()=>import("node:fs/promises").then(fs=>fs.rm(home,{recursive:true,force:true})));
 const raw=offeringInput();const path=join(home,"banner.png");await writeFile(path,new Uint8Array([1]));raw.materials={publicityPictures:[{path}]};
 const env={...process.env,FRIENDS_HOME:home,FRIENDS_BASE_URL:upstream.baseUrl};
 await assert.rejects(()=>run(resolve("dist/cli/main.js"),env,["offerings","materials","--input","-","--via","api","--confirm","--json"],JSON.stringify(raw)),e=>{assert.equal(e.code,7);const out=JSON.parse(e.stdout);assert.equal(out.error.code,"UNKNOWN_OUTCOME");return true;});
 assert.equal(upstream.state.uploads.length,1);
});
