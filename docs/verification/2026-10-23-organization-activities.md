# #18 组织活动查询与开办验收

## 来源与范围

只使用主线程共享的 organization-operation-evidence.md、common-api-prefix-review.md 与 school-public-source 快照，以及已读取的 endpoint collection USAGE/notes/OpenAPI/review。没有访问浏览器、GitHub 或生产服务，不实现 #19 报名、#20 审批或已撤回的 #16/#17。

源码：index.ab6e178e.js 请求工厂及导出映射；index.5fa98249.js 公开查询；activityApply.5e72e07a.js 的 my-page-list；detail.bb008e63.js 状态与组织活动申请流程；firstStep.95354968.js 第一步；secondStep.0d43cb1b.js 设置/最终提交；index.d1c12659.js 图片及 fileUploder.709dc576.js 附件上传。注意 activityApply 中别名 i 是取消函数；本实现没有复用它，不把索引别名误当 API 路径。

组织服务为 /gateway/zovecenter-saip-ek-app-team-organization-manage/mob，AppKey 为该服务名。公共 term-list、protected-file-upload、list-group-resource、flow/approve-list 均为 /gateway/ek-agg-mob/biz-common/...，AppKey 为 zovecenter-saip-ek-agg-mob。受控服务拒绝错误完整路径和 AppKey；不使用 fallback 重试。

## 交付契约

- SDK：organizationActivityId、createFriendsSdk().createOrganizationActivityClient，及可直接使用的 createOrganizationActivityClient；list/get/requirements/status/prepare/uploadMaterials/submit。
- Node SDK：prepareOrganizationActivityOfferingInEgo。CLI：organization-activities list/show/requirements/status/prepare/materials/submit，全都有 help/schema。
- API 查询与 Ego 会话查询使用同一 SDK。权限来自每次学校账号/上下文核验与 drop-down-list({isTeacher:false}) 中的组织，组织名/类型和学期从学校读取。未知状态保留原值，不用志愿或课程枚举解释。
- API 材料上传、第一步保存与最终设置提交分开。材料上传需独立确认；第一步 PUT next-update 返回新 UUID 后才允许最终 PUT set-update，中间重新核验组织权限。上传/保存/最终响应丢失立即停止后续写入；只读回查匹配不能清除 UNKNOWN_OUTCOME。
- 恢复证据中的 publicity-group/attachment-group 是本地分配的组标识，upload:resourceId 才表示收到该资源的上传回执；已确认的第一步另保留申请 UUID。没有自动回滚或跨路径补交。
- Ego 只在初始活动信息页填空白可编辑文本；所有实际 DOM evaluate 与 input/change 回调在同源 iframe 中执行。人工文本与只读控件保留，部分中断返回 completed/inProgress 和页面 label，始终 submitted=false。下一步、上传、第二步和最终提交交给用户；没有最终按钮或写 API 绕过。
- 最小 API 输入使用定时开启/截止、1–8 次签到、显式开关与空自定义问卷。图片/附件仅使用源码已知类型和大小规则；不提供未核实字段的任意透传。

## 受控验收

新能力先从公开 SDK 或真实 CLI 子进程失败，再实现：查询方法不存在、prepare 不存在、uploadMaterials 不存在、Node prepare 不存在、schema 缺失、非法会话未拒绝、status 缺少 workflow 证据等均有 red 记录。日志在本机临时目录，未加入仓库。

SDK 测试使用真实本地 HTTP 服务，断言完整 URL、AppKey、输入/材料/权限/状态、两步 payload 与副作用。覆盖第二份材料上传丢失后的部分证据、第一步丢失、返回 UUID 缺失、最终响应丢失但回查匹配、第一步后权限撤销和无重试。回查比较已提交的活动/材料/持久设置字段，仅存在第一步记录不能被当作最终设置匹配；回执与回查不一致分别报告。

Node 与 CLI DOM 测试运行生成的当前脚本和真实 DOM 回调，不返回预造 evaluate 成功对象。覆盖同源 iframe、标题/只读地址保留、实际文本和地址录入、交接后禁止读取、dry-run 零动作、错误账号、部分 fill 响应丢失、所有最终提交绕过拒绝。独立服务统计上传/next-update/set-update，Ego 准备均为零。

CLI 覆盖所有命令 help/schema、文件与 stdin、版本化单 JSON stdout、stderr、非交互确认、错误参数、权限退出 4、身份退出 3、UNKNOWN_OUTCOME 退出 7、API/Ego 查询和实际执行方式。材料 JSON 回执可直接传给 submit，不依赖私有临时页地址。

最终合入 integration `368abeec446fc36ed079c347dfd3fa3e4b3dec4e` 后，完整 `npm test` 通过：223 tests，0 failed、0 skipped（包含 TypeScript 构建）。功能提交合入之前的独立全量为 136/136；合并时保留课程、参与、审批与志愿功能，组织活动命令复用共享父命令。共享 strict fixture 同时保留真实 iframe、课程表单 model、远程写计数和已有用户输入保护。

## status 只读实测发现后的修复

主线程确认旧 `node-list-no-state` 请求 HTTP 200/code="0"，但 data 是长度 3 的数组；只记录形状，不保存真实节点或个人信息。重新沿源码核对：detail.bb008e63.js 导入 `{A as D}`，common.b21a4484.js 的导出为 `O as A`，O 实际 POST `biz-common/flow/approve-list`。前端从该接口 data 读取 nodeList/evaluationRecords；此前实现与 fixture 都把错误端点伪装成了这个对象。

修复将 status 对齐前端 approve-list，不把无状态节点数组伪装成审批历史、不以空数组掩盖历史缺失。节点与记录中的未知状态保留；缺失或非数组字段为 null，学校明确返回空数组时保留 []。SDK 和真实 CLI 的回归测试在旧代码准确复现同一 NETWORK_PROTOCOL_ERROR（CLI exit 6），再通过修复验证 API/Ego 查询的版本化输出与缺失历史。实际学校修复后复测由主线程执行。本次定向测试 18/18，全量 npm test 224/224 通过（0 failed/skipped，含构建）。

主线程后续通过现有 Ego 查询入口实测：修正后的 status 成功，nodeList 为 3 项、evaluationRecords 为 2 项。这里只记录数量与只读查询结论，不保存真实节点、审批人员或记录内容；它不代表开办写入或人工最终提交验收。

完整模块端点、字段与 fixture 审计见 [有界来源审计](2026-10-23-organization-activity-source-audit.md)。主线程以真实组织和当前学校学期执行修正后的 SDK prepare 已成功（materials-required，零上传/写入）。

## 尚未验收与风险

本工作线程没有执行真实 Ego、学校登录态只读、生产材料上传、生产 API 开办、用户最终提交或生产回查；主线程的 status 只读复测结果单独记录于上一节。受控测试不替代这些层次。实际学校服务对材料、权限及完整表单仍有最终决定权。

图片 fixture 仅为受控字节，未声称生产图片解码/压缩通过；资源核对仅验证学校返回的资源 ID/文件名，不能证明字节散列。Ego 只交付第一阶段文本准备，组织/日期/材料、下一步保存和第二步设置必须人工完成。
