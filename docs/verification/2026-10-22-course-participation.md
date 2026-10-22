# 课程报名、退出与个人记录验收（2026-10-22）

本记录对应 Issue #13。所有 HTTP、账号、课程、报名记录和 Ego bridge fixtures 均为虚构数据；不包含 token、cookie、真实姓名或真实名单。

## 学校前端与接口证据

- 当前生产课程页面使用 `POST /gateway/zovecenter-saip-ek-app-curriculum/mob/apply/my-applied-page-list` 查询个人申请。页面筛选状态包含分页、`key`、学院/年级/专业/课程级别与状态等字段；本轮公开契约只暴露已实现并测试的 `page`、`pageSize`、`keyword`，其余字段按前端原形传空值。
- 报名详情来自 `GET /mob/apply/{courseId}`。报名提交为 `POST /mob/student-apply/apply`，payload 保留 `curriculumId/questionnaireResult/studentNo/uuid` 及显式角色的 `roleId/roleName/roleClassHour/roleIntegral`。
- `GET /mob/student-apply/{registrationId}` 被个人课程页在“撤销”确认后调用，因此按业务写入处理；不能作为个人记录详情探测。安全单条查询通过个人记录分页定位。
- 退出已接受报名为 `DELETE /mob/student-apply/quit/{registrationId}`。
- `GET /mob/student-apply/can-apply/{courseId}` 在扫码报名页 onMount 后把 `code === "0"` 显示为“报名成功”，副作用不明；dry-run 禁止调用。
- 当前课程详情页角色选择 UI 被注释。实现不默认唯一角色，也不推断角色字段；课程返回角色时必须显式选择详情中的 `roleId`，否则拒绝。
- 课程问卷组件核实 `CHOICE`、`MULTIPLE_CHOICE`、`TEXT`、`NUMBER`、`DATE`、`PICTURE`、`MULTIPLE_PICTURE`、`FILE`、`MULTIPLE_FILE`。本轮 SDK/CLI 支持前五类非附件题及 `isMandatory` 必答/选答；附件题只核实到 `attachmentGroupUuid` 字段，上传服务与分组生命周期未核实，因此精确拒绝。Ego 报名准备不代填表单，非空问卷由用户在可见页面亲自输入。
- 个人课程页源码确认“撤销”“退出报名”先打开 `Dialog.confirm`，用户确认后才分别调用撤销/退出接口。Ego 准备只点击可见动作打开确认层，不点击确认按钮。

## 受控 SDK 验收

- 公开入口 `createFriendsSdk().createCourseParticipationClient(session)` 直接覆盖个人记录分页/关键词、未知审批状态投影、课程与报名记录 ID 分离校验。
- 覆盖报名检查与准备：`inspectApply` 只读取课程详情并返回问卷定义/角色需求且不生成问卷 payload；`prepareApply` 覆盖无问卷 payload、显式角色校验、五种非附件题型、必答缺失拒绝、选答省略置空、附件精确拒绝、已存在报名拒绝，并断言未调用 `can-apply` 或任何提交端点。
- 覆盖显式 API 报名：缺少确认先本地拒绝；成功后只读回查个人记录；HTTP 200 业务拒绝保留上游码；响应丢失转成不可重试 `UNKNOWN_OUTCOME`，保留 `courseId/registrationId`，只执行一次只读回查且提交请求仍为一次；学校 `code:"0"` 确认成功但回查失败时保留 `serverAck` 并返回 `readback:"unavailable"`。
- 覆盖撤销与退出：先用个人记录定位报名 UUID；撤销按业务写入调用 `GET student-apply/{id}`，退出调用 `DELETE student-apply/quit/{id}`；业务拒绝、成功回查、响应丢失和回查不可用路径均覆盖，写入不重复。申请、撤销、退出都在最终写入请求前重新核对账号/身份单位，身份变化时在业务写入前失败。

## 受控真实 CLI 验收

真实 Node 子进程执行 `dist/cli/main.js`，通过受控 HTTP 服务调用真实 SDK，而非在 CLI 内重写业务流程。已覆盖：

- `courses registrations` help 与 `schema`，包括查询/写入性质、撤销端点的 GET-but-write 契约、写入必须显式 `--via api|ego`，以及 API 提交与 Ego 人工交接的区分。
- 个人记录 `list/show` 的分页、关键词、JSON stdout、stderr、退出码和输出脱敏。
- `apply --dry-run --via ego`：复用不导航、不 handoff、不 finish 的既有 Ego 页面会话，直接 API 读取详情，`submitted:false`、远程写入为 0，并断言未调用 `can-apply`；问卷 dry-run 另覆盖文件与 stdin 输入。
- 缺少 `--via`、缺少确认、错误领域 ID 在读取凭据或发起写入前拒绝；课程 UUID 传入报名记录命令时只得到业务拒绝且没有写入。
- 显式 API 报名、撤销、退出、权限 4、业务拒绝 5、响应丢失 7 / `UNKNOWN_OUTCOME`、恢复信息、next action、确定成功后的回查不可用 receipt。
- 显式 `--via ego` 报名（含非空问卷）、撤销、退出：真实 CLI 调用受控 Ego bridge，脚本只可见导航/定位/打开确认层并 `handOff`；断言无 `finish`、无隐藏 fetch、无最终提交端点、无确认按钮点击，业务服务器收到的最终写入请求数保持为 0，输出 `awaiting-user` 且最终提交人为 human。

## 自动化与未验收范围

- 2026-10-22 在 macOS / Node.js 22 下运行 `npm run build && node --test tests/course-participation.test.js`，7 项本票测试全部通过，0 失败、0 跳过。
- 合并 `feat/issue-2-integration` `7d5850c` 后运行 `npm test`，TypeScript 构建和全部 74 项 Node 测试通过，0 失败、0 跳过；其中包含 #6 strict Ego fixture、OAuth、志愿认证 API、组织与课程报名相邻回归。
- 本票未执行真实学校课程报名、撤销或退出，未对生产业务发起任何写入，也未代用户点击 Ego 最终提交。真实 Ego 写入准备和用户亲自提交需由集中控制的 Ego 验收另行记录。
- `student-apply/can-apply/{courseId}` 的副作用、附件上传/分组生命周期、教师/管理员路径和生产角色选择行为仍未验收，不能宣称支持。
- 本线程未访问 TaskSpace16，未执行真实 Ego、真实学校课程报名/撤销/退出或任何生产业务写入。实际 Ego 受控 fixture 验收、可见页面选择器实测和用户亲自最终提交由主 agent 集中处理；本测试只证明受控 bridge 脚本边界，不能替代真实页面验收。
