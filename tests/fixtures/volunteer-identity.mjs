import {createServer} from 'node:http';
export const volunteerRoot = '/gateway/zovecenter-saip-ek-app-young-volunteers/mob';
export const identitySession = {token:'identity-fixture-token',userLevel:'XS',account:{userNo:'20210001'},context:{levelNo:'XS',unit:{unitNo:'unit-a'}}};
export const pendingApplication = {code:'10000',message:'你当前已有申请正在审批中，不能再申请!',data:{}};
export async function volunteerIdentitySchool(t) {
  const requests = [];
  const state = {eligibility:{status:200,body:{code:'0',data:true}},member:{status:200,body:{code:'0',data:{unpublishedField:'fixture-only'}}},list:{status:200,body:{code:'0',data:{data:[],currentPage:1,pageSize:10,pages:0,totalCount:0}}}};
  const server = createServer(async (req,res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const url = new URL(req.url,'http://localhost');
    requests.push({method:req.method,path:url.pathname,query:url.search,body:raw ? JSON.parse(raw) : null,headers:req.headers});
    const reply = ({status=200,body}) => {res.writeHead(status,{'content-type':typeof body === 'string' ? 'text/html' : 'application/json'});res.end(typeof body === 'string' ? body : JSON.stringify(body));};
    const ok = data => reply({body:{code:'0',data}});
    if (url.pathname === '/gateway/ek-agg-mob/user/checkUserAndGetUserLevel') return ok({loginLevels:[{levelNo:'XS',levelName:'学生',units:[{unitNo:'unit-a',unitType:2,unitName:'示例学院'}]}],userLoginType:'STUDENT_UNACTIVATED'});
    if (url.pathname === '/gateway/ek-agg-mob/user/info') return ok({userNo:'20210001',userName:'示例学生'});
    if (url.pathname === '/gateway/ek-agg-mob/user/enterHall') return ok({account:'20210001',name:'示例学生',userLoginStateLevel:'XS',departmentNo:'unit-a'});
    if (url.pathname.startsWith(volunteerRoot) && req.headers['h-zove-appkey'] !== 'zovecenter-saip-ek-app-young-volunteers') return reply({status:400,body:{message:'wrong app key'}});
    if (url.pathname === volunteerRoot+'/member/student-view' && req.method === 'GET' && !url.search) return reply(state.member);
    if (url.pathname === volunteerRoot+'/member-apply/can-apply' && req.method === 'GET' && !url.search) return reply(state.eligibility);
    if (url.pathname === volunteerRoot+'/school-activity-apply/student-apply-page-list' && req.method === 'POST') return reply(state.list);
    return reply({status:404,body:{message:'unexpected source path or method'}});
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  t.after(() => {server.closeAllConnections();server.close();});
  return {baseUrl:`http://127.0.0.1:${server.address().port}/gateway`,requests,state};
}
