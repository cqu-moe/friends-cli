import { lstat, readFile } from "node:fs/promises";
import { FriendsError, FriendsErrorCode } from "../errors.js";
const maximumInputBytes = 10 * 1024 * 1024;
const dangerousKeys = new Set(["__proto__", "constructor", "prototype"]);
function invalid(message: string): never { throw new FriendsError({code:FriendsErrorCode.InvalidInput,message}); }

function rejectUnsafeJson(value: unknown, depth = 0): void {
  if (depth > 20) invalid("JSON input nesting is too deep");
  if (Array.isArray(value)) {
    for (const item of value) rejectUnsafeJson(item, depth + 1);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const [key, child] of Object.entries(value)) {
    if (dangerousKeys.has(key)) invalid(`JSON input contains an unsafe key: ${key}`);
    rejectUnsafeJson(child, depth + 1);
  }
}
export async function readJsonInput(source: string): Promise<unknown> {
  let text: string;
  if (source === "-") {
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const chunk of process.stdin) {
      const buffer = chunk as Buffer;
      length += buffer.length;
      if (length > maximumInputBytes) invalid("JSON input exceeds 10 MiB");
      chunks.push(buffer);
    }
    text = Buffer.concat(chunks).toString("utf8");
  } else {
    const stat = await lstat(source).catch(() => null);
    if (stat === null || !stat.isFile() || stat.isSymbolicLink()) invalid("JSON input must be a regular file or stdin");
    text = await readFile(source, "utf8");
    if (Buffer.byteLength(text) > maximumInputBytes) invalid("JSON input exceeds 10 MiB");
  }
  try {
    const parsed: unknown = JSON.parse(text);
    rejectUnsafeJson(parsed);
    return parsed;
  } catch (error) {
    if (error instanceof FriendsError) throw error;
    invalid("JSON input must be valid JSON");
  }
}
