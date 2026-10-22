import { createOrganizationActivityReviewClient, validateOrganizationActivityReviewInput, type OrganizationActivityReviewKind, type OrganizationOfferingReviewInput, type OrganizationRegistrationReviewInput } from "./organization-activity-reviews.js";
import { prepareOrganizationActivityReviewPage } from "./organization-activity-review-page.js";
import { readVerifiedEgoSession } from "./node.js";
import { runEgoJson } from "./certification-ego.js";
import { FriendsError, FriendsErrorCode } from "./errors.js";

export async function prepareOrganizationActivityReviewInEgo(options: {
  kind: OrganizationActivityReviewKind;
  input: OrganizationOfferingReviewInput | OrganizationRegistrationReviewInput;
  taskSpaceId: number;
  page?: string;
  baseUrl?: string;
  command?: string;
  timeoutMs?: number;
  dryRun?: boolean;
}) {
  if (Object.keys(options).some(key => !["kind", "input", "taskSpaceId", "page", "baseUrl", "command", "timeoutMs", "dryRun"].includes(key)) || options.dryRun !== undefined && typeof options.dryRun !== "boolean") throw new FriendsError({ code: FriendsErrorCode.InvalidInput, message: "Ego reviews only prepare local fields for human final submission" });
  if (!Number.isSafeInteger(options.taskSpaceId) || options.taskSpaceId < 1 || !/^p[1-9][0-9]*$/.test(options.page ?? "p1")) throw new FriendsError({ code: FriendsErrorCode.InvalidInput, message: "Invalid Ego task space or page" });
  const timeoutMs = options.timeoutMs ?? 120_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new FriendsError({ code: FriendsErrorCode.InvalidInput, message: "Invalid Ego timeout" });
  validateOrganizationActivityReviewInput(options.kind, options.input);
  const baseUrl = options.baseUrl ?? "https://friends.cqu.edu.cn/gateway", session = await readVerifiedEgoSession({ ...options, baseUrl });
  const client = createOrganizationActivityReviewClient({ baseUrl, session, timeoutMs });
  const plan = options.kind === "offering" ? await client.offering.prepare(options.input as OrganizationOfferingReviewInput) : await client.registration.prepare(options.input as OrganizationRegistrationReviewInput);
  if (options.dryRun) return { ...plan, dryRun: true, manualFields: [] as string[] };
  const input = { url: new URL(plan.route, baseUrl).href, decision: options.input.decision, message: options.input.message, time: options.input.time, token: session.token, userLevel: session.userLevel };
  const script = `const task=await taskSpace(${options.taskSpaceId});const page=task.page(${JSON.stringify(options.page ?? "p1")});
const result=await (${prepareOrganizationActivityReviewPage.toString()})(page,${JSON.stringify(input)});
await task.handOff();console.log('FRIENDS_ORGANIZATION_REVIEW:'+JSON.stringify({...result,handoff:'completed'}));`;
  let completed: string[] = [];
  try {
    const result = await runEgoJson<{ status: "awaiting-user" | "needs-user"; submitted: false; completed: string[]; manualFields: string[]; handoff: "completed"; executionError?: boolean }>({ script, command: options.command ?? "ego-browser", timeoutMs, marker: "FRIENDS_ORGANIZATION_REVIEW:", failure: "Ego approval preparation was interrupted" });
    completed = result.completed;
    if (result.executionError || result.submitted !== false || result.handoff !== "completed") throw new Error("Visible preparation is incomplete");
    return { ...result, kind: plan.kind, id: plan.id, activityId: plan.activityId, organizationId: plan.organizationId };
  } catch {
    throw new FriendsError({ code: FriendsErrorCode.UnknownOutcome, message: "Visible approval preparation may be partial; inspect the existing page; no retry or final submission was requested", recovery: { operation: `organization.${plan.kind}-reviews.prepare`, organizationId: plan.organizationId, activityId: plan.activityId, applicationId: plan.id, completed } });
  }
}
