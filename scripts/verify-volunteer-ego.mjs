import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  prepareVolunteerRegistrationInEgo,
  prepareVolunteerWithdrawalInEgo,
} from "../dist/node.js";

const mode = process.argv[2] ?? "register";
const taskSpaceId = 7;
if (!["register", "withdraw"].includes(mode)) {
  console.error("usage: node scripts/verify-volunteer-ego.mjs register|withdraw");
  process.exit(2);
}

const fixtureRoot = new URL("../tests/fixtures/", import.meta.url);
const fixtureName = mode === "register"
  ? "volunteer-apply-fixture.html"
  : "volunteer-withdraw-fixture.html";
const fixture = await readFile(new URL(fixtureName, fixtureRoot), "utf8");
const activity = {
  uuid: "activity-1",
  activityName: "示例志愿活动",
  organizationName: "示例组织",
  activityType: "SCHOOL",
  activityTypeName: "校内活动",
  activityCategory: "SCHOOL_ACTIVITY",
  activityPlace: "示例地点",
  beginTime: "2099-01-01 10:00",
  endTime: "2099-01-01 12:00",
  openTime: "2000-01-01 10:00",
  deadline: "2999-01-01 10:00",
  isOpenEnrollment: true,
  activityState: "ENROLLING",
  studentApplied: null,
  questionnaires: [
    { uuid: "question-text", activityId: "activity-1", title: "为什么参加", itemType: "TEXT", isMandatory: true, options: [] },
    { uuid: "question-choice", activityId: "activity-1", title: "是否同意服务安排", itemType: "CHOICE", isMandatory: false, options: [{ uuid: "option-a", optionName: "选项A" }] },
    { uuid: "question-multiple", activityId: "activity-1", title: "可携带物品", itemType: "MULTIPLE_CHOICE", isMandatory: false, options: [{ uuid: "option-b", optionName: "选项B" }, { uuid: "option-c", optionName: "选项C" }] },
    { uuid: "question-number", activityId: "activity-1", title: "服务人数", itemType: "NUMBER", isMandatory: false, options: [] },
  ],
};
const registration = {
  uuid: "registration-1",
  activityId: "activity-1",
  studentNo: "20210001",
  postId: "post-1",
  postName: "签到岗",
  postDuration: 2,
  flowOverallState: 7,
  flowCurrMsg: "审核通过",
};
const actualWriteRequests = [];

function reply(response, body) {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

const pagePath = mode === "register"
  ? "/mobile/volunteerManage/campusActivityApplyDetail"
  : "/mobile/volunteerManage/campusActivityInfo";
const server = createServer((request, response) => {
  let body = "";
  request.on("data", (chunk) => (body += chunk));
  request.on("end", () => {
    if (request.url === "/write" || request.url === "/quit") {
      actualWriteRequests.push({ method: request.method, url: request.url });
      response.destroy();
      return;
    }
    if (request.url.startsWith("/mobile/")) {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(fixture);
      return;
    }
    if (request.url.endsWith("/checkUserAndGetUserLevel")) {
      return reply(response, { code: "0", data: { loginLevels: [{ levelNo: "XS", levelName: "学生", units: [{ unitType: 2, unitNo: "unit-a", unitName: "示例学院" }] }], userLoginType: "STUDENT" } });
    }
    if (request.url.endsWith("/user/info")) return reply(response, { code: "0", data: { userNo: "20210001", userName: "张三" } });
    if (request.url.endsWith("/enterHall")) return reply(response, { code: "0", data: { account: "20210001", name: "张三", userLoginStateLevel: "XS", departmentNo: "unit-a" } });
    if (request.url.endsWith("/school-activity-apply/approve-detail/activity-1")) return reply(response, { code: "0", data: activity });
    if (request.url.endsWith("/school-activity-apply/post/activity-1")) return reply(response, { code: "0", data: [{ uuid: "post-1", postName: "签到岗", duration: 2 }] });
    if (request.url.endsWith("/schoolActivityStudentApply/can-apply/activity-1")) return reply(response, { code: "0", data: true });
    if (request.url.endsWith("/schoolActivityStudentApply/registration-1")) return reply(response, { code: "0", data: registration });
    return reply(response, { code: "0", data: null });
  });
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const root = await mkdtemp(join(tmpdir(), "friends-volunteer-verify-"));
const url = `http://127.0.0.1:${server.address().port}${pagePath}?uuid=activity-1`;
const configPath = join(root, "ego.json");
const resultPath = join(root, "observed.json");
const scriptLogPath = join(root, "ego-script.js");
const errorLogPath = join(root, "ego-error.log");
const commandPath = join(root, "ego-browser");
await writeFile(configPath, JSON.stringify({
  html: new URL(fixtureName, fixtureRoot).pathname,
  result: resultPath,
  url,
  token: "ego-fixture-token",
  accountUserNo: "20210001",
}));
await writeFile(commandPath, [
  "#!/bin/sh",
  `cat > ${JSON.stringify(scriptLogPath)}`,
  `exec ${JSON.stringify(process.execPath)} -e 'await import(${JSON.stringify(new URL("strict-ego.mjs", fixtureRoot).href)})' < ${JSON.stringify(scriptLogPath)} 2> ${JSON.stringify(errorLogPath)}`,
  "",
].join("\n"));
await chmod(commandPath, 0o700);
process.env.FRIENDS_EGO_FIXTURE_CONFIG = configPath;

try {
  const common = {
    activityId: "activity-1",
    taskSpaceId,
    baseUrl: `http://127.0.0.1:${server.address().port}/gateway`,
    command: commandPath,
    timeoutMs: 5000,
    schoolTimeoutMs: 1000,
  };
  const result = mode === "register"
    ? await prepareVolunteerRegistrationInEgo({
      ...common,
      input: {
        postId: "post-1",
        questionnaireAnswers: [
          { itemUuid: "question-text", type: "TEXT", inputContent: "受控验收答案" },
          { itemUuid: "question-choice", type: "CHOICE", optionUuid: "option-a" },
          { itemUuid: "question-multiple", type: "MULTIPLE_CHOICE", optionUuids: ["option-b", "option-c"] },
          { itemUuid: "question-number", type: "NUMBER", inputContent: "3" },
        ],
      },
    })
    : await prepareVolunteerWithdrawalInEgo({ ...common, registrationId: "registration-1" });
  const observed = JSON.parse(await readFile(resultPath, "utf8"));
  const preparationWriteRequests = actualWriteRequests.length;
  console.log(JSON.stringify({
    ...result,
    controlledPage: observed,
    preparationWriteRequests,
    actualWriteRequests,
  }, null, 2));
  if (preparationWriteRequests !== 0 || observed.finalRequests !== 0 || observed.handoffs !== 1) {
    process.exitCode = 3;
  }
} catch (error) {
  console.error(error);
  try {
    console.error(await readFile(errorLogPath, "utf8"));
    console.error(await readFile(scriptLogPath, "utf8"));
  } catch {}
  process.exitCode = 1;
} finally {
  await rm(root, { recursive: true, force: true });
  server.closeAllConnections();
  server.close();
}
