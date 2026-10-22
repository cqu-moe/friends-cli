import assert from 'node:assert/strict';import {test} from 'node:test';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {prepareVolunteerActivityReviewInEgo} from '../dist/node.js';
import {reviewScenario} from './fixtures/volunteer-activity-reviews.mjs';

test('public Ego SDK and CLI prepare real DOM decisions, preserve human input, and never confirm',async t=>{
 const api=await reviewScenario();t.after(api.close);const home=await mkdtemp(join(tmpdir(),'friends-review-ego-'));t.after(()=>rm(home,{recursive:true,force:true}));
 const html=join(home,'page.html'),config=join(home,'config.json'),result=join(home,'result.json');
 const command=resolve('tests/fixtures/strict-ego.mjs');
 for(const kind of ['offering','registration'])for(const mode of ['empty','human']){
  const input={type:kind,id:kind+'-1',decision:'refuse',message:'填写意见',time:'2026-10-22',...(kind==='offering'?{isSafeEducation:0}:{})};
  const url=new URL(kind==='offering'?'/mobile/volunteerManage/campusApprovalDetail?uuid=offering-1&handleType=YJ01&isInstructor=false&isGuidanceUnit=false':'/mobile/volunteerManage/activityRegisterApprovalDetails?uuid=registration-1&activityId=offering-1&studentNo=20210002',api.baseUrl).href;
  await writeFile(html,`<style>.van-dialog{display:${mode==='human'?'block':'none'}}</style><div class="action-bar"><button onclick="openDialog('审批通过')">通过</button><button onclick="openDialog('审批拒绝')">拒绝</button><button onclick="fetch('/unsafe-save',{method:'POST'})">保存</button></div><div class="van-dialog" role="dialog"><div class="van-dialog__header">审批拒绝</div><textarea>${mode==='human'?'人工补充意见':''}</textarea><input name="time" value="2026-10-22">${kind==='offering'?'<div role="radio" aria-checked="false" onclick="this.setAttribute(\'aria-checked\',\'true\')">是</div><div role="radio" aria-checked="false" onclick="this.setAttribute(\'aria-checked\',\'true\')">否</div>':''}<button class="van-dialog__confirm" onclick="fetch('/unsafe-final',{method:'POST'})">确定</button></div><script>function openDialog(title){document.querySelector('.van-dialog__header').textContent=title;document.querySelector('.van-dialog').style.display='block'}</script>`);
  await writeFile(config,JSON.stringify({html,url,result,executeSession:true,token:'fixture-token',userLevel:'XY'}));
  const old=process.env.FRIENDS_EGO_FIXTURE_CONFIG;process.env.FRIENDS_EGO_FIXTURE_CONFIG=config;
  try {
   const prepared=await prepareVolunteerActivityReviewInEgo({input,taskSpaceId:7,page:'p2',command,baseUrl:api.baseUrl});
   assert.equal(prepared.submitted,false);assert.equal(prepared.handoff,'completed');
   const observed=JSON.parse(await readFile(result,'utf8'));assert.equal(observed.submits,0);assert.equal(observed.navigations,0);assert.equal(observed.handoffs,1);
   assert.equal(observed.fills.length,mode==='empty'?1:0);assert.equal(observed.clicks.some(v=>v.includes('确定')||v.includes('confirm')||v.includes('保存')),false);
   if(mode==='human')assert.ok(prepared.manualFields.includes('preserved-human-message'));
  }finally{if(old===undefined)delete process.env.FRIENDS_EGO_FIXTURE_CONFIG;else process.env.FRIENDS_EGO_FIXTURE_CONFIG=old;}
  const bin=join(home,'ego-browser');await writeFile(bin,`#!/bin/sh\nexec '${process.execPath}' '${command}' "$@"\n`,{mode:0o755});
  const fields={message:input.message,time:input.time,...(kind==='offering'?{isSafeEducation:0}:{})};const json=join(home,'input.json');await writeFile(json,JSON.stringify(fields));
  const executed=await promisify(execFile)(process.execPath,['dist/cli/main.js','volunteer','activity-reviews','prepare',kind+'-1','--type',kind,'--decision','refuse','--via','ego','--ego-task-space','7','--ego-page','p2','--input',json],{env:{...process.env,PATH:home+':'+process.env.PATH,FRIENDS_EGO_FIXTURE_CONFIG:config,FRIENDS_BASE_URL:api.baseUrl,FRIENDS_HOME:home}});
  assert.equal(JSON.parse(executed.stdout).data.submitted,false);assert.equal(JSON.parse(executed.stdout).meta.requestMode,'visible-ui');assert.equal(executed.stderr,'');
 }
 assert.equal(api.requests.some(r=>/\/(pass|refuse|callback)$/.test(r.path)||r.path.includes('unsafe')),false);
});
