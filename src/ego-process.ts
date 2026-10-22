import {spawn} from "node:child_process";
import {FriendsError,FriendsErrorCode} from "./errors.js";
function error(message:string,code:FriendsErrorCode=FriendsErrorCode.AuthRequired){return new FriendsError({code,message});}

export async function runEgoJson<T>(options: {
  script: string;
  command: string;
  timeoutMs: number;
  marker: string;
  failure: string;
  startupErrorCode?: FriendsErrorCode;
}): Promise<T> {
  const child = spawn(options.command, ["nodejs"], { stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  const collect = (stream: "stdout" | "stderr", chunk: Buffer) => {
    if (stream === "stdout") stdout += chunk.toString(); else stderr += chunk.toString();
    if (stdout.length + stderr.length > 1024 * 1024) child.kill("SIGTERM");
  };
  child.stdout.on("data", (chunk: Buffer) => collect("stdout", chunk));
  child.stderr.on("data", (chunk: Buffer) => collect("stderr", chunk));
  child.stdin.on("error", () => child.kill("SIGTERM"));
  const timer = setTimeout(() => child.kill("SIGTERM"), options.timeoutMs);
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
    throw error("Could not start the configured Ego browser command", options.startupErrorCode ?? FriendsErrorCode.AuthRequired);
  } finally {
    clearTimeout(timer);
  }
  if (exitCode !== 0) throw error(options.failure, FriendsErrorCode.UnknownOutcome);
  const lines = `${stdout}\n${stderr}`.split("\n").filter((line) => line.startsWith(options.marker));
  const last = lines.length === 1 ? lines[0].slice(options.marker.length) : undefined;
  if (last === undefined) throw error(options.failure, FriendsErrorCode.UnknownOutcome);
  let parsed: T & { error?: string; errorCode?: string };
  try {
    parsed = JSON.parse(last) as T & { error?: string; errorCode?: string };
  } catch {
    throw error("The Ego bridge returned an invalid result", FriendsErrorCode.UnknownOutcome);
  }
  if (typeof parsed === "object" && parsed !== null && typeof parsed.error === "string") {
    const code = Object.values(FriendsErrorCode).find((value) => value === parsed.errorCode);
    throw error(parsed.error, code ?? FriendsErrorCode.UnknownOutcome);
  }
  return parsed;
}
