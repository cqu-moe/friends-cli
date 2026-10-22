import { createServer } from 'node:http';
export const reviewSession = {token:'fixture-token',userLevel:'XY',account:{userNo:'20210001'},context:{levelNo:'XY',unit:{unitNo:'college-1'}}};
export async function reviewScenario() {
  const requests=[];
  const rows={offering:{uuid:'offering-1',activityName:'示例活动',activityCategory:'SCHOOL_ACTIVITY',organizationId:'org-1',posts:[],flowOverallState:1,flowCurrNodeOperateRole:'YJ01'},registration:{uuid:'registration-1',activityId:'offering-1',studentNo:'20210002',studentName:'示例志愿者',postId:'post-1',postName:'服务',postDuration:2,questionnaireResult:{},flowOverallState:1}};
  const state={mode:'ok',role:'XY',availableRole:'XY',unit:'college-1',availableUnit:'college-1',account:'20210001',enteredAccount:'20210001',pending:{offering:true,registration:true},managed:true};
  const server=createServer(async(req,res)=>{
    let body='';for await(const chunk of req) body+=chunk;
    const data=body?JSON.parse(body):null; const path=new URL(req.url,'http://fixture').pathname;
    requests.push({path,method:req.method,body:data});
    const reply=(data,code='0',status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify({code,data,message:code==='0'?'ok':'rejected'}));};
    if(path.endsWith('/checkUserAndGetUserLevel'))return reply({userLoginType:'TEACHER',loginLevels:[{levelNo:state.availableRole,levelName:'学院',units:[{unitNo:state.availableUnit,unitName:'示例学院',unitType:1}]}]});
    if(path.endsWith('/enterHall'))return reply({account:state.enteredAccount,name:'示例管理者',userLoginStateLevel:state.role,departmentNo:state.unit});
    if(path.endsWith('/user/info'))return reply({userNo:state.account,userName:'示例管理者'});
    if(path==='/gateway/ek-agg-mob/biz-common/flow/template-activity-state')return reply([{code:'0',name:'待审批'}]);
    if(path==='/gateway/ek-agg-mob/biz-common/flow/callback-list')return reply([{templateActivityRespDto:{activityid:'node-1',name:'申请人'}}]);
    if(path.endsWith('/manager-activity-list'))return reply(state.managed?[{uuid:'offering-1'}]:[]);
    const kind=path.includes('/schoolActivityStudentApply/')?'registration':'offering';
    if(path.endsWith('/apply-page-list')||path.endsWith('/schoolActivityStudentApply/page-list'))return reply({data:state.pending[kind]?[rows[kind]]:[],currentPage:data.currentPage,pageSize:data.pageSize,pages:1,totalCount:state.pending[kind]?1:0});
    if(path.endsWith('/apply-list-by-activity/offering-1'))return reply([rows.registration]);
    if(path.endsWith('/approve-detail/offering-1')||path.endsWith('/schoolActivityStudentApply/registration-1')){
      if(state.mode==='lost-readback'&&!state.pending[kind])return reply(null,'unavailable',503);
      return reply(rows[kind]);
    }
    if(req.method==='POST'&&/\/(pass|refuse|callback)$/.test(path)){
      if(state.mode==='reject')return reply(null,'rejected');
      state.pending[kind]=false;rows[kind].flowOverallState=path.endsWith('/pass')?7:5;
      if(state.mode.startsWith('lost')){req.socket.destroy();return;}
      return reply(null);
    }
    return reply(null,'unexpected',404);
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  return {baseUrl:`http://127.0.0.1:${server.address().port}/gateway`,state,rows,requests,close:()=>new Promise(r=>server.close(r))};
}
