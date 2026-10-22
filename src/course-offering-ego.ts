import {record,strings,pageActions,executionFailure,knownPrecondition} from "./ego-receipt.js";
import {runEgoJson} from "./ego-process.js";
import { createFriendsSdk, type CourseOfferingApplication, type CourseOfferingSession } from "./index.js";
import { FriendsError, FriendsErrorCode } from "./errors.js";
import type { PreparedCourseOfferingApplication } from "./course-offering.js";

export interface CourseOfferingEgoResult {
  status: "ready" | "awaiting-user";
  submitted: false;
  dryRun?: boolean;
  handoff?: "completed" | "unknown";
  actions?: Array<{ field: string; action: "filled" | "already-matching" | "human-value-preserved" | "missing" }>;
  page?: Record<string, string | null>;
  missing?: string[];
  executionError?: { code: string; message: string } | null;
  prepared?: PreparedCourseOfferingApplication;
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
    return { status: "ready", submitted: false, dryRun: true, prepared };
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
  let result:CourseOfferingEgoResult|undefined;
  try {
    const raw=await runEgoJson<unknown>({script,command:options.command??"ego-browser",timeoutMs:timeoutMs+30_000,
      marker:"FRIENDS_CLI_COURSE_PREPARE:",failure:"Visible course preparation returned no reliable receipt"});
    if(!record(raw)||(raw.handoff!==undefined&&raw.handoff!=='completed'&&raw.handoff!=='unknown')||raw.status!=="awaiting-user"||raw.submitted!==false||!pageActions(raw.actions,['filled','already-matching','human-value-preserved','missing'])||
       !strings(raw.missing)||!executionFailure(raw.executionError)||!record(raw.page)||!['curriculumName','curriculumPlace','curriculumContent','curriculumType','curriculumLevel','organizationName','beginTime','endTime','role','attestationType'].every(key=>raw.page && record(raw.page)&&(raw.page[key]===null||typeof raw.page[key]==='string')))throw new Error('Incomplete Ego course receipt');
    result=raw as unknown as CourseOfferingEgoResult;
    if(result.executionError || result.handoff!=="completed")throw new Error(result.executionError?.message??'Course handoff was not confirmed');
    return {...result,prepared};
  } catch(cause) {
    if(knownPrecondition(cause))throw cause;
    const {term,organization,typeName,levelName,materialGroups,...input}=prepared;
    throw new FriendsError({code:FriendsErrorCode.UnknownOutcome,
      message:"Visible course preparation stopped. Inspect the existing page before any new operation; no automatic retry was made.",
      recovery:{operation:"course-offering.prepare-ego",courseId:prepared.uuid??undefined,applicationId:prepared.uuid??undefined,organizationId:prepared.organization.id,input,
        completed:result?.actions?.filter(action=>action.action==='filled'||action.action==='already-matching').map(action=>action.field)??[],
        handoff:result?.handoff??'unknown',page:result?.page,missing:result?.missing,
        executionError:result?.executionError??{code:FriendsErrorCode.UnknownOutcome,message:cause instanceof Error?cause.message:'Unconfirmed preparation receipt'}}});
  }
}

export type { CourseOfferingApplication };
