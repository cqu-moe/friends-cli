import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {saveSession} from '../dist/node.js';
import {setupOrganizationActivities,offeringInput,session} from './fixtures/organization-activities.mjs';
import {setupOrganizationActivityEgo} from './fixtures/organization-activity-ego.mjs';
function cli(args,env,input){return new Promise((done,reject)=>{const child=spawn(process.execPath,[resolve('dist/cli/main.js'),...args],{env});let stdout='',stderr='';const timer=setTimeout(()=>child.kill('SIGTERM'),20000);child.stdout.on('data',data=>stdout+=data);child.stderr.on('data',data=>stderr+=data);child.on('error',reject);child.on('close',code=>{clearTimeout(timer);done({code,stdout,stderr});});child.stdin.end(input??'');});}
async function setup(t){
 const api=await setupOrganizationActivities(t),ego=await setupOrganizationActivityEgo(t,api.baseUrl);const home=await mkdtemp(join(tmpdir(),'friends-org-cli-'));t.after(()=>rm(home,{recursive:true,force:true}));
 const prior=process.env.FRIENDS_HOME;process.env.FRIENDS_HOME=home;
 try{await saveSession({...session,schemaVersion:1,loginMethod:'local',storage:'file',account:{...session.account,userName:'示例学生'},context:{...session.context,levelName:'学生',unit:{...session.context.unit,unitType:2,unitName:'示例学院'}}},'file');}finally{if(prior===undefined)delete process.env.FRIENDS_HOME;else process.env.FRIENDS_HOME=prior;}
 const poster=join(home,'poster.png');await writeFile(poster,'poster-bytes');const input={...offeringInput(),materials:{publicityPictures:[{path:poster}],attachments:[]}};const path=join(home,'input.json');await writeFile(path,JSON.stringify(input));
 return {api,ego,home,input,path,env:{...ego.env,FRIENDS_HOME:home,FRIENDS_BASE_URL:api.baseUrl}};
}
function body(result){assert.equal(result.code,0,result.stderr);assert.equal(result.stderr,'');const parsed=JSON.parse(result.stdout);assert.equal(parsed.schemaVersion,1);assert.equal(parsed.ok,true);assert.equal(result.stdout.includes('fixture-token'),false);return parsed;}
test('real CLI covers every organization activity API command, file/stdin, schemas and explicit writes',async t=>{
 const f=await setup(t);const run=(args,input)=>cli(['organization-activities',...args],f.env,input);
 for(const operation of ['list','show','requirements','status','prepare','materials','submit']){
  const help=await run([operation,'--help']);assert.equal(help.code,0);assert.match(help.stdout,/Usage:/);
  const schema=body(await cli(['schema','organization-activities.'+operation],f.env));assert.equal(schema.data.operation,'organization-activities.'+operation);
 }
 body(await run(['list','--kind','manageable','--keyword','示例','--page','2']));
 for(const operation of ['show','requirements','status'])body(await run([operation,'activity-1']));
 assert.equal(body(await run(['prepare','--input','-'],JSON.stringify(f.input))).data.submitted,false);
 body(await run(['materials','--input',f.path,'--dry-run']));body(await run(['submit','--input',f.path,'--dry-run']));
 const denied=await run(['materials','--input',f.path]);assert.equal(denied.code,2);assert.equal(JSON.parse(denied.stdout).error.code,'INVALID_INPUT');assert.equal(f.api.state.uploads,0);
 const uploaded=await run(['materials','--input',f.path,'--confirm']);assert.equal(body(uploaded).data.status,'materials-ready');
 const receipts=join(f.home,'materials.json');await writeFile(receipts,uploaded.stdout);
 const submitted=body(await run(['submit','--input',f.path,'--materials',receipts,'--confirm']));assert.equal(submitted.data.applicationId,'activity-1');assert.equal(submitted.data.approved,null);
 assert.equal(f.api.state.uploads,1);assert.equal(f.api.state.firstWrites,1);assert.equal(f.api.state.finalWrites,1);
 f.api.state.mode='lost-final';const lost=await run(['submit','--input',f.path,'--materials',receipts,'--confirm']);const error=JSON.parse(lost.stdout).error;
 assert.equal(lost.code,7);assert.equal(error.code,'UNKNOWN_OUTCOME');assert.equal(error.retryable,false);assert.equal(error.recovery.applicationId,'activity-1');assert.equal(error.recovery.readback,'matched');
 assert.equal(f.api.state.firstWrites,2);assert.equal(f.api.state.finalWrites,2);
});

