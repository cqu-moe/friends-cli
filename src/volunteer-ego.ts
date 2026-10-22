import { spawn } from "node:child_process";
import { FriendsError, FriendsErrorCode } from "./errors.js";

export interface VisibleVolunteerAnswer {
  title: string;
  type: "TEXT" | "NUMBER" | "CHOICE" | "MULTIPLE_CHOICE";
  inputContent?: string;
  optionLabels?: string[];
}

export interface VolunteerEgoPreparation {
  activityId: string;
  pageLabel: string;
  submitted: false;
  handoff: true;
}

function validateCommon(options: { taskSpaceId: number }) {
  if (!Number.isSafeInteger(options.taskSpaceId) || options.taskSpaceId < 1) {
    throw new FriendsError({ code: FriendsErrorCode.InvalidInput, message: "Ego task space must be a positive integer" });
  }
}

async function runEgo(options: { command?: string; timeoutMs?: number; script: string }): Promise<Record<string, unknown>> {
  const child = spawn(options.command ?? "ego-browser", ["nodejs"], { stdio: ["pipe", "pipe", "pipe"] });
  let output = "";
  const collect = (chunk: Buffer) => {
    output += chunk.toString();
    if (output.length > 1024 * 1024) child.kill("SIGTERM");
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  child.stdin.on("error", () => child.kill("SIGTERM"));
  const timer = setTimeout(() => child.kill("SIGTERM"), options.timeoutMs ?? 120_000);
  const closed = new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? -1));
  });
  child.stdin.end(options.script);
  let exitCode: number;
  try {
    exitCode = await closed;
  } catch {
    child.kill("SIGTERM");
    throw new FriendsError({ code: FriendsErrorCode.NetworkProtocol, message: "Could not start the Ego browser" });
  } finally {
    clearTimeout(timer);
  }
  const marker = "FRIENDS_CLI_VOLUNTEER_PREPARE:";
  const lines = output.split("\n").filter((line) => line.startsWith(marker));
  if (exitCode !== 0 || lines.length !== 1) {
    throw new FriendsError({ code: FriendsErrorCode.NetworkProtocol, message: "The Ego volunteer preparation failed" });
  }
  try {
    const parsed = JSON.parse(lines[0].slice(marker.length)) as Record<string, unknown>;
    if (typeof parsed !== "object" || parsed === null) throw new Error("invalid");
    return parsed;
  } catch {
    throw new FriendsError({ code: FriendsErrorCode.NetworkProtocol, message: "The Ego volunteer preparation returned invalid output" });
  }
}

function validateResult(result: Record<string, unknown>, activityId: string): VolunteerEgoPreparation {
  if (
    result.activityId !== activityId || result.submitted !== false || result.handoff !== true ||
    typeof result.pageLabel !== "string" || result.pageLabel === ""
  ) {
    throw new FriendsError({ code: FriendsErrorCode.NetworkProtocol, message: "Ego did not stop at the volunteer preparation boundary" });
  }
  return { activityId, pageLabel: result.pageLabel, submitted: false, handoff: true };
}

function visibleUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("invalid protocol");
    return url.toString();
  } catch {
    throw new FriendsError({ code: FriendsErrorCode.InvalidInput, message: "Ego page URL must be http(s)" });
  }
}

function pickerOptionSelector(value: string): string {
  return `loc=css:.van-picker .van-picker-column__item:text-is(${JSON.stringify(value)})`;
}

function fieldInputSelector(title: string): string {
  const quoted = JSON.stringify(title);
  return `xpath=(//*[contains(concat(" ", normalize-space(@class), " "), " form-outside ")][.//text()[normalize-space()=${quoted}]]//textarea | //*[contains(concat(" ", normalize-space(@class), " "), " form-outside ")][.//text()[normalize-space()=${quoted}]]//input)[1]`;
}

function optionIconSelector(label: string): string {
  const quoted = JSON.stringify(label);
  return `xpath=(//*[contains(concat(" ", normalize-space(@class), " "), " van-cell ")][.//text()[normalize-space()=${quoted}]]//*[contains(concat(" ", normalize-space(@class), " "), " van-radio__icon ") or contains(concat(" ", normalize-space(@class), " "), " van-checkbox__icon ")])[1]`;
}

function visibleAnswers(answers: VisibleVolunteerAnswer[]): Array<{
  title: string;
  type: "TEXT" | "NUMBER" | "CHOICE" | "MULTIPLE_CHOICE";
  inputSelector: string;
  inputContent: string;
  optionSelectors: string[];
}> {
  return answers.map((answer) => {
    if (typeof answer.title !== "string" || answer.title.trim() === "") {
      throw new FriendsError({ code: FriendsErrorCode.InvalidInput, message: "Visible volunteer answer requires a title" });
    }
    if ((answer.type === "TEXT" || answer.type === "NUMBER") && typeof answer.inputContent !== "string") {
      throw new FriendsError({ code: FriendsErrorCode.InvalidInput, message: "Visible TEXT and NUMBER answers require inputContent" });
    }
    if (answer.type !== "TEXT" && answer.type !== "NUMBER" && !Array.isArray(answer.optionLabels)) {
      throw new FriendsError({ code: FriendsErrorCode.InvalidInput, message: "Visible choice answers require optionLabels" });
    }
    return {
      title: answer.title,
      type: answer.type,
      inputSelector: fieldInputSelector(answer.title),
      inputContent: answer.inputContent ?? "",
      optionSelectors: (answer.optionLabels ?? []).map((label) => {
        if (typeof label !== "string" || label.trim() === "") {
          throw new FriendsError({ code: FriendsErrorCode.InvalidInput, message: "Visible choice answers require non-empty option labels" });
        }
        return optionIconSelector(label);
      }),
    };
  });
}

