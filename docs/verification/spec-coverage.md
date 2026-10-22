# SPEC #1 覆盖与交付验收

更新：2026-10-23。范围依据 [SPEC #1](https://github.com/cqu-moe/friends-cli/issues/1)、对应 ticket、仓库各项 verification 及主任务回报；以本页更新说明补充较早记录。#16、#17（课程认证）已撤销，不纳入交付。#23 是**组织负责人变更**，不是个人入会。

下表记录当前已合入代码的公开能力；“受控”指公开 SDK、真实 CLI 子进程、本地 HTTP 服务及执行实际 DOM 回调的页面场景，不等于真实学校业务通过。Ego 查询可用新鲜核验的现有会话直接查询 API；Ego 写属性操作只进行可见准备，保留人工输入并交接，最终由用户亲自提交。独立 API 写入要求明确选择与确认，不能接续 Ego 交接任务。响应丢失或含糊时保持 `UNKNOWN_OUTCOME` / exit 7，即使只读回查匹配也不自动重试或执行下一项写入。

## SDK、CLI 与阶段

SDK 名称指 npm 根入口；页面/存储适配器从 `/node` 导入，原生认证另有 `/auth`、`/auth-node`。CLI 前缀均为 `friends`。阶段细节以各命令 `schema` 为准；存在入口不代表所有复杂表单均支持。

| Ticket | 公开 SDK / CLI | API / 本地阶段 | Ego 阶段 | 最终执行者及边界 |
| --- | --- | --- | --- | --- |
| #2 本地登录、课程查询 | `createFriendsSdk`；`auth login/status`、`courses list/show` | 核验、激活固定身份；本地存储；课程列表/详情 | 浏览器完成学校登录，取回后重新核验 | 用户完成登录；SDK/CLI 只读课程查询 |
| #3 Ego 课程查询 | `readVerifiedEgoSession` + 课程 client；`courses list/show --via ego` | 现有会话、学校身份核验、列表/详情 | direct-api；不导航或代填 | SDK/CLI 只读 |
| #4 CQU Auth | `createCquAuthClient`、Node loopback/recovery；`auth login --method cqu-auth` | PKCE/DPoP、callback、token/refresh、ST、学校换会话 | 系统浏览器供用户授权 | 用户授权；客户端交换/恢复；生产链路被 WAF 阻塞 |
| #5 志愿认证草稿 | draft 函数、`createVolunteerCertificationClient`、Node store；`drafts activities/create/edit/show/list/validate/check` | 来源只读；本地修订、材料哈希、冲突保存 | 来源查询可 `--via ego` | 本地保存；没有学校草稿提交 |
| #6 志愿认证录入 | `buildVolunteerCertificationPreparation`、`prepareVolunteerCertificationInEgo`；`drafts prepare` | 校验与只读刷新 | 对应页面录入、局部名单编辑、交接 | 用户最终认证提交；Ego submit 拒绝 |
| #7 捕获、恢复协作 | `captureVolunteerCertificationFromEgo`；`drafts capture` | 显式交回控制后保存新本地修订；状态只读 | 重核身份/页面、读取人工修改，恢复需再次明确控制 | 用户保有控制；不补提交 |
| #8 志愿认证 API | `createVolunteerCertificationApi`；`certification submit/status` | 独立校验 → 最终提交 → 只读回查 | 只读 status；拒绝 Ego submit | 明确授权的 API；当前带材料草稿阻断 |
| #9 志愿查询、参与 | `createVolunteerClient`、Node prepare；`volunteers identity/activities/registrations/register/withdraw` | 身份/两类活动/条件/个人报名；独立报名或退出、回查 | 可见报名/退出准备与交接；重新核验学校权限 | API 明确确认或用户；上传问卷拒绝，审批结果独立保留 |
| #10 志愿开办 | `createVolunteerOfferingClient`、Node prepare；`offerings prepare/materials/submit/status` | 字典/组织校验 → 独立材料上传 → 开办 → 状态 | 可见信息录入与交接；不上传/下一步/最终提交 | API 明确确认或用户；临时活动 next-step 本身是最终写入 |
| #11 志愿开办/报名审批 | `createVolunteerActivityReviewClient`；`volunteer activity-reviews list/show/prepare/decide` | 两类待办/详情、校验、独立决定、回查 | 只准备决定/意见、交接 | API 明确确认或用户 |
| #12 志愿认证审批、时长 | `createVolunteerHoursClient`、`createVolunteerCertificationReviewClient`；`volunteer-hours`、`volunteer-certification-reviews` | 时长/详情、认证待办、决定、回查 | 可见审批准备与交接 | API 明确确认或用户；待审时长不算已认定 |
| #13 课程参与 | 课程 participation client、Node prepare；`courses registrations list/show/apply/cancel/exit` | 条件、问卷/材料校验、独立参与写入、个人记录 | 可见准备/交接；角色、日期等未完成项交给用户 | API 明确确认或用户 |
| #14 课程开办 | `createCourseOfferingClient`、Node prepare；`course-offering prepare/materials/next-step/submit/status/prepare-ego` | 只读准备 → 独立上传 → 第一步保存 → 最终申请 → 状态 | 仅第一步部分字段准备；不上传或点击下一步 | API 每个写阶段独立确认或用户；复杂岗位/问卷/受众限制未支持 |
| #15 课程开办/报名审批 | `createCourseReviewClient`、Node prepare；`courses reviews list/show/prepare/decide` | 两类现有待办/详情、决定、回查 | 可见决定/意见准备、交接 | API 明确确认或用户；具体节点决定与整体流程状态分开 |
| #18 组织活动查询、开办 | `createOrganizationActivityClient`、Node prepare；`organization-activities list/show/requirements/status/prepare/materials/submit` | 查询/组织字典 → 独立材料 → 第一步保存 → 最终设置 → 状态 | 仅第一阶段空白文本；组织/日期/材料、下一步及第二步交给用户 | API 明确确认或用户；1–8 次签到、空自定义问卷，拒绝任意字段透传 |
| #19 组织活动参与 | `createOrganizationParticipationClient`、Node prepare；`organization-participation list/show/prepare/apply/cancel/exit` | 活动/条件、已有材料组校验、参与写入、状态 | 对应页面准备、交接；日期/附件交给用户 | API 明确确认或用户；无自动上传 |
| #20 组织活动审批 | `createOrganizationActivityReviewClient`、Node prepare；`organization-activities offering-reviews/registration-reviews` | 待办/详情/verify；开办通过先保存再审批；报名独立审批 | 只打开决定弹窗、准备意见、交接 | API 明确确认或用户；保存不确定时不续审批；待办消失不证明具体决定 |
| #21 组织资料、成员 | `createFriendsSdk` 组织 client、Node profile prepare；`organizations list/members/profile show/prepare/save` | 组织权限、成员分页、允许字段准备/保存 | 可见资料准备、交接 | API 明确确认或用户；限定字段，拒绝错误组织 |
| #22 加入/退出审批 | 组织 client、`prepareOrganizationApplicationDecisionInEgo`；`organizations approvals list/show/prepare/decide` | 组织/申请/类型/待办绑定 → 决定 → 成员关系回查 | 新鲜权限核验；源码 CSS 打开无 ref 的 DIV 动作、填空意见、交接 | API 明确确认或用户；修复后真实适配器复测待主任务 |
| #23 负责人变更 | 组织 client、Node leader-change prepare；`organizations leader-change candidates/prepare/submit/status` | 当前负责人资格、候选人/岗位、申请、申请与实际负责人分别回查 | 可见候选人/岗位/电话/理由准备、交接 | API 明确确认或用户；不直接改写负责人，政治面貌由用户提供 |
| #24 三领域搜索 | `createUnifiedSearchClient().search`；`search` | 三类现有查询组合、独立分页/预算、完整性与部分失败 | 现有会话 direct-api；不导航/点击/填表 | SDK/CLI 只读；预算截断不等于搜索完整 |

## 源码、受控与真实证据

“真实”只列已记录的阶段，空列表、权限拒绝或关闭窗口不能证明写入可用。2026-10-23 新增结果由主任务执行并回报，本 worker 未访问浏览器或生产 API。以下只保留数量与阶段，不收录人员、组织、申请 ID 或电话。学校公开 JS 的文件名及对应接口见各行链接；原始 source/evidence 留在本地证据目录。

| Ticket | 已知来源 | 受控覆盖 | 真实证据与保留限制 |
| --- | --- | --- | --- |
| #2 | [学校登录、课程请求](2026-10-22-local-courses.md) | SDK 身份/固定上下文；真实 CLI 登录/恢复/JSON/错误；存储与安装包 | 10-22 已安装 SDK/CLI：学校登录 → status → 关键词分页 1 项 → 详情；文件及 macOS Keychain 均成功。教师/多身份与 Linux 系统库成功路径未验收 |
| #3 | [Ego 课程查询](2026-10-22-ego-course-query.md) | 现有会话重新核验、API/Ego 列表/详情与失败 | 10-22 真实 SDK/CLI Ego 查询 1 项及详情；不构成报名证据 |
| #4 | [原生认证与阻塞](2026-10-22-auth-native.md) | oauth4webapi 协议、PKCE/DPoP/nonce、refresh/ST、真实 CLI 挑战错误 | Auth PR #95 于 10-22 合并；浏览器 discovery 成功。10-23 Node discovery 仍 403 `cf-mitigated: challenge`；生产授权/交换/刷新/ST/学校换会话未完成 |
| #5 | [AddStu/SetStu、活动与名单来源](2026-10-22-volunteer-drafts.md) | 公共 draft/store、跨进程恢复、材料/冲突/写中断保护 | 10-22 学校管理列表 5 项、选定详情/岗位成功；真实 CLI API/Ego 建立并读取本地草稿。未知认证模式保留未知；无学校写入 |
| #6 | [认证页与局部编辑](2026-10-22-volunteer-certification-ego.md) | 真实 DOM 事件、人工值、交接后停止、Ego submit 拒绝 | 10-22 已安装 Ego 在**本地虚构页面**录入及零最终请求；该次 handoff 为记录包装器。真实学校只读检查控件；学校最终提交未验收 |
| #7 | [人工捕获记录](2026-10-22-certification-capture.md) | SDK/真实 CLI 捕获、修订冲突、恢复与控制边界 | 10-22 本地虚构页面真实交接/交还与捕获；学校页面局部名单编辑/捕获、只读认证状态 absent，刷新后临时名单消失。学校实际准备使用交接记录包装器；无最终提交 |
| #8 | [认证 API、空 DTO](2026-10-22-certification-api.md) | SDK/CLI 提交、拒绝、UNKNOWN_OUTCOME、不重试、只读回查 | 10-22 学校既有会话只读确认无申请的全 null DTO；真实最终 POST 与认证后结果未验收 |
| #9 | [志愿查询与参与](2026-10-22-volunteer-operations.md)、[集成修复](2026-10-23-volunteer-fixes.md) | SDK/真实 CLI 全部查询与报名/退出；同源 iframe 实际控件、人工值和中断回执 | 10-23 主任务实际调用公开 SDK `listActivities({pageSize:1})` 成功 1 项；`getIdentity` 的 can-apply 返回 400，来源参数修复待合入。此前 CLI 500 非持续故障，统一搜索现已调用志愿 SDK 成功；**独立志愿 CLI 尚未完成真实验收**，无参与写入 |
| #10 | [志愿开办及学校页面](2026-10-22-volunteer-offering.md) | SDK/CLI 分阶段 API、材料、丢失响应；真实 DOM 人工值保护 | 10-22 SDK 字典/组织/学期成功，实际 iframe 文本/选择器/日期准备，随后 reload；handoff 被包装。无真实上传、下一步或最终提交 |
| #11 | [两类志愿审批](2026-10-22-volunteer-activity-reviews.md) | SDK/CLI 两领域、严格 URL/ID/权限、真实 DOM 决定准备 | 10-22 真实 CLI Ego 报名待办为空、hasMore=false；无真实决定弹窗或写入 |
| #12 | [个人时长与认证审批](2026-10-22-volunteer-reviews.md) | SDK/CLI 时长、审批与错误；实际 DOM radio/textarea | 真实 CLI Ego 时长空列表；审批因当前角色权限不足拒绝。无真实审批准备/保存/最终提交 |
| #13 | [课程参与源码与测试](2026-10-22-course-participation.md) | SDK/CLI 参与写入、问卷/材料、状态；iframe 实际事件 | 10-23 真实 CLI `courses registrations list --via ego` 返回 1 项。无真实报名、撤销或退出；角色控件等需用户处理 |
| #14 | [CourseInfo/ReportSet、材料边界](2026-10-23-course-offering.md) | SDK/CLI 六阶段、丢失响应、严格 iframe DOM | 10-23 实际 SDK prepare 组织/字典查询成功，可见文本已填；**类型点击存在缺陷，修复及真实复测待补**。不能据旧受控记录宣称实际完整准备通过；无上传/下一步/最终提交 |
| #15 | [课程两类审批源码](2026-10-23-course-reviews.md)、[角色核验修复](2026-10-23-review-context-fix.md) | SDK/CLI、权限/节点/状态、真实 DOM 与零最终请求 | 10-23 主任务在功能提交 `dff1dd1` 的真实 CLI Ego 报名待办查询成功、0 项；此前 AUTH_REQUIRED 修复已进入 integration。无真实准备/决定；受控回查不证明整体获批 |
| #18 | [组织活动查询、两步开办与材料](2026-10-23-organization-activities.md) | SDK/真实 CLI 全部命令、严格路径/材料、多步停止、iframe 实际文本与事件 | 10-23 主任务真实 CLI list/show/requirements 成功；status 原始 data 是长度 3 的数组，**解析修复待合入，尚不宣称 status 通过**。无开办准备/上传/申请写入。材料资源回查只核对 ID/文件名，不证明字节哈希 |
| #19 | [组织活动参与源码](2026-10-23-organization-participation.md) | SDK/CLI 参与、材料组、丢失响应；实际 DOM | 10-23 真实 CLI list/show 同一项成功，但报名窗口关闭。无实际报名/撤销/退出 |
| #20 | [组织开办/报名审批源码](2026-10-23-organization-activity-reviews.md) | SDK/CLI 两领域、严格来源/权限、多步停止、实际 DOM | 未记录真实学校待办、准备或写入；verify 只证明当前角色待办范围内的观察 |
| #21 | [组织查询/维护公开说明](../../README.md#学生组织)、组织管理公开 JS | SDK/CLI 组织/成员/允许字段、API 保存及页面保护 | 10-23 真实 CLI Ego `organizations list` 成功 5 项。成员/资料编辑及写入无新增真实证据 |
| #22 | [加入/退出审批与实际 DIV](2026-10-23-organization-approvals.md) | SDK/CLI API、公开 prepare 自行重验；实际 DIV 无 ref、textarea、人工值、外层冲突与丢失回执 | 10-23 真实 CLI 加入申请列表 page-size=1 返回 1 项；手动打开空“通过”意见弹窗后取消。所选申请随后核实已通过、关系 state=1，公开 SDK 预检正确 BUSINESS_REJECTED，未进入浏览器或修改表单。列表数量不证明存在未处理待办；**真实待办 prepare 仍未验收** |
| #23 | [responsiblePersonChangeInfo 来源](2026-10-23-organization-leader-change.md) | SDK/CLI 候选人/资格/申请/状态、DOM 与不确定响应 | 10-23 真实 CLI Ego status 返回当前负责人、申请及岗位。无负责人变更申请写入或真实可见准备验收 |
| #24 | [三领域现有查询及预算契约](2026-10-23-unified-search.md) | SDK/真实 CLI、类型/ID、独立预算、未知分页与部分失败已覆盖 | 10-23 主任务在 `3be2468` 真实 CLI Ego 统一搜索：三领域均 status=ok、各 1 项，complete=false 且 budget 停止符合预期；无点击/填表/导航。已进入 integration；最终提交另做安装验收 |

通用公共接口必须使用 `/gateway/ek-agg-mob/biz-common/...` 与 `zovecenter-saip-ek-agg-mob`，不能退回 `/gateway/biz-common` 或换 AppKey 重试。历史测试数是各记录当时的本地结果；本次整体验收见下一节，不能相加当作当前测试数。

## 本次安装包验收

待在最新 integration 合入后的干净代码提交运行 `npm test`、`npm pack`，再在源码仓库外临时目录安装实际 tarball。记录准确提交、哈希、包内容、已安装 bin 的 help/schema 与 SDK 四入口导入结果；普通导入不得启动浏览器。

当前仍未验收：CI、真实 API 业务写入、用户最终提交及其生产回查。安装/受控测试不解除原生 Auth 的 WAF 阻塞；主任务负责 PR #25 和真实运行时验收，本 worker 不推送或发布。
