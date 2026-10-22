import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile,writeFile} from 'node:fs/promises';
import * as nodeSdk from '../dist/node.js';
import {offeringInput,setupOrganizationActivities} from './fixtures/organization-activities.mjs';
import {setupOrganizationActivityEgo} from './fixtures/organization-activity-ego.mjs';
async function run(f,fn){const prior=process.env.FRIENDS_EGO_FIXTURE_CONFIG;process.env.FRIENDS_EGO_FIXTURE_CONFIG=f.config;try{return await fn();}finally{if(prior===undefined)delete process.env.FRIENDS_EGO_FIXTURE_CONFIG;else process.env.FRIENDS_EGO_FIXTURE_CONFIG=prior;}}
test('public Node SDK prepares the real iframe DOM, preserves human and readonly values, and hands off before Next',async t=>{
 const api=await setupOrganizationActivities(t);const f=await setupOrganizationActivityEgo(t,api.baseUrl,{readonlyPlace:true});
 const options={input:offeringInput(),taskSpaceId:7,page:'p2',command:f.command,baseUrl:api.baseUrl};
 const preview=await run(f,()=>nodeSdk.prepareOrganizationActivityOfferingInEgo({...options,dryRun:true}));assert.equal(preview.submitted,false);assert.equal((await f.observed()).fills.length,0);assert.equal((await f.observed()).handoffs,0);
 const result=await run(f,()=>nodeSdk.prepareOrganizationActivityOfferingInEgo(options));
 assert.equal(result.status,'awaiting-user');assert.equal(result.submitted,false);assert.equal(result.handoff,'completed');assert.ok(result.preservedFields.includes('activityName'));assert.ok(result.preservedFields.includes('activityPlace'));
 const observed=await f.observed();assert.equal(observed.handoffs,1);assert.equal(observed.submits,0);assert.equal(observed.navigations,0);assert.equal(observed.clicks.length,0);
 assert.ok(observed.fieldValues.some(field=>field.value==='人工草稿标题'));assert.ok(observed.fieldValues.some(field=>field.value==='活动简介'));assert.match(observed.html,/data-model="活动简介"/);
 assert.equal(api.state.uploads+api.state.firstWrites+api.state.finalWrites,0);
});

test('Node SDK checks fresh permissions and iframe identity and preserves partial visible evidence',async t=>{
 const api=await setupOrganizationActivities(t);const wrong=await setupOrganizationActivityEgo(t,api.baseUrl,{browserAccount:'other'});
 const options={input:offeringInput(),taskSpaceId:7,page:'p2',command:wrong.command,baseUrl:api.baseUrl};
 await assert.rejects(()=>run(wrong,()=>nodeSdk.prepareOrganizationActivityOfferingInEgo(options)),e=>e.code==='PERMISSION_DENIED');
 assert.equal((await wrong.observed()).fills.length,0);
 const partial=await setupOrganizationActivityEgo(t,api.baseUrl,{humanName:''});const config=JSON.parse(await readFile(partial.config,'utf8'));config.failAfterFill=2;await writeFile(partial.config,JSON.stringify(config));
 await assert.rejects(()=>run(partial,()=>nodeSdk.prepareOrganizationActivityOfferingInEgo({...options,command:partial.command})),e=>{
  assert.equal(e.code,'UNKNOWN_OUTCOME');assert.equal(e.retryable,false);assert.equal(e.recovery.pageLabel,'p2');assert.deepEqual(e.recovery.completed,['activityName']);assert.equal(e.recovery.inProgress,'activityContent');return true;
 });
 const observed=await partial.observed();assert.equal(observed.fills.length,2);assert.equal(observed.handoffs,1);assert.match(observed.html,/data-model="活动简介"/);
 const before=api.requests.length;
 for(const extra of [{yes:true},{submit:true},{retry:true,apiFallback:true},{baseUrl:7},{command:7},{dryRun:'true'},{timeoutMs:0}])await assert.rejects(()=>nodeSdk.prepareOrganizationActivityOfferingInEgo({...options,...extra}),e=>e.code==='INVALID_INPUT');
 assert.equal(api.requests.length,before);
 api.state.permission=false;await assert.rejects(()=>run(partial,()=>nodeSdk.prepareOrganizationActivityOfferingInEgo({...options,command:partial.command})),e=>e.code==='PERMISSION_DENIED');
 assert.equal(api.state.uploads+api.state.firstWrites+api.state.finalWrites,0);
});
