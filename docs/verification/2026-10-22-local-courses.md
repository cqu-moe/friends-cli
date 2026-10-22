# 本地登录与课程查询验收（2026-10-22）

本记录对应 Issue #2。下列证据分层记录，真实账号、票据、token、cookie 和人员名单不进入仓库。

## 学校接口与前端

- Ego 打开 `https://friends.cqu.edu.cn/mobile/sso`，通过学校浏览器登录进入学生大厅。页面采用同源 iframe，不能以顶层文本或残留 localStorage 判断完成。
- 只读检查 `POST /gateway/ek-agg-mob/user/checkUserAndGetUserLevel` 与 `/user/info`，以学校返回的账号和可选身份为准；`POST /user/enterHall` 建立选定的登录上下文，并核对返回账号、角色和身份单位。
- 身份单位/院系编号不是学生组织 UUID；本次没有确认管理员或组织管理权限。
- 从课程页实际请求确认列表使用 `POST /gateway/zovecenter-saip-ek-app-curriculum/mob/apply/student-apply-page-list`；关键词字段为 `key`。历史聚合接口的 `type: CURRICULUM` 不构成可靠课程过滤。
- 列表显式请求页 1、每页 2、关键词“周周艺”，收到 1 项、总数 1。随后 `GET /gateway/zovecenter-saip-ek-app-curriculum/mob/apply/{courseUuid}` 返回相同课程详情。所有课程请求只读。
- 详情岗位的可用字段为 `uuid/roleName/integral/classHour`；本次问卷数组为空。未核实的非空问卷结构不能当作已解析报名要求。

## SDK 成品

本轮从本地打包安装产物直接调用公开 SDK：学校会话检查/激活 → 固定上下文 client → 关键词与分页 → 详情。收到页 1、页大小 2、1 项、总数 1，账号核对和详情一致性检查通过。凭据只在验收进程内存中使用。

## CLI 与存储

从 `npm pack` 产物安装后，实际 `friends` 入口分别使用显式文件后备和默认 macOS Keychain 跑通：`auth login --method local` → `auth status` → `courses list` → `courses show`。两条路径均通过账号一致性、API 执行方式、页 1/页大小 2/1 项/总数 1 与详情一致性检查；随后直接调用同一安装包 SDK，结果一致。

Keychain 模式的会话元数据不含 token；两个独立验收目录中的文件和专属 Keychain 条目已清理。另用独立合成条目验证过系统库写入、读取与删除。

首次成品验收发现 Ego 将脚本结果写到 stderr；修复后从两个输出流仅解析标记结果行，其他日志不会回显。上述成品复验确认了该修复，而非只依赖受控测试。

## 未验收范围

- 教师、管理员、多身份/多单位的真实账号路径；当前实地账号为学生身份。
- CQU Auth/Better Auth 取票与二课换会话，属于 #4。Auth #95 已合并且线上 discovery 已发布 `cqu:ticket:friends`，这并不等于消费者互操作完成。
- 报名、审批、认证、组织管理等业务写入，以及需人工审核的 Ego 表单提交；本次均未执行。
