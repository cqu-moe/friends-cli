/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
import {buildVolunteerCertificationPreparation,type CertificationPageSnapshot,type VolunteerCertificationPreparationAction} from './certification-prepare.js';
import {FriendsError,FriendsErrorCode} from './errors.js';
import type {VolunteerCertificationDraft} from './drafts.js';
import type {VolunteerCertificationSource} from './draft-source.js';

interface Page {
 url():Promise<string>;
 goto(url:string):Promise<unknown>;
 snapshot():Promise<unknown>;
 click(selector:string):Promise<unknown>;
 fill(selector:string,value:string):Promise<unknown>;
 waitForSelector(selector:string,options?:{state?:string;timeout?:number}):Promise<unknown>;
 waitForFunction<A>(fn:(arg:A)=>unknown,arg:A,options?:{timeout:number}):Promise<unknown>;
 evaluate<T,A>(fn:(arg:A)=>T,arg:A):Promise<Awaited<T>>;
}
interface Task {page(label:string):Page;handOff():Promise<unknown>}
interface Input {draft:VolunteerCertificationDraft;source:VolunteerCertificationSource;session:{token:string;userLevel:string;account:{userNo:string};context:{levelNo:string;unit:{unitNo:string}}};page:string;url:string;dryRun?:boolean}

