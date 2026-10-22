import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile,writeFile} from 'node:fs/promises';
import {prepareVolunteerCertificationInEgo} from '../dist/node.js';
import {setupCertification} from './fixtures/certification-setup.mjs';
async function prepare(fixture,extra={}){const previous=process.env.FRIENDS_EGO_FIXTURE_CONFIG;process.env.FRIENDS_EGO_FIXTURE_CONFIG=fixture.config;try{return await prepareVolunteerCertificationInEgo({...fixture.options,...extra});}finally{if(previous===undefined)delete process.env.FRIENDS_EGO_FIXTURE_CONFIG;else process.env.FRIENDS_EGO_FIXTURE_CONFIG=previous;}}
test('SDK executes Ego visible add, post, duration and selection with no final submit or navigation',async t=>{
 const f=await setupCertification(t);const result=await prepare(f);
 assert.equal(result.status,'awaiting-user');assert.equal(result.submitted,false);assert.equal(result.handoff,'completed');
 assert.deepEqual(result.page.selectedStudentNos,['20210001','20210002']);assert.deepEqual(result.page.rows.map(row=>row.durationHours),[1.5,3]);
 const observed=await f.observed();assert.equal(observed.submits,0);assert.equal(observed.handoffs,1);assert.equal(observed.navigations,0);
 assert.equal(f.requests.some(req=>req.url.endsWith('/school-activity-attestation-apply/apply')),false);
 assert.ok(observed.clicks.includes('loc=css:.set-form .footer button'));
 assert.equal(observed.clicks.some(click=>click.includes('全部认证')||click.includes('提交认证')),false);
});
test('SDK dry-run only inspects; newer human hours survive with a review handoff',async t=>{
 const clean=await setupCertification(t);const preview=await prepare(clean,{dryRun:true});assert.equal(preview.submitted,false);
 const inspected=await clean.observed();assert.equal(inspected.clicks.length,0);assert.equal(inspected.fills.length,0);assert.equal(inspected.handoffs,0);
 const edited=await setupCertification(t,{humanHours:9});const preserved=await prepare(edited);assert.equal(preserved.canPopulateWithoutOverwrite,false);assert.equal(preserved.page.rows[0].durationHours,9);
 const kept=await edited.observed();assert.equal(kept.clicks.length,0);assert.equal(kept.handoffs,1);assert.equal(kept.submits,0);
});
test('SDK rechecks school account before launching the visible preparation',async t=>{
 const f=await setupCertification(t,{account:'different'});
 await assert.rejects(()=>prepare(f),e=>e.code==='AUTH_REQUIRED'||e.code==='PERMISSION_DENIED');
 await assert.rejects(()=>f.observed(),e=>e.code==='ENOENT');
});

test('SDK preserves a duration changed after inspection before filling the open editor',async t=>{
 const f=await setupCertification(t);const config=JSON.parse(await readFile(f.config,'utf8'));config.changeOnSecondSnapshot=true;await writeFile(f.config,JSON.stringify(config));
 await assert.rejects(()=>prepare(f),e=>e.code==='UNKNOWN_OUTCOME');
 const observed=await f.observed();assert.equal(observed.fills.length,0);assert.equal(observed.submits,0);assert.equal(observed.handoffs,1);assert.match(observed.html,/>9<\/span>/);
});
