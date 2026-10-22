import {readVerifiedEgoSession} from './node.js';
import {createOrganizationActivityClient,validateOrganizationActivityOfferingInput} from './organization-activities.js';
import {runEgoJson} from './certification-ego.js';
import {FriendsError,FriendsErrorCode} from './errors.js';
import type {prepareOrganizationActivityPage} from './organization-activity-page.js';
export async function prepareOrganizationActivityOfferingInEgo(options: {
  input: unknown; taskSpaceId: number; page?: string; levelNo?: string; unitNo?: string; baseUrl?: string; command?: string; timeoutMs?: number; dryRun?: boolean;
}) {
  const invalid = (message: string): never => {throw new FriendsError({code:FriendsErrorCode.InvalidInput,message});};
  if (!options || !Number.isSafeInteger(options.taskSpaceId) || options.taskSpaceId < 1 || !/^p[1-9][0-9]*$/.test(options.page ?? 'p1')) invalid('Invalid Ego task space or page');
  if (['yes','submit','confirmation','retry','apiFallback'].some(key => key in options)) invalid('Ego only prepares the visible form; the user must personally save and submit');
  if (options.page !== undefined && typeof options.page !== 'string' || options.command !== undefined && (typeof options.command !== 'string' || !options.command) || options.baseUrl !== undefined && typeof options.baseUrl !== 'string') invalid('Invalid Ego page, command or base URL');
  try {const url=new URL(options.baseUrl ?? 'https://friends.cqu.edu.cn/gateway');if (!['http:','https:'].includes(url.protocol) || url.username || url.password) invalid('Invalid Ego base URL');} catch {invalid('Invalid Ego base URL');}
  const timeoutMs = options.timeoutMs ?? 120000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || options.dryRun !== undefined && typeof options.dryRun !== 'boolean') invalid('Invalid Ego timeout or dry-run');
  const input = validateOrganizationActivityOfferingInput(options.input);
  const baseUrl = options.baseUrl ?? 'https://friends.cqu.edu.cn/gateway';
  const session = await readVerifiedEgoSession({taskSpaceId:options.taskSpaceId,page:options.page,baseUrl,command:options.command,timeoutMs,selector:options.levelNo === undefined && options.unitNo === undefined ? undefined : {levelNo:options.levelNo,unitNo:options.unitNo}});
  const plan = await createOrganizationActivityClient({baseUrl,session,timeoutMs}).prepare(input);
  const runtime = new URL('./organization-activity-page.js',import.meta.url).href;
  const data = {...input,materials:undefined,registration:undefined,term:undefined,page:options.page ?? 'p1',url:new URL('/mobile/acManage/stuFirst?type=ADD',baseUrl).href,
    token:session.token,userLevel:session.userLevel,accountUserNo:session.account.userNo,organizationName:plan.firstStep.organizationName,attachmentCount:input.materials.attachments!.length,dryRun:options.dryRun === true};
  type Result = Awaited<ReturnType<typeof prepareOrganizationActivityPage>>;
  const script = `const task=await taskSpace(${options.taskSpaceId});const {prepareOrganizationActivityPage}=await import(${JSON.stringify(runtime)});
try{const result=await prepareOrganizationActivityPage(task,${JSON.stringify(data)});console.log('FRIENDS_ORGANIZATION_ACTIVITY:'+JSON.stringify(result));}
catch(error){console.log('FRIENDS_ORGANIZATION_ACTIVITY:'+JSON.stringify({error:error.message,errorCode:error.code}));}`;
  let result: Result;
  try {
    result = await runEgoJson<Result>({script,command:options.command ?? 'ego-browser',timeoutMs,marker:'FRIENDS_ORGANIZATION_ACTIVITY:',failure:'Visible organization activity preparation returned no reliable result'});
    if (!result || result.submitted !== false || !['ready','awaiting-user'].includes(result.status) || !Array.isArray(result.completedActions) || !Array.isArray(result.manualFields) || !Array.isArray(result.preservedFields)) throw new Error('Invalid visible result');
  } catch (error) {
    if (error instanceof FriendsError && [FriendsErrorCode.PermissionDenied,FriendsErrorCode.InvalidInput].some(code => code === error.code)) throw error;
    throw new FriendsError({code:FriendsErrorCode.UnknownOutcome,message:'Visible organization activity preparation may be partial; inspect the existing page',recovery:{operation:'organization-activities.prepare',organizationId:input.organizationId,pageLabel:options.page ?? 'p1',completed:[],serverAcknowledged:false},cause:error});
  }
  if (result.executionError) throw new FriendsError({code:FriendsErrorCode.UnknownOutcome,message:result.executionError,recovery:{operation:'organization-activities.prepare',organizationId:input.organizationId,pageLabel:result.pageLabel,completed:result.completedActions,inProgress:result.inProgress,serverAcknowledged:false}});
  return {...result,requested:{organizationName:plan.firstStep.organizationName,activityName:input.activityName,beginTime:input.beginTime,endTime:input.endTime,registration:input.registration,materials:plan.materials},verification:{account:session.account,context:session.context}};
}
