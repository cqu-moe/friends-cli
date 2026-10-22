# 校内志愿活动开办申请验证

实现 #10：`createVolunteerOfferingClient` 与 `friends offerings prepare/materials/submit/status`。

## 源码契约

- 仅使用公开前端源码核实字段：普通 `SCHOOL_ACTIVITY` 先 `POST school-activity-apply/next-step` 取得中间 UUID，再 `POST school-activity-apply/apply` 携带 `{...registration, uuid, handleType:"EJZZ01"}`；`TEMP_ACTIVITY` 的 `next-step` 本身是最终写入，额外发送 `posts: []` 和 `nameList`。
- 材料上传使用 `POST /ek-agg-mob/biz-common/protected-file-upload` 的标准 `FormData(files, groupId)`，回查使用 `POST /ek-agg-mob/biz-common/list-group-resource?groupUuid=...`；未使用 public upload 接口。
- 公开图片最多 5 张且仅图片、每张 20 MiB；附件最多 10 个，普通 20 MiB、视频 200 MiB。只构造源码核实字段，不发送历史 `applyReason` 或 `activityStyle`。
- SDK 根导出不含 Node/Ego 适配；`prepareVolunteerOfferingInEgo` 仅从 `@cqu-moe/friends-cli/node` 按需加载。

## 已运行验证

- 受控 SDK：真实本地 HTTP 服务覆盖上下文重验、成功准备、普通/临时活动提交、材料完整与部分失败、上传响应丢失后的只读回查、dry-run、无确认、Ego submit 意图拒绝、错误组织/日期/字段/材料、权限与业务拒绝、next/final/TEMP 响应丢失、未知流程字段保留。
- 受控真实 CLI 子进程：文件与 stdin JSON、help/schema、本地材料 File 加载、上传、dry-run、显式 API 提交、进度查询、版本化 JSON、Ego submit 拒绝及 token 不落输出。
- strict Ego fixture：真实 CLI 生成 `ego-browser nodejs` 脚本并由 fixture 执行该脚本，而非返回预置结果。页面执行器只使用文档支持的 `goto/url/snapshot/click/fill/waitForSelector/waitForFunction/evaluate` 与 `task.handOff`；fixture 拒绝 handoff 后操作、意外导航和最终提交请求，并验证人工已有值保留、FieldSelect 可见包装层点击、dry-run 零动作、prepare 交接且 `submitted:false`。
- 真实 CLI Ego 查询：使用虚构页面会话核验后直接调用同一个只读 status API，不导航当前页面。

## 实际 Ego 与学校只读验证

2026-10-22 主线程使用已登录的学校页面验证了公开 SDK 的身份/组织/字典/当前学年学期查询。真实当前学期来自 `/ek-agg-mob/biz-common/term-list`，`isCurrentTerm` 为字符串 `"1"`。网关公共服务 appkey 是 `zovecenter-saip-ek-agg-mob`；测试现在严格匹配完整路径。

在 `campusManagerApplyPages` 实际同源 iframe 内执行了页面准备器：填写虚构测试活动文本、人数、时长；选择类型、级别、组织和起止日期；保留页面原有联系人与电话。Vant 日期/类型滚轮逐步点击可见选项并等动画结束。返回无执行错误，缺项仅为材料与人工后续操作；未上传，未点击下一步或最终提交。已 reload 清除本次未提交的测试内容。

这次实测替换了最后的 handOff 回调，避免反复要求用户交接；真实交接行为由公开 SDK/CLI 的受控执行测试覆盖，不能把本次实测称为完整人工提交流程。实际个人字段与会话未写入仓库。

## 未执行

未上传生产材料、未发起生产申请、未执行人工下一步/最终提交或最终业务回查。API 写入与响应丢失仅通过受控 HTTP 服务验证；真实录入不等于生产提交验收。
