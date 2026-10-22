import assert from 'node:assert/strict';
import {test} from 'node:test';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {courseReviewScenario,reviewInput} from './fixtures/course-reviews.mjs';
import {courseCli,cliJson} from './fixtures/course-review-cli.mjs';
const command=(type,decision='pass')=>['courses','reviews','decide',reviewInput(type).id,'--type',type,'--via','api','--decision',decision,'--input','-'];
const fields=JSON.stringify({message:'资料已核对',time:'2026-10-23'});

test('real CLI lists and shows existing course tasks, dry-runs and confirms each supported API decision',async t=>{
  for(const [type,decisions] of [['offering',['pass','back','refuse']],['registration',['pass','refuse']]])for(const decision of decisions){
    const api=await courseReviewScenario();t.after(api.close);const cli=await courseCli(t,api);
    for(const args of [['list'],['show',reviewInput(type).id]]){
      const result=await cli.run(['courses','reviews',...args,'--type',type]);
      const json=cliJson(result);assert.equal(json.ok,true);assert.equal(json.meta.requestMode,'direct-api');assert.equal(result.stderr,'');
    }
    const dry=cliJson(await cli.run([...command(type,decision),'--dry-run'],fields));assert.equal(dry.data.submitted,false);assert.equal(api.writes().length,0);
    const missing=cliJson(await cli.run(command(type,decision),fields),2);assert.equal(missing.error.code,'INVALID_INPUT');
    const inputFile=join(cli.home,'review.json');await writeFile(inputFile,fields);
    const result=await cli.run([...command(type,decision).slice(0,-1),inputFile,'--yes']);
    const done=cliJson(result);assert.equal(done.data.readback,'matched');assert.equal(result.stderr,'');
    assert.equal(cliJson(await cli.run([...command(type,decision),'--yes'],fields),5).error.code,'BUSINESS_REJECTED');
    assert.equal(api.writes().length,1);assert.deepEqual(api.violations,[]);
  }
});

test('course review CLI publishes help/schema and rejects unsafe noninteractive arguments without side effects',async t=>{
  const api=await courseReviewScenario();t.after(api.close);const cli=await courseCli(t,api);
  const help=await cli.run(['courses','reviews','--help']);assert.equal(help.code,0);assert.match(help.stdout,/list/);assert.match(help.stdout,/prepare/);
  for(const operation of ['list','show','decide','prepare']){
    const result=cliJson(await cli.run(['schema','courses.reviews.'+operation]));assert.equal(result.data.readonly,['list','show'].includes(operation));
  }
  for(const [args,input] of [
    [command('registration','back'),fields],
    [[...command('offering'),'--yes'],'{broken'],
    [[...command('offering'),'--yes'],JSON.stringify({message:'x',time:'2026-10-23',applyInfo:{uuid:'spoof'}})],
    [['courses','reviews','list','--type','offering','--page','0']],
    [['courses','reviews','show','../escape','--type','offering']],
    [['courses','reviews','list','--type','certification']],
    [['courses','reviews','decide','course-apply-1','--type','offering','--via','ego','--decision','pass','--input','-','--yes'],fields],
    [['courses','reviews','prepare','course-apply-1','--type','offering','--via','ego','--decision','pass','--input','-','--yes'],fields],
  ]){
    const result=await cli.run(args,input);assert.equal(cliJson(result,2).error.code,'INVALID_INPUT');assert.notEqual(result.stderr,'');
  }
  assert.equal(api.writes().length,0);
});

test('course review CLI maps denial, business refusal and ambiguous responses to explicit exits with exactly one attempted write',async t=>{
  for(const type of ['offering','registration'])for(const [mode,code] of [['denied',4],['reject',5],['lost',7],['lost-readback',7],['malformed',7],['ack-no-change',7],['ack-readback-unavailable',7]]){
    const api=await courseReviewScenario();t.after(api.close);const cli=await courseCli(t,api);api.state.mode=mode;api.state.denied=mode==='denied';
    const result=await cli.run([...command(type,'refuse'),'--yes'],fields),json=cliJson(result,code);
    assert.equal(json.ok,false);assert.notEqual(result.stderr,'');assert.equal(api.writes().length,mode==='denied'?0:1);
    if(code===7){assert.equal(json.error.code,'UNKNOWN_OUTCOME');assert.equal(json.error.retryable,false);assert.equal(json.error.recovery.readback,['lost-readback','ack-readback-unavailable'].includes(mode)?'unavailable':mode==='ack-no-change'?'unmatched':'matched');assert.equal(json.error.recovery.serverAcknowledged,mode.startsWith('ack-')?true:'unknown');}
    assert.deepEqual(api.violations,[]);
  }
});
