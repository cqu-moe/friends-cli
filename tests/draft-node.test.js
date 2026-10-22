import assert from "node:assert/strict";
import { test } from "node:test";
import { chmod, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import {
  createVolunteerCertificationClient,
  createPartialVolunteerCertificationDraft,
  updateVolunteerCertificationDraft,
} from "../dist/index.js";
import { createCertificationDraftStore } from "../dist/node.js";

function reply(res, body) {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

test("volunteer source queries use the verified manager and roster endpoints", async (t) => {
  const requests = [];
  const server = createServer((req, res) => {
    requests.push({ method: req.method, url: req.url, headers: req.headers });
    if (req.url.endsWith("/checkUserAndGetUserLevel")) return reply(res, {code:"0",data:{loginLevels:[{levelNo:"XS",levelName:"学生",units:[{unitType:2,unitNo:"24080",unitName:"示例学院"}]}],userLoginType:"STUDENT"}});
    if (req.url.endsWith("/user/info")) return reply(res, {code:"0",data:{userNo:"20210001",userName:"示例学生"}});
    if (req.url.endsWith("/common-business/query-student?studentNo=20210002")) return reply(res,{code:"0",data:{studentNo:"20210002",studentName:"示例志愿者"}});
    if (req.url.endsWith("/school-activity-apply/manager-activity-list")) {
      return reply(res, {
        code: "0",
        data: [{ uuid: "activity-1", name: "迎新志愿服务" }],
      });
    }
    if (req.url.endsWith("/school-activity-apply/approve-detail/activity-1")) {
      return reply(res, {
        code: "0",
        data: {
            uuid: "activity-1",
            activityName: "迎新志愿服务",
            organizationId: "org-1",
            organizationName: "示例青年志愿者协会",
            positionSetMethod: "TIME",
            posts: [{ uuid: "post-1", postName: "引导岗", duration: 2.5 }],
        },
      });
    }
    if (req.url.endsWith("/schoolActivityStudentApply/apply-list-by-activity/activity-1")) {
      return reply(res, {
        code: "0",
        data: [{
          uuid: "registration-1",
          studentNo: "20210001",
          studentName: "示例学生",
          postId: "post-1",
          postName: "引导岗",
          postDuration: 2.5,
          signDuration: null,
          isApply: true,
          isAttestation: true,
        }],
      });
    }
    res.writeHead(404); res.end("{}");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });

  const client = createVolunteerCertificationClient({
    baseUrl: `http://127.0.0.1:${server.address().port}/gateway`,
    session: { token: "token-a", userLevel: "XS", accountUserNo: "20210001", levelNo: "XS", unitNo: "24080" },
  });
  const activities = await client.listManageableActivities();
  const source = await client.getCertificationSource("activity-1");
  assert.equal(activities[0].id, "activity-1");
  assert.equal(source.activity.posts[0].durationHours, 2.5);
  assert.equal(source.binding.organizationId, "org-1");
  assert.equal(source.registrations[0].postDurationHours, 2.5);
  assert.equal(source.registrations[0].upstreamPreselected, true);
  assert.equal(JSON.stringify(source).includes("token-a"), false);
  assert.deepEqual(
    requests.filter((request) => request.url.includes("/mob/")).map((request) => `${request.method} ${request.url}`),
    [
      "GET /gateway/zovecenter-saip-ek-app-young-volunteers/mob/school-activity-apply/manager-activity-list",
      "GET /gateway/zovecenter-saip-ek-app-young-volunteers/mob/school-activity-apply/manager-activity-list",
      "GET /gateway/zovecenter-saip-ek-app-young-volunteers/mob/school-activity-apply/approve-detail/activity-1",
      "GET /gateway/zovecenter-saip-ek-app-young-volunteers/mob/schoolActivityStudentApply/apply-list-by-activity/activity-1",
    ],
  );
  assert.equal(requests.filter(r=>r.url.includes("/mob/")).every((request) => request.headers["h-zove-appkey"] === "zovecenter-saip-ek-app-young-volunteers"), true);
  assert.deepEqual(await client.getStudent("20210002"), {studentNo:"20210002",studentName:"示例志愿者"});
  const invalid = createVolunteerCertificationClient({
    baseUrl: `http://127.0.0.1:${server.address().port}/gateway`,
    session: { token: "token-a", userLevel: "XS", accountUserNo: "other-account", levelNo: "XS", unitNo: "24080" },
  });
  const before = requests.filter(r=>r.url.includes("/mob/")).length;
  await assert.rejects(()=>invalid.getCertificationSource("activity-1"), e=>e.code==="AUTH_REQUIRED");
  assert.equal(requests.filter(r=>r.url.includes("/mob/")).length, before);

});

test("draft store persists privately, preserves conflicts, and checks material hashes", async (t) => {
  const root = join(tmpdir(), `friends-draft-store-${Date.now()}`);
  const material = join(root, "material.pdf");
  await mkdir(root, { recursive: true, mode: 0o700 });
  const bytes = Buffer.from([0, 128, 255]);
  await writeFile(material, bytes, { mode: 0o600 });
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const store = createCertificationDraftStore({ root });
  const base = createPartialVolunteerCertificationDraft({
    id: "draft-1",
    binding: { accountUserNo: "20210001", levelNo: "XS", unitNo: "24080", organizationId: "org-1", activityId: "activity-1" },
    activity: { id: "activity-1", name: "迎新志愿服务", organizationName: null, positionSetMethod: "TIME", posts: [{ id: "post-1", name: "引导岗", durationHours: 2.5 }] },
    registrations: [{ registrationId: "registration-1", studentNo: "20210001", studentName: "示例学生", postId: "post-1", postName: "引导岗", postDurationHours: 2.5, signDurationHours: null, isApplied: true, upstreamPreselected: true }],
  });
  const path = await store.save(base);
  assert.equal((await stat(root)).mode & 0o777, 0o700);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.equal(JSON.parse(await readFile(path, "utf8")).revision, 0);

  const withSelection = updateVolunteerCertificationDraft(base, {
    includedStudentNos: ["20210001"], durations: { "20210001": 2.5 },
  }, 0);
  await store.save(withSelection);
  const newer = updateVolunteerCertificationDraft(withSelection, { durations: { "20210001": 3 } }, 1);
  await store.save(newer);
  await assert.rejects(
    () => store.save(withSelection),
    (error) => {
      assert.equal(error.name, "DraftRevisionConflictError");
      assert.equal(error.currentRevision, 2);
      assert.match(error.conflictPath, /\.conflict\.0-1\.[^/]+\.json$/);
      return true;
    },
  );
  await assert.rejects(() => store.save(withSelection, {expectedRevision:2}), e=>e.code==="INVALID_INPUT");
  await assert.rejects(() => store.save({...newer,revision:3,binding:{...newer.binding,accountUserNo:"other"}}, {expectedRevision:2}), e=>e.code==="INVALID_INPUT");
  assert.equal((await store.load("draft-1")).revision, 2);
  assert.deepEqual((await store.list()).map((item) => [item.id, item.revision]), [["draft-1", 2]]);

  const withMaterial = updateVolunteerCertificationDraft(newer, {
    materials: [{ kind: "local-file", id: "material-1", path: material, sha256, size: 3 }],
  }, 2);
  await store.save(withMaterial);
  assert.deepEqual(await store.checkMaterials("draft-1"), [{ materialId: "material-1", status: "available" }]);
  await writeFile(material, "changed-material", { mode: 0o600 });
  assert.deepEqual(await store.checkMaterials("draft-1"), [{ materialId: "material-1", status: "hash-mismatch" }]);
  await chmod(root, 0o700);
  t.after(async () => {
    await chmod(root, 0o700);
    const { rm } = await import("node:fs/promises");
    await rm(root, { recursive: true, force: true });
  });
});

test("draft store rejects unsafe patch-conflict IDs before writing", async () => {
  const root = join(tmpdir(), `friends-draft-store-unsafe-${Date.now()}`);
  const store = createCertificationDraftStore({ root });
  await assert.rejects(
    () => store.savePatchConflict("../outside", 0, { includedStudentNos: [] }),
    (error) => error.code === "INVALID_INPUT",
  );
  assert.equal(await readdir(root).then((names) => names.length, () => 0), 0);
});
