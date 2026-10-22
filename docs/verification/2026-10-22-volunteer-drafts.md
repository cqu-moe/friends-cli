# 志愿认证本地草稿验证（2026-10-22）

本记录对应 Issue #5，仅覆盖本地草稿与只读数据来源，不表示学校认证提交能力已完成。

## 接口与页面证据

- 公开生产 chunk `index.32876fbb.js` 映射：`ae` 为管理端活动列表 GET，`E` 为活动审批详情 GET，`af` 为按活动报名名单 GET，`ag` 为认证提交 POST。
- `Index.d4e3187d.js` 证实入页只读详情/名单，时长单位为小时；`TIME` 使用岗位时长，`SIGN` 使用签到签退时长；最终提交 payload 为 `{activityId,nameList,uuid}` 及主 agent 记录的字段。
- `AddStuDetail.dc2494c3.js` 与 `SetStuInfo.9b73569a.js` 的“添加/保存”是本地表单状态更新，不是远端草稿保存。当前页面没有材料字段；本地材料引用只做存在性与 SHA-256 检查，正式完整校验会阻断。
- 主 agent 在只读登录态验证 `ae` 返回 HTTP 200 / `code: 0` 且有管理活动数据；本任务未复制真实活动值，也未访问 Ego 空间 16。
- Integration `04aaecf` 的 `readVerifiedEgoSession` 提供 `{token,userLevel,account,context}`；#5 仅将其作为 #6/#8 可映射的共享会话来源，本分支自动化仍使用受控 API fixture，不重复 #3 的真实 Ego 课程验收。

## 自动化验收

- SDK 纯逻辑：不完整结构保存、显式名单选择、revision 冲突、完整校验、生产小时 payload、材料缺失/哈希变化/网页不可恢复状态。
- SDK 查询：受控 API 覆盖 `ae/E/af` 方法、路径、服务 Header、管理列表授权、字段投影和 token 不落草稿。
- Node 存储：仓库外私有目录/文件权限、原子 temp+rename、并发 stale 完整稿 conflict 保存、附件哈希检查。
- 真实 CLI 进程：help/schema、API 只读创建、文件与 stdin 输入、多次独立进程编辑/恢复、材料检查、完整校验、列表、stale patch conflict 保存、`ulimit -f 0` 模拟写入中断不破坏旧稿，并断言志愿业务远端写入为 0。
- `npm test` 在 Node.js 22 下通过 26 项测试、0 失败、0 跳过，并同时完成 TypeScript 构建。

## 未验收

- 未调用 `ag`，未上传材料，未执行学校生产写入或服务器回查。
- 未运行 Ego prepare；人工最终提交及页面回填属于 #6/#7。
- CQU Auth、教师/管理员真实组织上下文、生产端完整活动类型枚举和共享 request 错误契约统一仍由相关任务/主 agent 处理。

## 集成前修复与当前只读核对

- 管理列表的 `positionSetMethod` 可能为 null，列表保留未知；创建草稿时只接受详情中已知的 TIME/SIGN，绝不默认猜一种模式。活动审批详情的 `data` 就是活动本身，没有 `activityInfo` 包装。
- SDK 数据源直接核验账号/角色/单位，不只在 CLI 外层核验。文件保存要求修订恰好递增且保持账号/组织/活动绑定；stale 写保留冲突文件。
- 附件 SHA-256 对原始字节计算；以非 ASCII 二进制内容复现并修复编码错误。
- 指定学号可只读查到学校姓名后增补到本地草稿，不要求先有报名 UUID。新增人员遵守当前前端 `uuid:""`、`isApply:0` 格式；正式提交仍由 #8 校验和执行。
- 当前学校登录态 SDK 查询：管理列表 5 个活动，其中 2 个认证模式未知；对显式选择的已知模式活动读取 1 个岗位、空报名名单和组织绑定成功。所有请求为只读业务请求，未录入页面、上传或提交。

- 真实 CLI 单独进程 `drafts create` → `drafts show` 成功，活动绑定一致、revision=0、指定名单为空；仓库外私有临时会话与草稿在验收后清除。该验证没有学校业务写入。

- CLI 来源回归：草稿查询/建稿可选现有 Ego 会话，受控外部桥接与 API 验证不依赖本地 session.json；与课程共用会话选择，未知 via 和混用参数由同一入口拒绝。

- 真实 Ego CLI：`drafts activities --via ego` 返回 5 项，`drafts create --via ego` 成功创建未选择任何人的本地草稿；使用同一任务空间现有页面，未使用本地登录凭据，未执行学校业务写入，临时草稿已清除。
