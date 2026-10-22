import {record,strings,knownPrecondition,executionFailure} from "./ego-receipt.js";
import {runEgoJson} from "./ego-process.js";
export {runEgoJson} from "./ego-process.js";
import {
  buildVolunteerCertificationPreparation,
  rejectVolunteerCertificationEgoSubmit,
  type CertificationPageSnapshot,
  type VolunteerCertificationPreparation,
} from "./certification-prepare.js";
import { parseVolunteerCertificationDraft, validateVolunteerCertificationDraft, type VolunteerCertificationDraft } from "./drafts.js";
import { createVolunteerCertificationClient } from "./draft-source.js";
import { FriendsError, FriendsErrorCode } from "./errors.js";

export interface VolunteerCertificationEgoPreparationResult extends VolunteerCertificationPreparation {
  handoff?: "completed";
  inProgress?: string;
  executionError?: {code:string;message:string}|null;
  completedActions: Array<VolunteerCertificationPreparation["actions"][number]>;
  page: CertificationPageSnapshot;
}

interface VerifiedEgoPreparationSession {
  token: string;
  userLevel: string;
  account: { userNo: string; userName?: string };
  context: { levelNo: string; levelName?: string; unit: { unitType?: number; unitNo: string; unitName?: string } };
}

interface EgoOptions {
  draft: VolunteerCertificationDraft;
  session: VerifiedEgoPreparationSession;
  taskSpaceId: number;
  page?: string;
  baseUrl?: string;
  command?: string;
  timeoutMs?: number;
  dryRun?: boolean;
}

const certificationPath = "/mobile/volunteerManage/campusActivityCerApply";

function error(message: string, code: FriendsErrorCode = FriendsErrorCode.AuthRequired): FriendsError {
  return new FriendsError({ code, message });
}

function invalid(message: string): never {
  throw new FriendsError({ code: FriendsErrorCode.InvalidInput, message });
}

function targetUrl(options: EgoOptions): string {
  const base = new URL(options.baseUrl ?? "https://friends.cqu.edu.cn/gateway");
  const url = new URL(certificationPath, base.origin);
  url.searchParams.set("uuid", options.draft.activity.id);
  url.searchParams.set("type", "attestApply");
  return url.toString();
}

function validateEgoOptions(options: EgoOptions): void {
  if (!options || typeof options !== 'object' || options.dryRun !== undefined && typeof options.dryRun !== 'boolean') invalid('Invalid Ego preparation options');
  const session=options.session;
  if (!session || [session.token,session.userLevel,session.account?.userNo,session.context?.levelNo,session.context?.unit?.unitNo].some(value=>typeof value!=='string'||!value||/[\r\n]/.test(value)) || session.userLevel!==session.context.levelNo) invalid('A complete verified Ego account and context are required');
  try{const url=new URL(options.baseUrl??'https://friends.cqu.edu.cn/gateway');if(!['http:','https:'].includes(url.protocol)||url.username||url.password)invalid('Invalid friends base URL');}catch{invalid('Invalid friends base URL');}

  if (!Number.isSafeInteger(options.taskSpaceId) || options.taskSpaceId < 1) {
    throw error("Invalid Ego task space", FriendsErrorCode.InvalidInput);
  }
  const page = options.page ?? "p1";
  if (!/^p[1-9][0-9]*$/.test(page)) throw error("Invalid Ego page label", FriendsErrorCode.InvalidInput);
  const timeoutMs = options.timeoutMs ?? 300_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw error("Invalid Ego timeout", FriendsErrorCode.InvalidInput);
  }
}


