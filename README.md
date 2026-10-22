# friends-cli

重庆大学第二课堂平台的 Agent-first CLI 与可复用 SDK。当前处于设计阶段，尚无可安装的命令行工具。

- [整体设计草案](docs/plans/2026-10-22-initial-design.md)：TypeScript + Node.js，共享 SDK、API/Ego 双路径与本地认证草稿。
- [CQU Auth 登录设计](docs/plans/2026-10-22-cqu-auth-login.md)：统一 Better Auth，说明 PKCE、DPoP 与二课会话的接入边界。
- [领域术语](GLOSSARY.md)。规格与任务使用 [GitHub Issues](https://github.com/cqu-moe/friends-cli/issues)。
- 上游依赖：[Auth #94：friends 固定服务与取票权限](https://github.com/cqu-moe/auth/issues/94)。

业务范围包括课程查询与管理、志愿服务、组织活动，以及组织资料和成员关系管理。设计中的命令均为提案；当前勘测不代表已验证真实写操作。
