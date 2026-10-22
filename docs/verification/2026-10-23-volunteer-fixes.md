# #9 集成修复验收

保留接手时的认证捕获与 Auth 诊断改动，并解决原有合并冲突。复用已批准的公开 SDK 和实际 CLI 子进程测试边界。

- 认证岗位直接定位 input[name="postId"] / input[name="date"]，时长定位 input[name="requiredCourseCount"]；不依赖并不存在的 .field-select 包装层。
- strict DOM fixture 执行真实生成脚本、同源 iframe 内回调及输入/点击事件；认证与志愿报名均检查 iframe 内账号/角色/活动，保留既有学校账号和可管理活动的重新查询校验。
- 只读/禁用时长与已有人工文本、岗位、选择不覆盖；不使用任何最终提交按钮或提交 API。
- 认证部分准备中断保留 draftId、activityId、pageLabel、已完成人员动作和 inProgress，返回不可重试的 UNKNOWN_OUTCOME；CLI 退出 7，最终提交计数 0。
- 新增回归先在旧选择器处失败，再通过修复；SDK 与 CLI 独立验收。未把受控 DOM 驱动称为真实 Ego。未加入私有测试页地址、凭据或个人名单。

本次未访问真实浏览器、GitHub 或生产服务，也未执行学校最终提交。此前文档的实际 Ego 证据属于历史记录，本次未复测。
