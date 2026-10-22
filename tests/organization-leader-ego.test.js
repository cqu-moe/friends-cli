import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import * as nodeSdk from "../dist/node.js";
import { leaderScenario } from "./fixtures/organization-leader-scenario.mjs";

import { leaderEgoFixture } from "./fixtures/organization-leader-ego.mjs";

test("public SDK visibly prepares the leader form in its iframe, preserves people edits, and leaves final submission to the user",async t=>{
  const scenario=await leaderScenario(t);
  const fixture=await leaderEgoFixture(t,scenario.baseUrl);
  const input={organizationId:"leader-org",candidateStudentNo:"20210002",newResponsiblePhone:"13800000002",newResponsiblePolitical:"共青团员",newPostUuid:"new-post",reason:"毕业交接"};
  const options={input,taskSpaceId:16,baseUrl:scenario.baseUrl,command:fixture.command};
  const result=await nodeSdk.prepareOrganizationLeaderChangeInEgo(options);
  assert.equal(result.submitted,false); assert.equal(result.status,"awaiting-user"); assert.deepEqual(result.manualFields,[]);
  const evidence=JSON.parse(await readFile(fixture.evidence,"utf8"));
  assert.equal(evidence.candidate,"新负责人"); assert.equal(evidence.post,"新职务"); assert.equal(evidence.reason,"毕业交接");
  assert.equal(evidence.externalWrites,0); assert.equal(evidence.submits,0); assert.equal(evidence.handoffs,1); assert.equal(evidence.navigations,0);
  assert.ok(evidence.inputEvents>0); assert.equal(scenario.writes().length,0);
  const human=await leaderEgoFixture(t,scenario.baseUrl,"human");
  const preserved=await nodeSdk.prepareOrganizationLeaderChangeInEgo({...options,command:human.command});
  assert.ok(preserved.manualFields.includes("candidate"));
  const kept=JSON.parse(await readFile(human.evidence,"utf8")); assert.equal(kept.candidate,"人工选择"); assert.equal(kept.phone,"13700000003"); assert.equal(kept.reason,"人工原因"); assert.deepEqual(kept.clicks,[]); assert.deepEqual(kept.fills,[]);
  const preview=await nodeSdk.prepareOrganizationLeaderChangeInEgo({...options,dryRun:true});
  assert.equal(preview.dryRun,true); const readOnly=JSON.parse(await readFile(fixture.evidence,"utf8")); assert.deepEqual(readOnly.clicks,[]); assert.deepEqual(readOnly.fills,[]); assert.equal(readOnly.handoffs,0);
  const wrong=await leaderEgoFixture(t,scenario.baseUrl,"wrong-route");
  await assert.rejects(()=>nodeSdk.prepareOrganizationLeaderChangeInEgo({...options,command:wrong.command}),e=>e.code==="UNKNOWN_OUTCOME");
  const untouched=JSON.parse(await readFile(wrong.evidence,"utf8")); assert.equal(untouched.navigations,0); assert.deepEqual(untouched.clicks,[]);
  const sameName=await leaderEgoFixture(t,scenario.baseUrl,"same-name");
  const ambiguous=await nodeSdk.prepareOrganizationLeaderChangeInEgo({...options,command:sameName.command});
  assert.ok(ambiguous.manualFields.includes("candidate-identity"));
  const sameNameEvidence=JSON.parse(await readFile(sameName.evidence,"utf8")); assert.deepEqual(sameNameEvidence.clicks,[]); assert.deepEqual(sameNameEvidence.fills,[]);
  const lost=await leaderEgoFixture(t,scenario.baseUrl,"lost-result");
  await assert.rejects(()=>nodeSdk.prepareOrganizationLeaderChangeInEgo({...options,command:lost.command}),e=>e.code==="UNKNOWN_OUTCOME" && !e.retryable);
  const partial=JSON.parse(await readFile(lost.evidence,"utf8")); assert.equal(partial.handoffs,1); assert.equal(partial.candidate,"新负责人"); assert.equal(partial.submits,0); assert.equal(partial.externalWrites,0);
  scenario.state.manager=true;
  await assert.rejects(()=>nodeSdk.prepareOrganizationLeaderChangeInEgo(options),e=>e.code==="PERMISSION_DENIED");
});
