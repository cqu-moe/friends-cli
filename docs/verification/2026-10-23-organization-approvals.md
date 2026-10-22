# 组织加入/退出审批 #22

实现 worker 的验收为受控 SDK/CLI 测试。2026-10-23 主任务另行回报真实只读/弹窗观察，见下文；两者不代表真实业务写入。

- API：加入/退出列表、指定申请详情、权限/组织/类型/等待状态核对，独立 API 决定及关系回查；响应丢失保持 UNKNOWN_OUTCOME，包含回查匹配的情况，不重试。
- 公共状态接口使用 `/gateway/ek-agg-mob/biz-common/flow/template-activity-state` 和 AppKey `zovecenter-saip-ek-agg-mob`；受控服务器断言完整路径及 Header。
- 公开 `prepareOrganizationApplicationDecisionInEgo` 自行读取新鲜的既有 Ego 会话、核对学校身份、当前组织管理权限、申请归属和等待列表；直接 SDK 调用覆盖错误组织、权限撤销、跨组织申请及已处理状态。
- Ego 准备使用执行真实回调的同源 iframe DOM 场景；真实审批动作是无 ref 的 DIV；观察快照后使用 `.action-bar .action-bar-item.c-success` / `.c-jujue` 和 `.van-popup .dialog-box textarea[name="msg"]`，不解析快照 ref。场景包含 `text` 子行及 `loc=` 注释，保留实际 DIV/textarea 结构。实际点击打开弹窗、input/change 更新、交接、非空意见保留、其他人工字段保留及拒绝覆盖其他申请页均有可观察断言。
- 可见准备已发生但 Ego bridge 回执丢失或畸形时，返回 UNKNOWN_OUTCOME，保留组织/申请 ID，禁止自动续交。场景在真实 DOM 动作之后损坏进程回执，验证不会误归类为认证错误。
- 外部请求、最终确认和表单提交计数来自场景事件监听；SDK 返回 `submitted:false`，不提供伪造的零写入计数。生产真实零写入/真实 UI 兼容性尚未验收。
- CLI 为真实 Node 子进程调用真实 SDK，覆盖 API 与 Ego 支持路径、JSON/退出码、输入与提交边界。人工最终提交与之后的真实业务回查未执行。

变更前的严格测试先复现错误公共 URL/应用头，再在旧 Ego 实现失败；修复后的完整 `npm test` 通过（合入当前 integration 后再次执行，以本次工作记录为准）。

## 主任务回报的真实证据（2026-10-23）

真实 CLI 的 Ego 查询返回组织 5 项、指定组织加入申请列表 1 项。主任务仅点击“通过”动作打开空意见弹窗，观察到无 ref 的 DIV 动作和带 `loc=` 注释的 textarea；随后取消，未点击最终确认。该观察复现旧快照解析不兼容；改用源 CSS 后，主任务实际调用公开 SDK，但所选申请已审批通过、关系 state=1，预检正确以 BUSINESS_REJECTED 拒绝，未进入浏览器或改动表单。此列表数量不证明存在未处理待办；真实未处理申请的准备仍未验收，不将打开弹窗观察当作已完成适配器验收。公开文档不记录真实组织、申请、人员 ID 或联系方式。
