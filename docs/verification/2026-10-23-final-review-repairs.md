# 最终审查修复与验收记录

首轮修复快照 `da00f4d38881fd25499d03121d87a5d693f55231` 通过独立 merge commit `6ed0c5dbfd5cfa53c1e007914dcc11755120da6f` 合入；R1 补丁 `f428c6f67323f77324d5e34249cd4d0568b5607c` 通过独立 merge commit `49f6ba2522042371ec4ef165c00f4d89fb816cbb` 合入。各合并树均与对应修复快照一致。SPEC F1–F7、STANDARDS S1–S5 及 R1 追加复核均通过，四项判断项可接受，无剩余审查 finding。该结论对应源码和受控验收，不等于真实业务或 SPEC 整体生产验收通过。

## 修复项与回归边界

修复涉及 SPEC F1–F7、STANDARDS S1–S5（F3 与 S1 重叠）及追加的 R1 启动错误兼容修复。受控测试调用公开 SDK、真实 CLI 子进程；学校 API 使用本地 HTTP 服务，Ego 场景执行实际同源 iframe DOM 回调及事件，回执损坏在实际录入和交接后注入。以下证据不包含真实学校最终写入。

| 项目 | 修复后的契约 | 主要回归边界 |
| --- | --- | --- |
| F1 | 所有本地 SDK 的 `enterHall` 写入前共享 token/账号/角色/单位预留；course/volunteer 双向冲突拒绝，同上下文可复用 | `sdk.test.js`：多 SDK、异构 client、并发、原 client 后续查询 |
| F2 | 读取实际 iframe URL；导航前保护文本、选择、文件和已有上传；已有正确表单不重建 | `organization-participation-ego.test.js`：公开 SDK、CLI、实际选择与 File 状态 |
| F3/S1 | 首次 await 前消费计划，发送保存的可信快照；并发、丢失响应后重放均不产生第二笔决定 | `volunteer-activity-reviews.test.js`：HTTP 屏障期间改 UUID/意见、并发与丢包 |
| F4 | OS 文件锁释放随句柄关闭或进程退出，不使用 PID/TTL 抢锁；保留原子替换、修订冲突与冲突副本 | `draft-crash-recovery.test.js`：实际写进程停在文件 rename 边界，CLI 活锁超时，SIGKILL 后 SDK/CLI 保存；既有 draft 测试 |
| F5 | `--no-open` 授权 URL 进度到 stderr；stdout 仅一个成功或错误终态 JSON | `auth-cli.test.js`：实际回环授权成功、拒绝和回调失败 |
| F6 | 仅 `cqu:ticket:friends`、无 refresh token 的 DPoP 授权可完成服务票据交换；过期须重新授权 | `auth.test.js`、`auth-cli.test.js`：非离线 scope、持久化/恢复、禁止 refresh/票据重放；既有轮换场景 |
| F7 | 最后 capture/snapshot/handoff 失败均为不可重试的 UNKNOWN_OUTCOME/7；保留字段、已知 UUID、最后页面与原始错误 | `course-offering-ego.test.js`：capture/snapshot/handoff 及组合故障经公开 SDK 与实际 CLI 验证；交接最多一次，丢失确认标记 `unknown` |
| S2 | certification、volunteer offering/review 校验实际回执与交接；空、损坏或缺少交接确认均 UNKNOWN_OUTCOME/7，含恢复标识；已知前置认证/权限失败保持原分类 | `ego-receipts.test.js`：三领域 × 四回执故障（含畸形 handoff），SDK/CLI；原流程与前置 guard 测试 |
| S3 | course/volunteer activity review 及 volunteer certification review 的所有调用方传递新核验会话；实际 iframe 的路由、token、角色匹配后才点击或填写 | `course-reviews-ego.test.js`、`volunteer-activity-reviews-ego.test.js`、`volunteer-review-cli.test.js`：正确外层 URL 下的错误 frame URL/会话，人工意见保留，零最终操作 |
| S4 | 布尔字段必须是 boolean，星级及问卷等必须是规定数组，不静默改义 | `volunteer-offering-api-contract.test.js`、`volunteer-offering-cli.test.js`：SDK 与 CLI 输入拒绝 |
| S5 | 材料按实际 Blob/File.size 检查上限，并拒绝不一致的 wrapper.size；拒绝发生在上传前 | `volunteer-offering-api-contract.test.js`：21 MiB 伪报为 1 byte 和声明大小不一致，零上传 |
| R1 | 志愿开办保留准备进程启动失败的 UNKNOWN_OUTCOME/7 和恢复标识；共享 runner 的其他调用方保留既有启动分类，真正的认证/权限前置错误不改类 | `volunteer-offering-cli.test.js`：真实会话 DOM 回调后删除命令，公开 SDK/实际 CLI 的第二次启动均 ENOENT；认证、课程公开 SDK 同时固定原有启动契约 |

## 独立复核

| 轴 | 精确对象 | 当前结果 |
| --- | --- | --- |
| SPEC | `da00f4d`；R1 精确 `f428c6f` | F1–F7 在源码及受控验收层面全部闭环；R1 源码追加复核通过，未发现实质回归 |
| STANDARDS | `da00f4d`；R1 精确 `f428c6f` | S1–S5 通过，四项判断项可接受；R1 有界复核闭环，无剩余项 |

SPEC 复核独立执行四组只读内存探针：从精确提交读取并加载 TypeScript，F1/F3 使用虚构 fetch 边界，F2/F7 执行实际 evaluate 回调和最小 DOM 模型。探针不访问网络或浏览器、不构建或改写源码，也不替代完整公共 CLI 测试；完整测试日志经核对，未由该 reviewer 重跑。逐项结果保存在本地外部报告 `final-spec-repair-verification.md`。

