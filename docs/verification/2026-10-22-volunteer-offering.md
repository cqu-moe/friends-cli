# 校内志愿活动开办申请验证

实现 #10：`createVolunteerOfferingClient` 与 `friends offerings prepare/materials/submit/status`。

## 源码契约

- 仅使用公开前端源码核实字段：普通 `SCHOOL_ACTIVITY` 先 `POST school-activity-apply/next-step` 取得中间 UUID，再 `POST school-activity-apply/apply` 携带 `{...registration, uuid, handleType:"EJZZ01"}`；`TEMP_ACTIVITY` 的 `next-step` 本身是最终写入，额外发送 `posts: []` 和 `nameList`。
- 材料上传使用 `POST /biz-common/protected-file-upload` 的标准 `FormData(files, groupId)`，回查使用 `POST /biz-common/list-group-resource?groupUuid=...`；未使用 public upload 接口。
- 公开图片最多 5 张且仅图片、每张 20 MiB；附件最多 10 个，普通 20 MiB、视频 200 MiB。只构造源码核实字段，不发送历史 `applyReason` 或 `activityStyle`。
- SDK 根导出不含 Node/Ego 适配；`prepareVolunteerOfferingInEgo` 仅从 `@cqu-moe/friends-cli/node` 按需加载。

## 已运行验证

- 受控 SDK：真实本地 HTTP 服务覆盖上下文重验、成功准备、普通/临时活动提交、材料完整与部分失败、上传响应丢失后的只读回查、dry-run、无确认、Ego submit 意图拒绝、错误组织/日期/字段/材料、权限与业务拒绝、next/final/TEMP 响应丢失、未知流程字段保留。
- 受控真实 CLI 子进程：文件与 stdin JSON、help/schema、本地材料 File 加载、上传、dry-run、显式 API 提交、进度查询、版本化 JSON、Ego submit 拒绝及 token 不落输出。
- strict Ego fixture：真实 CLI 生成 `ego-browser nodejs` 脚本并由 fixture 执行该脚本，而非返回预置结果。页面执行器只使用文档支持的 `goto/url/snapshot/click/fill/waitForSelector/waitForFunction/evaluate` 与 `task.handOff`；fixture 拒绝 handoff 后操作、意外导航和最终提交请求，并验证人工已有值保留、FieldSelect 可见包装层点击、dry-run 零动作、prepare 交接且 `submitted:false`。
- 真实 CLI Ego 查询：使用虚构页面会话核验后直接调用同一个只读 status API，不导航当前页面。

## 未执行

未运行已安装 Ego、未访问学校登录态、未读取或写入生产数据、未上传真实材料、未发起生产申请、未执行人工“下一步/提交申请”，也未推送或更新 GitHub。生产端还需要主线程在明确授权下完成真实已安装 Ego 控件验收、只读上下文/登录态核对、受控生产材料上传与提交，以及人工最终提交后的学校回查。本文的源码分析、本地 HTTP 和 jsdom fixture 不能替代这些外部验收。
