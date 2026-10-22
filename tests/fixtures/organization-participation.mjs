import {createServer} from 'node:http';
export const participationSession={token:'fixture-token',userLevel:'XS',account:{userNo:'20210001'},context:{levelNo:'XS',unit:{unitNo:'college-1'}}};
export async function participationScenario(){
 const requests=[];const questions=[{uuid:'q-1',title:'参与说明',itemType:'31',isMandatory:true,write:'',annex:null,respDtoList:[]}];
 const row={uuid:'org-activity-1',activityName:'示例组织活动',organizationId:'org-1',organizationName:'示例组织',application:false,applicationCode:null,applicationUuid:null,isOrganization:true,isEnrollPower:0,isCancel:false,isOpenEnrollment:true,openTime:'2020-01-01 00:00',deadline:'2099-12-31 23:59',applyNumber:30,enrollNumber:2};
 const state={mode:'ok',account:'20210001',detailId:'org-activity-1',pages:1,empty:false,brokenReadback:false};
 const service='/gateway/zovecenter-saip-ek-app-team-organization-manage/mob';
 const server=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;const body=raw?JSON.parse(raw):null;const path=new URL(req.url,'http://fixture').pathname;requests.push({path,method:req.method,body,appkey:req.headers['h-zove-appkey']});
 const reply=(data,code='0',status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify({code,data}));};
 if(path==='/gateway/ek-agg-mob/user/checkUserAndGetUserLevel')return reply({userLoginType:'STUDENT',loginLevels:[{levelNo:'XS',levelName:'学生',units:[{unitNo:'college-1',unitName:'示例学院',unitType:1}]}]});
 if(path==='/gateway/ek-agg-mob/user/info')return reply({userNo:state.account,userName:'示例学生',userLoginStateLevel:'XS'});
 if(path==='/gateway/ek-agg-mob/user/enterHall')return reply({account:state.account,name:'示例学生',userLoginStateLevel:'XS',departmentNo:'college-1'});
 if(state.mode==='denied')return reply(null,'denied',403);
 if(state.brokenReadback)return reply(null,'unavailable',503);
 if(path===service+'/enroll-info/apply-page-list'||path===service+'/apply-info/my-apply-list')return reply({data:state.empty?[]:[row],pages:state.pages,currentPage:body.currentPage,pageSize:body.pageSize,totalCount:1});
 if(path===service+'/enroll-info/find/org-activity-1')return reply({...row,uuid:state.detailId,application:undefined,applicationUuid:undefined,isOrganization:undefined,questionnaireInfoRespDtoList:questions});
 if(path==='/gateway/ek-agg-mob/biz-common/list-group-resource')return reply([{uuid:'resource-1',groupUuid:new URL(req.url,'http://fixture').searchParams.get('groupUuid'),originalName:'example.pdf',url:'/example.pdf'}]);
 if(path===service+'/enroll-info'&&req.method==='POST'||path===service+'/enroll-info/exit/org-activity-1'&&req.method==='DELETE'){
  if(state.mode==='reject')return reply(null,'rejected');
  row.application=req.method==='POST';row.applicationCode=row.application?3:null;row.applicationUuid=row.application?'org-registration-1':null;
  if(state.mode==='lost-unavailable')state.brokenReadback=true;
  if(state.mode.startsWith('lost'))return req.socket.destroy();return reply(null);
 }
 return reply(null,'unexpected',404);
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));return{baseUrl:`http://127.0.0.1:${server.address().port}/gateway`,row,questions,state,requests,close:()=>new Promise(r=>server.close(r))};
}
