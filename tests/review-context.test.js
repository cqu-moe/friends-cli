import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createCourseReviewClient,createVolunteerActivityReviewClient,createVolunteerCertificationReviewClient} from '../dist/index.js';
import {courseReviewScenario,courseReviewSession,reviewInput} from './fixtures/course-reviews.mjs';
import {reviewScenario,reviewSession} from './fixtures/volunteer-activity-reviews.mjs';
import {school,session as certificationSession} from './fixtures/volunteer-review.mjs';

const cases = [
  {name:'course',setup:courseReviewScenario,session:courseReviewSession,create:createCourseReviewClient,
    list:client=>client.list('offering'),
    prepare:client=>client.prepare(reviewInput('offering')),
    decide:(client,plan)=>client.decide(plan,{via:'api',intent:'decide-course-review',confirm:true})},
  {name:'volunteer activity',setup:reviewScenario,session:reviewSession,create:createVolunteerActivityReviewClient,
    list:client=>client.list('offering'),
    prepare:client=>client.prepare({type:'offering',id:'offering-1',decision:'pass',message:'已核对',time:'2026-10-23',isSafeEducation:1}),
    decide:(client,plan)=>client.decide(plan,{via:'api',intent:'decide-volunteer-activity-review',confirm:true})},
  {name:'volunteer certification',setup:school,session:certificationSession,create:createVolunteerCertificationReviewClient,
    list:client=>client.list(),
    prepare:client=>client.getPending('review-1'),
    decide:client=>client.decide('review-1',{via:'api',intent:'submit-volunteer-certification-review',decision:'pass',confirm:true,message:'已核对',time:'2026-10-23'})},
];
const businessRequests=api=>api.requests.filter(request=>/\/zovecenter-saip-ek-app-.*\/mob\//.test(request.path??request.url));
const entries=api=>api.requests.filter(request=>(request.path??request.url).endsWith('/user/enterHall'));

for (const contract of cases) test(`${contract.name} reviews bind every fresh role check to the fixed school context and enterHall acknowledgement`,async t=>{
  const api=await contract.setup(t);if(api.close)t.after(api.close);
  const client=contract.create({baseUrl:api.baseUrl,session:contract.session});
  assert.equal((await contract.list(client)).items.length,1);
  const expectedLevel=contract.session.context?.levelNo??contract.session.levelNo;
  const expectedUnit=contract.session.context?.unit.unitNo??contract.session.unitNo;
  assert.ok(entries(api).length>0);
  assert.deepEqual(entries(api).at(-1).body,{departNo:expectedUnit,userStateLevel:expectedLevel,userType:'TEACHER'});
  const baseline={...api.state};
  for (const [patch,code] of [
    [{role:'FDY'},'NETWORK_PROTOCOL_ERROR'],
    [{unit:'another-unit'},'NETWORK_PROTOCOL_ERROR'],
    [{enteredAccount:'another-account'},'NETWORK_PROTOCOL_ERROR'],
    [{availableRole:'FDY'},'AUTH_REQUIRED'],
    [{availableUnit:'another-unit'},'AUTH_REQUIRED'],
    [{account:'another-account'},'AUTH_REQUIRED'],
  ]) {
    Object.assign(api.state,baseline,patch);
    const before=businessRequests(api).length,entered=entries(api).length;
    await assert.rejects(()=>contract.list(client),{code});
    assert.equal(businessRequests(api).length,before);
    if(code==='AUTH_REQUIRED')assert.equal(entries(api).length,entered);
  }
  Object.assign(api.state,baseline);
  for (const inconsistent of [false,true]) {
    const forged=structuredClone(contract.session);forged.userLevel='FDY';
    if(inconsistent){if(forged.context)forged.context.levelNo='FDY';else forged.levelNo='FDY';}
    const before=businessRequests(api).length,entered=entries(api).length;
    await assert.rejects(async()=>contract.list(contract.create({baseUrl:api.baseUrl,session:forged})),{code:inconsistent?'AUTH_REQUIRED':'INVALID_INPUT'});
    assert.equal(businessRequests(api).length,before);assert.equal(entries(api).length,entered);
  }
  const plan=await contract.prepare(client);
  api.state.unit='another-unit';const before=businessRequests(api).length;
  await assert.rejects(()=>contract.decide(client,plan),{code:'NETWORK_PROTOCOL_ERROR'});
  assert.equal(businessRequests(api).length,before);
  assert.equal(api.requests.some(request=>/\/(pass|callback|refuse)$/.test(request.path??request.url)),false);
});
