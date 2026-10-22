import {createServer} from 'node:http';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
export async function setupCertification(t,{humanHours,account='20210001'}={}){
 const home=await mkdtemp(join(tmpdir(),'friends-ego-cert-'));t.after(()=>rm(home,{recursive:true,force:true}));
 const requests=[];
 const server=createServer((req,res)=>{
  requests.push({method:req.method,url:req.url});
  if(req.method==='GET'&&req.url.startsWith('/mobile/')){res.writeHead(200,{'content-type':'text/html; charset=utf-8'});readFile(htmlPath).then(html=>res.end(html));return;}
  if(req.url==='/__requests'){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({finalSubmits:requests.filter(req=>req.url.endsWith('/school-activity-attestation-apply/apply')).length}));return;}
  const reply=data=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({code:'0',data}));};
  if(req.url.endsWith('/checkUserAndGetUserLevel'))return reply({loginLevels:[{levelNo:'XS',levelName:'学生',units:[{unitType:2,unitNo:'24080',unitName:'示例学院'}]}],userLoginType:'STUDENT'});
  if(req.url.endsWith('/user/info'))return reply({userNo:account,userName:'示例'});
  if(req.url.endsWith('/enterHall'))return reply({account,name:'示例',userLoginStateLevel:'XS',departmentNo:'24080'});
  if(req.url.endsWith('/manager-activity-list'))return reply([{uuid:'activity-1',organizationId:'org-1'}]);
  if(req.url.endsWith('/school-activity-apply/approve-detail/activity-1'))return reply({uuid:'activity-1',activityName:'迎新志愿服务',organizationName:'示例青协',organizationId:'org-1',positionSetMethod:'SIGN',posts:[{uuid:'post-1',postName:'引导岗',duration:2.5}]});
  if(req.url.endsWith('/apply-list-by-activity/activity-1'))return reply([{uuid:'registration-1',studentNo:'20210001',studentName:'示例学生',postId:'post-1',postName:'引导岗',postDuration:2.5,signDuration:2,isApply:true,isAttestation:false}]);
  if(req.url.includes('/query-student?studentNo=20210002'))return reply({studentNo:'20210002',studentName:'示例志愿者'});
  if(req.url.endsWith('/school-activity-attestation-apply/apply'))return reply(true);
  res.writeHead(404);res.end();
 });
 await new Promise(done=>server.listen(0,'127.0.0.1',done));t.after(()=>{server.closeAllConnections();server.close();});
 const baseUrl=`http://127.0.0.1:${server.address().port}/gateway`;
 const url=baseUrl.replace('/gateway','/mobile/volunteerManage/campusActivityCerApply?uuid=activity-1&type=attestApply');
 let html=await readFile(resolve('fixtures/volunteer-certification/index.html'),'utf8');
 html=html.replace('<script>','<script>localStorage.setItem("token_str","ego-fixture-token");localStorage.setItem("userLevel_str","XS");');
 if(humanHours!==undefined)html=html.replace("hours:2,selected:false",`hours:${humanHours},selected:false`);
 const htmlPath=join(home,'index.html');await writeFile(htmlPath,html);
 const result=join(home,'observed.json'),config=join(home,'ego.json');await writeFile(config,JSON.stringify({html:htmlPath,url,result}));
 const bin=join(home,'bin');await mkdir(bin,{mode:0o700});
 const command=join(bin,'ego-browser');
 await writeFile(command,`#!${process.execPath}\nawait import(${JSON.stringify(new URL('./strict-ego.mjs',import.meta.url).href)});\n`,{mode:0o700});
 const draft={schemaVersion:1,kind:'volunteer-certification',id:'draft-1',revision:1,binding:{accountUserNo:'20210001',levelNo:'XS',unitNo:'24080',organizationId:'org-1',activityId:'activity-1'},activity:{id:'activity-1',name:'迎新志愿服务',organizationName:'示例青协',positionSetMethod:'SIGN',posts:[{id:'post-1',name:'引导岗',durationHours:2.5}]},registrations:[{registrationId:'registration-1',studentNo:'20210001',studentName:'示例学生',postId:'post-1',postName:'引导岗',postDurationHours:2.5,signDurationHours:2,isApplied:true,upstreamPreselected:false},{registrationId:null,studentNo:'20210002',studentName:'示例志愿者',postId:'post-1',postName:'引导岗',postDurationHours:null,signDurationHours:null,isApplied:false,upstreamPreselected:false}],includedStudentNos:['20210001','20210002'],durations:{'20210001':1.5,'20210002':3},materials:[]};
 const session={token:'ego-fixture-token',userLevel:'XS',account:{userNo:'20210001',userName:'示例'},context:{levelNo:'XS',unit:{unitNo:'24080'}}};
 return {home,config,result,requests,options:{draft,session,taskSpaceId:7,page:'p2',baseUrl,command},env:{...process.env,FRIENDS_HOME:home,FRIENDS_BASE_URL:baseUrl,FRIENDS_DRAFT_HOME:join(home,'drafts'),FRIENDS_EGO_FIXTURE_CONFIG:config,PATH:bin+':'+process.env.PATH},async observed(){return JSON.parse(await readFile(result,'utf8'))}};
}
