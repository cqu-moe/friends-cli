# #9 志愿身份业务拒绝修复

## 证据与根因

主线程实际只读 trace 确认：身份核验与 enterHall 均 HTTP 200，member/student-view 为 200，member-apply/can-apply 返回 HTTP 400，JSON 为非零学校业务码 10000，消息表示当前已有申请在审批中。只保存这一非个人业务条件与响应形状，不保存成员数据、申请明细或凭据。

公开源码 index.32876fbb.js 的 u（export a3）是无参数 GET member-apply/can-apply；Index.74658ce3.js 仅在提交加入申请前调用。menu.24ab8a26.js 与 request.9fd33a2f.js 未添加隐藏查询参数；请求拦截器只刷新 token/userLevel。因此不改成 POST、不猜参数、不根据中文消息推断资格。活动列表已由主线程再次只读验证通过，本修复未改变列表路径或筛选。

旧 readApi 在解析 JSON 前把所有非 2xx（401/403 之外）归为协议错误；getIdentity 的 Promise.all 因此丢失成功的成员证据。成功码下 can-apply.data === true 又会把 null、字符串和对象静默转成 false。

## 契约

- readApi 仅对 HTTP 400 的合法非零学校业务 envelope 映射 BUSINESS_REJECTED，保留 upstreamCode/message/requestId。缺失或空业务码、缺失消息、HTML、400/code 0 均为 NETWORK_PROTOCOL_ERROR。401/403 在此之前保留 AUTH_REQUIRED/PERMISSION_DENIED。其他 HTTP 失败的既有分类保持。
- getIdentity 只捕获 can-apply 的 BUSINESS_REJECTED，保留成功的 memberView.present 与 interpreted:false 证据，不暴露成员原始字段。membershipApplicationAllowed 为 null；membershipApplication 为 {status:"business-rejected",rejection:{code,upstreamCode,message,requestId}}。
- code 0 且 data 明确为 boolean 时返回原布尔值与 {status:"checked",rejection:null}。畸形 data 报协议错误；成员查询本身失败仍向调用方报错，不被资格的部分结果掩盖。
- SDK 导出的 VolunteerIdentity、CLI schema、旧调用者断言与 README 同步。CLI 部分身份结果为 schemaVersion 1、ok:true、退出 0；坏协议为退出 6，身份/权限为 3/4。其他 SDK/CLI 读取遇到合法 400 业务拒绝为 BUSINESS_REJECTED/退出 5。

## 验证层次

公开 SDK 首先准确复现 Unexpected friends HTTP status 400 / NETWORK_PROTOCOL_ERROR，再验证保留成员证据的业务拒绝结果。第二个回归先以 Missing expected rejection 复现畸形 data 被静默解释为 false，再要求严格 boolean。测试使用真实本地 HTTP 服务和虚构成员字段；不同业务码与英文消息同样显式拒绝，证明未依赖中文消息分类。

真实 CLI 子进程通过 API 与执行实际会话读取脚本的 Ego fixture 查询，检查版本化单 JSON、stderr、显式拒绝信息、缺失/错误资格数据及错误退出码；schema 与实际返回契约一起验证。未添加测试专用生产 export 或绕过。

本工作线程没有真实浏览器、生产 API 或任何真实业务写入；主线程会独立复测修复后的只读行为。来源检查与受控测试不能替代真实写入验收。

定向验证：TypeScript 构建及志愿 SDK/CLI 测试 7/7 通过，0 failed/skipped；全量集成测试另行记录。
