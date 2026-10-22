import { createFriendsSdk, organizationId, type OrganizationLeaderChangeInput } from "./index.js";
import { readVerifiedEgoSession } from "./node.js";
import { runEgoJson } from "./certification-ego.js";
import { prepareOrganizationLeaderPage } from "./organization-leader-page.js";
import { FriendsError, FriendsErrorCode } from "./errors.js";

export async function prepareOrganizationLeaderChangeInEgo(options: {
  input: OrganizationLeaderChangeInput & { organizationId: string };
  taskSpaceId: number;
  page?: string;
  baseUrl?: string;
  selector?: { levelNo?: string; unitNo?: string };
  command?: string;
  timeoutMs?: number;
  dryRun?: boolean;
}) {
  if (!Number.isSafeInteger(options.taskSpaceId) || options.taskSpaceId < 1 || !/^p[1-9][0-9]*$/.test(options.page ?? "p1")) {
    throw new FriendsError({ code: FriendsErrorCode.InvalidInput, message: "Invalid Ego task space or page" });
  }
  const requestedOrganization = organizationId(options.input?.organizationId);
  if (options.dryRun !== undefined && typeof options.dryRun !== "boolean") {
    throw new FriendsError({ code: FriendsErrorCode.InvalidInput, message: "dryRun must be boolean" });
  }
  const timeoutMs = options.timeoutMs ?? 120_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new FriendsError({ code: FriendsErrorCode.InvalidInput, message: "Invalid Ego timeout" });
  const session = await readVerifiedEgoSession(options);
  const client = await createFriendsSdk({ baseUrl: options.baseUrl, timeoutMs }).createOrganizationClient(session);
  const plan = await client.prepareLeaderChange({ ...options.input, organizationId: requestedOrganization });
  const route = `/mobile/groupManage/studentLeaderApply?uuid=${encodeURIComponent(plan.organizationId)}`;
  const input = {
    url: new URL(route, options.baseUrl ?? "https://friends.cqu.edu.cn/gateway").href,
    token: session.token, userLevel: session.userLevel,
    candidateName: plan.candidate.name, candidateStudentNo: plan.candidate.studentNo,
    candidateRow: `${plan.candidate.name}/${plan.candidate.postName || "-"}${plan.candidate.isManager ? "(负责人)" : ""}/电话：${plan.candidate.phone || "-"}`,
    phone: plan.input.newResponsiblePhone, political: plan.input.newResponsiblePolitical,
    postName: plan.state.posts.find(post => post.id === plan.input.newPostUuid)?.name ?? null,
    reason: plan.input.reason ?? "", dryRun: options.dryRun === true,
  };
  const script = `const task=await taskSpace(${options.taskSpaceId});const page=task.page(${JSON.stringify(options.page ?? "p1")});
const result=await (${prepareOrganizationLeaderPage.toString()})(page,${JSON.stringify(input)});
if (!${options.dryRun === true}) await task.handOff();
console.log('FRIENDS_LEADER_PREPARED:'+JSON.stringify(result));`;
  type Result = {
    status: "prepared" | "awaiting-user"; submitted: false; dryRun?: boolean;
    actions: string[]; manualFields: string[]; executionError?: string;
  };
  let result: Result;
  try {
    result = await runEgoJson<Result>({ script, command: options.command ?? "ego-browser", timeoutMs: timeoutMs + 30_000,
      marker: "FRIENDS_LEADER_PREPARED:", failure: "Inspect the organization leader-change page before any further action" });
  } catch {
    throw new FriendsError({ code: FriendsErrorCode.UnknownOutcome,
      message: "The Ego preparation result was lost or invalid; inspect the existing form before continuing",
      recovery: { operation: "organizations.leader-change.prepare", organizationId: plan.organizationId, applicationId: plan.state.application?.id, completed: ["visible-preparation-started"] } });
  }
  if (typeof result !== "object" || result === null || result.executionError || result.submitted !== false || result.status !== (options.dryRun ? "prepared" : "awaiting-user") ||
      (options.dryRun && result.dryRun !== true) || !Array.isArray(result.actions) || !Array.isArray(result.manualFields)) {
    throw new FriendsError({ code: FriendsErrorCode.UnknownOutcome,
      message: "The visible leader-change preparation may be partial; inspect the existing form before continuing",
      recovery: { operation: "organizations.leader-change.prepare", organizationId: plan.organizationId, applicationId: plan.state.application?.id, completed: result?.actions ?? [] } });
  }
  return { ...result, organizationId: plan.organizationId, route, candidate: plan.candidate,
    handoff: options.dryRun ? "not-requested" as const : "completed" as const };
}
