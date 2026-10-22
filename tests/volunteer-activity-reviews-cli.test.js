import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';import {tmpdir} from 'node:os';
import {reviewScenario,reviewSession} from './fixtures/volunteer-activity-reviews.mjs';
async function run(args,env,input){return new Promise((resolve,reject)=>{const p=spawn(process.execPath,['dist/cli/main.js',...args],{env});let stdout='',stderr='';p.stdout.on('data',d=>stdout+=d);p.stderr.on('data',d=>stderr+=d);p.on('error',reject);p.on('close',code=>resolve({code,stdout,stderr}));p.stdin.end(input);});}

test('CLI queries, dry-runs and explicitly decides each volunteer review type through the SDK',async t=>{
 const api=await reviewScenario();t.after(api.close);const home=await mkdtemp(join(tmpdir(),'friends-review-cli-'));t.after(()=>rm(home,{recursive:true,force:true}));
 await writeFile(join(home,'session.json'),JSON.stringify({...reviewSession,schemaVersion:1,storage:'file',loginMethod:'local',account:{userNo:'20210001',userName:'示例管理者'},context:{levelNo:'XY',levelName:'学院',unit:{unitNo:'college-1',unitName:'示例学院',unitType:1}}}),{mode:0o600});
 const env={...process.env,FRIENDS_HOME:home,FRIENDS_BASE_URL:api.baseUrl};
 for(const type of ['offering','registration']){
  for(const args of [['list'],['show',type+'-1']]){const r=await run(['volunteer','activity-reviews',...args,'--type',type,'--json'],env);assert.equal(r.code,0,r.stderr);assert.equal(JSON.parse(r.stdout).meta.requestMode,'direct-api');}
  const fields={message:'已审核',time:'2026-10-22',...(type==='offering'?{isSafeEducation:1}:{})};
  const cmd=['volunteer','activity-reviews','decide',type+'-1','--type',type,'--via','api','--decision','pass','--input','-'];
  const dry=await run([...cmd,'--dry-run'],env,JSON.stringify(fields));assert.equal(dry.code,0,dry.stderr);assert.equal(JSON.parse(dry.stdout).data.submitted,false);
  const refuse=await run(cmd,env,JSON.stringify(fields));assert.equal(refuse.code,2);assert.equal(JSON.parse(refuse.stdout).error.code,'INVALID_INPUT');
  const done=await run([...cmd,'--yes'],env,JSON.stringify(fields));assert.equal(done.code,0,done.stderr);assert.equal(JSON.parse(done.stdout).data.readback,'matched');assert.equal(done.stderr,'');assert.equal(done.stdout.trim().split('\n').length,1);
 }
 assert.equal(api.requests.filter(r=>/\/(pass|refuse|callback)$/.test(r.path)).length,2);
 const help=await run(['volunteer','activity-reviews','--help'],env);assert.equal(help.code,0);assert.match(help.stdout,/prepare/);
 const schema=await run(['schema','volunteer.activity-reviews.decide'],env);assert.equal(schema.code,0,schema.stderr);assert.equal(JSON.parse(schema.stdout).data.readonly,false);
});

test('CLI refuses unsafe inputs and preserves an uncertain review as exit 7 without resubmission',async t=>{
 for(const type of ['offering','registration']){
  const api=await reviewScenario();t.after(api.close);api.state.mode='lost';
  const home=await mkdtemp(join(tmpdir(),'friends-review-lost-'));t.after(()=>rm(home,{recursive:true,force:true}));
  await writeFile(join(home,'session.json'),JSON.stringify({...reviewSession,schemaVersion:1,storage:'file',loginMethod:'local',account:{userNo:'20210001',userName:'示例管理者'},context:{levelNo:'XY',levelName:'学院',unit:{unitNo:'college-1',unitName:'示例学院',unitType:1}}}),{mode:0o600});
  const env={...process.env,FRIENDS_HOME:home,FRIENDS_BASE_URL:api.baseUrl};
  const fields={message:'退回核对',time:'2026-10-22',...(type==='offering'?{isSafeEducation:0}:{})};
  const cmd=['volunteer','activity-reviews','decide',type+'-1','--type',type,'--via','api','--decision',type==='offering'?'back':'refuse','--input','-','--yes'];
  const invalid=await run(cmd,env,JSON.stringify({...fields,applyInfo:{uuid:'another'}}));assert.equal(invalid.code,2);
  const result=await run(cmd,env,JSON.stringify(fields));assert.equal(result.code,7,result.stderr);const body=JSON.parse(result.stdout);assert.equal(body.error.code,'UNKNOWN_OUTCOME');assert.equal(body.error.recovery.readback,'matched');assert.equal(body.error.retryable,false);
  assert.equal(api.requests.filter(r=>/\/(pass|refuse|callback)$/.test(r.path)).length,1);
 }
});
