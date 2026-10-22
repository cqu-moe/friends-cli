import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createOrganizationParticipationClient} from '../dist/index.js';
import {participationScenario,participationSession} from './fixtures/organization-participation.mjs';
test('organization participation SDK reads independent activity IDs, personal records and conditions',async t=>{
 const api=await participationScenario();t.after(api.close);const client=createOrganizationParticipationClient({baseUrl:api.baseUrl,session:participationSession});
 const list=await client.list({keyword:'示例'});assert.equal(list.items[0].activityId,'org-activity-1');assert.equal(list.page,1);assert.equal(list.hasMore,false);
 const detail=await client.get('org-activity-1');assert.equal(detail.eligibility.register,true);assert.equal(detail.registration.id,null);assert.equal(detail.questions[0].id,'q-1');
 await client.list({mine:true});assert.equal(api.requests.find(r=>r.path.endsWith('/apply-info/my-apply-list')).body.userNo,'20210001');
 api.state.detailId='wrong-domain';await assert.rejects(()=>client.get('org-activity-1'),{code:'NETWORK_PROTOCOL_ERROR'});
 assert.equal(api.requests.filter(r=>r.path.endsWith('/enroll-info')||r.method==='DELETE').length,0);
});
test('organization SDK prepares without writes, validates questionnaire and sends one confirmed registration or exit',async t=>{
 const api=await participationScenario();t.after(api.close);const client=createOrganizationParticipationClient({baseUrl:api.baseUrl,session:participationSession});
 api.questions.push({uuid:'q-2',title:'选择服务',itemType:'2',isMandatory:true,respDtoList:[{optionName:'协作'},{optionName:'布置'}]});
 const input={activityId:'org-activity-1',action:'register',answers:{'q-1':'参加服务','q-2':['布置','协作']}};
 await assert.rejects(()=>client.prepare({...input,answers:{'q-1':'hi','q-2':['unknown']}}),{code:'INVALID_INPUT'});
 const plan=await client.prepare(input);assert.equal(plan.submitted,false);assert.equal(plan.payload.questionnaireInfoRespDtoList[1].write,'布置,协作');
 await assert.rejects(()=>client.execute(plan,{via:'ego',intent:'organization-participation',confirm:true}),{code:'INVALID_INPUT'});
 assert.equal(api.requests.filter(r=>r.path.endsWith('/enroll-info')).length,0);
 const registered=await client.execute(plan,{via:'api',intent:'organization-participation',confirm:true});assert.equal(registered.readback,'matched');assert.equal(registered.registrationId,'org-registration-1');
 await assert.rejects(()=>client.prepare(input),{code:'BUSINESS_REJECTED'});await assert.rejects(()=>client.prepare({activityId:input.activityId,action:'exit'}),{code:'BUSINESS_REJECTED'});
 api.row.applicationCode=7;const exit=await client.prepare({activityId:input.activityId,action:'exit'});assert.equal((await client.execute(exit,{via:'api',intent:'organization-participation',confirm:true})).readback,'matched');
 const writes=api.requests.filter(r=>r.path.endsWith('/enroll-info')||r.method==='DELETE');assert.equal(writes.length,2);assert.equal(writes[0].body.activityId,'org-activity-1');assert.equal(writes[0].body.questionnaireInfoRespDtoList[0].activityId,'org-activity-1');assert.match(writes[1].path,/exit\/org-activity-1$/);
});
test('organization SDK blocks changed, closed, restricted and unknown states without speculative writes',async t=>{
 const api=await participationScenario();t.after(api.close);const client=createOrganizationParticipationClient({baseUrl:api.baseUrl,session:participationSession});const input={activityId:'org-activity-1',action:'register',answers:{'q-1':'示例'}};const original=structuredClone(api.row);
 for(const patch of [{isCancel:true},{isOpenEnrollment:false},{deadline:'2020-01-02 00:00'},{openTime:'2099-01-01 00:00'},{deadline:'2099-02-30 00:00'},{isEnrollPower:1,isOrganization:false},{application:true,applicationCode:123},{application:null}]){Object.assign(api.row,original,patch);assert.equal((await client.get(input.activityId)).eligibility.register,false);await assert.rejects(()=>client.prepare(input),{code:'BUSINESS_REJECTED'});}
 Object.assign(api.row,original);const plan=await client.prepare(input);api.row.activityName='changed';await assert.rejects(()=>client.execute(plan,{via:'api',intent:'organization-participation',confirm:true}),{code:'BUSINESS_REJECTED'});
 Object.assign(api.row,original);const forged=await client.prepare(input);forged.payload.activityId='another';await assert.rejects(()=>client.execute(forged,{via:'api',intent:'organization-participation',confirm:true}),{code:'INVALID_INPUT'});
 api.state.account='other';await assert.rejects(()=>client.prepare(input),{code:'AUTH_REQUIRED'});api.state.account='20210001';api.state.mode='denied';await assert.rejects(()=>client.list(),{code:'PERMISSION_DENIED'});
 assert.equal(api.requests.filter(r=>r.path.endsWith('/enroll-info')||r.method==='DELETE').length,0);
});
test('organization SDK preserves lost acknowledgement as unknown even after a matching readback, and never retries',async t=>{
 for(const mode of ['lost','lost-unavailable','reject']){const api=await participationScenario();t.after(api.close);api.state.mode=mode;const client=createOrganizationParticipationClient({baseUrl:api.baseUrl,session:participationSession});const plan=await client.prepare({activityId:'org-activity-1',action:'register',answers:{'q-1':'示例'}});const intent={via:'api',intent:'organization-participation',confirm:true};
 await assert.rejects(()=>client.execute(plan,intent),error=>{assert.equal(error.code,mode==='reject'?'BUSINESS_REJECTED':'UNKNOWN_OUTCOME');if(mode!=='reject'){assert.equal(error.retryable,false);assert.equal(error.recovery.readback,mode==='lost'?'matched':'unavailable');}return true;});
 await assert.rejects(()=>client.execute(plan,intent));assert.equal(api.requests.filter(r=>r.path.endsWith('/enroll-info')).length,1);
 }
});
test('organization questionnaire validates dates, numbers, resource groups and scan budgets at the public SDK',async t=>{
 const api=await participationScenario();t.after(api.close);const client=createOrganizationParticipationClient({baseUrl:api.baseUrl,session:participationSession});
 api.questions.splice(0,api.questions.length,{uuid:'q-date',title:'时间',itemType:'32',isMandatory:true},{uuid:'q-number',title:'人数',itemType:'33',isMandatory:true},{uuid:'q-file',title:'附件',itemType:'421',isMandatory:true});
 const input={activityId:'org-activity-1',action:'register',answers:{'q-date':'2026-11-02 09:00','q-number':'2','q-file':'group-1'}};
 const plan=await client.prepare(input);assert.equal(plan.payload.questionnaireInfoRespDtoList[2].annex,'group-1');assert.ok(api.requests.some(r=>r.path==='/gateway/ek-agg-mob/biz-common/list-group-resource'&&r.appkey==='zovecenter-saip-ek-agg-mob'));
 for(const patch of [{'q-date':'2026-02-31 09:00'},{'q-number':'nope'},{'q-file':'../group'},{'unknown':'value'}])await assert.rejects(()=>client.prepare({...input,answers:{...input.answers,...patch}}),{code:'INVALID_INPUT'});
 const visible=await client.prepare({activityId:'org-activity-1',action:'register'},'ego');await assert.rejects(()=>client.execute(visible,{via:'api',intent:'organization-participation',confirm:true}),{code:'INVALID_INPUT'});
 api.state.empty=true;api.state.pages=100;const before=api.requests.length;await assert.rejects(()=>client.get('org-activity-1'),{code:'PERMISSION_DENIED'});assert.equal(api.requests.slice(before).filter(r=>r.path.endsWith('/apply-page-list')).length,20);
});