export async function prepareVolunteerCertificationInEgo(options: EgoOptions): Promise<VolunteerCertificationEgoPreparationResult> {
  validateEgoOptions(options);
  const draft = parseVolunteerCertificationDraft(options.draft);
  if (!validateVolunteerCertificationDraft(draft, "complete").complete) invalid("The certification draft is incomplete");
  const client = createVolunteerCertificationClient({
    baseUrl:options.baseUrl ?? "https://friends.cqu.edu.cn/gateway",
    session:{token:options.session.token,userLevel:options.session.userLevel,accountUserNo:options.session.account.userNo,levelNo:options.session.context.levelNo,unitNo:options.session.context.unit.unitNo},
  });
  const source=await client.getCertificationSource(draft.activity.id);
  for(const studentNo of draft.includedStudentNos){
    const row=draft.registrations.find(item=>item.studentNo===studentNo)!;
    const current=source.registrations.find(item=>item.studentNo===studentNo);
    const post=source.activity.posts.find(item=>item.id===row.postId);
    if(!post||post.name!==row.postName || row.registrationId!==null && current?.registrationId!==row.registrationId) invalid("The selected roster or post changed; refresh the draft");
    if(row.registrationId===null){
      if(current) invalid("The manually added student now has a registration; refresh the draft");
      const student=await client.getStudent(studentNo);
      if(student.studentName!==row.studentName) invalid("The selected student name changed; refresh the draft");
    }
  }
  buildVolunteerCertificationPreparation(draft,source,{activity:draft.activity,rows:[],selectedStudentNos:[]},options.session);
  const runtime = new URL("./certification-page.js", import.meta.url).href;
  const input = {draft,source,session:options.session,page:options.page??"p1",url:targetUrl(options),dryRun:options.dryRun};
  const script = `
const task = await taskSpace(${options.taskSpaceId});
const {prepareCertificationPage} = await import(${JSON.stringify(runtime)});
try {
 const result = await prepareCertificationPage(task, ${JSON.stringify(input)});
 console.log("FRIENDS_CLI_CERTIFICATION_PREPARE:" + JSON.stringify(result));
} catch(error) {
 console.log("FRIENDS_CLI_CERTIFICATION_PREPARE:" + JSON.stringify({error:error.message,errorCode:error.code}));
}
`;
  let result:VolunteerCertificationEgoPreparationResult|undefined;
  const action=(v:unknown)=>record(v)&&['select-person','set-person','add-person'].includes(String(v.kind))&&typeof v.studentNo==='string';
  try {
    const raw=await runEgoJson<unknown>({script,command:options.command??"ego-browser",timeoutMs:(options.timeoutMs??300_000)+30_000,
      marker:"FRIENDS_CLI_CERTIFICATION_PREPARE:",failure:"Could not prepare the visible volunteer certification page; inspect it manually"});
    if(!record(raw)||(raw.handoff!==undefined&&raw.handoff!=='completed')||raw.submitted!==false||typeof raw.canPopulateWithoutOverwrite!=='boolean'||!Array.isArray(raw.actions)||!raw.actions.every(action)||
       !Array.isArray(raw.completedActions)||!raw.completedActions.every(action)||!Array.isArray(raw.preservedHumanChanges)||!Array.isArray(raw.unresolved)||
       !record(raw.page)||!record(raw.page.activity)||raw.page.activity.id!==draft.activity.id||!Array.isArray(raw.page.rows)||!strings(raw.page.selectedStudentNos)||
       (options.dryRun?raw.status!=='ready'||raw.dryRun!==true:raw.status!=='awaiting-user')||
       (options.dryRun?raw.executionError!==undefined&&!executionFailure(raw.executionError):!executionFailure(raw.executionError))) throw new Error('Incomplete Ego certification receipt');
    result=raw as unknown as VolunteerCertificationEgoPreparationResult;
    if(result.executionError || !options.dryRun&&result.handoff!=='completed') throw new Error(result.executionError?.message??'Ego handoff was not confirmed');
    return result;
  } catch(cause) {
    if(knownPrecondition(cause))throw cause;
    throw new FriendsError({code:FriendsErrorCode.UnknownOutcome,message:cause instanceof Error?cause.message:'Visible certification preparation is uncertain',
      recovery:{operation:'drafts.prepare',draftId:draft.id,activityId:draft.activity.id,pageLabel:options.page??'p1',
        completed:result?.completedActions.map(action=>action.kind+':'+action.studentNo)??[],inProgress:result?.inProgress,handoff:result?.handoff??'unknown',serverAcknowledged:false}});
  }
}

export function rejectVolunteerCertificationEgoSubmitInEgo(input: Parameters<typeof rejectVolunteerCertificationEgoSubmit>[0]): never {
  rejectVolunteerCertificationEgoSubmit(input);
}
