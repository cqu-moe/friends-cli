# #24 统一搜索验证记录

## 组合范围与领域证据

公开 SDK 为 `createUnifiedSearchClient(options).search(input)`；CLI 为 `friends search`，schema 为 `search`。复用现有公开查询：

| 类型 | SDK 查询 | 详情引用 |
| --- | --- | --- |
| course | `createFriendsSdk(...).createCourseClient(session).list(...)` | courses.get + 课程 ID |
| volunteer | `createFriendsSdk(...).createVolunteerClient(session).listActivities(...)` | volunteers.activities.show + 志愿活动 ID |
| organization-activity | `createOrganizationParticipationClient(...).list(...)` | organization-participation.show + 组织活动 ID |

`src/search.ts` 不构造领域 endpoint、不执行详情查询或业务写入，只在公共查询边界组合。关键词原样交给各领域客户端的学校 key 查询；没有本地搜索算法、模糊匹配、状态筛选或全局排序。

领域证据沿用 #2/#9/#19：课程查询已有认证只读证据；志愿服务 `volunteer-operations-evidence.md` 对照公开 `Index.bc436136.js` 的活动名称/组织单位 key；组织活动沿用 `organization-operation-evidence.md` 与 #19 已提交参与查询。#19 使用提交 16b76d1；志愿查询使用提交版 a7ece1b，后续依赖更新通过 integration 同步。没有复制其他 worker 未提交的实现。

## 公共契约

- 单个已核实账号和固定身份单位，所有来源复用同一 session；每次 search 先通过公开 SDK 重新核验，不进行 CQU Auth 自动恢复或身份回退。输出仅含已核实账号 ID、身份/单位 ID，不含 token。
- 类型默认全选；每类默认 page=1/pageSize=10/maxPages=1。按类型设置独立分页，pageSize 1–100、maxPages 1–20；page 必须为安全正整数。字段、类型、重复类型、空类型、显式 null 和未支持条件均拒绝。
- CLI 支持关键词/逗号分隔类型/公共分页 flags，或 JSON 文件/stdin 的独立分页。两种输入方式互斥，验证在读取会话和访问学校之前完成。
- 每条结果保留领域原 record、类型及领域 ID，以及现有详情操作名；不同领域相同 ID 保留为不同结果，不跨类型去重或重排。
- 逐类 `pages` 保留实际 page/pageSize/totalCount/hasMore。SDK 页面调用尝试计入 pagesRequested，成功校验的页面计入 pagesRead；身份核验不计列表页预算。学校未给出 hasMore 时停止，不猜测下一页。
- `complete:true` 仅表示从第 1 页开始且学校明确没有后页；从中间页开始为 false，分页不明为 null。顶层 complete 是全部选中来源均明确完整；没有全局 totalCount、排序或 nextPage。分页间数据可变化，本实现不提供跨来源一致性快照。
- 学校还有后页且本次预算已用完时，stoppedBecause=budget、budget.exhausted=true；已到末页、分页未知和失败分别标记 end/unknown-pagination/failure。
- 某来源 403、非零业务码、断连或非法 ID/分页均逐类显式报错，不重试、不切换身份、不丢弃其他来源；第二页失败仍保留第一页面并标为 partial。业务未知状态原样保留，不解释为业务成功。
- CLI 部分失败为 ok=true、status=partial、stderr 提示、exit 0；所有来源均没有成功页面时 ok=false、status=failed，仍返回完整逐类错误。相同错误使用其既有退出码，混合错误用 NETWORK_PROTOCOL_ERROR/6。输入错误 exit 2、身份失配 exit 3，继续使用统一根错误输出。

## API 与 Ego

API 和 Ego 搜索都只执行领域 API 查询。Ego 从既有同源 iframe 会话读取并验证身份，不打开新页、点击、填表或交接。身份核验可能调用已有 enterHall 固定当前指定上下文，POST 查询不视为业务写入。没有注册、退出、审批、上传或人工操作功能。

## 受控验证

- `tests/search.test.js` 从公开 SDK 进入，覆盖三类结果/关键词/详情引用/相同 ID、类型限定、独立分页与预算、已扫描页面保留、未知分页与状态、空结果、权限/业务/网络失败、非法 ID 与错误页码、输入条件拒绝和账号变化。
- `tests/search-cli.test.js` 使用真实 Node CLI 子进程和真实 SDK，覆盖 help/schema、默认搜索、类型/分页 flags、文件/stdin、混用/非法/非交互错误、单条版本化 JSON stdout、stderr 与退出码、部分失败/全失败、空/未知/错误 ID，以及 Ego 会话来源。
- `tests/fixtures/search.mjs` 为共享的受控外部学校服务，核对完整 URL、方法、AppKey、token/context 和分页请求；只允许现有身份与三类只读列表路径。不会复制统一搜索算法。
- Ego 控制 fixture 执行真实会话脚本和同源 iframe DOM 回调；删除本地 session 文件后仍能完成查询，证明没有凭据回退。确认 clicks/fills/newPages/navigations/handoffs/submits 均为零，人工输入保留。

最终同步 integration `b2adb95`（包含提交版 #9/#18/#19，同步提交 `43248a0`）后，完整 `npm test` 已通过：233/233，零失败、零跳过。#24 独立 SDK 用例 5 个、真实 CLI 用例 4 个均包含在此全量结果内。依赖同步后的基线树与 `b2adb95` 完全一致；本任务只新增下面所述统一搜索实现、接线、测试及文档。

## 验收层与限制

公开源码与已提交领域实现：已核对。受控 SDK 和真实 CLI：已运行。实际 Ego 和当前学校登录态三类统一搜索：未运行，主流程保留真实浏览器验收。生产 API 写入和人工最终提交不属于只读搜索范围，没有执行。没有 GitHub 操作、推送、WAF 修改或课程认证实现。
