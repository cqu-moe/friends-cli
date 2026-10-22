import {parseVolunteerCertificationDraft,type VolunteerCertificationDraft} from './drafts.js';
import {createVolunteerCertificationClient} from './draft-source.js';
import {createCertificationDraftStore} from './draft-store.js';
import {readVerifiedEgoSession} from './node.js';
import {runEgoJson} from './certification-ego.js';
import type {CertificationPageSnapshot} from './certification-prepare.js';
import {FriendsError,FriendsErrorCode} from './errors.js';

export interface CaptureVolunteerCertificationOptions {
 draft:VolunteerCertificationDraft;
 expectedRevision:number;
 userReturnedControl:true;
 taskSpaceId:number;
 page?:string;
 baseUrl?:string;
 command?:string;
 timeoutMs?:number;
 draftRoot?:string;
}
function invalid(message:string):never{throw new FriendsError({code:FriendsErrorCode.InvalidInput,message});}

/** Explicit human return is required before any browser access. Capture never prepares or submits. */
export async function captureVolunteerCertificationFromEgo(options:CaptureVolunteerCertificationOptions){
 if(options.userReturnedControl!==true)invalid('Capture requires explicit userReturnedControl; --yes cannot return browser control');
 if(!Number.isSafeInteger(options.taskSpaceId)||options.taskSpaceId<1)invalid('Invalid Ego task space');
 if(!/^p[1-9][0-9]*$/.test(options.page??'p1'))invalid('Invalid Ego page');
 if(!Number.isSafeInteger(options.expectedRevision)||options.expectedRevision<0)invalid('Invalid expected revision');
 const timeoutMs=options.timeoutMs??300000;
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1)invalid('Invalid timeout');
 const draft=parseVolunteerCertificationDraft(options.draft);
 const command=options.command??'ego-browser',page=options.page??'p1';
 await runEgoJson({command,timeoutMs,marker:'FRIENDS_CLI_CONTROL:',failure:'Could not resume the explicitly returned Ego task',script:`await takeOverTaskSpace(${options.taskSpaceId});console.log('FRIENDS_CLI_CONTROL:'+JSON.stringify({returned:true}));`});
 const session=await readVerifiedEgoSession({taskSpaceId:options.taskSpaceId,page,command,baseUrl:options.baseUrl,selector:{levelNo:draft.binding.levelNo,unitNo:draft.binding.unitNo}});
 const client=createVolunteerCertificationClient({baseUrl:options.baseUrl??"https://friends.cqu.edu.cn/gateway",session:{token:session.token,userLevel:session.userLevel,accountUserNo:session.account.userNo,levelNo:session.context.levelNo,unitNo:session.context.unit.unitNo}});
 const source=await client.getCertificationSource(draft.activity.id);
 if(Object.keys(draft.binding).some(key=>draft.binding[key as keyof typeof draft.binding]!==source.binding[key as keyof typeof source.binding])||source.activity.positionSetMethod!==draft.activity.positionSetMethod)throw new FriendsError({code:FriendsErrorCode.PermissionDenied,message:'The fresh account, organization or activity no longer matches the draft'});
 const url=new URL('/mobile/volunteerManage/campusActivityCerApply',options.baseUrl??'https://friends.cqu.edu.cn/gateway');url.searchParams.set('uuid',draft.activity.id);url.searchParams.set('type','attestApply');
 const runtime=new URL('./certification-page.js',import.meta.url).href;
 const captured=await runEgoJson<{page:CertificationPageSnapshot;pending:string[];completeRoster:boolean}>({command,timeoutMs,marker:'FRIENDS_CLI_CERTIFICATION_CAPTURE:',failure:'Could not capture the current page; local draft was not replaced',script:`
 const task=await taskSpace(${options.taskSpaceId});
 const {captureCertificationPage}=await import(${JSON.stringify(runtime)});
 try{const result=await captureCertificationPage(task,${JSON.stringify({draft,source,session,page,url:url.href})});console.log('FRIENDS_CLI_CERTIFICATION_CAPTURE:'+JSON.stringify(result));}
 catch(error){console.log('FRIENDS_CLI_CERTIFICATION_CAPTURE:'+JSON.stringify({error:error.message,errorCode:error.code}));}
 `});
 if(captured.page.activity.name!==source.activity.name||captured.page.activity.organizationName!==source.activity.organizationName||captured.page.activity.positionSetMethod!==source.activity.positionSetMethod)throw new FriendsError({code:FriendsErrorCode.PermissionDenied,message:'The current visible activity does not match the fresh school context'});
 if(!captured.completeRoster)return {status:'needs-input' as const,submitted:false as const,draft,pending:captured.pending,saved:false as const};
 const next:VolunteerCertificationDraft=structuredClone(draft);next.revision++;next.activity=source.activity;next.includedStudentNos=[];next.durations={};
 const seen=new Set<string>();
 for(const row of captured.page.rows){
  if(!row.studentNo||seen.has(row.studentNo))invalid('Captured roster has missing or duplicate student numbers');seen.add(row.studentNo);
  let registration=source.registrations.find(r=>r.studentNo===row.studentNo);
  if(!registration){const student=await client.getStudent(row.studentNo);if(student.studentName!==row.studentName)invalid('The captured student identity does not match the school');registration={registrationId:null,studentNo:row.studentNo,studentName:row.studentName,postId:null,postName:null,postDurationHours:null,signDurationHours:null,isApplied:false,upstreamPreselected:false};}
  if(registration.studentName!==row.studentName)invalid('The captured student name does not match the school');
  const post=source.activity.posts.find(p=>p.id===row.postId);
  const fresh={...registration,postId:post?.id??null,postName:post?.name??null,postDurationHours:post?.durationHours??null};
  const index=next.registrations.findIndex(r=>r.studentNo===row.studentNo);if(index<0)next.registrations.push(fresh);else next.registrations[index]=fresh;
  if(row.selected)next.includedStudentNos.push(row.studentNo);
  if(row.durationHours!==null&&Number.isFinite(row.durationHours)&&row.durationHours>=0&&row.durationHours<=99999.9&&Math.abs(row.durationHours*10-Math.round(row.durationHours*10))<1e-7)next.durations[row.studentNo]=row.durationHours;
  else captured.pending.push(`incomplete-duration:${row.studentNo}`);
 }
 for(const row of draft.registrations)if(!seen.has(row.studentNo))captured.pending.push(`missing-from-page:${row.studentNo}`);
 // This form has no material controls; preserve local references, never invent recoverable browser files.
 for(const material of next.materials)captured.pending.push(`material-not-in-form:${material.id}`);
 parseVolunteerCertificationDraft(next);
 const store=createCertificationDraftStore({root:options.draftRoot});
 const path=await store.save(next,{expectedRevision:options.expectedRevision});
 return {status:captured.pending.length?'needs-input' as const:'captured' as const,submitted:false as const,draft:next,path,pending:captured.pending,saved:true as const};
}
