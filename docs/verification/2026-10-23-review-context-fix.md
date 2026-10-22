# 审批角色来源修复（2026-10-23）

## 问题与证据

主 agent 的真实学校只读验收发现：`courses reviews list --type registration --via ego` 在账号匹配、`session.userLevel/context.levelNo` 均为 `XS` 时仍返回 `AUTH_REQUIRED`。`/ek-agg-mob/user/info` 是仪表盘响应，实际返回 `userNo/userName` 等资料及统计，不包含 `userLoginStateLevel`。本 worker 使用这份生产证据，未自行访问浏览器或生产 API。

代码中相同误用存在于 `course-reviews.ts` 的 `role`、`volunteer-activity-reviews.ts` 的 `role` 和 `volunteer-reviews.ts` 的 `realRole`。公开前端/既有 SDK 的上下文流程使用 `checkUserAndGetUserLevel` 获取可用角色/单位，并通过 `enterHall` 的 `account/userLoginStateLevel/departmentNo` 回执建立及核对选定上下文；仪表盘资料不能替代这个回执。

## 修复与权限边界

三个角色检查保留 `verifyLocalSession` 对固定 session 内部一致性、账号和可用角色/单位的校验；随后复用 `activateLocalContext`，显式传入 `expectedAccount` 和固定 `levelNo/unitNo`。只有共享 SDK 验证学校 `enterHall` 回执完全匹配之后，才用返回的 `context.levelNo` 映射原有审批 handleType。

没有新增角色覆盖输入或身份选择回退；固定角色/单位不再可用时在进入业务接口前拒绝。回执账号、角色或单位不同，同样在业务接口前失败。报名审批保留来源页面的 `XS02`，由学校接口决定业务权限；普通学生不因此获得开办或志愿认证管理角色。审批 payload、未知结果处理、附件能力和 Ego 最终提交边界未改动。生产代码只修改上述三个模块。

## 受控验证

- 公共 SDK 与真实 CLI 子进程复现了仪表盘缺少角色字段时的失败；修复后该真实响应形状正常通过。CLI 回归使用实际 Ego 会话脚本在受控同源 iframe 上执行回调，调用真实 SDK 和 loopback HTTP 服务，`courses reviews list --type registration --via ego` 成功，版本化单 JSON stdout、stderr 和零可见动作均有断言。
- 三套 HTTP fixture 默认都移除仪表盘的伪造角色字段；课程/志愿活动仍覆盖各自 SDK 与 CLI 的完整既有审批路径。旧认证 fixture 原先用 `XS` session 配合仪表盘伪造的 `XSC`，现改为会话、可用身份及 `enterHall` 一致的 `XSC`；另明确验证真实 `XS` 上下文仍无认证审批角色。
- `tests/review-context.test.js` 从三个公开 SDK 工厂直接进入，覆盖每次检查的账号/角色/单位漂移、角色/单位消失、伪造或内部不一致的 caller session、准备后回执变化。负例断言不会进入审批业务请求，也不会自动选其他身份或发送决定。
- 定向 TypeScript 构建和七个 SDK/CLI 测试文件：34 项通过，0 失败、0 跳过。
- `01fc43f` 提交修复，`7f24e77` 合入 integration `368abee`。合入后的完整 `npm test`（包含 TypeScript 构建）：204 项通过，0 失败、0 跳过。完整日志保存于共享 notes 的 `review-context-fix-npm-test.log`；生产改动仍只涉及三个指定模块。

## 验收限制

所有 worker HTTP、CLI、Ego fixtures 均为虚构本地场景。真实学校只读命令的修复回归由主 agent 在合入后完成；worker 未操作 GitHub、生产业务写入或真实浏览器。`enterHall` 会建立/核对明确指定的固定会话上下文，它不是审批提交；本修复没有增加业务写入或绕过人工最终提交。
