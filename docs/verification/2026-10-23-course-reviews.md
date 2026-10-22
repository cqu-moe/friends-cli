# 课程开办与报名审批（#15）

## 交付与边界

公开 SDK `createCourseReviewClient` 提供 `list`、`get`、`prepare`、`decide`；Node 入口提供 `prepareCourseReviewInEgo`。CLI 为 `courses reviews list|show|prepare|decide --type offering|registration`。两类审批都可以从学校已有待办开始，不依赖 #14 创建新课程。未实现已撤回的 #16/#17 课程认证。

| 命令 | 业务性质 | 路径及阶段 | 权限与校验 |
| --- | --- | --- | --- |
| list | 只读，虽然列表为 POST | API / Ego 当前会话直接查询 API | 重新核对账号、身份和学校待办过滤条件 |
| show | 只读 | API / Ego 当前会话直接查询 API | 领域 ID、详情及待办归属；报名还核对可管理课程 |
| decide --dry-run | 只读准备 | 仅 API，无审批写入 | 与正式准备相同，不执行保存/决定/上传 |
| decide --yes | 一次审批写入及只读回查 | 仅显式 API | 原 client 创建且未修改的 plan；执行前重新核对身份、待办、绑定、学校详情 |
| prepare | 可见控件准备及交接 | 仅 Ego，始终 submitted=false | 新鲜验证的 Ego 会话、相同业务校验；最终确定由用户亲自操作 |

`allowedDecisions` 由详情页实际提供的控件与当前待办归属共同限定：开办 `pass/back/refuse`，报名 `pass/refuse`。报名共享 API chunk 虽定义 callback 请求，但报名详情未提供“打回”，因此拒绝该决定。已处理对象仍能只读 show，返回 `pending:false` 和空决定列表，不能再次决定。

开办普通审批仅支持生产列表已确认的 `XSC→ZNBM`、`XY→EJXY`、`FDY→ZDLS` 映射；不接受 handleType/admin 覆盖，不猜测指导单位等入口的身份上下文。学校当前角色必须与 client 固定角色一致；未知身份停止。报名固定 `XS02`，同时要求该课程出现在当前学校 `apply/manager-activity-list`。

## 源码证据

证据根为共享笔记目录的 `school-public-source/`；本记录没有发生产请求。

- `index.7ba42e14.js` 经 curriculum 请求工厂发送 `/gateway/zovecenter-saip-ek-app-curriculum/mob/...`。`menu.24ab8a26.js`、`request.9fd33a2f.js` 确认服务 AppKey；公共实例的真实前缀是 `/gateway/ek-agg-mob/biz-common`，AppKey 为 `zovecenter-saip-ek-agg-mob`。
- `Index.047450f3.js`、`Detail.33f703ee.js`：开办待办 POST `apply/apply-page-list`，普通入口 `state:0`；详情 GET `apply/approve-detail/{uuid}`；决定 POST `apply/pass|callback|refuse`。仅普通开办审批，未混入 `clearingApply` 补录审批。
- `Index.c394d0a0.js`、`Detail.2f33c3e8.js`：报名待办 POST `student-apply/page-list`，先通过公共 `flow/template-activity-state` 查询 `businessTypeCode:课程学生报名申请,handleType:XS02` 的待办过滤值 `"0"`；详情 GET `student-apply/{uuid}`。路由同时带报名 UUID、curriculumId 与 studentNo。
- 决定 payload 只构造 `time,msg,handleType,applyInfo,uuid`，报名另含源列表 `queryDto`，固定为一个报名对象绑定的 curriculumId。`applyInfo` 仅来自此次校验过的学校详情；输入 JSON 只接受 message/time，不接受调用者提供的任意学校对象。
- `Detail.33f703ee.js` 调用 `base.58f865b9.js` 的 formatter 时使用 `{y}-{m}-{d} {h}:{m}:{s}`，分钟位置实际取月份。本实现忠实保留该前端契约，例如日期 `2026-10-23` 得到 `2026-10-23 00:10:00`；报名原样发送日期。没有擅自修正学校格式。
- `index.cb76156f.js` 的 Course FlowRecord 明确把 audit `nodeState` 3/5/7 映射为通过/打回/拒绝，并读取 `handleOpinion`、`handleTime`。回查匹配要求同一详情出现新增的选定决定记录（意见、日期相符），并离开该身份待办。整体 `flowOverallState` 枚举仍未确认，保留原值且 `known:false`，不将节点通过宣称为课程最终通过。
- `SimpleDialog.4bfd972c.js`：action-bar 的按钮只打开审批对话框，最终 `.van-dialog__confirm` 才触发表单提交。Ego 复用 #11 的 iframe 处理与可见审批控件流程，使用直接 textarea / input[name=time]；不解析不存在的快照 `@N` 标签。

