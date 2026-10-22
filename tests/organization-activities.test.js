import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as sdk from '../dist/index.js';
import {setupOrganizationActivities,session,teamRoot,commonRoot,offeringInput} from './fixtures/organization-activities.mjs';
test('public organization activity SDK queries distinct lists, requirements and raw progress',async t=>{
 const f=await setupOrganizationActivities(t);
 const client=await sdk.createFriendsSdk({baseUrl:f.baseUrl}).createOrganizationActivityClient(session);
 const page=await client.list({page:2,pageSize:5,keyword:'示例'});
 assert.equal(page.items[0].domain,'organization-activity');assert.equal(page.page,2);assert.equal(page.hasMore,false);
 assert.deepEqual(f.requests.find(r=>r.path===teamRoot+'/apply-info/activity-page-list').body,{currentPage:2,pageSize:5,key:'示例',approve:false});
 await client.list({kind:'manageable'});assert.ok(f.requests.some(r=>r.path===teamRoot+'/apply-info/my-page-list'));
 const id=sdk.organizationActivityId('activity-1');assert.equal((await client.get(id)).id,'activity-1');
 assert.equal((await client.requirements(id)).isOpenEnrollment,true);
 const status=await client.status(id);assert.deepEqual(status.state,{raw:'FUTURE_STATE',flowOverallState:'SCHOOL_PENDING',known:false});
 assert.deepEqual(status.flow,{nodeList:[{activityname:'组织审核',state:'UNKNOWN_NODE_STATE'}],evaluationRecords:[{msg:'等待学校处理',state:'UNKNOWN_RECORD_STATE'}]});
 assert.deepEqual(f.requests.find(r=>r.path===commonRoot+'/flow/approve-list'&&r.method==='POST').body,{businessTypeCode:'组织活动申请流程',applyId:'activity-1',branchNo:''});
 for(const [workflow,expected] of [
  [{nodeList:[],evaluationRecords:[]},{nodeList:[],evaluationRecords:[]}],
  [{},{nodeList:null,evaluationRecords:null}],
  [{nodeList:[{activityname:'组织审核',state:null}],evaluationRecords:null},{nodeList:[{activityname:'组织审核',state:null}],evaluationRecords:null}],
 ]){f.state.workflow=workflow;assert.deepEqual((await client.status(id)).flow,expected);}
 f.state.mode='unknown-pages';assert.equal((await client.list()).hasMore,null);
 f.state.mode='denied';await assert.rejects(()=>client.get(id),e=>e.code==='PERMISSION_DENIED');
 f.state.mode='normal';await assert.rejects(()=>client.get(sdk.organizationActivityId('course-1')),e=>e.code==='NETWORK_PROTOCOL_ERROR');
 assert.equal(f.state.firstWrites+f.state.finalWrites+f.state.uploads,0);
});

test('SDK prepares organization fields and school term without uploading or saving',async t=>{
 const f=await setupOrganizationActivities(t);const client=await sdk.createFriendsSdk({baseUrl:f.baseUrl}).createOrganizationActivityClient(session);
 const input=offeringInput();const prepared=await client.prepare(input);
 assert.equal(prepared.status,'materials-required');assert.equal(prepared.submitted,false);
 assert.deepEqual(prepared.binding,{accountUserNo:'20210001',levelNo:'XS',unitNo:'unit-1',organizationId:'organization-1'});
 assert.equal(prepared.firstStep.organizationType,3);assert.equal(prepared.firstStep.termNo,'1');assert.equal(prepared.firstStep.uuid,'');
 assert.equal(prepared.settings.addOrUpdate,2);assert.equal(prepared.settings.push,true);assert.equal(prepared.settings.draft,false);
 assert.ok(f.requests.some(r=>r.path===commonRoot+'/term-list'&&r.headers['h-zove-appkey']==='zovecenter-saip-ek-agg-mob'));
 const noPoster=offeringInput();noPoster.materials.publicityPictures=[];
 await assert.rejects(()=>client.prepare(noPoster),e=>e.code==='INVALID_INPUT');
 f.state.permission=false;await assert.rejects(()=>client.prepare(input),e=>e.code==='PERMISSION_DENIED');
 f.state.permission=true;f.state.account='other';await assert.rejects(()=>client.prepare(input),e=>e.code==='AUTH_REQUIRED');
 assert.equal(f.state.uploads+f.state.firstWrites+f.state.finalWrites,0);
});
test('SDK explicitly uploads materials, saves the first step once, submits settings once and reads progress',async t=>{
 const f=await setupOrganizationActivities(t);const client=await sdk.createFriendsSdk({baseUrl:f.baseUrl}).createOrganizationActivityClient(session);const input=offeringInput();
 await assert.rejects(()=>client.uploadMaterials(input,{}),e=>e.code==='INVALID_INPUT');
 const materials=await client.uploadMaterials(input,{confirmation:'organization-activities.materials'});
 assert.equal(materials.status,'materials-ready');assert.equal(materials.submitted,false);assert.deepEqual(materials.publicity.resourceUuids,['resource-1']);
 assert.equal(f.state.uploads,1);assert.equal(f.state.firstWrites+f.state.finalWrites,0);
 const upload=f.requests.find(r=>r.path===commonRoot+'/protected-file-upload');assert.match(upload.headers['content-type'],/^multipart\/form-data; boundary=/);assert.match(upload.raw.toString(),/poster-bytes/);
 await assert.rejects(()=>client.submit(input,{materials}),e=>e.code==='INVALID_INPUT');
 const result=await client.submit(input,{confirmation:'organization-activities.submit',materials});
 assert.equal(result.applicationId,'activity-1');assert.equal(result.submitted,true);assert.equal(result.serverAcknowledged,true);assert.equal(result.approved,null);assert.equal(result.readback.state,'matched');
 assert.equal(f.state.firstWrites,1);assert.equal(f.state.finalWrites,1);
 const first=f.requests.find(r=>r.path===teamRoot+'/apply-info/next-update');
 assert.deepEqual(first.body,{beginYear:'2099',endYear:'2100',termNo:'1',activityName:'示例组织活动',activityContent:'活动简介',activityPlace:'示例活动室',beginTime:'2099-11-02 10:00',endTime:'2099-11-02 12:00',organizationId:'organization-1',organizationName:'示例组织',organizationType:3,attachmentGroupUuid:'',publicityPicturesGroupUuid:materials.publicity.groupUuid,uuid:''});
 const final=f.requests.find(r=>r.path===teamRoot+'/apply-info/set-update');assert.equal(final.body.uuid,'activity-1');assert.equal(final.body.addOrUpdate,2);assert.equal(final.body.push,true);assert.equal(final.body.draft,false);
 assert.deepEqual((await client.status(sdk.organizationActivityId('activity-1'))).state,{raw:'SCHOOL_PENDING',flowOverallState:'NEW_SERVER_VALUE',known:false});
});

