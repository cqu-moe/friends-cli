import {createServer} from 'node:http';
export const teamRoot='/gateway/zovecenter-saip-ek-app-team-organization-manage/mob';
export const commonRoot='/gateway/ek-agg-mob/biz-common';
export const session={token:'organization-fixture-token',userLevel:'XS',account:{userNo:'20210001'},context:{levelNo:'XS',unit:{unitNo:'unit-1'}}};
export function offeringInput(){return {organizationId:'organization-1',activityName:'示例组织活动',activityContent:'活动简介',activityPlace:'示例活动室',beginTime:'2099-11-02 10:00',endTime:'2099-11-02 12:00',registration:{isOpenEnrollment:true,isHideList:false,isEnrollExamine:true,isEnrollPower:false,signinNum:1,openTime:'2099-10-01 10:00',deadline:'2099-11-01 18:00'},materials:{publicityPictures:[new File(['poster-bytes'],'poster.png',{type:'image/png'})],attachments:[]}};}
export async function setupOrganizationActivities(t){
 const requests=[],resources=new Map();const state={mode:'normal',account:'20210001',permission:true,detail:null,workflow:{nodeList:[{activityname:'组织审核',state:'UNKNOWN_NODE_STATE'}],evaluationRecords:[{msg:'等待学校处理',state:'UNKNOWN_RECORD_STATE'}]},uploads:0,firstWrites:0,finalWrites:0};
 const activity=()=>state.detail??{uuid:'activity-1',activityName:'示例组织活动',organizationId:'organization-1',organizationName:'示例组织',activityPlace:'示例活动室',beginTime:'2099-11-02 10:00',endTime:'2099-11-02 12:00',approvalState:'FUTURE_STATE',flowOverallState:'SCHOOL_PENDING',isOpenEnrollment:true,isEnrollPower:false,openTime:'2099-10-01 10:00',deadline:'2099-11-01 18:00',questionnaireInfoRespDtoList:[]};
 const server=createServer(async(req,res)=>{
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const raw=Buffer.concat(chunks);const url=new URL(req.url,'http://localhost');
  const multipart=req.headers['content-type']?.startsWith('multipart/form-data');let body=null;
  try{body=raw.length&&!multipart?JSON.parse(raw.toString()):null;}catch{}
  requests.push({method:req.method,path:url.pathname,query:url.search,headers:req.headers,body,raw});
  const reply=(data,code='0')=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({code,data,message:code==='0'?'accepted':'school rejected',requestId:'controlled-request'}));};
  const fail=status=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify({message:'denied'}));};
  if(url.pathname==='/gateway/ek-agg-mob/user/checkUserAndGetUserLevel')return reply({loginLevels:[{levelNo:'XS',levelName:'学生',units:[{unitNo:'unit-1',unitType:2,unitName:'示例学院'}]}],userLoginType:'STUDENT'});
  if(url.pathname==='/gateway/ek-agg-mob/user/info')return reply({userNo:state.account,userName:'示例学生'});
  if(url.pathname==='/gateway/ek-agg-mob/user/enterHall')return reply({account:state.account,name:'示例学生',userLoginStateLevel:'XS',departmentNo:'unit-1'});
  if(url.pathname.startsWith(teamRoot)&&req.headers['h-zove-appkey']!=='zovecenter-saip-ek-app-team-organization-manage')return fail(400);
  if(url.pathname.startsWith(commonRoot)&&req.headers['h-zove-appkey']!=='zovecenter-saip-ek-agg-mob')return fail(400);
  if(state.mode==='denied'&&url.pathname.startsWith(teamRoot))return fail(403);
  if(url.pathname===teamRoot+'/apply-info/chose-type')return reply(state.permission?[{uuid:'organization-1',organizationName:'示例组织',organizationType:'STUDENT_CLUB'}]:[]);
  // Live evidence establishes only a three-item array here; synthetic entries contain no personal data.
  if(url.pathname===commonRoot+'/flow/node-list-no-state')return reply([{},{},{}]);
  if(url.pathname===commonRoot+'/flow/approve-list')return reply(state.workflow);
  if(url.pathname===commonRoot+'/term-list')return reply([{beginYear:'2099',endYear:'2100',termNo:'1',schoolTermName:'2099-2100学年第1学期',isCurrentTerm:1}]);
  if([teamRoot+'/apply-info/activity-page-list',teamRoot+'/apply-info/my-page-list'].includes(url.pathname))return reply({data:[activity()],currentPage:body.currentPage,pageSize:body.pageSize,totalCount:3,...(state.mode==='unknown-pages'?{}:{pages:2})});
  if(url.pathname===teamRoot+'/apply-info/activity-1'){
   if(state.mode==='lost-readback')return res.destroy();
   return reply(activity());
  }
  if(url.pathname===teamRoot+'/apply-info/course-1')return fail(404);
  if(url.pathname===commonRoot+'/protected-file-upload'){
   state.uploads++;
   const data=raw.toString();const group=/name="groupId"\r\n\r\n([^\r]+)/.exec(data)?.[1];const filename=/filename="([^"]+)"/.exec(data)?.[1];
   if(!group||!filename||!data.includes('name="files"'))return fail(400);
   const resource={uuid:'resource-'+state.uploads,title:filename.slice(0,filename.lastIndexOf('.')),fileExtension:filename.slice(filename.lastIndexOf('.'))};
   resources.set(group,[...(resources.get(group)??[]),resource]);
   if(state.mode==='lost-upload'||state.mode==='lost-second-upload'&&state.uploads===2)return res.destroy();
   return reply([resource.uuid]);
  }
  if(url.pathname===commonRoot+'/list-group-resource'){if(state.mode==='lost-resource-readback')return res.destroy();return reply(resources.get(url.searchParams.get('groupUuid'))??[]);}
  if(url.pathname===teamRoot+'/apply-info/next-update'){
   state.firstWrites++;state.detail={...activity(),...body,uuid:'activity-1'};
   if(state.mode==='lost-first')return res.destroy();
   if(state.mode==='revoke-after-first')state.permission=false;
   return reply(state.mode==='invalid-first-id'?null:'activity-1');
  }
  if(url.pathname===teamRoot+'/apply-info/set-update'){
   state.finalWrites++;if(state.mode==='ignore-final')return reply(true);state.detail={...activity(),...body,approvalState:'SCHOOL_PENDING',flowOverallState:'NEW_SERVER_VALUE'};
   if(state.mode==='lost-final')return res.destroy();
   if(state.mode==='rejected-final')return reply(null,'BUSINESS_DENIED');
   return reply(true);
  }
  return fail(404);
 });
 await new Promise(done=>server.listen(0,'127.0.0.1',done));
 t.after(()=>{server.closeAllConnections();server.close();});
 return {baseUrl:`http://127.0.0.1:${server.address().port}/gateway`,requests,state,resources};
}
