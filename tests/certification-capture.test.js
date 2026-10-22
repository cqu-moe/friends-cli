import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import * as nodeSdk from '../dist/node.js';
import {setupCertification} from './fixtures/certification-setup.mjs';
async function environment(f,fn){const prior=process.env.FRIENDS_EGO_FIXTURE_CONFIG;process.env.FRIENDS_EGO_FIXTURE_CONFIG=f.config;try{return await fn();}finally{if(prior===undefined)delete process.env.FRIENDS_EGO_FIXTURE_CONFIG;else process.env.FRIENDS_EGO_FIXTURE_CONFIG=prior;}}
async function initialize(f){const config=JSON.parse(await readFile(f.config,'utf8'));config.executeSession=true;config.state=join(f.home,'browser-state.json');await writeFile(f.config,JSON.stringify(config));const store=nodeSdk.createCertificationDraftStore({root:join(f.home,'drafts')});const draft={...f.options.draft,revision:0};await store.save(draft);return {store,draft,state:config.state};}
test('SDK handoff, explicit return and capture preserve human hours and selection as a new private revision without submitting',async t=>{
 const f=await setupCertification(t);const {store,draft,state}=await initialize(f);
 await environment(f,()=>nodeSdk.prepareVolunteerCertificationInEgo({...f.options,draft}));
 const human=JSON.parse(await readFile(state,'utf8'));assert.equal(human.ownership,'user');human.rows[0].hours=9;human.rows[1].selected=false;await writeFile(state,JSON.stringify(human));
 const before=f.requests.length;
 await assert.rejects(()=>nodeSdk.captureVolunteerCertificationFromEgo({...f.options,draft,draftRoot:join(f.home,'drafts'),expectedRevision:0}),e=>e.code==='INVALID_INPUT');
 assert.equal(f.requests.length,before);
 const result=await environment(f,()=>nodeSdk.captureVolunteerCertificationFromEgo({...f.options,draft,draftRoot:join(f.home,'drafts'),expectedRevision:0,userReturnedControl:true}));
 assert.equal(result.submitted,false);assert.equal(result.draft.revision,1);assert.deepEqual(result.draft.includedStudentNos,['20210001']);assert.equal(result.draft.durations['20210001'],9);assert.equal(result.pending.length,0);
 assert.deepEqual(await store.load('draft-1'),result.draft);
 const observed=await f.observed();assert.equal(observed.fills.length,0);assert.equal(observed.submits,0);assert.equal(observed.navigations,0);assert.equal(observed.clicks.some(c=>c.includes('.save')||c.includes('提交')),false);
 assert.equal(f.requests.some(r=>r.url.endsWith('/school-activity-attestation-apply/apply')),false);
});

test('SDK refuses changed context, preserves incomplete edits, and reports missing people and unrecoverable materials',async t=>{
 const f=await setupCertification(t);const {store,draft}=await initialize(f);
 const capture=extra=>environment(f,()=>nodeSdk.captureVolunteerCertificationFromEgo({...f.options,draft,draftRoot:join(f.home,'drafts'),expectedRevision:0,userReturnedControl:true,...extra}));
 const config=JSON.parse(await readFile(f.config,'utf8'));config.url=config.url.replace('activity-1','other-activity');await writeFile(f.config,JSON.stringify(config));
 await assert.rejects(()=>capture(),e=>e.code==='PERMISSION_DENIED');assert.equal((await store.load(draft.id)).revision,0);
 config.url=config.url.replace('other-activity','activity-1');config.partialEditor=true;await writeFile(f.config,JSON.stringify(config));
 const partial=await capture();assert.equal(partial.saved,false);assert.match(partial.pending[0],/unfinished-editor/);assert.equal((await f.observed()).clicks.length,0);
 config.partialEditor=false;await writeFile(f.config,JSON.stringify(config));
 const recovered=await capture({draft:{...draft,materials:[{kind:'web-unrecoverable',id:'m1',label:'网页附件',remoteRef:null}]}});
 assert.equal(recovered.saved,true);assert.ok(recovered.pending.includes('missing-from-page:20210002'));assert.ok(recovered.pending.includes('material-not-in-form:m1'));assert.equal(recovered.draft.materials[0].kind,'web-unrecoverable');assert.deepEqual(recovered.draft.includedStudentNos,[]);
 assert.equal((await f.observed()).submits,0);
});

test('SDK and CLI observe an externally submitted certification without producing any write',async t=>{
 const {createVolunteerCertificationApi}=await import('../dist/index.js');
 const {execFile}=await import('node:child_process');const {promisify}=await import('node:util');
 const f=await setupCertification(t);const session=f.options.session;
 const api=createVolunteerCertificationApi({baseUrl:f.options.baseUrl,session:{token:session.token,userLevel:'XS',accountUserNo:'20210001',levelNo:'XS',unitNo:'24080'}});
 assert.equal((await api.status('activity-1')).state,'absent');
 // The external actor updates server state. No automated final-submit request is made.
 f.school.certification={uuid:'receipt-1',activityInfo:{uuid:'activity-1'},nameList:[{studentNo:'20210001',postId:'post-1',attestationDuration:9}],flowOverallState:'SCHOOL_PENDING'};
 assert.equal((await api.status('activity-1')).applicationId,'receipt-1');
 const run=promisify(execFile);const result=await run(process.execPath,['dist/cli/main.js','certification','status','activity-1','--via','ego','--ego-task-space','7','--ego-page','p2'],{env:f.env});
 const body=JSON.parse(result.stdout);assert.equal(body.data.rawState,'SCHOOL_PENDING');assert.equal(body.data.applicationId,'receipt-1');assert.equal(f.requests.some(r=>r.url.endsWith('/school-activity-attestation-apply/apply')),false);
});