/** Runs in Ego's Node process. Every write below is a visible, local form action. */
export async function prepareCertificationPage(task:Task,input:Input){
 const page=task.page(input.page);
 const target=new URL(input.url);
 const before=await page.url();
 // Existing tabs can hold unsaved work; navigate only an explicitly supplied blank tab.
 if(before==='about:blank') {
  if(input.dryRun) throw new FriendsError({code:FriendsErrorCode.InvalidInput,message:'Open the certification page before a dry-run'});
  await page.goto(target.href);
 }
 await page.waitForSelector('loc=css:.name-list',{timeout:15000});
 await page.snapshot();
 const facts=await page.evaluate(({origin,token,userLevel})=>{
  const frame=document.querySelector('iframe')?.contentDocument;
  const d=frame?.querySelector('.name-list')?frame:document;
  const w=d.defaultView!;
  const raw=w.localStorage.getItem('token_str');
  let current=raw;try {if(raw?.startsWith('{')){const parsed=JSON.parse(raw);current=parsed.token??parsed.data?.token??parsed.data;}}catch{return {matches:false,url:w.location.href};}
  return {matches:w.location.origin===origin && current===token && w.localStorage.getItem('userLevel_str')===userLevel,url:w.location.href};
 },{origin:target.origin,token:input.session.token,userLevel:input.session.userLevel});
 const current=new URL(facts.url);
 if(!facts.matches || current.pathname!==target.pathname || current.searchParams.get('uuid')!==input.draft.activity.id || current.searchParams.get('type')!=='attestApply') throw new FriendsError({code:FriendsErrorCode.PermissionDenied,message:'The visible certification page, account or role does not match the draft'});
 await page.waitForFunction(({name,count})=>{
  const d=document.querySelector('iframe')?.contentDocument??document;
  const nameCell=Array.from(d.querySelectorAll('.van-cell')).find(cell=>cell.querySelector('.van-cell__title')?.textContent==='活动名称');
  return (!name || nameCell?.querySelector('.van-cell__value')?.textContent===name) && d.querySelectorAll('.name-list .list-group').length>=count;
 },{name:input.source.activity.name,count:input.source.registrations.length},{timeout:15000});
 const candidates=[...input.source.registrations,...input.draft.registrations].filter((row,index,all)=>all.findIndex(item=>item.studentNo===row.studentNo)===index).map(row=>({studentNo:row.studentNo,studentName:row.studentName}));
 const capture=()=>page.evaluate(({candidates})=>{
  const frame=document.querySelector('iframe')?.contentDocument;
  const d=frame?.querySelector('.name-list')?frame:document;
  const text=(node:Element|null)=>node?.textContent?.replace(/\s+/g,' ').trim()||null;
  const cell=(label:string)=>[...d.querySelectorAll('.van-cell')].find(node=>text(node.querySelector('.van-cell__title'))===label)?.querySelector('.van-cell__value')??null;
  const rows=[...d.querySelectorAll('.name-list .list-group')].map(row=>{
   const studentName=text(row.querySelector('.user-name span:first-child'));
   const matches=candidates.filter(person=>person.studentName===studentName);
   const studentNo=matches.length===1?matches[0].studentNo:null;
   const checkbox=row.querySelector('[role="checkbox"]');
   const value=text(row.querySelector('.hours span:last-child'));
   return {studentNo,studentName,selected:checkbox?.getAttribute('aria-checked')==='true',durationHours:value===null?null:Number(value),postId:null};
  });
  const method=text(cell('认证方式'));
  return {activity:{id:new URL(d.defaultView!.location.href).searchParams.get('uuid')!,name:text(cell('活动名称')),organizationName:text(cell('组织单位')),positionSetMethod:method==='岗位时长'?'TIME':method==='签到+签退'?'SIGN':null},rows,selectedStudentNos:rows.filter(row=>row.selected).map(row=>row.studentNo).filter((id):id is string=>id!==null)};
 },{candidates});
 const initial=await capture();
 const preparation=buildVolunteerCertificationPreparation(input.draft,input.source,initial as CertificationPageSnapshot,input.session);
 if(input.dryRun) return {...preparation,status:'ready',dryRun:true,submitted:false,page:initial,completedActions:[]};
 const completedActions:VolunteerCertificationPreparationAction[]=[];
 let executionError: {code:string;message:string}|null=null;
 try {
  if(preparation.canPopulateWithoutOverwrite) for(const action of preparation.actions){
   const now=await capture();
   const index=now.rows.findIndex(row=>row.studentNo===action.studentNo);
   if(action.kind==='select-person'){
    if(index<0) throw new Error('The selected student is no longer visible');
    if(!now.rows[index].selected) await page.click(`loc=css:.name-list .list-group:nth-child(${index+1}) [role="checkbox"]`);
    completedActions.push(action);continue;
   }
   let panel:string;
   if(action.kind==='add-person'){
    if(index>=0) throw new Error('The student was added after inspection; preserve the page for review');
    await page.click('text="添加名单"');
    await page.waitForSelector('loc=css:.van-popup--right input[placeholder="学号/姓名"]',{state:'visible'});
    await page.snapshot();
    await page.fill('loc=css:.van-popup--right input[placeholder="学号/姓名"]',action.studentNo);
    await page.click('loc=css:.van-popup--right .van-search__action');
    await page.waitForSelector('loc=css:.van-popup--right .stu-info',{state:'visible',timeout:15000});
    const found=await page.evaluate((name)=>{const d=document.querySelector('iframe')?.contentDocument??document;const rows=[...d.querySelectorAll('.van-popup--right .stu-info')];return rows.length===1&&rows[0].querySelector('.stu-name')?.textContent?.trim().startsWith(name+' / ');},action.studentName);
    if(!found) throw new Error('The exact student search is ambiguous; review it manually');
    await page.click('loc=css:.van-popup--right .stu-info [role="checkbox"]');
    await page.click('loc=css:.search-footer .confirm');
    await page.waitForSelector('loc=css:.van-popup--right',{state:'hidden'});
    panel='.set-form';
    const identity=await page.evaluate(({studentNo})=>{const d=document.querySelector('iframe')?.contentDocument??document;return [...d.querySelectorAll('.set-form .van-cell')].some(cell=>cell.querySelector('.van-cell__title')?.textContent==='学号'&&cell.querySelector('.van-cell__value')?.textContent===studentNo);},{studentNo:action.studentNo});
    if(!identity) throw new Error('The selected visible student number differs from the draft');
   } else {
    if(index<0) throw new Error('The student is no longer visible');
    await page.click(`loc=css:.name-list .list-group:nth-child(${index+1}) button`);
    panel='.van-popup--center';
   }
   await page.waitForSelector(`loc=css:${panel} input[name="requiredCourseCount"]`,{state:'visible'});
   await page.snapshot();
   const fields=await page.evaluate(({panel})=>{const d=document.querySelector('iframe')?.contentDocument??document;const p=d.querySelector(panel)!;const post=p.querySelector<HTMLInputElement>('.field-select input')!;const hours=p.querySelector<HTMLInputElement>('input[name="requiredCourseCount"]')!;return {post:post?.value??'',hours:hours.value,disabled:hours.disabled};},{panel});
   const baseline=input.source.registrations.find(row=>row.studentNo===action.studentNo);
   const baselineHours=input.source.activity.positionSetMethod==='TIME'?baseline?.postDurationHours:baseline?.signDurationHours;
   if(action.kind==='set-person' && fields.hours!=='' && Number(fields.hours)!==action.durationHours && Number(fields.hours)!==baselineHours) throw new Error('A human changed the duration after inspection; preserve it for review');
   if(action.kind==='set-person' && fields.post!==action.postName && fields.post && fields.post!==baseline?.postName) throw new Error('A human changed the post; preserve it for review');
   if(fields.post!==action.postName){
    await page.click(`loc=css:${panel} .field-select input`);
    await page.waitForSelector('loc=css:.van-picker',{state:'visible'});
    await page.snapshot();
    await page.click(`loc=css:.van-picker-column__item:text-is(${JSON.stringify(action.postName)})`);
    await page.click('loc=css:.van-picker__confirm');
    await page.waitForSelector('loc=css:.van-picker',{state:'hidden'});
   }
   const hours=await page.evaluate(({panel})=>{const d=document.querySelector('iframe')?.contentDocument??document;const e=d.querySelector<HTMLInputElement>(`${panel} input[name="requiredCourseCount"]`)!;return {value:e.value,disabled:e.disabled};},{panel});
   if(hours.disabled && Number(hours.value)!==action.durationHours) throw new Error('The school fixes the selected post duration; review the differing draft hours');
   if(!hours.disabled) await page.fill(`loc=css:${panel} input[name="requiredCourseCount"]`,String(action.durationHours));
   // Only these two source-verified local buttons are allowed; global Save can write remotely.
   await page.click(`loc=css:${panel} ${action.kind==='add-person'?'.footer':'.save'} button`);
   await page.waitForSelector(`loc=css:${panel} input[name="requiredCourseCount"]`,{state:'hidden'});
   completedActions.push(action);
  }
 }catch(error){executionError={code:'UNKNOWN_OUTCOME',message:error instanceof Error?error.message:'Visible preparation interrupted'};}
 const finalPage=await capture();
 await page.snapshot();
 const result={...preparation,status:'awaiting-user' as const,submitted:false as const,handoff:'completed' as const,completedActions,page:finalPage,executionError};
 await task.handOff();
 return result;
}
