# friends-cli

重庆大学第二课堂平台的本地 CLI 与可复用 SDK。实现范围以已确认的规格和 Issues 为准。

- 接入学校 API 前，先读 cqu-api-endpoint-collection 的 USAGE.md，再读 systems/friends/notes.md、openapi.yaml 与 review.md。仓库位置按工作区确认。
- 区分前端源码证据、历史接口实测、当前只读实测与真实写操作验收；不能仅凭 verified 或 HTTP 200 宣称业务成功。
- SDK 承载共享领域契约与输入验证，API 和 Ego 适配器共享业务数据并明确各自支持的操作阶段；CLI 负责参数、输出、本地会话与草稿。未来 MCP 与客户端复用 SDK。
- 所有范围内业务以 API/Ego 双路径为目标，各自验收；查询类 Ego 操作可直接调用 API；写操作须可见且分阶段处理。志愿者录入等需要人工审阅的 Ego 表单流程只 prepare 并交接，由用户亲自最终提交；禁止点击提交、调用提交 API 或通过 --yes 绕过。写入结果不确定时禁止跨路径自动重试。
- 认证统一使用 Better Auth 客户端与官方 OAuth 工具；复用成熟库，未验证的 DPoP 客户端能力明确列缺口，不手写协议或静默降级。
- 公开仓库不得提交凭据、登录会话或真实个人信息；示例和 fixtures 使用虚构数据。
- 非微小修改使用隔离 worktree。提交前检查有效 Git 身份并原样使用。

## Agent skills

### Issue tracker

规格与任务在 cqu-moe/friends-cli 的 GitHub Issues 跟踪。见 docs/agents/issue-tracker.md。

### Triage labels

使用五个默认 triage 标签。见 docs/agents/triage-labels.md。

### Domain docs

使用单一领域文档：根目录 GLOSSARY.md 与 docs/adr/。见 docs/agents/domain.md。
