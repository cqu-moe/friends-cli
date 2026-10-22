import { createServer } from 'node:http';
export const session = {token:'fixture-token',userLevel:'XS',accountUserNo:'20210001',levelNo:'XS',unitNo:'24080'};
export const draft = {
 schemaVersion:1,kind:'volunteer-certification',id:'draft-1',revision:2,
 binding:{accountUserNo:'20210001',levelNo:'XS',unitNo:'24080',organizationId:'org-1',activityId:'activity-1'},
 activity:{id:'activity-1',name:'示例活动',organizationName:'示例青协',positionSetMethod:'SIGN',posts:[{id:'post-1',name:'引导岗',durationHours:2.5}]},
 registrations:[{registrationId:'registration-1',studentNo:'20210002',studentName:'示例志愿者',postId:'post-1',postName:'引导岗',postDurationHours:2.5,signDurationHours:2,isApplied:true,upstreamPreselected:false}],
 includedStudentNos:['20210002'],durations:{'20210002':1.5},materials:[],
};
export async function school(t) {
 const state={mode:'ok',writes:[],reads:[],stored:null,organizationId:'org-1'};
 const reply=(res, data,code='0')=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({code,data,message:code==='0'?'accepted':'rejected'}))};
 const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');const path=url.pathname;
  state.reads.push(path);
  if(path.endsWith('/checkUserAndGetUserLevel')) return reply(res,{loginLevels:[{levelNo:'XS',levelName:'学生',units:[{unitType:2,unitNo:'24080',unitName:'示例学院'}]}],userLoginType:'STUDENT'});
  if(path.endsWith('/user/info')) return reply(res,{userNo:'20210001',userName:'示例'});
  if(path.endsWith('/enterHall')) return reply(res,{account:'20210001',name:'示例',userLoginStateLevel:'XS',departmentNo:'24080'});
  if(path.endsWith('/manager-activity-list')) return reply(res,[{uuid:'activity-1',organizationId:state.organizationId,positionSetMethod:'SIGN'}]);
  if(path.endsWith('/school-activity-apply/approve-detail/activity-1')) return reply(res,{uuid:'activity-1',organizationId:state.organizationId,positionSetMethod:'SIGN',posts:[{uuid:'post-1',postName:'引导岗',duration:2.5}]});
  if(path.endsWith('/apply-list-by-activity/activity-1')) return reply(res,[{uuid:'registration-1',studentNo:'20210002',studentName:'示例志愿者',postId:'post-1',postName:'引导岗',postDuration:2.5,signDuration:2,isApply:true}]);
  if(path.endsWith('/find-by-activity/activity-1')) {
   if(state.mode.includes('readback-failure')&&state.writes.length) {res.writeHead(503);return res.end();}
   return reply(res,state.mode==='extra-roster'&&state.stored?{...state.stored,nameList:[...state.stored.nameList,{studentNo:'unselected',postId:'post-1',attestationDuration:1}]}:state.stored);
  }
  if(path.endsWith('/school-activity-attestation-apply/apply')&&req.method==='POST') {
   let body='';for await(const chunk of req)body+=chunk;
   state.writes.push(JSON.parse(body));
   if(state.mode==='permission') {res.writeHead(403);return res.end();}
   if(state.mode==='business') return reply(res,null,'CONFLICT');
   state.stored={uuid:'certification-1',activityInfo:{uuid:JSON.parse(body).activityId,organizationId:'org-1'},nameList:JSON.parse(body).nameList,flowOverallState:'FUTURE_STATE'};
   if(state.mode.startsWith('lost')) return req.socket.destroy();
   if(state.mode==='malformed') {res.writeHead(200);return res.end('not-json');}
   return reply(res,null);
  }
  res.writeHead(404);res.end();
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>{server.closeAllConnections();server.close()});
 return {state,baseUrl:`http://127.0.0.1:${server.address().port}/gateway`};
}
