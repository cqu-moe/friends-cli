import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {courseReviewSession} from './course-reviews.mjs';
export async function courseCli(t,api) {
  const home=await mkdtemp(join(tmpdir(),'friends-course-review-'));t.after(()=>rm(home,{recursive:true,force:true}));
  await writeFile(join(home,'session.json'),JSON.stringify({...courseReviewSession,schemaVersion:1,storage:'file',loginMethod:'local',account:{userNo:'20210001',userName:'示例管理者'},context:{levelNo:'XY',levelName:'学院',unit:{unitNo:'college-1',unitName:'示例学院',unitType:1}}}),{mode:0o600});
  const env={...process.env,FRIENDS_HOME:home,FRIENDS_BASE_URL:api.baseUrl};
  return {home,env,async run(args,input,extraEnv={}){
    return new Promise((resolve,reject)=>{
      const child=spawn(process.execPath,['dist/cli/main.js',...args],{env:{...env,...extraEnv}});let stdout='',stderr='';
      child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);child.on('error',reject);
      child.on('close',code=>resolve({code,stdout,stderr}));child.stdin.on('error',error=>{if(error.code!=='EPIPE')reject(error)});child.stdin.end(input);
    });
  }};
}
export function cliJson(result,code=0) {
  if(result.code!==code)throw new Error(`Expected exit ${code}, got ${result.code}: ${result.stdout} ${result.stderr}`);
  const lines=result.stdout.trim().split('\n');if(lines.length!==1)throw new Error('Expected one JSON stdout record');
  const data=JSON.parse(lines[0]);if(data.schemaVersion!==1)throw new Error('Expected versioned JSON');
  return data;
}
