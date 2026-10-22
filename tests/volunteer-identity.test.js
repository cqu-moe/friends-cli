import assert from 'node:assert/strict';
import {test} from 'node:test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,chmod,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createFriendsSdk} from '../dist/index.js';
import {saveSession} from '../dist/node.js';
import {volunteerIdentitySchool,identitySession,pendingApplication,volunteerRoot} from './fixtures/volunteer-identity.mjs';

test('SDK volunteer identity retains member evidence when the school rejects membership application eligibility',async t => {
  const school = await volunteerIdentitySchool(t);
  const client = await createFriendsSdk({baseUrl:school.baseUrl}).createVolunteerClient(identitySession);
  school.state.eligibility = {status:400,body:pendingApplication};
  const identity = await client.getIdentity();
  assert.deepEqual(identity,{
    memberView:{present:true,interpreted:false},membershipApplicationAllowed:null,
    membershipApplication:{status:'business-rejected',rejection:{code:'BUSINESS_REJECTED',upstreamCode:'10000',message:'你当前已有申请正在审批中，不能再申请!',requestId:null}},
  });
  assert.equal(JSON.stringify(identity).includes('unpublishedField'),false);
  assert.ok(school.requests.some(r => r.path === volunteerRoot+'/member-apply/can-apply' && r.method === 'GET' && r.query === '' && r.body === null));
  school.state.eligibility = {status:400,body:{code:'UNRELATED_RULE',message:'A different school business rule',data:null,requestId:'synthetic-request'}};
  const other = await client.getIdentity();
  assert.equal(other.membershipApplicationAllowed,null);
  assert.deepEqual(other.membershipApplication,{status:'business-rejected',rejection:{code:'BUSINESS_REJECTED',upstreamCode:'UNRELATED_RULE',message:'A different school business rule',requestId:'synthetic-request'}});
  for (const allowed of [true,false]) {
    school.state.eligibility = {status:200,body:{code:'0',data:allowed}};
    const checked = await client.getIdentity();
    assert.equal(checked.membershipApplicationAllowed,allowed);
    assert.deepEqual(checked.membershipApplication,{status:'checked',rejection:null});
  }
  school.state.list = {status:400,body:pendingApplication};
  await assert.rejects(() => client.listActivities(),error => error.code === 'BUSINESS_REJECTED' && error.upstreamCode === '10000' && error.message === '你当前已有申请正在审批中，不能再申请!');
  assert.equal(school.requests.some(r => /apply$|quit/.test(r.path) && r.method !== 'GET'),false);
});

test('SDK rejects malformed eligibility and generic HTTP failures without turning them into false',async t => {
  const school = await volunteerIdentitySchool(t);
  const client = await createFriendsSdk({baseUrl:school.baseUrl}).createVolunteerClient(identitySession);
  for (const data of [null,'false',0,1,{},[],undefined]) {
    school.state.eligibility = {status:200,body:{code:'0',data}};
    await assert.rejects(() => client.getIdentity(),error => error.code === 'NETWORK_PROTOCOL_ERROR');
  }
  for (const response of [
    {status:400,body:{code:'0',data:false}},
    {status:400,body:{message:'generic bad request'}},
    {status:400,body:{code:'10000',data:null}},
    {status:400,body:{code:'',message:'empty business code'}},
    {status:400,body:'<html>bad request</html>'},
    {status:409,body:pendingApplication},
    {status:500,body:pendingApplication},
  ]) {
    school.state.eligibility = response;
    await assert.rejects(() => client.getIdentity(),error => error.code === 'NETWORK_PROTOCOL_ERROR');
  }
  for (const [status,code] of [[401,'AUTH_REQUIRED'],[403,'PERMISSION_DENIED']]) {
    school.state.eligibility = {status,body:pendingApplication};
    await assert.rejects(() => client.getIdentity(),error => error.code === code);
  }
  school.state.eligibility = {status:200,body:{code:'0',data:true}};
  school.state.member = {status:400,body:pendingApplication};
  await assert.rejects(() => client.getIdentity(),error => error.code === 'BUSINESS_REJECTED');
});


