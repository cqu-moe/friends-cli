import assert from 'node:assert/strict';
import {test} from 'node:test';
import {writeFile,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import * as nodeSdk from '../dist/node.js';
import {courseReviewScenario,reviewInput} from './fixtures/course-reviews.mjs';
import {courseCli,cliJson} from './fixtures/course-review-cli.mjs';

async function pageFixture(cli,api,type,decision,mode='empty') {
  const input=reviewInput(type,decision), html=join(cli.home,'page.html'),config=join(cli.home,'ego.json'),result=join(cli.home,'result.json');
  const params=type==='offering'?'uuid=course-apply-1&handleType=EJXY':'uuid=course-reg-1&studentNo=20210002&curriculumId=course-apply-1';
  const route=type==='offering'?'applyApprovalDetail':'reportApprovalDetail';
  const url=new URL('/mobile/course/'+route+'?'+params,api.baseUrl).href;
  const human=mode==='human',title=mode==='different'?'审批通过':{pass:'审批通过',back:'审批打回',refuse:'审批拒绝'}[decision];
  await writeFile(html,`<div class="action-bar"><button onclick="openDialog('审批通过')">通过</button>${type==='offering'?'<button onclick="openDialog(\'审批打回\')">打回</button>':''}<button onclick="openDialog('审批拒绝')">拒绝</button><button onclick="fetch('/unsafe-save',{method:'POST'})">保存</button></div><div class="van-dialog" style="display:${human||mode==='different'?'block':'none'}"><div class="van-dialog__header">${title}</div><form onsubmit="fetch('/unsafe-final',{method:'POST'});return false"><textarea oninput="document.querySelector('#mirror').textContent=this.value">${human?'人工意见':''}</textarea><input name="time" readonly value="${human?'2026-10-21':'2026-10-23'}"><button class="van-dialog__confirm" type="submit">确定</button></form></div><output id="mirror"></output><script>function openDialog(title){document.querySelector('.van-dialog__header').textContent=${mode==='broken'?"'未识别对话框'":'title'};document.querySelector('.van-dialog').style.display='block'}</script>`);
  await writeFile(config,JSON.stringify({html,url,result,frame:true,executeSession:true,token:'fixture-token',userLevel:'XY'}));
  const command=resolve('tests/fixtures/strict-ego.mjs'),bin=join(cli.home,'ego-browser');
  await writeFile(bin,`#!/bin/sh\nexec '${process.execPath}' '${command}' "$@"\n`,{mode:0o755});
  return {input,command,config,result,env:{FRIENDS_EGO_FIXTURE_CONFIG:config,PATH:cli.home+':'+process.env.PATH}};
}
async function viaSdk(page,api,run) {
  const old=process.env.FRIENDS_EGO_FIXTURE_CONFIG;process.env.FRIENDS_EGO_FIXTURE_CONFIG=page.config;
  try {return await run(()=>nodeSdk.prepareCourseReviewInEgo({input:page.input,taskSpaceId:7,page:'p2',command:page.command,baseUrl:api.baseUrl}));}
  finally {if(old===undefined)delete process.env.FRIENDS_EGO_FIXTURE_CONFIG;else process.env.FRIENDS_EGO_FIXTURE_CONFIG=old;}
}

test('public SDK and real course CLI execute iframe DOM callbacks for each allowed decision without submitting',async t=>{
  const api=await courseReviewScenario();t.after(api.close);const cli=await courseCli(t,api);
  for(const [type,decisions] of [['offering',['pass','back','refuse']],['registration',['pass','refuse']]])for(const decision of decisions){
    const page=await pageFixture(cli,api,type,decision);
    await assert.rejects(()=>nodeSdk.prepareCourseReviewInEgo({input:page.input,taskSpaceId:7,command:page.command,baseUrl:api.baseUrl,submit:true}),{code:'INVALID_INPUT'});
    const prepared=await viaSdk(page,api,run=>run());
    assert.equal(prepared.submitted,false);assert.equal(prepared.handoff,'completed');assert.equal(prepared.status,'awaiting-user');
    const observed=JSON.parse(await readFile(page.result,'utf8'));
    assert.equal(observed.handoffs,1);assert.equal(observed.navigations,0);assert.equal(observed.submits,0);assert.equal(observed.fills.length,1);
    assert.match(observed.html,/<output id="mirror">资料已核对<\/output>/);
    assert.equal(observed.clicks.length,1);assert.doesNotMatch(observed.clicks.join(','),/确定|confirm|保存/);
    const cliResult=await cli.run(['courses','reviews','prepare',page.input.id,'--type',type,'--decision',decision,'--via','ego','--ego-task-space','7','--ego-page','p2','--input','-'],JSON.stringify({message:page.input.message,time:page.input.time}),page.env);
    assert.equal(cliJson(cliResult).data.submitted,false);assert.equal(cliResult.stderr,'');
    const cliObserved=JSON.parse(await readFile(page.result,'utf8'));assert.equal(cliObserved.clicks.length,1);assert.equal(cliObserved.fills.length,1);assert.equal(cliObserved.submits,0);assert.equal(cliObserved.handoffs,1);assert.match(cliObserved.html,/<output id="mirror">资料已核对<\/output>/);
  }
  assert.equal(api.writes().length,0);assert.deepEqual(api.violations,[]);
});

test('real course CLI supports Ego list/show and visible preparation, preserves human fields and cannot accept --yes',async t=>{
  const api=await courseReviewScenario();t.after(api.close);const cli=await courseCli(t,api);
  for(const type of ['offering','registration']){
    const page=await pageFixture(cli,api,type,'refuse','human');
    const preserved=await viaSdk(page,api,run=>run());
    assert.deepEqual(preserved.manualFields,['preserved-human-message','review-date']);
    const sdkObserved=JSON.parse(await readFile(page.result,'utf8'));assert.equal(sdkObserved.clicks.length,0);assert.equal(sdkObserved.fills.length,0);assert.equal(sdkObserved.submits,0);
    for(const args of [['list'],['show',page.input.id]]){
      const result=await cli.run(['courses','reviews',...args,'--type',type,'--via','ego','--ego-task-space','7','--ego-page','p2'],undefined,page.env);
      assert.equal(cliJson(result).meta.requestMode,'direct-api');assert.equal(result.stderr,'');
      const observed=JSON.parse(await readFile(page.result,'utf8'));assert.equal(observed.clicks.length,0);assert.equal(observed.fills.length,0);assert.equal(observed.submits,0);
    }
    const file=join(cli.home,'review.json');await writeFile(file,JSON.stringify({message:page.input.message,time:page.input.time}));
    const args=['courses','reviews','prepare',page.input.id,'--type',type,'--decision','refuse','--via','ego','--ego-task-space','7','--ego-page','p2','--input',file];
    const result=await cli.run(args,undefined,page.env),prepared=cliJson(result).data;
    assert.equal(prepared.submitted,false);assert.ok(prepared.manualFields.includes('preserved-human-message'));assert.ok(prepared.manualFields.includes('review-date'));assert.equal(result.stderr,'');
    const observed=JSON.parse(await readFile(page.result,'utf8'));assert.equal(observed.fills.length,0);assert.equal(observed.clicks.length,0);assert.equal(observed.submits,0);assert.equal(observed.handoffs,1);assert.match(observed.html,/人工意见/);
    assert.equal(cliJson(await cli.run([...args,'--yes'],undefined,page.env),2).error.code,'INVALID_INPUT');
  }
  assert.equal(api.writes().length,0);assert.deepEqual(api.violations,[]);
});

test('course Ego SDK preserves a different human decision and SDK/CLI report partial preparation as unknown without another action',async t=>{
  const api=await courseReviewScenario();t.after(api.close);const cli=await courseCli(t,api);
  for(const type of ['offering','registration']){
    const human=await pageFixture(cli,api,type,'refuse','different');
    const result=await viaSdk(human,api,run=>run());assert.equal(result.status,'needs-user');assert.deepEqual(result.manualFields,['different-open-decision']);
    const saved=JSON.parse(await readFile(human.result,'utf8'));assert.equal(saved.clicks.length,0);assert.equal(saved.fills.length,0);assert.equal(saved.submits,0);
    const broken=await pageFixture(cli,api,type,'refuse','broken');
    await viaSdk(broken,api,async run=>assert.rejects(run,{code:'UNKNOWN_OUTCOME'}));
    const fields=JSON.stringify({message:broken.input.message,time:broken.input.time});
    const failure=await cli.run(['courses','reviews','prepare',broken.input.id,'--type',type,'--decision','refuse','--via','ego','--ego-task-space','7','--ego-page','p2','--input','-'],fields,broken.env);
    const error=cliJson(failure,7).error;assert.equal(error.code,'UNKNOWN_OUTCOME');assert.equal(error.retryable,false);assert.deepEqual(error.recovery.completed,['opened-decision']);
    const observed=JSON.parse(await readFile(broken.result,'utf8'));assert.equal(observed.clicks.length,1);assert.equal(observed.submits,0);assert.equal(observed.handoffs,1);
  }
  assert.equal(api.writes().length,0);
});


test('public course review SDK and CLI bind the acted-on iframe route and fresh session',async t=>{
 const api=await courseReviewScenario();t.after(api.close);const cli=await courseCli(t,api);
 for(const mismatch of ['url','token','role']){
  const page=await pageFixture(cli,api,'registration','refuse');
  const config=JSON.parse(await readFile(page.config,'utf8'));config.outerUrl=config.url;
  if(mismatch==='url')config.url=config.url.replace('course-reg-1','other-registration');
  if(mismatch==='token')config.preparationToken='different-token';
  if(mismatch==='role')config.preparationRole='XS';
  await writeFile(page.config,JSON.stringify(config));
  await viaSdk(page,api,run=>assert.rejects(run,{code:'PERMISSION_DENIED'}));
  const result=await cli.run(['courses','reviews','prepare',page.input.id,'--type','registration','--decision','refuse','--via','ego','--ego-task-space','7','--ego-page','p2','--input','-'],JSON.stringify({message:page.input.message,time:page.input.time}),page.env);
  assert.equal(cliJson(result,4).error.code,'PERMISSION_DENIED');
  const observed=JSON.parse(await readFile(page.result,'utf8'));
  for(const count of ['fills','clicks'])assert.deepEqual(observed[count],[]);
  assert.equal(observed.navigations,0);assert.equal(observed.handoffs,0);assert.equal(observed.submits,0);
 }
 assert.equal(api.writes().length,0);
});
