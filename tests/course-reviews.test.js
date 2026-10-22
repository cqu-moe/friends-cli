import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as sdk from '../dist/index.js';
import {courseReviewScenario,courseReviewSession,reviewInput} from './fixtures/course-reviews.mjs';
const intent={via:'api',intent:'decide-course-review',confirm:true};

test('course review SDK lists existing tasks, exposes source-supported decisions and executes each domain separately',async t=>{
  for(const [type,decisions] of [['offering',['pass','back','refuse']],['registration',['pass','refuse']]])for(const decision of decisions){
    const api=await courseReviewScenario();t.after(api.close);
    const client=sdk.createCourseReviewClient({baseUrl:api.baseUrl,session:courseReviewSession});
    const input=reviewInput(type,decision);
    assert.equal((await client.list(type)).items[0].id,input.id);
    const detail=await client.get(type,input.id);
    assert.deepEqual(detail.allowedDecisions,decisions);assert.equal(detail.pending,true);assert.equal(detail.courseId,'course-apply-1');
    const plan=await client.prepare(input);
    assert.equal(plan.submitted,false);assert.equal(api.writes().length,0);
    const done=await client.decide(plan,intent);
    assert.equal(done.serverAcknowledged,true);assert.equal(done.readback,'matched');assert.equal(done.submitted,true);
    assert.equal(done.state.known,false);
    await assert.rejects(()=>client.decide(plan,intent),{code:'INVALID_INPUT'});
    const after=await client.get(type,input.id);assert.equal(after.pending,false);assert.deepEqual(after.allowedDecisions,[]);
    assert.equal(api.writes().length,1);assert.deepEqual(api.violations,[]);
  }
});

test('course review SDK rejects wrong domains, bindings, roles and changed or processed tasks before any write',async t=>{
  for(const type of ['offering','registration']){
    const api=await courseReviewScenario();t.after(api.close);
    const client=sdk.createCourseReviewClient({baseUrl:api.baseUrl,session:courseReviewSession});
    const input=reviewInput(type);
    const invalid=[{id:'../wrong'},{type:'certification'},{message:''},{message:'x'.repeat(101)},{time:'2026-02-31'},{applyInfo:{uuid:'spoof'}},{handleType:'admin'},{decision:'delete'},...(type==='registration'?[{decision:'back'}]:[])];
    for(const patch of invalid)await assert.rejects(()=>client.prepare({...input,...patch}),{code:'INVALID_INPUT'});
    await assert.rejects(()=>client.list(type,{page:0}),{code:'INVALID_INPUT'});
    await assert.rejects(()=>client.get(type,type==='offering'?'course-reg-1':'course-apply-1'),{code:'NETWORK_PROTOCOL_ERROR'});
    api.state.detailOverride={...api.rows[type],uuid:'another'};
    await assert.rejects(()=>client.prepare(input),{code:'NETWORK_PROTOCOL_ERROR'});api.state.detailOverride=null;
    api.state.pending[type]=false;
    assert.deepEqual((await client.get(type,input.id)).allowedDecisions,[]);
    await assert.rejects(()=>client.prepare(input),{code:'BUSINESS_REJECTED'});api.state.pending[type]=true;
    api.state.denied=true;await assert.rejects(()=>client.prepare(input),{code:'PERMISSION_DENIED'});api.state.denied=false;
    if(type==='offering'){
      api.state.role='XS';await assert.rejects(()=>client.prepare(input),{code:'AUTH_REQUIRED'});api.state.role='XY';
      api.state.detailOverride={...api.rows.offering,organizationId:'unrelated-org'};
    }else{
      api.state.managed=false;await assert.rejects(()=>client.prepare(input),{code:'PERMISSION_DENIED'});api.state.managed=true;
      api.state.detailOverride={...api.rows.registration,curriculumId:'unrelated-course'};
    }
    await assert.rejects(()=>client.prepare(input),{code:'NETWORK_PROTOCOL_ERROR'});api.state.detailOverride=null;
    const plan=await client.prepare(input);
    await assert.rejects(()=>client.decide(plan,{...intent,via:'ego'}),{code:'INVALID_INPUT'});
    await assert.rejects(()=>client.decide(plan,{...intent,confirm:false}),{code:'INVALID_INPUT'});
    const forged=structuredClone(plan);await assert.rejects(()=>client.decide(forged,intent),{code:'INVALID_INPUT'});
    api.rows[type].flowCurrMsg='另一审批者更新了申请';
    await assert.rejects(()=>client.decide(plan,intent),{code:'BUSINESS_REJECTED'});
    const roleBound=await client.prepare(input);api.state.role='XSC';
    await assert.rejects(()=>client.decide(roleBound,intent),{code:'AUTH_REQUIRED'});api.state.role='XY';
    const changed=await client.prepare(input);changed.payload.uuid='spoof';
    await assert.rejects(()=>client.decide(changed,intent),{code:'INVALID_INPUT'});
    assert.equal(api.writes().length,0);
  }
});

