import { FriendsError, FriendsErrorCode } from "../errors.js";
import { loadSession, readVerifiedEgoSession } from "../node.js";

export async function resolveQuerySession(options: Record<string, string | undefined>, baseUrl: string) {
  const via = options.via ?? "api";
  if (via === "api") {
    const mixedEgoOptions = ["egoTaskSpace", "egoPage", "levelNo", "unitNo"].filter((key) => options[key] != null);
    if (mixedEgoOptions.length > 0) {
      throw new FriendsError({
        code: FriendsErrorCode.InvalidInput,
        message: `Ego options require --via ego: ${mixedEgoOptions.join(", ")}`,
      });
    }
    return { session: await loadSession(), entry: "api" as const };
  }
  if (via !== "ego") {
    throw new FriendsError({
      code: FriendsErrorCode.InvalidInput,
      message: "--via must be api or ego",
    });
  }
  if (options.egoTaskSpace === undefined) {
    throw new FriendsError({
      code: FriendsErrorCode.InvalidInput,
      message: "--via ego requires --ego-task-space",
    });
  }
  const taskSpaceId = Number(options.egoTaskSpace);
  if (!Number.isInteger(taskSpaceId) || taskSpaceId < 1) {
    throw new FriendsError({
      code: FriendsErrorCode.InvalidInput,
      message: "--ego-task-space must be a positive integer",
    });
  }
  const session = await readVerifiedEgoSession({
    taskSpaceId,
    page: options.egoPage,
    baseUrl: baseUrl,
    selector:
      options.levelNo === undefined && options.unitNo === undefined
        ? undefined
        : { levelNo: options.levelNo, unitNo: options.unitNo },
  });
  return { session, entry: "ego" as const };
}