export async function prepareVolunteerRegistrationEgo(options: {
  activityId: string;
  activityName: string | null;
  postName: string | null;
  answers: VisibleVolunteerAnswer[];
  taskSpaceId: number;
  command?: string;
  pageUrl?: string;
  timeoutMs?: number;
}): Promise<VolunteerEgoPreparation> {
  validateCommon(options);
  if (typeof options.postName !== "string" || options.postName.trim() === "") {
    throw new FriendsError({ code: FriendsErrorCode.InvalidInput, message: "A visible volunteer post name is required" });
  }
  const url = visibleUrl(options.pageUrl ?? `https://friends.cqu.edu.cn/mobile/volunteerManage/campusActivityApplyDetail?uuid=${encodeURIComponent(options.activityId)}`);
  const answers = visibleAnswers(options.answers);
  const postField = 'loc=css:.van-field:text-is("申请岗位")';
  const submitField = 'text="申请加入"';
  const script = `
const task = await taskSpace(${options.taskSpaceId});
// A dedicated page avoids discarding unsaved work in the caller's existing page.
const page = await task.newPage();
await page.goto(${JSON.stringify(url)});
await page.waitForLoadState();
await page.waitForSelector(${JSON.stringify(postField)}, { state: "visible" });
const before = await page.snapshot();
const activityName = ${JSON.stringify(options.activityName)};
if (activityName !== null && !before.includes(activityName)) throw new Error("volunteer activity is not visible");
if (!before.includes("申请岗位")) throw new Error("volunteer post field is not visible");
await page.click(${JSON.stringify(postField)}, { label: "open volunteer post picker" });
await page.waitForSelector(${JSON.stringify(pickerOptionSelector(options.postName))}, { state: "visible" });
await page.click(${JSON.stringify(pickerOptionSelector(options.postName))}, { label: "select volunteer post" });
await page.click("loc=css:.van-picker__confirm", { label: "confirm volunteer post" });
await page.waitForSelector("loc=css:.van-picker", { state: "hidden" });
for (const answer of ${JSON.stringify(answers)}) {
  if (answer.type === "TEXT" || answer.type === "NUMBER") {
    await page.waitForSelector(answer.inputSelector, { state: "visible" });
    await page.fill(answer.inputSelector, answer.inputContent);
  } else {
    for (const selector of answer.optionSelectors) {
      await page.waitForSelector(selector, { state: "visible" });
      await page.click(selector, { label: "select questionnaire option" });
    }
  }
}
const prepared = await page.snapshot();
await page.waitForSelector(${JSON.stringify(submitField)}, { state: "visible" });
if (!prepared.includes("申请加入")) throw new Error("human submit control is not visible");
await task.handOff();
console.log("FRIENDS_CLI_VOLUNTEER_PREPARE:" + JSON.stringify({
  activityId: ${JSON.stringify(options.activityId)}, pageLabel: page.label, submitted: false, handoff: true
}));
`;
  return validateResult(await runEgo({ command: options.command, timeoutMs: options.timeoutMs, script }), options.activityId);
}

export async function prepareVolunteerWithdrawalEgo(options: {
  activityId: string;
  taskSpaceId: number;
  command?: string;
  pageUrl?: string;
  timeoutMs?: number;
}): Promise<VolunteerEgoPreparation> {
  validateCommon(options);
  const url = visibleUrl(options.pageUrl ?? `https://friends.cqu.edu.cn/mobile/volunteerManage/campusActivityInfo?uuid=${encodeURIComponent(options.activityId)}`);
  const script = `
const task = await taskSpace(${options.taskSpaceId});
const page = await task.newPage();
await page.goto(${JSON.stringify(url)});
await page.waitForLoadState();
await page.waitForSelector("text=退出报名", { state: "visible" });
const before = await page.snapshot();
if (!before.includes("退出报名")) throw new Error("volunteer withdrawal control is not visible");
await task.handOff();
console.log("FRIENDS_CLI_VOLUNTEER_PREPARE:" + JSON.stringify({
  activityId: ${JSON.stringify(options.activityId)}, pageLabel: page.label, submitted: false, handoff: true
}));
`;
  return validateResult(await runEgo({ command: options.command, timeoutMs: options.timeoutMs, script }), options.activityId);
}
