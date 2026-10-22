# 志愿活动开办与报名审批（#11）

公开 SDK：`createVolunteerActivityReviewClient` 的 `list`、`get`、`prepare`、`decide`；Node SDK：`prepareVolunteerActivityReviewInEgo`。CLI：`volunteer activity-reviews list|show|prepare|decide --type offering|registration`。

- 学校源码 `Index.684810f8.js`、`Index.0f0a5bf2.js` 分别定义开办与报名待办；动态流程状态接口返回 code 0 的待办筛选项。开办角色来自当前学校 user/info；报名角色 XS02 还需要活动出现在当前可管理活动列表中。
- `Detail.1db16044.js`、`Detail.0fa7bdf3.js` 定义单条审批：开办允许通过、打回、拒绝；报名允许通过、拒绝。只提交明确的一个 UUID，不调用批量接口，不使用可写的“保存”按钮。
- `request.9fd33a2f.js` 的公共 Axios baseURL 包含 `/gateway/ek-agg-mob`；公共流程实际路径为 `/gateway/ek-agg-mob/biz-common/flow/*`。受控服务器对完整路径做匹配，旧路径的 404 已复现并修复。
- SDK 的 prepare 不写学校业务数据；decide 要求独立 API intent 和 confirm，并重新校验账号、角色、待办归属、报名与活动关系、准备时的完整详情。输入不允许任意 applyInfo/handleType/queryDto。准备结果被修改或来源不是当前 client 时拒绝执行。
- 网络响应丢失只读回查，始终保留 UNKNOWN_OUTCOME / exit 7，即使回查已变化也不伪称收到提交确认；不会自动重试。服务器确认和回查是否匹配分别报告。
- Ego 使用当前真实会话重新准备；通过可见按钮打开审批对话框，填空白意见、安全教育项，保留人工现值。审批日期不一致或有多个打回节点时标注需要人工复核；最终“确定”和页面“保存”始终留给人操作。中途失败保留已执行的可见步骤。
- 查询选 Ego 时从当前页面读取已验证会话后直接调用 API，不导航页面。写入准备复用当前目标页；同站学校页面没有已有输入时可打开目标，其他页面或已有输入会停止并交接。

## 验收层次

- 受控 SDK 流程与真实 CLI 进程：两种对象分别测试查询、显式决定、拒绝、打回、重复操作、越权、错 ID、输入白名单、状态变化、HTTP 200 业务拒绝、响应丢失和回查失败。
- 严格 Ego DOM：实际执行页面 JavaScript、点击、输入事件与网络计数；SDK 和 CLI 均覆盖可见准备、人工意见保留、handoff，最终提交请求为零。
- 真实学校只读：2026-10-22 使用实际安装的 Ego 当前学校会话执行 `volunteer activity-reviews list --type registration --via ego --page-size 1`，成功返回空待办页、hasMore=false、requestMode=direct-api。没有输出或提交真实人员名单。
- 真实审批弹窗、生产 API 决定、人工最终提交及服务器审批结果尚未验收；当前账号没有报名待办，不伪造审批对象。