test('real CLI preserves partial volunteer identity through API and Ego and reports malformed or denied checks explicitly',async t => {
  const school = await volunteerIdentitySchool(t);
  const root = await mkdtemp(join(tmpdir(),'friends-volunteer-identity-'));
  t.after(() => rm(root,{recursive:true,force:true}));
  const command = join(root,'ego-browser'), config = join(root,'ego.json');
  await writeFile(command,'#!/usr/bin/env node\nimport('+JSON.stringify(new URL('./fixtures/strict-ego.mjs',import.meta.url).href)+');\n');
  await chmod(command,0o700);
  await writeFile(config,JSON.stringify({html:resolve('tests/fixtures/volunteer-apply-fixture.html'),result:join(root,'observed.json'),url:school.baseUrl.replace('/gateway','')+'/mobile/volunteerManage/campusActivityApplyDetail?uuid=activity-1',iframe:true,executeSession:true,token:'ego-fixture-token',accountUserNo:'20210001'}));
  const env = {...process.env,PATH:root+':'+process.env.PATH,FRIENDS_HOME:join(root,'home'),FRIENDS_EGO_FIXTURE_CONFIG:config,FRIENDS_BASE_URL:school.baseUrl};
  const invoke = args => promisify(execFile)(process.execPath,[resolve('dist/cli/main.js'),...args],{env,timeout:15000,maxBuffer:1024*1024});
  const success = async args => {
    const result = await invoke(args);
    assert.equal(result.stderr,'');
    const output = JSON.parse(result.stdout);assert.equal(output.schemaVersion,1);assert.equal(output.ok,true);
    assert.equal(result.stdout.includes('unpublishedField'),false);assert.equal(result.stdout.includes('ego-fixture-token'),false);
    return output;
  };
  const previousHome = process.env.FRIENDS_HOME;
  try {
    process.env.FRIENDS_HOME = env.FRIENDS_HOME;
    await saveSession({...identitySession,schemaVersion:1,loginMethod:'local',storage:'file',account:{...identitySession.account,userName:'示例学生'},context:{levelNo:'XS',levelName:'学生',unit:{unitNo:'unit-a',unitType:2,unitName:'示例学院'}}},'file');
  } finally {if (previousHome === undefined) delete process.env.FRIENDS_HOME; else process.env.FRIENDS_HOME = previousHome;}

  school.state.eligibility = {status:400,body:pendingApplication};
  for (const via of ['api','ego']) {
    const output = await success(['volunteers','identity','--via',via,...(via === 'ego' ? ['--ego-task-space','7'] : []),'--json']);
    assert.deepEqual(output.data,{memberView:{present:true,interpreted:false},membershipApplicationAllowed:null,membershipApplication:{status:'business-rejected',rejection:{code:'BUSINESS_REJECTED',upstreamCode:'10000',message:'你当前已有申请正在审批中，不能再申请!',requestId:null}}});
    assert.equal(output.meta.selectedEntry,via);assert.equal(output.meta.requestMode,'direct-api');
  }
  const schema = await success(['schema','volunteers.identity','--json']);
  assert.equal(schema.data.output.membershipApplicationAllowed.type,'boolean|null');
  assert.deepEqual(schema.data.output.membershipApplication.status,['checked','business-rejected']);
  school.state.eligibility = {status:200,body:{code:'0',data:false}};
  const checked = await success(['volunteers','identity','--json']);assert.equal(checked.data.membershipApplicationAllowed,false);assert.deepEqual(checked.data.membershipApplication,{status:'checked',rejection:null});
  for (const [response,exit,code] of [
    [{status:200,body:{code:'0',data:null}},6,'NETWORK_PROTOCOL_ERROR'],
    [{status:400,body:{message:'generic bad request'}},6,'NETWORK_PROTOCOL_ERROR'],
    [{status:401,body:pendingApplication},3,'AUTH_REQUIRED'],
    [{status:403,body:pendingApplication},4,'PERMISSION_DENIED'],
  ]) {
    school.state.eligibility = response;
    await assert.rejects(() => invoke(['volunteers','identity','--json']),error => {
      assert.equal(error.code,exit);assert.notEqual(error.stderr,'');
      const output = JSON.parse(error.stdout);assert.equal(output.schemaVersion,1);assert.equal(output.ok,false);assert.equal(output.error.code,code);assert.equal(output.data,undefined);return true;
    });
  }
  school.state.list = {status:400,body:pendingApplication};
  await assert.rejects(() => invoke(['volunteers','activities','list','--json']),error => error.code === 5 && JSON.parse(error.stdout).error.code === 'BUSINESS_REJECTED' && JSON.parse(error.stdout).error.upstreamCode === '10000');
});
