import {record,strings,pageActions,executionFailure,knownPrecondition} from "./ego-receipt.js";
import {runEgoJson} from "./ego-process.js";
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
 console.log("FRIENDS_CLI_OFFERING_PREPARE:" + JSON.stringify({error:error.message,errorCode:error.code}));
}
`;
  let result:VolunteerOfferingVisiblePreparation|undefined;
  try {
    const raw=await runEgoJson<unknown>({startupErrorCode:FriendsErrorCode.UnknownOutcome,script,command:options.command??"ego-browser",timeoutMs:(options.timeoutMs??300_000)+30_000,marker:"FRIENDS_CLI_OFFERING_PREPARE:",failure:"Visible offering preparation returned no reliable receipt"});
    if(!record(raw)||(raw.handoff!==undefined&&raw.handoff!=='completed')||raw.submitted!==false||!pageActions(raw.actions,['filled','selected','already-matching','human-value-preserved'])||
       !strings(raw.missing)||!executionFailure(raw.executionError)||!record(raw.page)||typeof raw.page.url!=='string'||
       !Array.isArray(raw.page.fields)||!raw.page.fields.every(f=>record(f)&&typeof f.name==='string'&&typeof f.value==='string')||
       typeof raw.page.publicityUploadCount!=='number'||typeof raw.page.attachmentUploadCount!=='number'||
       (options.dryRun?raw.status!=='ready'||raw.dryRun!==true:raw.status!=='awaiting-user')) throw new Error('Incomplete Ego offering receipt');
    result=raw as unknown as VolunteerOfferingVisiblePreparation;
    if(result.executionError || !options.dryRun&&result.handoff!=='completed')throw new Error(result.executionError?.message??'Ego handoff was not confirmed');
    return result;
  } catch(cause) {
    if(knownPrecondition(cause))throw cause;
    throw new FriendsError({code:FriendsErrorCode.UnknownOutcome,message:cause instanceof Error?cause.message:'Visible offering preparation is uncertain',
      recovery:{operation:'offerings.prepare',pageLabel:options.page??'p1',completed:result?.actions.map(action=>`${action.field}:${action.action}`)??[],handoff:result?.handoff??'unknown',serverAcknowledged:false}});
  }
}
