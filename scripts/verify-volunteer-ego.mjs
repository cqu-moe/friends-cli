import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { prepareVolunteerRegistrationEgo, prepareVolunteerWithdrawalEgo } from "../dist/volunteer-ego.js";

const root = new URL("../tests/fixtures/", import.meta.url);
const mode = process.argv[2] ?? "register";
const taskSpaceId = Number(process.env.FRIENDS_EGO_TASK_SPACE);
const humanWaitMs = Number(process.env.FRIENDS_EGO_VERIFY_WAIT_MS ?? 0);
if (
  !["register", "withdraw"].includes(mode) ||
  !Number.isInteger(taskSpaceId) || taskSpaceId < 1 ||
  !Number.isInteger(humanWaitMs) || humanWaitMs < 0 || humanWaitMs > 600_000
) {
  console.error("usage: FRIENDS_EGO_TASK_SPACE=7 node scripts/verify-volunteer-ego.mjs register|withdraw [FRIENDS_EGO_VERIFY_WAIT_MS=0]");
  process.exit(2);
}

const fixture = mode === "register"
  ? await readFile(new URL("volunteer-apply-fixture.html", root), "utf8")
  : await readFile(new URL("volunteer-withdraw-fixture.html", root), "utf8");
const actualWriteRequests = [];
const server = createServer((req, res) => {
  if (req.url === "/write" || req.url === "/quit") {
    actualWriteRequests.push({ method: req.method, url: req.url });
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(fixture);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const pageUrl = `http://127.0.0.1:${server.address().port}/${mode}.html`;
const common = {
  activityId: "activity-1",
  taskSpaceId,
  pageUrl,
  command: process.env.FRIENDS_EGO_COMMAND,
};
try {
  const result = mode === "register"
    ? await prepareVolunteerRegistrationEgo({
      ...common,
      activityName: "示例志愿活动",
      postName: "签到岗",
      answers: [
        { title: "是否同意服务安排", type: "CHOICE", optionLabels: ["选项A"] },
        { title: "可携带物品", type: "MULTIPLE_CHOICE", optionLabels: ["选项B", "选项C"] },
        { title: "服务人数", type: "NUMBER", inputContent: "3" },
        { title: "为什么参加", type: "TEXT", inputContent: "受控验收答案" },
      ],
    })
    : await prepareVolunteerWithdrawalEgo(common);
  const preparationWriteRequests = actualWriteRequests.length;
  if (preparationWriteRequests !== 0) {
    throw new Error(`Ego preparation unexpectedly triggered ${preparationWriteRequests} write request(s)`);
  }
  if (humanWaitMs !== 0) {
    await new Promise((resolve) => setTimeout(resolve, humanWaitMs));
  }
  console.log(JSON.stringify({
    ...result,
    preparationWriteRequests,
    actualWriteRequests,
    humanActionObserved: actualWriteRequests.length > 0,
  }, null, 2));
  if (humanWaitMs !== 0 && actualWriteRequests.length === 0) process.exitCode = 3;
} finally {
  server.closeAllConnections();
  server.close();
}
