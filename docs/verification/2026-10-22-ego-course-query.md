# Ego 会话课程查询验收（2026-10-22）

本记录对应 Issue #3，包含本分支实际执行的受控验收与真实只读验收。受控验收中的所有 Ego 输出、账号、token 和课程均来自虚构 fixture；真实验收只记录脱敏结果。

## 受控 SDK

测试从公开 `readVerifiedEgoSession()` 读取并核对虚构 Ego 会话，再经公开 `createCourseClient` 查询课程；函数返回 `{ token, userLevel, account, context }`。覆盖：

- 第 2 页、每页 1 项、总数 2 页的列表分页和详情一致性；
- 未知 `curriculumState` 保留原值并标记 `known: false`；
- 学校 API 核对 Ego token、账号、角色 `XS` 与身份单位；
- 账号不一致、身份单位不一致、HTTP 401 失效、HTTP 403 权限拒绝；
- 请求序列只包含身份核对、`enterHall` 上下文激活、课程列表 POST 查询和详情 GET，没有业务写入 endpoint。

`enterHall` 是选择学校身份上下文的既有会话操作，不归类为课程业务写入。课程列表 POST 按已核实业务语义标记为只读查询。

## 受控真实 CLI 进程

测试用 `node dist/cli/main.js` 启动真实命令进程，配合虚构 `ego-browser` 命令与本地 HTTP 服务执行：

- `courses list --via ego --ego-task-space 7 --ego-page p2 --page 2 --page-size 1`；
- `courses show course-2 --via ego --ego-task-space 7 --ego-page p2`；
- 权限拒绝退出码 4 / `PERMISSION_DENIED`；
- `--via invalid`、缺少 task space、api 混用 Ego 参数、未发布的 `--via local` 等输入错误退出码 2。

执行目录没有本地会话文件。Ego 脚本复用 `taskSpace(7)` / `p2` 且不调用 `task.finish`；课程 token 不出现在 JSON 输出。成功输出的 `meta.selectedEntry` 为 `ego`，`meta.requestMode` 为 `direct-api`，`meta.verification` 含 `school-api-verified`、学校核对的账号和已核对身份单位。默认和不显式传 `--via` 的旧课程查询仍走保存会话 + API，`meta.selectedEntry` 为 `api`。

## 真实已安装 Ego 与生产只读查询

主 agent 在 `feat/issue-3-ego-query/e2a45fa` 构建产物上完成真实已安装 Ego 与生产学校只读验收：

- 公开 Node SDK `readVerifiedEgoSession({taskSpaceId:16,page:'p1'})` → `createCourseClient` → `list({page:1,pageSize:2,keyword:'周周艺'})` → `get(courseId)`；获得 1 条课程，`totalCount` 为 1，详情 ID 与列表一致。
- 实际 Node CLI 进程执行 `friends courses list --via ego --ego-task-space 16 --ego-page p1 --page-size 2 --keyword 周周艺` 与同一课程 ID 的 `courses show --via ego ...` 均成功；输出 `selectedEntry=ego`、`requestMode=direct-api`，列表/详情 ID 一致。
- 复用同一真实 Ego task space，使用当前浏览器独立核对的学校会话；未读取或写入本地凭据，未输出 token，只执行登录/身份上下文与课程只读操作，业务写入 0。

受控外部 HTTP 场景仍由自动化测试覆盖错误与拒绝分支；本段不包含 token、账号或课程 UUID。

## 自动化

`node --test tests/ego-query.test.js` 通过 2 项测试。合并 integration tip `4e7b694` 后，完整 `npm test` 通过 17 项测试、0 失败、0 跳过；打包安装测试同时确认根 SDK 与 `/node` 的 `readVerifiedEgoSession` 导出可用，且未启动 Ego。

## 未验收范围

- 未执行报名、认证、审批、组织管理或任何明确业务写入。
