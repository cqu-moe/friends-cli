# 组织加入/退出审批 #22

本次验收仅为公开源码对应的受控 SDK/CLI 测试，未访问生产浏览器、学校登录态、GitHub 或真实业务写入。

- API：加入/退出列表、指定申请详情、权限/组织/类型/等待状态核对，独立 API 决定及关系回查；响应丢失保持 UNKNOWN_OUTCOME，包含回查匹配的情况，不重试。
- 公共状态接口使用 `/gateway/ek-agg-mob/biz-common/flow/template-activity-state` 和 AppKey `zovecenter-saip-ek-agg-mob`；受控服务器断言完整路径及 Header。
- 公开 `prepareOrganizationApplicationDecisionInEgo` 自行读取新鲜的既有 Ego 会话、核对学校身份、当前组织管理权限、申请归属和等待列表；直接 SDK 调用覆盖错误组织、权限撤销、跨组织申请及已处理状态。
- Ego 准备使用执行真实回调的同源 iframe DOM 场景；快照采用动态 `[ref=N]`，按钮文字单列下一行。实际点击打开弹窗、input/change 更新、交接、非空意见保留、其他人工字段保留及拒绝覆盖其他申请页均有可观察断言。
- 可见准备已发生但 Ego bridge 回执丢失或畸形时，返回 UNKNOWN_OUTCOME，保留组织/申请 ID，禁止自动续交。场景在真实 DOM 动作之后损坏进程回执，验证不会误归类为认证错误。
- 外部请求、最终确认和表单提交计数来自场景事件监听；SDK 返回 `submitted:false`，不提供伪造的零写入计数。生产真实零写入/真实 UI 兼容性尚未验收。
- CLI 为真实 Node 子进程调用真实 SDK，覆盖 API 与 Ego 支持路径、JSON/退出码、输入与提交边界。人工最终提交与之后的真实业务回查未执行。

变更前的严格测试先复现错误公共 URL/应用头，再在旧 Ego 实现失败；修复后的完整 `npm test` 通过（合入当前 integration 后再次执行，以本次工作记录为准）。
