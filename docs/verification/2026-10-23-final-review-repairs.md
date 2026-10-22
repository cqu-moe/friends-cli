# 最终 review 修复的受控验收

本轮修复 SPEC F1–F7、STANDARDS S1–S5（F3 与 S1 重叠）。测试调用公开 SDK、真实 CLI 子进程；学校 API 使用外部本地 HTTP 服务，Ego 使用执行真实 DOM 回调及事件的同源 iframe 场景。回执损坏在实际填入和交接后注入；没有真实学校请求、浏览器、GitHub 或最终提交。

| 项目 | 修复后的契约 | 主要回归边界 |
| --- | --- | --- |
| F1 | 所有本地 SDK 的 `enterHall` 写入前共享 token/账号/角色/单位预留；course/volunteer 双向冲突拒绝，同上下文可复用 | `sdk.test.js`：多 SDK、异构 client、并发、原 client 后续查询 |
| F2 | 读取实际 iframe URL；导航前保护文本、选择、文件和已有上传；已有正确表单不重建 | `organization-participation-ego.test.js`：公开 SDK、CLI、实际选择与 File 状态 |
| F3/S1 | 首次 await 前消费计划，发送保存的可信快照；并发、丢失响应后重放均不产生第二笔决定 | `volunteer-activity-reviews.test.js`：HTTP 屏障期间改 UUID/意见、并发与丢包 |
| F4 | OS 文件锁释放随句柄关闭或进程退出，不使用 PID/TTL 抢锁；保留原子替换、修订冲突与冲突副本 | `draft-crash-recovery.test.js`：实际写进程停在文件 rename 边界，CLI 活锁超时，SIGKILL 后 SDK/CLI 保存；既有 draft 测试 |
| F5 | `--no-open` 授权 URL 进度到 stderr；stdout 仅一个成功或错误终态 JSON | `auth-cli.test.js`：实际回环授权成功、拒绝和回调失败 |
| F6 | 仅 `cqu:ticket:friends`、无 refresh token 的 DPoP 授权可完成服务票据交换；过期须重新授权 | `auth.test.js`、`auth-cli.test.js`：非离线 scope、持久化/恢复、禁止 refresh/票据重放；既有轮换场景 |
| F7 | 最后 capture/snapshot/handoff 失败均为不可重试的 UNKNOWN_OUTCOME/7；保留字段、已知 UUID、最后页面与原始错误 | `course-offering-ego.test.js`：三个最终化边界分别经公开 SDK 与实际 CLI；交接最多一次，丢失确认标记 `unknown` |
| S2 | certification、volunteer offering/review 校验实际回执与交接；空、损坏或缺少交接确认均 UNKNOWN_OUTCOME/7，含恢复标识；已知前置认证/权限失败保持原分类 | `ego-receipts.test.js`：三领域 × 四回执故障（含畸形 handoff），SDK/CLI；原流程与前置 guard 测试 |
| S3 | course/volunteer activity review 及 volunteer certification review 的所有调用方传递新核验会话；实际 iframe 的路由、token、角色匹配后才点击或填写 | `course-reviews-ego.test.js`、`volunteer-activity-reviews-ego.test.js`、`volunteer-review-cli.test.js`：正确外层 URL 下的错误 frame URL/会话，人工意见保留，零最终操作 |
| S4 | 布尔字段必须是 boolean，星级及问卷等必须是规定数组，不静默改义 | `volunteer-offering-api-contract.test.js`、`volunteer-offering-cli.test.js`：SDK 与 CLI 输入拒绝 |
| S5 | 材料按实际 Blob/File.size 检查上限，并拒绝不一致的 wrapper.size；拒绝发生在上传前 | `volunteer-offering-api-contract.test.js`：21 MiB 伪报为 1 byte 和声明大小不一致，零上传 |

F1 是进程内保护，不能保证其他进程或外部学校客户端的服务器会话隔离。审批计划在发起后即消费；发生冲突或未知结果后不会自动重试。

F4 新增精确版本 `fs-native-extensions@1.5.2`，使用其 `tryLock(fd)` 的系统锁。持久的 `.write-lock` 文件权限为 0600，保留稳定 inode，不靠删锁或时间过期夺取活锁。旧版本的目录锁协议与新版本不共同协调；升级前需结束旧写入进程，新实现不删除旧锁目录或遗留临时数据。本机实际运行仅覆盖 macOS；其他平台运行与 CI 留待主任务独立验收。

本轮合并最新 integration 后统一执行全量测试；准确 SHA、测试数、安装包内容审计与安装后公开 draft store 的 save/load/conflict 结果记录在主任务的外部修复交付证据。受控测试不能替代真实学校读写、完整交接、CI 或生产验收。原生 Auth 的 `403 cf-mitigated: challenge` 外部阻塞、#22 缺少有权限且待审批的真实样本仍保留。#16/#17 已取消，不纳入修复。
