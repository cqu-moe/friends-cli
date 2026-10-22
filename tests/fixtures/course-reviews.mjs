import assert from 'node:assert/strict';
import {createServer} from 'node:http';

export const courseReviewSession = {token:'fixture-token',userLevel:'XY',account:{userNo:'20210001'},context:{levelNo:'XY',unit:{unitNo:'college-1'}}};
const prefix='/gateway/zovecenter-saip-ek-app-curriculum/mob';

// Exact contracts from the downloaded course list/detail chunks, not a suffix router.
export async function courseReviewScenario() {
  const requests=[], violations=[];
  const rows={
    offering:{uuid:'course-apply-1',curriculumName:'示例课程',organizationId:'org-1',roles:[{uuid:'role-1',roleName:'参与者',integral:1}],flowOverallState:1,flowCurrMsg:'等待学院审批',approvalRecords:[]},
    registration:{uuid:'course-reg-1',curriculumId:'course-apply-1',studentNo:'20210002',studentName:'示例学生',roleId:'role-1',roleName:'参与者',roleIntegral:1,roleClassHour:2,flowOverallState:1,flowCurrMsg:'等待报名审批',approvalRecords:[]},
  };
  const state={mode:'ok',role:'XY',managed:true,pending:{offering:true,registration:true},denied:false,detailOverride:null,pageCount:1,recordPage:1};
  const server=createServer(async(req,res)=>{
    let body='';for await(const chunk of req)body+=chunk;
    const data=body?JSON.parse(body):null;
    const path=new URL(req.url,'http://fixture').pathname;
    requests.push({path,method:req.method,body:data});
    const reply=(data,code='0',status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify({code,data,message:code==='0'?'ok':'rejected'}));};
    try {
      assert.equal(req.headers['h-zove-token'],'fixture-token');
      assert.equal(req.headers['h-zove-appkey'],path.startsWith(prefix+'/')?'zovecenter-saip-ek-app-curriculum':'zovecenter-saip-ek-agg-mob');
      if(path==='/gateway/ek-agg-mob/user/checkUserAndGetUserLevel'){
        assert.equal(req.method,'POST');return reply({userLoginType:'TEACHER',loginLevels:[{levelNo:'XY',levelName:'学院',units:[{unitNo:'college-1',unitName:'示例学院',unitType:1}]}]});
      }
      if(path==='/gateway/ek-agg-mob/user/enterHall'){
        assert.equal(req.method,'POST');return reply({account:'20210001',name:'示例管理者',userLoginStateLevel:state.role,departmentNo:'college-1'});
      }
      if(path==='/gateway/ek-agg-mob/user/info'){
        assert.equal(req.method,'POST');return reply({userNo:'20210001',userName:'示例管理者',userLoginStateLevel:state.role});
      }
      if(path==='/gateway/ek-agg-mob/biz-common/flow/template-activity-state'){
        assert.equal(req.method,'POST');assert.deepEqual(data,{businessTypeCode:'课程学生报名申请',handleType:'XS02'});return reply([{code:'0',name:'待审批'}]);
      }
      if(path===prefix+'/apply/manager-activity-list'){
        assert.equal(req.method,'GET');return reply(state.managed?[{uuid:'course-apply-1'}]:[]);
      }
      const listKind=path===prefix+'/apply/apply-page-list'?'offering':path===prefix+'/student-apply/page-list'?'registration':null;
      if(listKind){
        assert.equal(req.method,'POST');assert.equal(data.handleType,listKind==='offering'?'EJXY':'XS02');assert.equal(data.state,listKind==='offering'?0:'0');
        if(state.denied)return reply(null,'denied',403);
        return reply({data:state.pending[listKind]&&data.currentPage===state.recordPage?[rows[listKind]]:[],currentPage:data.currentPage,pageSize:data.pageSize,pages:state.pageCount,totalCount:state.pending[listKind]?1:0});
      }
      const detailKind=path===prefix+'/apply/approve-detail/course-apply-1'?'offering':path===prefix+'/student-apply/course-reg-1'?'registration':null;
      if(detailKind){
        assert.equal(req.method,'GET');
        if(['lost-readback','ack-readback-unavailable'].includes(state.mode)&&!state.pending[detailKind])return reply(null,'unavailable',503);
        return reply(state.detailOverride??rows[detailKind]);
      }
      const write=path.match(/^\/gateway\/zovecenter-saip-ek-app-curriculum\/mob\/(apply|student-apply)\/(pass|callback|refuse)$/);
      if(write){
        assert.equal(req.method,'POST');const kind=write[1]==='apply'?'offering':'registration';
        assert.equal(state.pending[kind],true);assert.equal(data.uuid,rows[kind].uuid);assert.deepEqual(data.applyInfo,rows[kind]);
        assert.equal(data.handleType,kind==='offering'?'EJXY':'XS02');
        assert.deepEqual(Object.keys(data).sort(),(kind==='offering'?['time','msg','handleType','applyInfo','uuid']:['time','msg','handleType','applyInfo','uuid','queryDto']).sort());
        assert.equal(data.time,kind==='offering'?'2026-10-23 00:10:00':'2026-10-23');
        if(kind==='registration'){assert.notEqual(write[2],'callback');assert.equal(data.queryDto.curriculumId,'course-apply-1');}
        if(state.mode==='reject')return reply(null,'school-rejected');
        if(!['lost-pending','ack-no-change'].includes(state.mode)){
          state.pending[kind]=false;rows[kind].flowOverallState=write[2]==='pass'?7:write[2]==='refuse'?5:3;
          rows[kind].flowCurrMsg={pass:'审批通过',refuse:'审批拒绝',callback:'审批打回'}[write[2]];
          rows[kind].approvalRecords.push({nodeState:state.mode==='wrong-decision'?'7':{pass:'3',callback:'5',refuse:'7'}[write[2]],handleOpinion:data.msg,handleTime:data.time});
        }
        if(state.mode==='timeout'){setTimeout(()=>res.destroy(),150);return;}
        if(state.mode==='malformed'){res.end('{');return;}
        if(state.mode.startsWith('lost')){req.socket.destroy();return;}
        return reply(null);
      }
      throw new Error('Unexpected school route '+req.method+' '+path);
    } catch(error){violations.push(error.message);return reply(null,'fixture-contract',500);}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  return {baseUrl:`http://127.0.0.1:${server.address().port}/gateway`,rows,state,requests,violations,writes:()=>requests.filter(r=>/\/(pass|refuse|callback)$/.test(r.path)),close:()=>new Promise(r=>server.close(r))};
}
export const reviewInput=(type,decision='pass')=>({type,id:type==='offering'?'course-apply-1':'course-reg-1',decision,message:'资料已核对',time:'2026-10-23'});
