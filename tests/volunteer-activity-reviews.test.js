import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createVolunteerActivityReviewClient} from '../dist/index.js';
import {reviewScenario,reviewSession} from './fixtures/volunteer-activity-reviews.mjs';

test('volunteer activity review SDK keeps offering and registration decisions distinct',async t=>{
 const api=await reviewScenario();t.after(api.close);
 const client=createVolunteerActivityReviewClient({baseUrl:api.baseUrl,session:reviewSession});
 for(const type of ['offering','registration']){
  assert.equal((await client.list(type)).items[0].id,type+'-1');
  assert.equal((await client.get(type,type+'-1')).type,type);
  const input={type,id:type+'-1',decision:'pass',message:'资料已核对',time:'2026-10-22',...(type==='offering'?{isSafeEducation:1}:{})};
  const plan=await client.prepare(input);
  assert.equal(plan.submitted,false);
  assert.equal(api.requests.filter(r=>/\/(pass|refuse|callback)$/.test(r.path)).length,type==='offering'?0:1);
  const result=await client.decide(plan,{via:'api',intent:'decide-volunteer-activity-review',confirm:true});
  assert.equal(result.serverAcknowledged,true);assert.equal(result.readback,'matched');
  await assert.rejects(()=>client.decide(plan,{via:'api',intent:'decide-volunteer-activity-review',confirm:true}),{code:'BUSINESS_REJECTED'});
 }
 const writes=api.requests.filter(r=>/\/(pass|refuse|callback)$/.test(r.path));assert.equal(writes.length,2);
 assert.equal(writes[0].body.handleType,'YJ01');assert.equal(writes[0].body.isSafeEducation,1);
 assert.equal(writes[1].body.handleType,'XS02');assert.equal(writes[1].body.uuid,'registration-1');
 assert.equal(writes[1].body.applyInfo.activityId,'offering-1');
});

test('volunteer review SDK validates decisions, stale records and uncertain one-shot writes',async t=>{
 for(const kind of ['offering','registration'])for(const mode of ['reject','lost','lost-readback']){
  const api=await reviewScenario();t.after(api.close);api.state.mode=mode;
  const client=createVolunteerActivityReviewClient({baseUrl:api.baseUrl,session:reviewSession});
  const input={type:kind,id:kind+'-1',decision:'refuse',message:'资料不全',time:'2026-10-22',...(kind==='offering'?{isSafeEducation:0}:{})};
  const plan=await client.prepare(input);
  await assert.rejects(()=>client.decide(plan,{via:'ego',intent:'decide-volunteer-activity-review',confirm:true}),{code:'INVALID_INPUT'});
  await assert.rejects(()=>client.decide(plan,{via:'api',intent:'decide-volunteer-activity-review',confirm:true}),e=>{
   assert.equal(e.code,mode==='reject'?'BUSINESS_REJECTED':'UNKNOWN_OUTCOME');
   if(mode!=='reject'){assert.equal(e.retryable,false);assert.equal(e.recovery.readback,mode==='lost'?'matched':'unavailable');}
   return true;
  });
  assert.equal(api.requests.filter(r=>/\/(pass|refuse|callback)$/.test(r.path)).length,1);
 }
 const api=await reviewScenario();t.after(api.close);const client=createVolunteerActivityReviewClient({baseUrl:api.baseUrl,session:reviewSession});
 const input={type:'offering',id:'offering-1',decision:'back',message:'请补充',time:'2026-10-22',isSafeEducation:0};
 const plan=await client.prepare(input);assert.equal(plan.payload.callbackActivityId,'node-1');
 for(const patch of [{id:'../wrong'},{type:'unknown'},{message:''},{time:'2026-02-31'},{isSafeEducation:2},{callbackActivityId:'unrelated'},{confirm:true}])await assert.rejects(()=>client.prepare({...input,...patch}),{code:'INVALID_INPUT'});
 await assert.rejects(()=>client.get('offering','registration-1'));
 api.state.role='XS';await assert.rejects(()=>client.prepare(input),{code:'NETWORK_PROTOCOL_ERROR'});api.state.role='XY';
 api.rows.offering.activityName='Changed by human';await assert.rejects(()=>client.decide(plan,{via:'api',intent:'decide-volunteer-activity-review',confirm:true}),{code:'BUSINESS_REJECTED'});
 const fresh=await client.prepare(input);fresh.payload.uuid='registration-1';await assert.rejects(()=>client.decide(fresh,{via:'api',intent:'decide-volunteer-activity-review',confirm:true}),{code:'INVALID_INPUT'});
 api.state.managed=false;await assert.rejects(()=>client.prepare({type:'registration',id:'registration-1',decision:'pass',message:'已核对',time:'2026-10-22'}),{code:'PERMISSION_DENIED'});
 assert.equal(api.requests.filter(r=>/\/(pass|refuse|callback)$/.test(r.path)).length,0);
});


test('one public volunteer approval plan cannot be decided concurrently or replayed after a lost response',async t=>{
 const api=await reviewScenario();t.after(api.close);api.state.mode='lost-overlap';
 const client=createVolunteerActivityReviewClient({baseUrl:api.baseUrl,session:reviewSession});
 const plan=await client.prepare({type:'registration',id:'registration-1',decision:'pass',message:'核对完成',time:'2026-10-22'});
 const intent={via:'api',intent:'decide-volunteer-activity-review',confirm:true};
 const results=await Promise.allSettled([client.decide(plan,intent),client.decide(plan,intent)]);
 assert.deepEqual(results.map(result=>result.reason?.code).sort(),['BUSINESS_REJECTED','UNKNOWN_OUTCOME']);
 await assert.rejects(()=>client.decide(plan,intent),{code:'BUSINESS_REJECTED'});
 assert.equal(api.requests.filter(request=>/\/(pass|refuse|callback)$/.test(request.path)).length,1);
});


test('public volunteer decision snapshots its trusted payload before asynchronous revalidation',async t=>{
 const api=await reviewScenario();t.after(api.close);
 const client=createVolunteerActivityReviewClient({baseUrl:api.baseUrl,session:reviewSession});
 const plan=await client.prepare({type:'registration',id:'registration-1',decision:'refuse',message:'原始意见',time:'2026-10-22'});
 let reached,release;
 const waiting=new Promise(resolve=>{reached=resolve;});
 api.state.beforeIdentity=async()=>{reached();await new Promise(resolve=>{release=resolve;});};
 const decision=client.decide(plan,{via:'api',intent:'decide-volunteer-activity-review',confirm:true});
 await waiting;plan.payload.uuid='other-registration';plan.payload.msg='替换意见';release();
 await decision;
 const writes=api.requests.filter(request=>/\/(pass|refuse|callback)$/.test(request.path));
 assert.equal(writes.length,1);assert.equal(writes[0].body.uuid,'registration-1');assert.equal(writes[0].body.msg,'原始意见');
});