test('course review SDK handles pagination and makes one decision across concurrent prepared plans',async t=>{
  const api=await courseReviewScenario();t.after(api.close);api.state.pageCount=2;api.state.recordPage=2;
  const client=sdk.createCourseReviewClient({baseUrl:api.baseUrl,session:courseReviewSession});
  const a=await client.prepare(reviewInput('offering')),b=await client.prepare(reviewInput('offering'));
  const results=await Promise.allSettled([client.decide(a,intent),client.decide(b,intent)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(api.writes().length,1);assert.deepEqual(api.violations,[]);
});

test('course review SDK preserves rejection and uncertain one-shot results, even with matching readback',async t=>{
  for(const type of ['offering','registration'])for(const mode of ['reject','lost','lost-pending','lost-readback','malformed','timeout']){
    const api=await courseReviewScenario();t.after(api.close);api.state.mode=mode;
    const client=sdk.createCourseReviewClient({baseUrl:api.baseUrl,session:courseReviewSession,timeoutMs:100});
    const input=reviewInput(type,'refuse'),plan=await client.prepare(input);
    await assert.rejects(()=>client.decide(plan,intent),error=>{
      assert.equal(error.code,mode==='reject'?'BUSINESS_REJECTED':'UNKNOWN_OUTCOME');
      if(mode!=='reject'){
        assert.equal(error.retryable,false);assert.equal(error.recovery.applicationId,input.id);
        assert.equal(error.recovery.serverAcknowledged,'unknown');
        assert.equal(error.recovery.readback,mode==='lost-pending'?'unmatched':mode==='lost-readback'?'unavailable':'matched');
      }
      return true;
    });
    if(mode!=='reject'){
      await assert.rejects(()=>client.prepare(reviewInput(type==='offering'?'registration':'offering')),{code:'UNKNOWN_OUTCOME'});
      assert.equal((await client.list(type)).items.length,mode==='lost-pending'?1:0);
    }
    await assert.rejects(()=>client.decide(plan,intent));assert.equal(api.writes().length,1);assert.deepEqual(api.violations,[]);
  }
});

test('course SDK binds readback to a new matching school decision record, retaining acknowledged uncertainty',async t=>{
  for(const mode of ['wrong-decision','ack-no-change','ack-readback-unavailable']){
    const api=await courseReviewScenario();t.after(api.close);api.state.mode=mode;
    const client=sdk.createCourseReviewClient({baseUrl:api.baseUrl,session:courseReviewSession});
    const plan=await client.prepare(reviewInput('offering','pass'));
    await assert.rejects(()=>client.decide(plan,intent),error=>{
      assert.equal(error.code,'UNKNOWN_OUTCOME');assert.equal(error.recovery.serverAcknowledged,true);
      assert.equal(error.recovery.readback,mode==='ack-readback-unavailable'?'unavailable':'unmatched');return true;
    });
    assert.equal(api.writes().length,1);
  }
});

test('course SDK snapshots caller input and the approved plan across asynchronous school checks',async t=>{
  const api=await courseReviewScenario();t.after(api.close);
  const client=sdk.createCourseReviewClient({baseUrl:api.baseUrl,session:courseReviewSession});
  const input=reviewInput('offering','pass'),preparing=client.prepare(input);
  input.id='spoof';input.message='';input.decision='refuse';
  const plan=await preparing;assert.equal(plan.id,'course-apply-1');assert.equal(plan.payload.msg,'资料已核对');
  const deciding=client.decide(plan,intent);plan.payload.uuid='spoof';plan.decision='refuse';
  assert.equal((await deciding).readback,'matched');assert.equal(api.writes()[0].path,'/gateway/zovecenter-saip-ek-app-curriculum/mob/apply/pass');
  assert.deepEqual(api.violations,[]);
});
