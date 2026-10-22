# 组织负责人变更申请与结果 #23

## 范围与证据

负责人变更使用既有申请/审批流程，不是加入组织申请，也不调用直接维护负责人或成员的接口。本次读取公开生产源码快照与本地操作证据；未访问真实浏览器、生产学校接口或 GitHub，未推送。

源码：`apply.cfd0eab3.js`、`Search.98fff28e.js`、`index.3f4fa71d.js`、`index.4ab3df1a.js`，对应 `/mobile/groupManage/studentLeaderApply`。API 请求使用服务 `zovecenter-saip-ek-app-team-organization-manage` 的 `/gateway/.../mob` 路径及同名 AppKey。此任务未增加通用 `/biz-common` 请求；#22 公共审批状态路径已修正为 `/gateway/ek-agg-mob/biz-common/...`。

## 支持阶段与权限

| 公开操作 | 性质 | API | Ego | 核对与结果 |
| --- | --- | --- | --- | --- |
| leader-change candidates | 只读 | 查询 | 新鲜会话后直接查询 API | 指定组织的候选学号/姓名/职务/电话必要投影 |
| leader-change status | 只读 | 查询 | 新鲜会话后直接查询 API | 申请流程字段与实际负责人分别返回；未知状态不推断审批通过 |
| leader-change prepare | 可见准备 | 使用 submit --dry-run 预览 | 可见录入后交接；dry-run 只读 | 自行核实身份、现任负责人、候选与申请归属；最终用户亲自提交 |
| leader-change submit | 业务写入 | 独立确认后一次 POST | 拒绝 | 重新核验权限/候选/配置/申请状态，提交后分别回查申请与实际负责人 |

负责人权限绑定学校 `/student-organization-info/my` 与当前组织详情中的 `responsiblePerson`；管理员不自动具备此权限。候选资格绑定学校 `new-response-person/{organizationUuid}`；当前职务配置来自 `post-list/{labelCode}` 与 `labelInfo/code/{labelCode}`。API exact payload 为源码中的十个字段，不开放任意 JSON。政治面貌由调用者提供并核实；API 当前未实现源码中加密学生详情的独立解码链，不宣称已校验该字段来自学校。Ego 比较可见回填值，缺失/不一致留待人工复核。

## 受控验收

- SDK：从公开组织 client 直接调用。覆盖候选/当前关系查询、申请准备与一次提交、材料和职务校验、错误组织/候选、权限撤销、跨组织申请、未知/冲突状态、候选并发变化、HTTP 200 业务拒绝、超时及响应丢失；回查匹配也保持未知结果。申请已提交和实际负责人是否变化分别断言。
- CLI：真实 Node 命令进程调用真实 SDK。覆盖 candidates/status/prepare/submit、help/schema、文件/stdin/参数输入、错误 JSON/缺资料、非交互确认、单个版本化 JSON stdout、stderr 诊断和 exit 2/4/5/7。Ego 查询与可见准备使用同一受控场景，不读取本地凭据作为替代。
- Ego：严格外部进程执行实际浏览器回调，页面为同源 iframe；原生电话 input/原因 textarea 与源码自定义字段分开模拟。候选 radio 与相邻文字分开，动态 `[ref=N]` 与下一行标签用于可见操作。页面事件产生选择、回填和编辑结果；不返回预制 evaluate 结果。
- 直接 SDK 和 CLI 均覆盖只读 dry-run、人工字段保留、禁止 --yes/隐藏提交、错误表单不导航。已有同名候选只保留并标记 `candidate-identity`，不能仅凭姓名宣称已绑定学号。
- 外部请求、表单提交、最终“提交申请”和 handoff 由场景监听，准备阶段最终提交/业务写入为零。Ego bridge 回执丢失或损坏在实际 DOM 操作后注入，仍返回 UNKNOWN_OUTCOME，保留部分步骤，不重试。
- 未复用测试专用 SDK 导出，也未替换自己的业务流程；外部 HTTP/学校 UI 是受控替身。旧 worker 的未提交源码/测试已保留并修复，不以通过旧有错误 fixture 为验收。

## 未验收与限制

受控 SDK/CLI 与源码核对不等于生产兼容性。真实 Ego 页面、学校登录态只读、明确授权的真实 API 写入、用户亲自最终提交和服务器真实审批/负责人变化均未在本任务执行。真实页面快照、加载时序和控件差异仍需主 agent 独立验证；遇到歧义保留表单并停止。原生认证受 WAF 阻挡的限制未修改，也未以测试替身声称打通。