test('SDK stops all remaining writes on lost upload or application responses, retaining partial evidence',async t=>{
 for(const mode of ['lost-upload','lost-second-upload','lost-resource-readback','lost-first','invalid-first-id','lost-final','revoke-after-first'])await t.test(mode,async t=>{
  const f=await setupOrganizationActivities(t);const client=await sdk.createFriendsSdk({baseUrl:f.baseUrl,timeoutMs:500}).createOrganizationActivityClient(session);const input=offeringInput();
  if(['lost-upload','lost-second-upload','lost-resource-readback'].includes(mode)){
   input.materials.publicityPictures.push(new File(['second-poster'],'poster2.png',{type:'image/png'}));f.state.mode=mode;
   await assert.rejects(()=>client.uploadMaterials(input,{confirmation:'organization-activities.materials'}),e=>{
    assert.equal(e.code,'UNKNOWN_OUTCOME');assert.equal(e.retryable,false);assert.equal(e.recovery.readback,mode==='lost-resource-readback'?'unavailable':'matched');
    if(mode==='lost-resource-readback')assert.equal(e.recovery.serverAcknowledged,true);
    assert.match(e.recovery.inProgress,/upload:[0-9a-f]{32}:poster/);
    if(mode==='lost-second-upload')assert.ok(e.recovery.completed.includes('upload:resource-1'));return true;
   });
   assert.equal(f.state.uploads,mode==='lost-second-upload'?2:1);assert.equal(f.state.firstWrites+f.state.finalWrites,0);return;
  }
  const materials=await client.uploadMaterials(input,{confirmation:'organization-activities.materials'});f.state.mode=mode;
  await assert.rejects(()=>client.submit(input,{confirmation:'organization-activities.submit',materials}),e=>{
   assert.equal(e.code,mode==='revoke-after-first'?'PERMISSION_DENIED':'UNKNOWN_OUTCOME');assert.equal(e.retryable,false);
   if(mode==='lost-final'){assert.equal(e.recovery.applicationId,'activity-1');assert.equal(e.recovery.readback,'matched');assert.ok(e.recovery.completed.includes('next-update:activity-1'));}
   if(mode==='revoke-after-first')assert.equal(e.recovery.applicationId,'activity-1');return true;
  });
  assert.equal(f.state.firstWrites,1);assert.equal(f.state.finalWrites,mode==='lost-final'?1:0);assert.equal(f.state.uploads,1);
 });
});
test('SDK rejects malformed public session and input types before any external operation',async t=>{
 for(const options of [{session:null},{session,baseUrl:7},{session,fetch:'invalid'},{session,timeoutMs:0}])assert.throws(()=>sdk.createOrganizationActivityClient(options),e=>e.code==='INVALID_INPUT');
 const f=await setupOrganizationActivities(t);const client=await sdk.createFriendsSdk({baseUrl:f.baseUrl}).createOrganizationActivityClient(session);
 const variants=[{activityName:7},{activityName:'x'.repeat(33)},{beginTime:'2099-02-31 10:00'},{registration:{...offeringInput().registration,isOpenEnrollment:'true'}},{registration:{...offeringInput().registration,signinNum:99}},{term:{beginYear:'2099',endYear:'2100',termNo:'1',extra:true}},{materials:{publicityPictures:['not-a-file']}},{extra:true}];
 for(const patch of variants)await assert.rejects(()=>client.prepare({...offeringInput(),...patch}),e=>e.code==='INVALID_INPUT');
 assert.equal(f.requests.length,0);
});

test('SDK distinguishes an acknowledged request from a readback that only contains the first saved step',async t=>{
 const f=await setupOrganizationActivities(t);const client=await sdk.createFriendsSdk({baseUrl:f.baseUrl}).createOrganizationActivityClient(session);const input=offeringInput();
 const materials=await client.uploadMaterials(input,{confirmation:'organization-activities.materials'});f.state.mode='ignore-final';
 const result=await client.submit(input,{confirmation:'organization-activities.submit',materials});
 assert.equal(result.serverAcknowledged,true);assert.equal(result.approved,null);assert.equal(result.readback.state,'unmatched');
 assert.equal(f.state.firstWrites,1);assert.equal(f.state.finalWrites,1);
});
