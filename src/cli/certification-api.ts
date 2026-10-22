import type {Command} from 'commander';
import {createVolunteerCertificationApi,FriendsError,FriendsErrorCode,parseVolunteerCertificationDraft,type VerifiedCourseSession} from '../index.js';
import {createCertificationDraftStore,loadSession} from '../node.js';
import {resolveQuerySession} from './session.js';
import {readJsonInput} from './json-input.js';
export const certificationApiSchemas={
 'certification.submit':{operation:'certification.submit',readonly:false,remoteReadonly:false,permission:'verified activity manager; independent explicit API intent',phases:['validate','submit','readback'],supportedVia:['api'],input:{draftId:'stored draft ID, or --input file|- exported draft',via:'api (required)',confirm:'required except --dry-run',dryRun:'validation and readonly requests only'},materials:'current school form has no attachment input; material-bearing drafts are rejected before writes',unknownOutcome:'exit 7; retain draft and read status; never automatically resubmit',verifiedWith:'public-source; controlled SDK and CLI'},
 'certification.status':{operation:'certification.status',readonly:true,remoteReadonly:true,permission:'verified activity manager',phases:['query'],supportedVia:['api','ego'],requestMode:'direct-api',input:{activityId:'activity UUID',via:'api|ego',egoTaskSpace:'required with ego'},verifiedWith:'public-source; controlled SDK and CLI'},
};
function invalid(message:string):never{throw new FriendsError({code:FriendsErrorCode.InvalidInput,message});}
function output(data:unknown,operation:string,via:string){process.stdout.write(`${JSON.stringify({schemaVersion:1,ok:true,data,meta:{operation,selectedEntry:via,requestMode:'direct-api'}})}\n`);}
export function registerCertificationApiCommands(program:Command,{baseUrl}:{baseUrl:string}){
 const certification=program.commands.find(command=>command.name()==='certification')??program.command('certification').description('Volunteer certification; Ego preparation requires human final submission');
 const client=(session:VerifiedCourseSession)=>createVolunteerCertificationApi({baseUrl,session:{token:session.token,userLevel:session.userLevel,accountUserNo:session.account.userNo,levelNo:session.context.levelNo,unitNo:session.context.unit.unitNo}});
 certification.command('submit').description('Independently submit a complete draft via API and read back; never completes an Ego task')
 .argument('[draftId]','stored draft ID').option('--input <file>','exported draft JSON file or - for stdin')
 .requiredOption('--via <path>','explicit api intent').option('--confirm','confirm the selected API submission').option('--dry-run','validate without remote writes').option('--json','stable JSON',true)
 .action(async(draftId:string|undefined,options:{input?:string;via:string;confirm?:boolean;dryRun?:boolean})=>{
  if(options.via!=='api') invalid('Only independent --via api submission is allowed; Ego requires human final submission');
  if(!options.dryRun && options.confirm!==true) invalid('--confirm is required for API submission');
  if(Boolean(draftId)===Boolean(options.input)) invalid('Choose exactly one stored draft ID or --input file|-');
  const draft=parseVolunteerCertificationDraft(options.input?await readJsonInput(options.input):await createCertificationDraftStore().load(draftId!));
  const session=await loadSession();
  output(await client(session).submit(draft,{via:'api',intent:'submit-volunteer-certification',confirm:options.confirm,dryRun:options.dryRun}),'certification.submit','api');
 });
 certification.command('status').description('Read school certification for an activity without resubmitting')
 .argument('<activityId>','activity UUID').option('--via <source>','query session source','api')
 .option('--ego-task-space <number>','existing Ego task space').option('--ego-page <label>','existing Ego page')
 .option('--level-no <value>','identity role').option('--unit-no <value>','identity unit').option('--json','stable JSON',true)
 .action(async(activityId:string,options:Record<string,string>)=>{const source=await resolveQuerySession(options,baseUrl);output(await client(source.session).status(activityId),'certification.status',source.entry);});
}
