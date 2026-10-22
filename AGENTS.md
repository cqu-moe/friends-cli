# friends-cli

重庆大学第二课堂平台的本地 CLI 与可复用 SDK。当前处于设计阶段；实现范围以已确认的规格和 Issues 为准。

- 接入学校 API 前，先读 cqu-api-endpoint-collection 的 USAGE.md，再读 systems/friends/notes.md、openapi.yaml 与 review.md。仓库位置按工作区确认。
- 区分前端源码证据、历史接口实测、当前只读实测与真实写操作验收；不能仅凭 verified 或 HTTP 200 宣称业务成功。
- SDK 承载领域操作、输入验证与业务错误映射；CLI 负责参数、输出和本地会话。未来 MCP 与客户端复用 SDK。
- 公开仓库不得提交凭据、登录会话或真实个人信息；示例和 fixtures 使用虚构数据。
- 非微小修改使用隔离 worktree。提交前检查有效 Git 身份并原样使用。

## Agent skills

### Issue tracker

规格与任务在 cqu-moe/friends-cli 的 GitHub Issues 跟踪。见 docs/agents/issue-tracker.md。

### Triage labels

使用五个默认 triage 标签。见 docs/agents/triage-labels.md。

### Domain docs

使用单一领域文档：根目录 GLOSSARY.md 与 docs/adr/。见 docs/agents/domain.md。
