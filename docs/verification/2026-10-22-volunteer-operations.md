# 志愿身份、活动与个人报名验收记录（2026-10-22）

## 证据边界

- 公开源码证据见集中工作区 `volunteer-operations-evidence.md` 与 `volunteer-certification-evidence.md`：身份、可参加/可管理列表、详情、岗位、报名要求、个人报名、报名与退出接口、问卷类型和状态字段均来自当前公开 JS；源码证据本身不代表生产写入成功。
- 志愿网关服务对齐 #5 已实测的 `zovecenter-saip-ek-app-young-volunteers`。可管理列表保留 `positionSetMethod: string | null`，不把 null 猜成 `TIME` 或 `SIGN`；详情响应的 `data` 按活动本身解析。
- 活动 UUID、报名 UUID、岗位 UUID 分开校验。报名前校验岗位属于当前活动、问卷和选项属于当前活动、当前账号为学生且报名属于当前学生；重复报名、窗口关闭、学校 `can-apply=false`、上传类问卷和错误域 ID 均显式拒绝。
- SDK 写入自身要求精确 `confirmation`，不是仅靠 CLI flag。成功响应分离 `receipt` 与 `readback`：`receipt` 只表示网关确认收到，`readback` 是 `my-applied-page-list` 第一页证据，`approval` 保留未知/通过/拒绝，不把 HTTP 200 或业务 code 0 说成审批通过。

## 本仓库受控验收

- `npm run build`
- `node --test tests/volunteer*.test.js`
- SDK 公共方法覆盖：身份、可参加分页/关键词、可管理列表、详情、报名要求、个人报名列表/详情、报名、退出；403、null 行、教师尝试报名、错误活动/岗位/问卷/报名 ID、窗口关闭、重复报名、不可报名、他人报名、非通过状态、上传问卷、缺少 SDK 确认、写响应丢失后不重试。
- 真实 CLI 子进程覆盖 help/schema、本地会话、全部查询命令、stdin/文件输入、dry-run 零写入、明确确认后的 API 报名/退出、Ego 选择后的直接 API 查询、可见准备脚本边界和输入错误。
- SDK Ego 测试使用 integration #6 的 jsdom strict fixture 执行当前生成脚本，而不是断言预构建 JSON 回执：岗位 picker、单选/多选图标、文本和数字输入都实际改变 DOM，并统计真实到达受控 HTTP fixture 的最终请求。断言专用页、可见 snapshot/click/fill、真实最终按钮文案“申请加入”、`handOff()`，且 `/write`、`/quit` 最终请求为 0；问卷标题或选项缺少页面可见文本时，CLI 在启动 Ego 前以输入错误拒绝，不能用 UUID 生成选择器。
- 受控真实浏览器入口：`FRIENDS_EGO_TASK_SPACE=<id> npm run verify:volunteer-ego -- register|withdraw`。报名 fixture 覆盖单选、多选、数字和文本可见控件；HTTP server 统计真实到达 `/write` 或 `/quit` 的请求，准备阶段必须为 0；可选 `FRIENDS_EGO_VERIFY_WAIT_MS` 保留页面供用户亲自点击受控最终按钮并统计实际请求。

## 未验收

- 本 agent 未运行真实 Ego 浏览器；真实可见控件、专用页面和人工交接由主线程执行。
- 未使用学校生产登录态做本业务只读查询。
- 未执行任何学校生产业务写入、隐藏写入或退出。
- 未由用户在真实页面亲自提交报名/确认退出。
- 未对学校服务器进行生产写入后的只读回查。仓库内 readback 只证明受控 HTTP fixture 中 API 写入后会发起独立个人报名列表查询。
