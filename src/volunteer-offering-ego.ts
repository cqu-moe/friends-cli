import { spawn } from "node:child_process";
import { createVolunteerOfferingClient } from "./volunteer-offering-api.js";
import { readVerifiedEgoSession } from "./node.js";
import { FriendsError, FriendsErrorCode } from "./errors.js";
import type { VolunteerOfferingVisiblePreparation } from "./volunteer-offering-page.js";
import type { PreparedVolunteerOffering } from "./volunteer-offering-api.js";

interface EgoOptions {
  value: unknown;
  taskSpaceId: number;
  page?: string;
  levelNo?: string;
  unitNo?: string;
  baseUrl: string;
  timeoutMs?: number;
  command?: string;
  dryRun?: boolean;
}

const offeringPath = "/mobile/volunteerManage/campusManagerApplyPages";

function error(message: string, code: FriendsErrorCode): FriendsError {
  return new FriendsError({ code, message });
}

function validate(options: EgoOptions): void {
  if (!Number.isSafeInteger(options.taskSpaceId) || options.taskSpaceId < 1) throw error("Invalid Ego task space", FriendsErrorCode.InvalidInput);
  const page = options.page ?? "p1";
  if (!/^p[1-9][0-9]*$/.test(page)) throw error("Invalid Ego page label", FriendsErrorCode.InvalidInput);
}

async function runEgoJson<T>(script: string, command: string, timeoutMs: number, marker: string): Promise<T> {
  const child = spawn(command, ["nodejs"], { stdio: ["pipe", "pipe", "pipe"] });
  let stdout = ""; let stderr = "";
  const collect = (stream: "stdout" | "stderr", chunk: Buffer) => {
    if (stream === "stdout") stdout += chunk.toString(); else stderr += chunk.toString();
    if (stdout.length + stderr.length > 1024 * 1024) child.kill("SIGTERM");
  };
  child.stdout.on("data", (chunk: Buffer) => collect("stdout", chunk));
  child.stderr.on("data", (chunk: Buffer) => collect("stderr", chunk));
  child.stdin.on("error", () => child.kill("SIGTERM"));
  const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
  const closed = new Promise<number>((resolve, reject) => {
    child.once("error", reject); child.once("close", (code) => resolve(code ?? -1));
  });
  child.stdin.end(script);
  let exitCode: number;
  try { exitCode = await closed; } catch { child.kill("SIGTERM"); throw error("Could not start the configured Ego browser command", FriendsErrorCode.UnknownOutcome); } finally { clearTimeout(timer); }
  if (exitCode !== 0) throw error("Could not prepare the visible offering page; inspect it before retrying", FriendsErrorCode.UnknownOutcome);
  const lines = `${stdout}\n${stderr}`.split("\n").filter((line) => line.startsWith(marker));
  if (lines.length !== 1) throw error("Could not prepare the visible offering page; inspect it before retrying", FriendsErrorCode.UnknownOutcome);
  try {
    return JSON.parse(lines[0].slice(marker.length)) as T;
  } catch {
    throw error("The Ego offering bridge returned an invalid result", FriendsErrorCode.NetworkProtocol);
  }
}

export async function prepareVolunteerOfferingInEgo(options: EgoOptions): Promise<VolunteerOfferingVisiblePreparation> {
  validate(options);
  const session = await readVerifiedEgoSession({
    taskSpaceId: options.taskSpaceId, page: options.page, baseUrl: options.baseUrl,
    selector: { levelNo: options.levelNo, unitNo: options.unitNo }, command: options.command,
  });
  const client = createVolunteerOfferingClient({ baseUrl: options.baseUrl, session });
  const prepared: PreparedVolunteerOffering = await client.prepare(options.value);
  const target = new URL(options.baseUrl);
  const url = new URL(offeringPath, target.origin);
  url.searchParams.set("activityPageTypes", "Apply");
  url.searchParams.set("activityCategory", prepared.activityCategory);
  const input = {
    page: options.page ?? "p1", url: url.toString(),
    activityCategory: prepared.activityCategory,
    dryRun: options.dryRun === true,
    activity: {
      activityName: String(prepared.payload.activityName),
      activityTypeLabel: prepared.context.activityType.name,
      activityLevelLabel: prepared.context.activityLevel.name,
      beginTime: String(prepared.payload.beginTime), endTime: String(prepared.payload.endTime),
      activityPlace: String(prepared.payload.activityPlace), contacts: String(prepared.payload.contacts),
      phone: String(prepared.payload.phone), volunteerNumber: String(prepared.payload.volunteerNumber),
      totalDuration: String(prepared.payload.totalDuration),
      activityContent: String(prepared.payload.activityContent), overview: String(prepared.payload.overview),
    },
    organizationName: prepared.context.organization.name,
    expectedPublicityCount: prepared.materials.publicityPictures.length,
    sessionToken: session.token, sessionUserLevel: session.userLevel,
  };
  const runtime = new URL("./volunteer-offering-page.js", import.meta.url).href;
  const script = `
const task = await taskSpace(${options.taskSpaceId});
const {prepareVolunteerOfferingPage} = await import(${JSON.stringify(runtime)});
try {
 const result = await prepareVolunteerOfferingPage(task, ${JSON.stringify(input)});
 console.log("FRIENDS_CLI_OFFERING_PREPARE:" + JSON.stringify(result));
} catch (error) {
 console.log("FRIENDS_CLI_OFFERING_PREPARE:" + JSON.stringify({executionError:{code:error.code ?? "UNKNOWN_OUTCOME",message:error.message},status:"awaiting-user",submitted:false,actions:[],missing:["human-review:page"]}));
}
`;
  const result = await runEgoJson<VolunteerOfferingVisiblePreparation>(
    script, options.command ?? "ego-browser", (options.timeoutMs ?? 300_000) + 30_000, "FRIENDS_CLI_OFFERING_PREPARE:",
  );
  if (result.executionError) {
    throw new FriendsError({
      code: FriendsErrorCode.UnknownOutcome, message: result.executionError.message,
      recovery: { operation: "offerings.prepare", completed: result.actions.map((action) => `${action.field}:${action.action}`) },
    });
  }
  return result;
}