## 不确定结果与人工控制

写入前重新检查，plan 在异步检查前快照，避免调用者在网络等待期间更改选定决定或 payload。每个 client 对同一对象只允许一次尝试，并发 plan 不会多写。学校明确拒绝返回业务错误；连接丢失、超时、无效响应即使回查匹配也保留 `UNKNOWN_OUTCOME`。学校已确认但回查不匹配/不可用，同样返回未知，并区分 `serverAcknowledged:true` 与 `"unknown"`。保留对象 ID、已发生阶段与 readback，client 此后只允许只读检查，不重试、不切路径续交、不回滚。CLI 单次命令只尝试一次，退出码 7；调用者必须保存 JSON 恢复信息，不能通过新进程自动重交。

Ego 仅打开源页面提供的决定对话框并在空白意见中填写输入。已有意见、日期和不同的人工决定均保留；日期不同列为 `review-date` 待人工复核。交接后不再操作。页面不符且存在输入时不导航；中途失败报告未知结果并保留已完成的可见步骤。`prepare --yes`、`decide --via ego --yes`、SDK 提交越界选项均拒绝；没有最终点击、快捷键、隐藏审批 API 或上传路径。

## 实际运行的验收

`tests/fixtures/course-reviews.mjs` 是虚构学校 HTTP 服务，对完整网关路径、方法、AppKey、账号以及决定 payload 做独立约束。`tests/fixtures/strict-ego.mjs` 在同源 iframe JSDOM 中执行生成脚本的真实 evaluate 回调、原生点击/输入事件；没有用预制 evaluate 结果替代流程。危险“保存”和最终“确定”具备可观测 POST 副作用，准备测试确认其请求为零。

- `npm run build && node --test tests/course-reviews*.test.js`：公开 SDK 的各决定完整链、验证/权限/待办/已处理/绑定、并发与输入快照、业务拒绝、实际短超时、丢响应、已确认但回查不一致；真实 CLI 子进程的 list/show/prepare/decide、API/Ego 支持路径、全部可见决定、file/stdin、确认、schema/help、单条版本 JSON、stderr 和退出码；两入口均验证人工意见保留和中途失败交接。
- 完整 `npm test` 在合入当时最新 integration 后运行，最终数量及 integration SHA 见本次交接记录。

| 验收层次 | 本次证据 |
| --- | --- |
| 生产公开源码 | 已核对下载快照、路由、控件和 exact payload |
| 受控 SDK / 真实 CLI 子进程 | 已运行，本地 HTTP + 实际 iframe DOM 回调 |
| 实际 Ego 页面准备 | 未运行，由主任务负责 |
| 当前学校登录态只读 | 本任务未运行 |
| 生产 API 审批写入 | 未运行 |
| 用户亲自最终提交及服务器回查 | 未运行 |

本次未访问真实浏览器、GitHub 或其他 worker 的工作树，未处理 native 登录 WAF。生产角色返回、审批记录时间格式及完整 applyInfo 的学校校验仍需主任务的真实只读/人工验收；不满足已确认字段时停止或报告未知，不能用本地通过替代生产验收。
