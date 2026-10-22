# Issue tracker: GitHub

规格和任务保存在 https://github.com/cqu-moe/friends-cli/issues 。使用 gh CLI；在 worktree 外显式指定 --repo cqu-moe/friends-cli。

- 创建与更新多行正文时，先保存正文文件，再使用 --body-file；避免 shell 插值。
- 读取任务时包含正文、标签与评论，不能仅凭标题实施。
- 每个实现任务单独一个 Issue，写明范围、验收标准和阻塞关系。
- 优先使用 GitHub 原生子任务与依赖；不可用时使用 Part of #N 与 Blocked by: #N 文字引用。
- 规格尚未达成共识时，不将任务标为 ready-for-agent。
- PRs as a request surface: no.