STANDARDS 复核以同一精确提交独立检查 S1–S5，执行输入、材料大小、并发及回执探针；其他 runner 回执与错误通过 13 组本地进程场景。四项判断中，存储 guard 重复与扁平会话字段允许保留，runner 采用部分收敛，tokenRequest 透传别名已移除。完整 274 项日志经核对，未由该 reviewer 重跑；报告为本地外部证据 `final-standards-repair-verification.md`。

**R1/P3 已修复并独立复核闭环：** 共享 runner 保留 AUTH_REQUIRED 默认启动分类，仅志愿开办指定 UNKNOWN_OUTCOME；选项只作用于 spawn 错误，真实认证/权限拒绝分类不变，开办 wrapper 保留不可重试语义和 `offerings.prepare` 恢复标识。

公开 SDK 与真实 CLI 测试执行实际 iframe 会话提取后删除命令，第二次启动触发 ENOENT；CLI 的 PATH 仅含 fixture 目录，并使用绝对 Node shebang。修复前分别因 AUTH_REQUIRED 和 exit 3 失败，修复后相关 **44/44** 通过，认证和课程 SDK 原启动契约也保留。点击、填写、交接、提交、上传及开办保存均为零；没有重复安装包。红/绿日志为 `final-r1-red.log`、`final-r1-green.log`，因果与隔离说明为 `final-r1-evidence.md`。

SPEC 已对精确 `f428c6f` 作源码追加复核，无新 finding，未重跑测试；STANDARDS 独立执行 **26 项进程检查**，两种启动策略各 13 项，覆盖有效 stdout/stderr 回执、缺失/重复/畸形回执、非零退出、超时、命令不可用及明确认证/权限/输入/业务错误。独立前后进程探针确认志愿开办恢复 UNKNOWN_OUTCOME/7，默认调用方保持 AUTH_REQUIRED/3；显式认证/权限错误保留原分类。该 reviewer 核对了 44 项 SDK/CLI 日志，未重跑该套件；未执行真实 Ego/browser。闭环结果追加于 `final-standards-repair-verification.md`，检查数据为 `final-standards-r1-runner-probes.json`、`final-standards-r1-compatibility.json`。

## 受控测试与隐私对照

- R1 integration 合并头 `49f6ba2522042371ec4ef165c00f4d89fb816cbb` 完整 `npm test` 为 **279 项通过，0 失败、0 取消、0 跳过**，包含 TypeScript 构建；日志为本地证据 `r1-integration-test.log`。合并提交的文件树与精确 `f428c6f` 一致；后续本次文档整理不改变源码或测试。
- 修复快照 `da00f4d` 和 integration 合并 `6ed0c5d` 均完成完整 `npm test`，各 **274 项通过，0 失败、0 取消、0 跳过**，包含 TypeScript 构建、公开 SDK、真实 CLI、进程崩溃/活锁、回执及最终化故障场景。日志分别为本地证据 `final-review-full-test.log`、`repair-integration-test.log`；这不是 CI 或真实业务写入结论。
- `final-source-privacy.json` 对 `6ed0c5dbfd5cfa53c1e007914dcc11755120da6f` 的 **195 个追踪文件**对照 **8 个已知私有值**，匹配路径为 **0**。该结果只对应所列提交与对照集合，未把私有值或原始会话数据写入公开文档。
- 已有修复快照安装检查针对 `da00f4d`：108 个 help、68 个 schema，已安装公开 draft store 的原生锁、保存/恢复及修订冲突检查通过；环境为 macOS arm64 / Node 22.22.3。该包不是最终源码/文档头的安装验收。

## 最终安装包与 CI

最终源码/文档提交的精确 SHA、包 hash、安装检查、测试数及 exact-head CI 证据统一见 [PR #25](https://github.com/cqu-moe/friends-cli/pull/25)。本页不把历史修复快照包套用到后续提交，也不以受控测试或 reviewer 探针代替 CI；最终头需独立运行安装和 CI 验收。

## 保留限制

F1 是进程内保护，不能保证其他进程或外部学校客户端的服务器会话隔离。审批计划在发起后即消费；发生冲突或未知结果后不会自动重试。

F4 使用精确版本 `fs-native-extensions@1.5.2` 的 `tryLock(fd)` 系统锁。持久的 `.write-lock` 文件权限为 0600，保留稳定 inode，不靠删锁或时间过期夺取活锁。旧版本目录锁协议不与新版本协调；升级前需结束旧写入进程，新实现不删除旧锁目录或遗留临时数据。本页安装证据为 macOS arm64；Linux 受控运行结果以 [PR #25](https://github.com/cqu-moe/friends-cli/pull/25) 最终提交的 CI 为准，Windows 未验收。

- 原验收浏览器任务空间已不存在，其他用户空间未接管。既有真实证据仅对应其记录的功能版本；最终修复头没有实时浏览器复验。#14/#18 真实 helper 诊断的 `handoffExercised:false` 保留，不扩大为真实完整公开 SDK/CLI 或所有权交接通过。
- 原生 Node v22.22.3 在 `2026-10-22T18:35:40.675Z` 重查 discovery 仍为 HTTP 403、`cf-mitigated: challenge`、HTML；记录于本地证据 `final-auth-discovery-check.json`。生产授权、token/refresh、friends ST/学校换会话链路仍未验收，#4 保持未完成。
- #22 仍缺少有权限且待审批的真实样本；已有真实预检拒绝不等于完整可见准备通过。
- 无真实业务 API 最终写入、用户最终提交或其生产回查证据。#16/#17（课程认证）已取消，不纳入修复；本地 finding 闭环不等于 SPEC 整体生产验收通过。
