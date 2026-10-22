# 组织活动报名与个人记录验证

范围：#19；独立组织活动 ID 与报名记录 ID。查询可通过已验证 API 或 Ego 会话直接请求学校；Ego 写入只准备并交接，用户亲自确认。

## 源码契约

学校 `stuApply.b8442519.js`、`stuApplyDetail.f4567e6c.js` 和 `index.ab6e178e.js` 提供以下依据：

- `POST /enroll-info/apply-page-list` 查询可报名活动；`POST /apply-info/my-apply-list` 查询个人参与记录，后者传当前账号 `userNo`。
- `GET /enroll-info/find/{activityId}` 读取活动和问卷。详情没有完整个人状态；按活动名搜索列表、精确匹配活动 UUID，最多扫描 20 页后明确失败。
- `POST /enroll-info` 报名；`DELETE /enroll-info/exit/{activityId}` 退出。`GET /enroll-info/{applicationUuid}` 在页面中用于撤销，**不作为只读状态查询**。
- 学校报名状态 3/5/7 分别为待审批/拒绝/通过；报名窗口使用学校时区 UTC+08，未识别状态保持 unknown 并阻止写入。退出必须处于学校页面支持的已通过且仍在报名窗口状态。
- 问卷类型 1/2/31/32/33/411/412/421/422；选项写入 optionName，多选写逗号分隔值，附件写已有学校资源组 ID 并只读校验资源存在。不存在的上传能力不伪装成已上传。

## 受控验证

直接从 SDK 根导出与 Node 导出进入，并用实际 CLI 子进程调用真实 SDK。测试服务器匹配完整业务路径；Ego 外部进程执行真实 evaluate 回调及可见输入/点击，页面使用同源 iframe 和学校实际 class/控件结构。

覆盖查询/个人列表、详情 ID、窗口关闭、成员限制、未知状态、重复报名/退出、篡改计划、身份变化、权限/业务拒绝、附件组、问卷校验、扫描预算、API 单次确认、响应丢失与只读回查、Ego 人工值保留和中断恢复。所有受控 Ego 准备的最终请求数为零；CLI 覆盖 JSON stdin/文件、help/schema、单 JSON stdout、实际执行方式及未知结果 exit 7。

此模块新增 10 个测试；合入前基线全量 122 项通过。后续总分支完整结果以 PR 为准。

## 当前学校与浏览器验证

2026-10-23 实际运行 `organization-participation list/show --via ego`，使用现有已登录 Ego 页、直接 API 请求：列表第一页读取 1 项且 hasMore=true；详情正确匹配同一活动及个人状态。抽查活动已经截止，eligibility.register/exit 均 false，原因为 outside-enrollment-window。未输出或提交真实名单到仓库。

未对真实组织活动报名、退出或最终提交；真实组织报名页面的可见填写未验收。Ego 自动填写文本/数字/选项，日期与附件明确列为人工字段；附件自动上传不属于本模块当前交付。所提供的已有资源组可用于显式 API 报名，但 Ego 不会注入隐藏资源组。

响应丢失即使回查匹配也保持 UNKNOWN_OUTCOME，不自动重试或换路径。Ego 准备计划不可转为 API 执行。
