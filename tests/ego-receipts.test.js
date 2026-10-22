import assert from 'node:assert/strict';
import {test} from 'node:test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {prepareVolunteerCertificationInEgo,prepareVolunteerOfferingInEgo,prepareVolunteerActivityReviewInEgo} from '../dist/node.js';
import {setupCertification} from './fixtures/certification-setup.mjs';
import {setupOfferingEgo} from './fixtures/volunteer-offering-ego.mjs';
import {offeringInput,offeringSchool} from './fixtures/volunteer-offering-api.mjs';
import {reviewScenario} from './fixtures/volunteer-activity-reviews.mjs';
const exec=promisify(execFile);
async function configured(path,run){const previous=process.env.FRIENDS_EGO_FIXTURE_CONFIG;process.env.FRIENDS_EGO_FIXTURE_CONFIG=path;try{return await run();}finally{if(previous===undefined)delete process.env.FRIENDS_EGO_FIXTURE_CONFIG;else process.env.FRIENDS_EGO_FIXTURE_CONFIG=previous;}}
async function fixture(t,domain){
 if(domain==='certification'){
  const f=await setupCertification(t);await mkdir(f.env.FRIENDS_DRAFT_HOME,{mode:0o700});await writeFile(join(f.env.FRIENDS_DRAFT_HOME,'draft-1.json'),JSON.stringify(f.options.draft),{mode:0o600});
  return {config:f.config,observed:f.observed,sdk:()=>configured(f.config,()=>prepareVolunteerCertificationInEgo(f.options)),args:['drafts','prepare','draft-1','--via','ego','--ego-task-space','7','--ego-page','p2'],env:f.env};
 }
 if(domain==='offering'){
  const api=await offeringSchool(t),f=await setupOfferingEgo(t,{baseUrl:api.baseUrl}),value=offeringInput();
  const path=join(f.root,'input.json'),banner=join(f.root,'banner.png');await writeFile(banner,new Uint8Array([1]));await writeFile(path,JSON.stringify({...value,materials:{publicityPictures:[{path:banner}]}}));
  return {config:f.configPath,observed:f.observed,sdk:()=>prepareVolunteerOfferingInEgo({value,baseUrl:api.baseUrl,taskSpaceId:7,command:f.command}),args:['offerings','prepare','--input',path,'--via','ego','--ego-task-space','7'],env:{...process.env,FRIENDS_HOME:f.root,FRIENDS_BASE_URL:api.baseUrl,PATH:f.root+':'+process.env.PATH}};
 }
 const api=await reviewScenario();t.after(api.close);const home=await mkdtemp(join(tmpdir(),'friends-review-receipt-'));t.after(()=>rm(home,{recursive:true,force:true}));
 const html=join(home,'page.html'),config=join(home,'ego.json'),result=join(home,'result.json'),inputFile=join(home,'input.json');
 const input={type:'registration',id:'registration-1',decision:'refuse',message:'已核对',time:'2026-10-22'};
 const url=new URL('/mobile/volunteerManage/activityRegisterApprovalDetails?uuid=registration-1&activityId=offering-1&studentNo=20210002',api.baseUrl).href;
 await writeFile(html,'<div class="van-dialog"><div class="van-dialog__header">审批拒绝</div><textarea oninput="document.querySelector(\'output\').textContent=this.value"></textarea><input name="time" value="2026-10-22"><button onclick="fetch(\'/unsafe-final\',{method:\'POST\'})">确定</button></div><output></output>');
 await writeFile(config,JSON.stringify({html,url,result,frame:true,executeSession:true,token:'fixture-token',userLevel:'XY'}));await writeFile(inputFile,JSON.stringify({message:input.message,time:input.time}));
 const command=join(home,'ego-browser');await writeFile(command,`#!${process.execPath}\nawait import(${JSON.stringify(new URL('./fixtures/strict-ego.mjs',import.meta.url).href)});\n`,{mode:0o700});
 return {config,observed:async()=>JSON.parse(await readFile(result,'utf8')),sdk:()=>configured(config,()=>prepareVolunteerActivityReviewInEgo({input,baseUrl:api.baseUrl,taskSpaceId:7,command})),args:['volunteer','activity-reviews','prepare','registration-1','--type','registration','--decision','refuse','--via','ego','--ego-task-space','7','--input',inputFile],env:{...process.env,FRIENDS_HOME:home,FRIENDS_BASE_URL:api.baseUrl,FRIENDS_EGO_FIXTURE_CONFIG:config,PATH:home+':'+process.env.PATH}};
}
for(const domain of ['certification','review','offering'])test(`public ${domain} SDK and real CLI keep incomplete preparation receipts unknown`,async t=>{
 const f=await fixture(t,domain);
 for(const receipt of ['empty','malformed','noHandoff','invalidHandoff'])await t.test(receipt,async()=>{
  const config=JSON.parse(await readFile(f.config,'utf8'));config.receipt=receipt;await writeFile(f.config,JSON.stringify(config));
  await assert.rejects(f.sdk,error=>{assert.equal(error.code,'UNKNOWN_OUTCOME');assert.equal(error.retryable,false);assert.ok(error.recovery?.operation);assert.equal(error.recovery.handoff,'unknown');return true;});
  const sdkObserved=await f.observed();assert.ok(sdkObserved.fills.length>0);assert.equal(sdkObserved.submits,0);assert.equal(sdkObserved.handoffs,1);
  await assert.rejects(()=>exec(process.execPath,['dist/cli/main.js',...f.args],{env:f.env,timeout:30000}),error=>{assert.equal(error.code,7);const out=JSON.parse(error.stdout);assert.equal(out.error.code,'UNKNOWN_OUTCOME');assert.equal(out.error.retryable,false);assert.ok(out.error.recovery.operation);assert.equal(out.error.recovery.handoff,'unknown');return true;});
  const cliObserved=await f.observed();assert.ok(cliObserved.fills.length>0);assert.equal(cliObserved.submits,0);assert.equal(cliObserved.handoffs,1);
 });
});
