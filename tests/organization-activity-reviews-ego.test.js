import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { prepareOrganizationActivityReviewInEgo } from "../dist/node.js";
import { organizationReviewScenario, organizationReviewSession, offeringInput, registrationInput } from "./fixtures/organization-activity-reviews.mjs";

test("SDK and real CLI visibly prepare source-specific iframe approval popups, preserve human fields and hand off without submission", async t => {
  const root = await mkdtemp(join(tmpdir(), "friends-org-reviews-ego-")); t.after(() => rm(root, { recursive: true, force: true }));
  const command = resolve("tests/fixtures/strict-ego.mjs");
  const bin = join(root, "ego-browser"); await writeFile(bin, `#!/bin/sh\nexec '${process.execPath}' '${command}' "$@"\n`, { mode: 0o755 });
  for (const kind of ["offering", "registration"]) for (const decision of ["pass", "refuse", ...(kind === "offering" ? ["back"] : [])]) for (const mode of ["empty", "human", "dry-run"]) {
    const api = await organizationReviewScenario(); t.after(api.close);
    const input = { ...(kind === "offering" ? offeringInput : registrationInput), decision };
    const title = "审批" + ({ pass: "通过", back: "打回", refuse: "拒绝" }[decision]);
    const html = join(root, "page.html"), config = join(root, "config.json"), result = join(root, "result.json");
    const url = new URL(kind === "offering" ? "/mobile/acManage/auditDetail?uuid=offering-1" : "/mobile/acManage/stuManageSignAuditDetail?uuid=registration-1&acId=offering-1&studentNo=fixture-student&flowCurrMsg=等待审核", api.baseUrl).href;
    await writeFile(html, `<style>.van-popup{display:${mode === "human" ? "block" : "none"}}</style><input name="activityPlace" value="用户保留的活动地点"><div class="btn"><button onclick="openDecision('审批通过')">通过</button>${kind === "offering" ? '<button onclick="openDecision(\'审批打回\')">打回</button>' : ''}<button onclick="openDecision('审批拒绝')">拒绝</button><button onclick="fetch('/unsafe-save',{method:'POST'})">保存</button></div><div class="van-popup"><div class="pop"><div class="title">${title}</div><div class="time"><div>审批时间</div><div>2026-10-23</div></div><div class="advice"><span>审批意见</span><textarea>${mode === "human" ? "用户正在写的审批意见" : ""}</textarea></div><div class="btn_b"><div onclick="document.querySelector('.van-popup').style.display='none'">取消</div><div onclick="fetch('/unsafe-final',{method:'POST'})">确定</div></div></div></div><output id="input-proof"></output><script>function openDecision(title){document.querySelector('.title').textContent=title;document.querySelector('.van-popup').style.display='block'}document.querySelector('textarea').addEventListener('input',e=>document.querySelector('#input-proof').textContent=e.target.value)</script>`);
    await writeFile(config, JSON.stringify({ html, url, outerUrl: new URL("/mobile/main/index", api.baseUrl).href, result, frame: true, executeSession: true, token: "org-review-fixture", userLevel: organizationReviewSession(kind).userLevel }));
    const old = process.env.FRIENDS_EGO_FIXTURE_CONFIG; process.env.FRIENDS_EGO_FIXTURE_CONFIG = config;
    try {
      const prepared = await prepareOrganizationActivityReviewInEgo({ kind, input, taskSpaceId: 8, page: "p2", baseUrl: api.baseUrl, command, dryRun: mode === "dry-run" });
      assert.equal(prepared.submitted, false);
      if (mode !== "dry-run") {
        assert.equal(prepared.handoff, "completed");
        const observed = JSON.parse(await readFile(result, "utf8"));
        assert.equal(observed.submits, 0); assert.equal(observed.handoffs, 1); assert.equal(observed.navigations, 0);
        assert.equal(observed.fills.length, mode === "empty" ? 1 : 0);
        assert.equal(observed.clicks.some(s => s.includes("确定") || s.includes("保存")), false);
        assert.match(observed.html, /用户保留的活动地点/);
        if (mode === "empty") assert.ok(observed.html.includes(`<output id="input-proof">${input.message}</output>`));
        else assert.ok(prepared.manualFields.includes("preserved-human-message"));
      } else {
        const observed = JSON.parse(await readFile(result, "utf8"));
        assert.deepEqual(observed.clicks, []); assert.deepEqual(observed.fills, []); assert.equal(observed.submits, 0); assert.equal(observed.handoffs, 0);
      }
    } finally { if (old === undefined) delete process.env.FRIENDS_EGO_FIXTURE_CONFIG; else process.env.FRIENDS_EGO_FIXTURE_CONFIG = old; }
    const file = join(root, "input.json"); await writeFile(file, JSON.stringify({ message: input.message, time: input.time }));
    const env = { ...process.env, PATH: root + ":" + process.env.PATH, FRIENDS_BASE_URL: api.baseUrl, FRIENDS_EGO_FIXTURE_CONFIG: config, FRIENDS_HOME: root };
    const scope = ["--organization", "org-1", ...(kind === "registration" ? ["--activity", "offering-1"] : [])];
    const executed = await promisify(execFile)(process.execPath, ["dist/cli/main.js", "organization-activities", kind + "-reviews", "prepare", input.id, ...scope, "--decision", decision, "--input", file, "--via", "ego", "--ego-task-space", "8", "--ego-page", "p2", ...(mode === "dry-run" ? ["--dry-run"] : [])], { env });
    assert.equal(executed.stdout.trim().split("\n").length, 1); assert.equal(executed.stderr, "");
    const json = JSON.parse(executed.stdout); assert.equal(json.schemaVersion, 1); assert.equal(json.data.submitted, false);
    assert.equal(json.meta.requestMode, mode === "dry-run" ? "dry-run" : "visible-ego-prepare");
    if (decision === "pass" && mode === "empty") {
      for (const operation of ["list", "show", "verify"]) {
        const read = await promisify(execFile)(process.execPath, ["dist/cli/main.js", "organization-activities", kind + "-reviews", operation, ...(operation === "list" ? [] : [input.id]), ...scope, "--via", "ego", "--ego-task-space", "8", "--ego-page", "p2"], { env });
        const value = JSON.parse(read.stdout);
        assert.equal(read.stderr, ""); assert.equal(value.meta.via, "ego"); assert.equal(value.meta.requestMode, "direct-api");
        assert.equal(operation === "list" ? value.data.items[0].id : value.data.id, input.id);
      }
      const beforeReject = api.requests.length;
      await assert.rejects(() => promisify(execFile)(process.execPath, ["dist/cli/main.js", "organization-activities", kind + "-reviews", "prepare", input.id, ...scope, "--decision", "pass", "--input", file, "--via", "ego", "--ego-task-space", "8", "--yes"], { env }), error => error.code === 2 && JSON.parse(error.stdout).error.code === "INVALID_INPUT");
      assert.equal(api.requests.length, beforeReject);
      await assert.rejects(() => prepareOrganizationActivityReviewInEgo({ kind, input, taskSpaceId: 8, page: "p2", baseUrl: api.baseUrl, command, submit: true }), error => error.code === "INVALID_INPUT");
    }
    assert.equal(api.state.writes, 0); assert.deepEqual(api.violations, []);
  }
});
