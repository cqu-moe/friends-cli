import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chmod, mkdir, readFile, stat } from "node:fs/promises";
import { writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";

const run = promisify(execFile);

function reply(res, body) {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

test("real CLI performs local login, fixed-context activation, storage, and course search", async () => {
  const requests = [];
  let mode = "normal";
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      requests.push({ url: req.url, headers: req.headers, body: body ? JSON.parse(body) : null });
      if (mode === "business") {
        reply(res, { code: "10030", message: "resource unavailable", requestId: "request-cli" });
        return;
      }
      if (mode === "expired") {
        res.writeHead(401, { "content-type": "application/json" });
        res.end("{}");
        return;
      }
      if (req.url === "/gateway/ek-agg-mob/user/checkUserAndGetUserLevel") {
        reply(res, {
          code: "0",
          data: {
            loginLevels: [
              {
                levelNo: "XS",
                levelName: "学生",
                units: [{ unitType: 1, unitNo: "24080", unitName: "计算机学院" }],
              },
            ],
            userLoginType: "STUDENT_UNACTIVATED",
            msg: "",
          },
        });
        return;
      }
      if (req.url === "/gateway/ek-agg-mob/user/info") {
        reply(res, { code: "0", data: { userNo: "20210001", userName: "张三" } });
        return;
      }
      if (req.url === "/gateway/ek-agg-mob/user/enterHall") {
        reply(res, {
          code: "0",
          data: {
            account: "20210001",
            name: "张三",
            userLoginStateLevel: "XS",
            departmentNo: "24080",
            tokenId: "secret-token-id",
          },
        });
        return;
      }
      if (req.url === "/gateway/zovecenter-saip-ek-app-curriculum/mob/apply/student-apply-page-list") {
        reply(res, {
          code: "0",
          data: {
            currentPage: 1,
            pageSize: 2,
            totalCount: 1,
            pages: 1,
            data: [
              {
                uuid: "course-1",
                curriculumName: "周周艺",
                organizationName: "艺术学院",
                curriculumState: "NEW_LIVE_STATE",
                flowOverallState: 7,
                cancelByUserNo: "20219999",
              },
            ],
          },
        });
        return;
      }
      if (req.url === "/gateway/zovecenter-saip-ek-app-curriculum/mob/apply/course-1") {
        reply(res, {
          code: "0",
          data: {
            uuid: "course-1",
            curriculumName: "周周艺",
            organizationName: "艺术学院",
            curriculumState: "NEW_LIVE_STATE",
            roles: [{ uuid: "role-1", integral: 0.5 }],
            approvalRecords: [{ reviewerName: "王五" }],
          },
        });
        return;
      }
      res.writeHead(404);
      res.end("{}");
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  const home = join(tmpdir(), `friends-cli-flow-${Date.now()}`);
  const bin = join(home, "bin");
  await mkdir(bin, { recursive: true });
  const egoBrowser = join(bin, "ego-browser");
  const egoScriptLog = join(home, "ego-script.js");
  await writeFile(
    egoBrowser,
    "#!/bin/sh\ncat > \"$EGO_SCRIPT_LOG\"\ngrep -q 'taskSpace(\"friends-cli local login\")' \"$EGO_SCRIPT_LOG\" || exit 19\nprintf '%s' '{\"token\":\"bridge-token\",\"userLevel\":\"XS\"}'\n",
  );
  await chmod(egoBrowser, 0o700);
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    FRIENDS_BASE_URL: `http://127.0.0.1:${server.address().port}/gateway`,
    FRIENDS_HOME: home,
    EGO_SCRIPT_LOG: egoScriptLog,
  };
  const cli = process.env.FRIENDS_TEST_CLI ?? resolve("dist/cli/main.js");

  const login = await run(
    process.execPath,
    [cli, "auth", "login", "--method", "local", "--storage", "file", "--json"],
    { env },
  );
  const loginJson = JSON.parse(login.stdout);
  assert.equal(login.stderr, "");
  assert.equal(loginJson.ok, true);
  assert.equal(loginJson.data.loginMethod, "local");
  assert.equal(loginJson.data.account.userNo, "20210001");
  assert.equal(loginJson.data.context.unit.unitNo, "24080");
  assert.equal(loginJson.data.context.levelNo, "XS");
  assert.equal(login.stdout.includes("bridge-token"), false);
  assert.equal(login.stdout.includes("secret-token-id"), false);
  const egoScript = await readFile(egoScriptLog, "utf8");
  assert.match(egoScript, /taskSpace\("friends-cli local login"\)/);
  assert.doesNotMatch(egoScript, /taskSpace\(12\)/);
  assert.match(egoScript, /task\.finish\(\{ keep: \[\] \}\)/);

  const sessionPath = join(home, "session.json");
  const sessionStat = await stat(sessionPath);
  const homeStat = await stat(home);
  assert.equal(sessionStat.mode & 0o777, 0o600);
  assert.equal(homeStat.mode & 0o777, 0o700);
  const stored = JSON.parse(await readFile(sessionPath, "utf8"));
  assert.equal(stored.token, "bridge-token");

  const status = await run(process.execPath, [cli, "auth", "status", "--json"], { env });
  const statusJson = JSON.parse(status.stdout);
  assert.equal(statusJson.data.account.userNo, "20210001");
  assert.equal(statusJson.data.context.unit.unitNo, "24080");
  assert.equal(status.stdout.includes("bridge-token"), false);

  const courses = await run(
    process.execPath,
    [cli, "courses", "list", "--page", "1", "--page-size", "2", "--keyword", "周周艺", "--json"],
    { env },
  );
  const courseJson = JSON.parse(courses.stdout);
  assert.equal(courseJson.data.items[0].name, "周周艺");
  assert.equal(courseJson.data.items[0].state.raw, "NEW_LIVE_STATE");
  assert.equal(courseJson.data.items[0].state.known, false);
  assert.equal(courseJson.data.totalCount, 1);
  assert.equal(courseJson.meta.via, "api");
  assert.equal(courseJson.stdout === undefined, true);
  assert.equal(JSON.stringify(courseJson).includes("20219999"), false);

  const detail = await run(process.execPath, [cli, "courses", "show", "course-1", "--json"], { env });
  const detailJson = JSON.parse(detail.stdout);
  assert.equal(detailJson.data.name, "周周艺");
  assert.deepEqual(detailJson.data.roles, [{ uuid: "role-1", integral: 0.5 }]);
  assert.equal(JSON.stringify(detailJson).includes("reviewerName"), false);

  const enter = requests.find(
    (request) => request.url === "/gateway/ek-agg-mob/user/enterHall",
  );
  assert.deepEqual(enter.body, {
    departNo: "24080",
    userStateLevel: "XS",
    userType: "STUDENT",
  });
  assert.equal(enter.headers["h-zove-token"], "bridge-token");
  const courseRequest = requests.find((request) =>
    request.url.endsWith("student-apply-page-list"),
  );
  assert.equal(courseRequest.body.key, "周周艺");
  assert.equal(courseRequest.headers["h-zove-userlevel"], "XS");

  mode = "business";
  await assert.rejects(
    () => run(process.execPath, [cli, "courses", "list", "--json"], { env }),
    (error) => {
      const output = JSON.parse(error.stdout);
      assert.equal(error.code, 5);
      assert.equal(output.error.code, "BUSINESS_REJECTED");
      assert.equal(output.error.upstreamCode, "10030");
      assert.equal(error.stdout.includes("bridge-token"), false);
      return true;
    },
  );
  mode = "expired";
  await assert.rejects(
    () => run(process.execPath, [cli, "courses", "list", "--json"], { env }),
    (error) => {
      const output = JSON.parse(error.stdout);
      assert.equal(error.code, 3);
      assert.equal(output.error.code, "AUTH_REQUIRED");
      assert.equal(output.error.nextAction, "friends auth login --method local");
      return true;
    },
  );
  server.closeAllConnections();
  server.close();
});
