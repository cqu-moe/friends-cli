import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawnSync} from 'node:child_process';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

test('strict Ego fixture keeps existing pages protected after creating a new page and after handoff',async t=>{
  const root=await mkdtemp(join(tmpdir(),'friends-strict-navigation-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const html=join(root,'page.html'),config=join(root,'config.json'),result=join(root,'result.json');
  await writeFile(html,'<p>Existing human page</p>');
  await writeFile(config,JSON.stringify({html,result,url:'https://fixture.invalid/mobile/form'}));
  const script=`
const task=await taskSpace(1),original=task.page('p1'),fresh=await task.newPage();
await fresh.goto('https://fixture.invalid/mobile/form');
let originalBlocked=false,newAfterHandoffBlocked=false,freshAfterHandoffBlocked=false;
try{await original.goto('https://fixture.invalid/mobile/other')}catch{originalBlocked=true}
await task.handOff();
try{await task.newPage()}catch{newAfterHandoffBlocked=true}
try{await fresh.goto('https://fixture.invalid/mobile/other')}catch{freshAfterHandoffBlocked=true}
console.log('STRICT_NAV:'+JSON.stringify({originalBlocked,newAfterHandoffBlocked,freshAfterHandoffBlocked}));`;
  const child=spawnSync(process.execPath,['tests/fixtures/strict-ego.mjs'],{input:script,encoding:'utf8',timeout:15000,env:{...process.env,FRIENDS_EGO_FIXTURE_CONFIG:config}});
  assert.equal(child.status,0,child.stderr);
  const record=child.stdout.split('\n').find(line=>line.startsWith('STRICT_NAV:'));
  assert.ok(record,child.stdout);
  assert.deepEqual(JSON.parse(record.slice('STRICT_NAV:'.length)),{originalBlocked:true,newAfterHandoffBlocked:true,freshAfterHandoffBlocked:true});
  const observed=JSON.parse(await readFile(result,'utf8'));
  assert.equal(observed.newPages,1);assert.equal(observed.handoffs,1);assert.equal(observed.remoteWrites,0);
});
