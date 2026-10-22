import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";

const execFileAsync = promisify(execFile);

function reply(res, body) {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function identity(res) {
  reply(res, { code: "0", data: { loginLevels: [{ levelNo: "XS", levelName: "学生", units: [{ unitType: 2, unitNo: "24080", unitName: "示例学院" }] }], userLoginType: "STUDENT" } });
}

test("real CLI queries organizations, prepares visibly in Ego, and confirms API profile writes", async (t) => {
  const requests = [];
  let profile = {
    uuid: "org-cli",
    organizationName: "CLI示例组织",
    organizationType: "STUDENT_CLUB",
    responsiblePerson: "20210001",
    currentUserIsManager: true,
    logo: "logo-old",
    backgroundGroupUuid: "background-old",
    blurb: "旧简介",
    internalField: "school-value",
  };
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      requests.push({ method: req.method, url: req.url, body: body ? JSON.parse(body) : null });
      if (req.url.endsWith("/checkUserAndGetUserLevel")) return identity(res);
      if (req.url.endsWith("/user/info")) return reply(res, { code: "0", data: { userNo: "20210001", userName: "示例学生" } });
      if (req.url.endsWith("/enterHall")) return reply(res, { code: "0", data: { account: "20210001", name: "示例学生", userLoginStateLevel: "XS", departmentNo: "24080" } });
      if (req.url.endsWith("/student-organization-info/my")) {
        return reply(res, { code: "0", data: [{ uuid: "org-cli", organizationName: "CLI示例组织", organizationType: "STUDENT_CLUB", responsiblePerson: "20210001", currentUserIsManager: true }] });
      }
      if (req.method === "GET" && req.url.endsWith("/student-organization-info/org-cli")) {
        return reply(res, { code: "0", data: profile });
      }
      if (req.method === "POST" && req.url.endsWith("/student-organization-apply/organizational-members-list")) {
        return reply(res, { code: "0", data: { currentPage: 1, pageSize: 10, totalCount: 1, pages: 1, data: [{ uuid: "member-cli", studentNo: "20210002", studentName: "CLI成员", postName: "成员" }] } });
      }
      if (req.method === "PUT" && req.url.endsWith("/student-organization-info")) {
        profile = { ...profile, ...JSON.parse(body) };
        return reply(res, { code: "0", message: "saved" });
      }
      return reply(res, { code: "0", data: {} });
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });

  const home = await mkdtemp(join(tmpdir(), "friends-org-cli-"));
  const egoRoot = await mkdtemp(join(tmpdir(), "friends-org-ego-"));
  const sessionPath = join(home, "session.json");
  await writeFile(sessionPath, JSON.stringify({
    schemaVersion: 1,
    loginMethod: "local",
    storage: "file",
    token: "cli-token",
    userLevel: "XS",
    account: { userNo: "20210001", userName: "示例学生" },
    context: { levelNo: "XS", levelName: "学生", unit: { unitType: 2, unitNo: "24080", unitName: "示例学院" } },
  }) + "\n", { mode: 0o600 });
  await chmod(sessionPath, 0o600);
  const baseUrl = `http://127.0.0.1:${server.address().port}/gateway`;
  async function egoFixture(mode) {
    const root = await mkdtemp(join(tmpdir(), `friends-org-ego-${mode}-`));
    const scriptPath = join(root, "ego-script.js");
    const evidencePath = join(root, "evidence.json");
    const runner = new URL("./fixtures/ego-organization-page.mjs", import.meta.url).href;
    const ego = join(root, "ego-browser");
    await writeFile(ego, [
      "#!/bin/sh",
      `cat > ${JSON.stringify(scriptPath)}`,
      `EGO_ORGANIZATION_FIXTURE_MODE=${JSON.stringify(mode)}`,
      `EGO_ORGANIZATION_SCRIPT_PATH=${JSON.stringify(scriptPath)}`,
      `EGO_ORGANIZATION_EVIDENCE_PATH=${JSON.stringify(evidencePath)}`,
      "export EGO_ORGANIZATION_FIXTURE_MODE EGO_ORGANIZATION_SCRIPT_PATH EGO_ORGANIZATION_EVIDENCE_PATH",
      `exec ${JSON.stringify(process.execPath)} -e 'await import(${JSON.stringify(runner)})'`,
      "",
    ].join("\n"), { mode: 0o700 });
    await chmod(ego, 0o700);
    return { root, scriptPath, evidencePath, env: { PATH: `${root}:${process.env.PATH}` } };
  }
  const cleanEgo = await egoFixture("clean");
  const env = {
    ...process.env,
    PATH: cleanEgo.env.PATH,
    FRIENDS_HOME: home,
    FRIENDS_BASE_URL: baseUrl,
  };
  const cli = process.env.FRIENDS_TEST_CLI ?? join(process.cwd(), "dist/cli/main.js");
  const run = (args, options = {}) => options.input === undefined ? execFileAsync(process.execPath, [cli, ...args], {
    timeout: 20_000,
    ...options,
    env: { ...env, ...options.env },
  }) : new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      timeout: 20_000,
      ...options,
      env: { ...env, ...options.env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => stdout += chunk);
    child.stderr.on("data", (chunk) => stderr += chunk);
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(Object.assign(new Error("CLI failed"), { code, stdout, stderr }));
    });
    child.stdin.end(options.input);
  });

  const help = await run(["organizations", "--help"]);
  assert.match(help.stdout, /managed student organizations/);
  const schema = JSON.parse((await run(["schema", "organizations.profile.save", "--json"])).stdout);
  assert.equal(schema.data.readonly, false);
  assert.equal(schema.data.confirmation, "requires independent --via api and --yes");
  assert.equal(schema.data.input.via.required, true);
  assert.deepEqual(schema.data.input.changes, ["logo", "backgroundGroupUuid", "blurb"]);
  assert.equal(schema.data.submittedViaEgo, "never");

  const list = JSON.parse((await run(["organizations", "list", "--json"])).stdout);
  assert.equal(list.data.items[0].id, "org-cli");
  assert.equal(list.data.items[0].access, "principal");
  assert.equal(list.meta.requestMode, "direct-api");

  const members = JSON.parse((await run(["organizations", "members", "org-cli", "--page", "2", "--page-size", "5", "--keyword", "成员", "--post-uuid", "post", "--manager-only", "--json"])).stdout);
  assert.equal(members.data.items[0].name, "CLI成员");
  assert.equal(members.meta.operation, "organizations.members.list");

  const shownProfile = JSON.parse((await run(["organizations", "profile", "show", "org-cli", "--json"])).stdout);
  assert.equal(shownProfile.data.id, "org-cli");
  assert.equal(shownProfile.data.blurb, "旧简介");
  assert.equal(shownProfile.meta.operation, "organizations.profile.show");

  const prepared = JSON.parse((await run([
    "organizations", "profile", "prepare", "org-cli", "--via", "ego",
    "--ego-task-space", "16", "--ego-page", "p1", "--blurb", "Ego新简介", "--json",
  ])).stdout);
  assert.equal(prepared.data.status, "awaiting-user");
  assert.equal(prepared.data.submitted, false);
  assert.equal(prepared.data.editRoute.path, "/groupManage/studentClubEdit");
  assert.equal(prepared.meta.requestMode, "visible-ego-prepare");
  assert.equal(prepared.data.ego.blurbAction, "filled");
  assert.equal(prepared.data.ego.externalWriteActions, 0);
  assert.equal(prepared.data.ego.finalSubmitActions, 0);
  const egoScript = await readFile(cleanEgo.scriptPath, "utf8");
  assert.match(egoScript, /task\.handOff\(\)/);
  assert.match(egoScript, /组织简介及Logo/);
  assert.match(egoScript, /Ego新简介/);
  for (const forbidden of [
    /page\.locator\(/,
    /page\.getByText\(/,
    /\.first\(\)/,
    /\.last\(\)/,
    /waitForTimeout\(/,
    /保存/,
  ]) assert.doesNotMatch(egoScript, forbidden);
  const cleanEvidence = JSON.parse(await readFile(cleanEgo.evidencePath, "utf8"));
  assert.equal(cleanEvidence.gotoCount, 1);
  assert.equal(cleanEvidence.snapshotCount >= 1, true);
  assert.deepEqual(cleanEvidence.clickSelectors, ["@7"]);
  assert.deepEqual(cleanEvidence.fillSelectors, ["textarea[data-friends-cli-blurb]"]);
  assert.equal(cleanEvidence.inputEvents, 1);
  assert.equal(cleanEvidence.changeEvents, 1);
  assert.equal(cleanEvidence.dialogOpen, true);
  assert.equal(cleanEvidence.waitForTimeoutCount, 0);
  assert.equal(cleanEvidence.externalWrites, 0);
  assert.equal(cleanEvidence.finalSubmitActions, 0);
  assert.equal(cleanEvidence.finalValue, "Ego新简介");

  const dirtyEgo = await egoFixture("dirty");
  const preserved = JSON.parse((await run([
    "organizations", "profile", "prepare", "org-cli", "--via", "ego",
    "--ego-task-space", "16", "--ego-page", "p1", "--blurb", "脚本想覆盖", "--json",
  ], { env: dirtyEgo.env })).stdout);
  assert.equal(preserved.data.status, "awaiting-user");
  assert.equal(preserved.data.ego.blurbAction, "human-value-preserved");
  const dirtyEvidence = JSON.parse(await readFile(dirtyEgo.evidencePath, "utf8"));
  assert.equal(dirtyEvidence.gotoCount, 0);
  assert.equal(dirtyEvidence.snapshotCount >= 1, true);
  assert.deepEqual(dirtyEvidence.clickSelectors, []);
  assert.deepEqual(dirtyEvidence.fillSelectors, []);
  assert.equal(dirtyEvidence.finalValue, "用户正在编辑的简介");
  assert.equal(dirtyEvidence.externalWrites, 0);
  assert.equal(dirtyEvidence.finalSubmitActions, 0);

  const putCountBefore = requests.filter((request) => request.method === "PUT").length;
  await assert.rejects(
    () => run(["organizations", "profile", "save", "org-cli", "--blurb", "新简介", "--json"]),
    (error) => error.code === 2 &&
      JSON.parse(error.stdout).error.code === "INVALID_INPUT" &&
      requests.filter((request) => request.method === "PUT").length === putCountBefore,
  );
  await assert.rejects(
    () => run(["organizations", "profile", "save", "org-cli", "--blurb", "新简介", "--yes", "--json"]),
    (error) => error.code === 2 &&
      JSON.parse(error.stdout).error.code === "INVALID_INPUT" &&
      requests.filter((request) => request.method === "PUT").length === putCountBefore,
  );
  await assert.rejects(
    () => run(["organizations", "profile", "save", "org-cli", "--via", "api", "--input", "-", "--yes", "--json"], {
      input: '{"organizationName":"越权"}',
      env: {},
    }),
    (error) => error.code === 2 && JSON.parse(error.stdout).error.code === "INVALID_INPUT",
  );

  const saved = JSON.parse((await run(["organizations", "profile", "save", "org-cli", "--via", "api", "--input", "-", "--yes", "--json"], {
    input: '{"blurb":"CLI新简介","logo":"logo-new"}',
    env: {},
  })).stdout);
  assert.equal(saved.data.status, "saved");
  assert.equal(saved.data.profile.blurb, "CLI新简介");
  assert.equal(saved.data.submitted, true);
  assert.equal(saved.meta.operation, "organizations.profile.save");
  assert.equal(saved.meta.requestMode, "api-write");
  const put = requests.find((request) => request.method === "PUT");
  assert.equal(put.body.internalField, "school-value");
  assert.equal(put.body.organizationName, "CLI示例组织");
  assert.equal(put.body.blurb, "CLI新简介");

  await rm(home, { recursive: true, force: true });
  await rm(cleanEgo.root, { recursive: true, force: true });
  await rm(dirtyEgo.root, { recursive: true, force: true });
});
