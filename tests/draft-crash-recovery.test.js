import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createPartialVolunteerCertificationDraft,updateVolunteerCertificationDraft} from '../dist/index.js';
import {createCertificationDraftStore} from '../dist/node.js';
const execute=promisify(execFile);

test('a killed draft writer recovers without stealing a live lock or losing atomic revisions', {timeout:30000,skip:process.platform==='win32'}, async t=>{
 const root=await mkdtemp(join(tmpdir(),'friends-crash-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const store=createCertificationDraftStore({root});
 const base=createPartialVolunteerCertificationDraft({id:'crash-draft',binding:{accountUserNo:'fixture',levelNo:'XS',unitNo:'unit',organizationId:'org',activityId:'activity'},activity:{id:'activity',name:'示例',organizationName:null,positionSetMethod:'TIME',posts:[]},registrations:[]});
 await store.save(base);
 const patch=join(root,'patch.json');await writeFile(patch,JSON.stringify({includedStudentNos:[]}));
 const env={...process.env,FRIENDS_HOME:root,FRIENDS_DRAFT_HOME:root};
 const cli=['dist/cli/main.js','drafts','edit',base.id,'--expected-revision','0','--input',patch,'--json'];
 const child=spawn(process.execPath,['tests/fixtures/paused-draft-writer.mjs',root],{stdio:['ignore','ignore','pipe','ipc']});
 t.after(()=>child.kill('SIGKILL'));
 const exited=new Promise(resolve=>child.once('close',resolve));
 await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('Writer did not reach atomic rename')),5000);timer.unref();
  child.once('message',message=>{clearTimeout(timer);assert.equal(message.ready,'atomic-rename');child.kill('SIGSTOP');resolve();});
  child.once('error',reject);
 });
 await assert.rejects(()=>execute(process.execPath,cli,{env,timeout:10000}),error=>error.code===5&&JSON.parse(error.stdout).error.code==='BUSINESS_REJECTED');
 assert.equal((await store.load(base.id)).revision,0,'a live owner has not replaced the previous atomic JSON');
 child.kill('SIGKILL');await exited;
 const restored=await store.load(base.id);
 await store.save(updateVolunteerCertificationDraft(restored,{includedStudentNos:[]},restored.revision));
 assert.equal((await store.load(base.id)).revision,1);
 const completed=await execute(process.execPath,[...cli.slice(0,5),'1',...cli.slice(6)],{env,timeout:10000});
 assert.equal(JSON.parse(completed.stdout).data.draft.revision,2);
});
