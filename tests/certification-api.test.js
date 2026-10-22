import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as sdk from '../dist/index.js';
import {school,session,draft} from './fixtures/certification-api.mjs';
const intent={via:'api',intent:'submit-volunteer-certification',confirm:true};
test('SDK explicitly submits selected volunteer hours and separately verifies the school readback',async t=>{
 const upstream=await school(t);
 const client=sdk.createVolunteerCertificationApi({...upstream,session});
 const preview=await client.submit(draft,{...intent,dryRun:true});
 assert.equal(preview.submitted,false);assert.equal(upstream.state.writes.length,0);
 const result=await client.submit(draft,intent);
 assert.equal(result.submitted,true);assert.equal(result.serverAcknowledged,true);
 assert.equal(result.readback.state,'matched');assert.equal(result.readback.applicationId,'certification-1');
 assert.equal(upstream.state.writes.length,1);
 assert.deepEqual(upstream.state.writes[0],{activityId:'activity-1',uuid:null,nameList:[{activityId:'activity-1',attestationDuration:1.5,postDuration:null,postId:'post-1',postName:'引导岗',signDuration:1.5,studentNo:'20210002',uuid:'registration-1',isApply:true}]});
 const status=await client.status('activity-1');assert.equal(status.state,'present');assert.equal(status.rawState,'FUTURE_STATE');
});
test('SDK rejects Ego submit, unconfirmed intent, stale bindings, materials, and existing certification before a write',async t=>{
 const upstream=await school(t);const client=sdk.createVolunteerCertificationApi({...upstream,session});
 for(const [value,options,code] of [
  [draft,{...intent,via:'ego'},'INVALID_INPUT'],[draft,{...intent,confirm:false},'INVALID_INPUT'],
  [{...draft,includedStudentNos:[]},intent,'INVALID_INPUT'],
  [{...draft,binding:{...draft.binding,accountUserNo:'different'}},intent,'INVALID_INPUT'],
  [{...draft,materials:[{kind:'web-unrecoverable',id:'old',label:'网页材料',remoteRef:'old-group'}]},intent,'INVALID_INPUT'],
 ]) await assert.rejects(()=>client.submit(value,options),e=>e.code===code);
 assert.equal(upstream.state.reads.length,0);
 upstream.state.organizationId='different';
 await assert.rejects(()=>client.submit(draft,intent),e=>e.code==='BUSINESS_REJECTED');
 upstream.state.organizationId='org-1';upstream.state.stored={uuid:'prior',activityInfo:{uuid:'activity-1'},nameList:[]};
 await assert.rejects(()=>client.submit(draft,intent),e=>e.code==='BUSINESS_REJECTED');
 assert.equal(upstream.state.writes.length,0);
});
test('SDK preserves unknown outcome after a lost or malformed response, even when readback matches',async t=>{
 for(const mode of ['lost','malformed']) await t.test(mode,async t=>{
  const upstream=await school(t);upstream.state.mode=mode;
  const client=sdk.createVolunteerCertificationApi({...upstream,session});
  await assert.rejects(()=>client.submit(draft,intent),e=>{
   assert.equal(e.code,'UNKNOWN_OUTCOME');assert.equal(e.retryable,false);
   assert.equal(e.recovery.activityId,'activity-1');assert.equal(e.recovery.draftId,'draft-1');
   assert.deepEqual(e.recovery.completed,['readback:matched']);return true;
  });
  assert.equal(upstream.state.writes.length,1);
  assert.equal((await client.status('activity-1')).applicationId,'certification-1');
  await assert.rejects(()=>client.submit(draft,intent),e=>e.code==='BUSINESS_REJECTED');
  assert.equal(upstream.state.writes.length,1);
 });
});
test('SDK distinguishes permission, business rejection and acknowledged submission with failed readback',async t=>{
 for(const [mode,expected] of [['permission','PERMISSION_DENIED'],['business','BUSINESS_REJECTED'],['readback-failure',null]]) await t.test(mode,async t=>{
  const upstream=await school(t);upstream.state.mode=mode;const client=sdk.createVolunteerCertificationApi({...upstream,session});
  if(expected) await assert.rejects(()=>client.submit(draft,intent),e=>e.code===expected);
  else {const result=await client.submit(draft,intent);assert.equal(result.serverAcknowledged,true);assert.equal(result.readback.state,'unavailable');}
  assert.equal(upstream.state.writes.length,1);
 });
});

test('SDK never calls readback an exact match when school includes unselected people',async t=>{
 const upstream=await school(t);upstream.state.mode='extra-roster';
 const result=await sdk.createVolunteerCertificationApi({...upstream,session}).submit(draft,intent);
 assert.equal(result.serverAcknowledged,true);assert.equal(result.readback.state,'unmatched');
});
test('SDK recognizes the production empty certification DTO without treating unrelated malformed objects as absent',async t=>{
 const upstream=await school(t);const client=sdk.createVolunteerCertificationApi({...upstream,session});
 upstream.state.stored={uuid:null,activityId:null,activityInfo:null,nameList:null,flowOverallState:null};
 assert.equal((await client.status('activity-1')).state,'absent');
 upstream.state.stored={uuid:'existing',activityId:'activity-1',activityInfo:null,nameList:null};
 await assert.rejects(()=>client.status('activity-1'),e=>e.code==='NETWORK_PROTOCOL_ERROR');
});