test('real CLI reuses Ego sessions for all queries and prepares editable controls without any submit bypass',async t=>{
 const f=await setup(t);const ego=['--via','ego','--ego-task-space','7','--ego-page','p2'];const run=(args,input)=>cli(['organization-activities',...args],f.env,input);
 for(const operation of ['list','show','requirements','status']){
  const args=operation==='list'?[operation]:[operation,'activity-1'];const result=body(await run([...args,...ego]));assert.equal(result.meta.selectedEntry,'ego');assert.equal(result.meta.requestMode,'direct-api');
 }
 const preview=body(await run(['prepare','--input',f.path,...ego,'--dry-run']));assert.equal(preview.data.submitted,false);assert.equal((await f.ego.observed()).fills.length,0);
 const prepared=body(await run(['prepare','--input','-',...ego],JSON.stringify(f.input)));assert.equal(prepared.data.status,'awaiting-user');assert.equal(prepared.data.submitted,false);assert.equal(prepared.data.handoff,'completed');assert.ok(prepared.data.manualFields.includes('registration-settings'));
 const observed=await f.ego.observed();assert.equal(observed.fills.length,2);assert.equal(observed.clicks.length,0);assert.equal(observed.handoffs,1);assert.match(observed.html,/data-model="活动简介"/);
 assert.ok(f.api.requests.some(r=>r.headers['h-zove-token']==='ego-fixture-token'));
 const before=f.api.requests.length;
 for(const args of [ ['submit','--input',f.path,...ego,'--confirm'],['materials','--input',f.path,...ego,'--confirm'],['prepare','--input',f.path,...ego,'--yes'],['prepare','--input',f.path,...ego,'--retry','--api-fallback']]){
  const denied=await run(args);assert.equal(denied.code,2);assert.equal(JSON.parse(denied.stdout).error.code,'INVALID_INPUT');
 }
 assert.equal(f.api.requests.length,before);assert.equal(f.api.state.uploads+f.api.state.firstWrites+f.api.state.finalWrites,0);
 const config=JSON.parse(await readFile(f.ego.config,'utf8'));config.failAfterFill=2;await writeFile(f.ego.config,JSON.stringify(config));
 const partial=await run(['prepare','--input',f.path,...ego]);const error=JSON.parse(partial.stdout).error;
 assert.equal(partial.code,7);assert.equal(error.code,'UNKNOWN_OUTCOME');assert.equal(error.retryable,false);assert.equal(error.recovery.pageLabel,'p2');assert.equal(error.recovery.inProgress,'activityPlace');assert.deepEqual(error.recovery.completed,['activityContent']);
 assert.equal((await f.ego.observed()).handoffs,1);assert.equal(f.api.state.firstWrites+f.api.state.finalWrites,0);
});
test('real CLI rejects malformed inputs and permissions with versioned errors before writes',async t=>{
 const f=await setup(t);const run=(args,input)=>cli(['organization-activities',...args],f.env,input);
 for(const [args,input] of [ [['prepare','--input','-'],'{bad'],[['list','--page','0'],undefined],[['prepare','--input','-'],JSON.stringify({...f.input,unverifiedField:true})],[['prepare','--input','-'],JSON.stringify({...f.input,materials:{publicityPictures:[]}})]]){
  const result=await run(args,input);assert.equal(result.code,2);assert.equal(JSON.parse(result.stdout).schemaVersion,1);assert.equal(JSON.parse(result.stdout).error.code,'INVALID_INPUT');assert.notEqual(result.stderr,'');
 }
 f.api.state.mode='denied';const denied=await run(['show','activity-1']);assert.equal(denied.code,4);assert.equal(JSON.parse(denied.stdout).error.code,'PERMISSION_DENIED');
 f.api.state.mode='normal';f.api.state.account='changed';const expired=await run(['status','activity-1']);assert.equal(expired.code,3);assert.equal(JSON.parse(expired.stdout).error.code,'AUTH_REQUIRED');
 assert.equal(f.api.state.uploads+f.api.state.firstWrites+f.api.state.finalWrites,0);
});
