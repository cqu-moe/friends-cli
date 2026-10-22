# #20 组织活动开办与报名审批验证记录

## 范围与证据

依据 2026-10-22 下载的学校生产公开 JS 和本地 #20 任务说明实现；本次未访问浏览器、学校生产 API 或 GitHub。证据不是当前登录态或真实写入验收。

- `index.ab6e178e.js`：组织服务 `team-organization-manage` 请求工厂与精确导出映射。
- `teacher.4fd8bab0.js`、`menuChildList.e9675e4c.js`：FDY 辅导员、`/zdls` 指导老师、`/fuzeren` 负责人和 `/admin` 管理员菜单边界。开办列表 FDY 使用 `userLevel: ""`，指导老师使用 `"zdls"`。
- `list.5c71a66e.js`、`detail.5804a9b8.js`：组织开办待办、详情、审批 payload 和通过前保存现有表单的顺序。
- `list.ba6393f0.js`、`detail.e68e6da2.js`：报名待办、活动/报名/学生标识、审批 payload。单条报名页面只显示通过、拒绝按钮；不暴露隐藏的 ROLLBACK。
- `common.b21a4484.js`、`request.9fd33a2f.js`：公共流程前缀是 `/gateway/ek-agg-mob/biz-common/flow`，AppKey 为 `zovecenter-saip-ek-agg-mob`。组织服务前缀是 `/gateway/zovecenter-saip-ek-app-team-organization-manage/mob`。

## 业务契约

| 领域 | 待办 | 决定 | 精确审批字段 |
| --- | --- | --- | --- |
| 开办 | POST `/apply-info/activity-page-list`，`organizationId` + 动态等待状态，`FDY01` | pass=AGREEMENT，back=REJECTION，refuse=ADJUSTMENT | identified,msg,time,uuid,activityId；通过 activityId=""，另两种用首个 callback 节点 |
| 报名 | POST `/enroll-info/approve-page-list`，`activityId` + `approvalState:XS02` | pass=AGREEMENT，refuse=REJECTION | identified,msg,time,uuid |

开办通过依次 PUT `/apply-info/next-update`、PUT `/apply-info/audit`；后一步只在前一步有明确业务成功确认后发送。报名只 PUT `/enroll-info/audit`。GET `/enroll-info/{uuid}` 曾在撤销 UI 使用、副作用不明，本实现不使用它；报名流程只读使用 `/enroll-info/flow/{uuid}`。

开办组织范围由当前教师下拉列表确认；报名必须同时匹配当前负责人/管理员菜单、`student-organization-info/my` 中的组织权限、活动审批下拉列表、活动详情组织 ID 和当前待办的报名/活动/学生绑定。执行前再次核实，未知等待状态或未知能力直接报错。活动详情整对象仅来自学校，允许通过前按原页面补齐显示用 time/year；不支持用户任意透传字段或编辑活动。

SDK 各领域分别提供 `list/get/prepare/decide/verify`；CLI 为 `organization-activities offering-reviews` 与 `registration-reviews`，各有 `list/show/prepare/decide/verify`。查询的 API/Ego 均直接读 API，HTTP POST 查询不计业务写入。Ego prepare 是可见本地准备并交接；API decide 是明确有副作用的学校写入。各命令 schema 标记 readonly、阶段、权限、路径和未完成的真实验收层。

Ego 使用真实 `.btn button`、`.pop .advice textarea`，在同源 iframe 的文档中读取状态；不依赖虚构快照 ref 格式。只有通过/打回/拒绝按钮可点击，它们在源码中只打开本地弹窗。源码中的保存和弹窗最终确定不由程序触发。已有人工意见不覆盖，其他活动字段不修改；不同日期提示人工处理。交接后无浏览器动作。

`--via api` 与 `--yes` 独立，SDK 也要求对应领域 intent + confirm。Ego 不接受最终提交参数；`--yes` 不能绕过。dry-run 只核对与预览，不保存、不审批、不操作表单。

计划执行使用私有快照、一次性计划和客户端内并发限制。任何丢失/超时/含糊响应均 `UNKNOWN_OUTCOME`，保留业务标识和已确认部分步骤，禁止自动重试或继续保存后的审批；即使只读回查匹配也不改判。学校明确拒绝（含 HTTP 200 非零业务码）保持 BUSINESS_REJECTED。明确确认后只读回查失败仍是 UNKNOWN_OUTCOME。没有跨路径续交或回滚。

读回匹配只证明“该 ID 不再在当前角色待办”，不证明具体的最终流程决定。输出显式 `readbackBasis: absent-from-current-role-pending-list`、`decisionVerified:false`，保留未知原始状态。独立 verify 同样是范围内待办/流程读取，不把未出现的 ID 当作存在证明。

## 受控测试

- `tests/organization-activity-reviews.test.js`：公开 SDK 两领域成功、拒绝/打回、错对象、跨组织、已处理、字段/日期/理由校验、权限刷新、HTTP 200 业务拒绝、丢失/超时/读回丢失、部分保存停止、请求期间计划变更及并发限制。
- `tests/organization-activity-reviews-cli.test.js`：真实 Node CLI 子进程调用真实 SDK；help/schema、所有 API 命令、文件/stdin、独立确认、无交互错误、单个版本化 JSON stdout、stderr、退出码 2/4/5/7、实际写入次数和 payload。
- `tests/organization-activity-reviews-ego.test.js`：公开 Node SDK 与真实 CLI prepare 的真实 DOM 回调；外层 mobile shell 与同源 iframe 使用不同路径，覆盖通过/拒绝/开办打回、空意见填入、人工意见与其他字段保留、dry-run、Ego 三个查询命令、拒绝提交绕过。严格检查最终请求为零，handOff 后禁止动作。
- Loopback 学校 fixture 对完整 URL、方法、AppKey、领域 ID 和精确 payload 作独立校验；所有人名、组织与 ID 均虚构。

## 尚未验收

实际 Ego 页面、当前学校登录态只读、明确授权的 API 写入、用户亲自提交和生产服务器回查均未运行。没有创建活动作为测试前提。未处理 native 认证 WAF；未实现课程认证、批量审批、活动编辑或其他 ticket。回查尚不能独立验证最终具体决定，源 DOM/角色/返回结构改变时可能需要重新核实。
