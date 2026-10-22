import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {school,draft} from './fixtures/certification-api.mjs';
const cli=resolve('dist/cli/main.js');
function run(args,env,input='') {return new Promise((resolve,reject)=>{const child=spawn(process.execPath,[cli,...args],{env});let stdout='',stderr='';child.stdout.on('data',v=>stdout+=v);child.stderr.on('data',v=>stderr+=v);child.on('error',reject);child.on('close',code=>resolve({code,stdout,stderr,json:stdout.startsWith('{')?JSON.parse(stdout):null}));child.stdin.end(input);});}
async function setup(t){const upstream=await school(t);const home=await mkdtemp(join(tmpdir(),'friends-cert-'));t.after(()=>rm(home,{recursive:true,force:true}));await mkdir(join(home,'drafts'),{mode:0o700});await writeFile(join(home,'session.json'),JSON.stringify({schemaVersion:1,loginMethod:'local',storage:'file',token:'fixture-token',userLevel:'XS',account:{userNo:'20210001',userName:'示例'},context:{levelNo:'XS',levelName:'学生',unit:{unitType:2,unitNo:'24080',unitName:'示例学院'}}}),{mode:0o600});await writeFile(join(home,'drafts','draft-1.json'),JSON.stringify(draft),{mode:0o600});return {...upstream,home,env:{...process.env,FRIENDS_HOME:home,FRIENDS_DRAFT_HOME:join(home,'drafts'),FRIENDS_BASE_URL:upstream.baseUrl}};}
test('CLI dry-run, stored draft, file and stdin all use the real certification SDK and preserve drafts',async t=>{
 const fixture=await setup(t);const {env,state,home}=fixture;
 const help=await run(['certification','--help'],env);assert.equal(help.code,0);assert.match(help.stdout,/submit/);
 const schema=await run(['schema','certification.submit'],env);assert.equal(schema.json.data.remoteReadonly,false);assert.deepEqual(schema.json.data.supportedVia,['api']);
 const denied=await run(['certification','submit','draft-1','--via','ego','--confirm'],env);assert.equal(denied.code,2);assert.equal(state.reads.length,0);
 const unconfirmed=await run(['certification','submit','draft-1','--via','api'],env);assert.equal(unconfirmed.code,2);
 const preview=await run(['certification','submit','draft-1','--via','api','--dry-run'],env);assert.equal(preview.code,0);assert.equal(preview.json.data.submitted,false);assert.equal(state.writes.length,0);
 const inputFile=join(home,'export.json');await writeFile(inputFile,JSON.stringify(draft),{mode:0o600});
 const filePreview=await run(['certification','submit','--input',inputFile,'--via','api','--dry-run'],env);assert.equal(filePreview.code,0);
 const sent=await run(['certification','submit','--input','-','--via','api','--confirm'],env,JSON.stringify(draft));assert.equal(sent.code,0);assert.equal(sent.stderr,'');assert.equal(sent.json.schemaVersion,1);assert.equal(sent.json.data.readback.state,'matched');assert.equal(sent.stdout.includes('fixture-token'),false);assert.equal(state.writes.length,1);
 const status=await run(['certification','status','activity-1'],env);assert.equal(status.code,0);assert.equal(status.json.data.applicationId,'certification-1');
 assert.deepEqual(JSON.parse(await readFile(join(home,'drafts','draft-1.json'),'utf8')),draft);
});
test('CLI exposes failures with stable exits and never retries a submitted request',async t=>{
 for(const [mode,exit,code] of [['permission',4,'PERMISSION_DENIED'],['business',5,'BUSINESS_REJECTED'],['lost',7,'UNKNOWN_OUTCOME'],['lost-readback-failure',7,'UNKNOWN_OUTCOME']]) await t.test(mode,async t=>{
  const {env,state,home}=await setup(t);state.mode=mode;
  const before=await readFile(join(home,'drafts','draft-1.json'),'utf8');
  const result=await run(['certification','submit','draft-1','--via','api','--confirm'],env);
  assert.equal(result.code,exit);assert.equal(result.json.error.code,code);assert.notEqual(result.stderr,'');assert.equal(result.stdout.includes('fixture-token'),false);assert.equal(state.writes.length,1);
  if(exit===7){assert.equal(result.json.error.retryable,false);assert.equal(result.json.error.recovery.draftId,'draft-1');if(mode==='lost-readback-failure')assert.deepEqual(result.json.error.recovery.completed,['readback:unavailable']);}
  assert.equal(await readFile(join(home,'drafts','draft-1.json'),'utf8'),before);
 });
});
test('CLI rejects invalid input and stale account before mutation, and reads status through an Ego-selected session',async t=>{
 const {env,state,home}=await setup(t);
 for(const input of ['{',JSON.stringify({...draft,includedStudentNos:[]}),JSON.stringify({...draft,binding:{...draft.binding,accountUserNo:'different'}})]){
  const result=await run(['certification','submit','--input','-','--via','api','--confirm'],env,input);assert.equal(result.code,2);
 }
 assert.equal(state.writes.length,0);
 const bin=join(home,'bin');await mkdir(bin,{mode:0o700});
 await writeFile(join(bin,'ego-browser'),`#!/bin/sh\ncat >/dev/null\nprintf '%s\\n' 'FRIENDS_CLI_EGO_SESSION:{"token":"fixture-token","userLevel":"XS"}'\n`,{mode:0o700});
 const result=await run(['certification','status','activity-1','--via','ego','--ego-task-space','7'],{...env,PATH:bin+':'+env.PATH,FRIENDS_HOME:join(home,'no-local-session')});
 assert.equal(result.code,0);assert.equal(result.json.meta.selectedEntry,'ego');assert.equal(result.json.data.state,'absent');assert.equal(state.writes.length,0);
});
