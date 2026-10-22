import { spawn } from "node:child_process";
import { createFriendsSdk, type CourseOfferingApplication, type CourseOfferingSession } from "./index.js";
import { FriendsError, FriendsErrorCode } from "./errors.js";
import type { PreparedCourseOfferingApplication } from "./course-offering.js";

export interface CourseOfferingEgoResult {
  status: "ready" | "awaiting-user";
  submitted: false;
  dryRun?: boolean;
  handoff?: "completed";
  actions?: Array<{ field: string; action: "filled" | "already-matching" | "human-value-preserved" | "missing" }>;
  page?: Record<string, string | null>;
  missing?: string[];
  executionError?: { code: string; message: string } | null;
  prepared?: PreparedCourseOfferingApplication;
  finalSubmitActions: 0;
}

interface Options {
  application: unknown;
  session: CourseOfferingSession;
  taskSpaceId: number;
  page?: string;
  baseUrl?: string;
  command?: string;
  timeoutMs?: number;
  dryRun?: boolean;
}

function error(message: string, code: FriendsErrorCode = FriendsErrorCode.AuthRequired): FriendsError {
  return new FriendsError({ code, message });
}

function targetUrl(baseUrl: string, courseId: string | null): string {
  const origin = new URL(baseUrl).origin;
  const url = new URL("/mobile/course/courseInfo", origin);
  url.searchParams.set("type", courseId === null ? "add" : "Apply");
  if (courseId !== null) url.searchParams.set("uuid", courseId);
  return url.toString();
}

async function runEgoJson(options: {
  script: string;
  command: string;
  timeoutMs: number;
  marker: string;
}): Promise<Record<string, unknown>> {
  const child = spawn(options.command, ["nodejs"], { stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  const collect = (stream: "stdout" | "stderr", chunk: Buffer) => {
    if (stream === "stdout") stdout += chunk.toString(); else stderr += chunk.toString();
    if (stdout.length + stderr.length > 1024 * 1024) child.kill("SIGTERM");
  };
  child.stdout.on("data", chunk => collect("stdout", chunk));
  child.stderr.on("data", chunk => collect("stderr", chunk));
  child.stdin.on("error", () => child.kill("SIGTERM"));
  const timer = setTimeout(() => child.kill("SIGTERM"), options.timeoutMs);
  const closed = new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", code => resolve(code ?? -1));
  });
  child.stdin.end(options.script);
  let exitCode: number;
  try {
    exitCode = await closed;
  } catch {
    child.kill("SIGTERM");
    throw error("Could not start the configured Ego browser command");
  } finally {
    clearTimeout(timer);
  }
  if (exitCode !== 0) {
    throw error("Could not prepare the visible course page; inspect it before retrying", FriendsErrorCode.UnknownOutcome);
  }
  const marker = options.marker;
  const lines = `${stdout}\n${stderr}`.split("\n").filter(line => line.startsWith(marker));
  if (lines.length !== 1) {
    throw error("Could not prepare the visible course page; inspect it before retrying", FriendsErrorCode.UnknownOutcome);
  }
  try {
    return JSON.parse(lines[0].slice(marker.length)) as Record<string, unknown>;
  } catch {
    throw error("The Ego course preparation returned an invalid result; inspect the retained page", FriendsErrorCode.UnknownOutcome);
  }
}

export async function prepareCourseOfferingInEgo(options: Options): Promise<CourseOfferingEgoResult> {
  if ("yes" in options || "confirm" in options || "submit" in options) throw error("Ego course preparation never authorizes submission", FriendsErrorCode.InvalidInput);
  if (!Number.isSafeInteger(options.taskSpaceId) || options.taskSpaceId < 1) {
    throw error("Invalid Ego task space", FriendsErrorCode.InvalidInput);
  }
  const page = options.page ?? "p1";
  if (!/^p[1-9][0-9]*$/.test(page)) throw error("Invalid Ego page label", FriendsErrorCode.InvalidInput);
  const baseUrl = options.baseUrl ?? "https://friends.cqu.edu.cn/gateway";
  const timeoutMs = options.timeoutMs ?? 300_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw error("Invalid Ego timeout", FriendsErrorCode.InvalidInput);
  const client = await createFriendsSdk({ baseUrl }).createCourseOfferingClient(options.session);
  const prepared = await client.prepare(options.application);
  if (options.dryRun) {
    return { status: "ready", submitted: false, dryRun: true, prepared, finalSubmitActions: 0 };
  }
  const runtime = new URL("./course-offering-page.js", import.meta.url).href;
  const input = {
    prepared,
    session: {
      token: options.session.token,
      userLevel: options.session.userLevel,
    },
    page,
    url: targetUrl(baseUrl, prepared.uuid),
  };
  const script = `
const task = await taskSpace(${options.taskSpaceId});
const {prepareCourseOfferingPage} = await import(${JSON.stringify(runtime)});
try {
 const result = await prepareCourseOfferingPage(task, ${JSON.stringify(input)});
 console.log("FRIENDS_CLI_COURSE_PREPARE:" + JSON.stringify(result));
} catch(error) {
 console.log("FRIENDS_CLI_COURSE_PREPARE:" + JSON.stringify({error:error.message,errorCode:error.code}));
}
`;
  const raw = await runEgoJson({
    script,
    command: options.command ?? "ego-browser",
    timeoutMs: timeoutMs + 30_000,
    marker: "FRIENDS_CLI_COURSE_PREPARE:",
  });
  if (typeof raw.error === "string") {
    const code = Object.values(FriendsErrorCode).find(value => value === raw.errorCode);
    throw error(raw.error, code ?? FriendsErrorCode.NetworkProtocol);
  }
  if (
    raw.status !== "awaiting-user" ||
    raw.submitted !== false ||
    raw.handoff !== "completed" ||
    raw.finalSubmitActions !== 0
  ) {
    throw error("The Ego course preparation did not preserve the required handoff boundary", FriendsErrorCode.UnknownOutcome);
  }
  return { ...(raw as unknown as CourseOfferingEgoResult), prepared };
}

export type { CourseOfferingApplication };
