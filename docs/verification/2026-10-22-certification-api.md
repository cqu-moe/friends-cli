# 志愿认证 API 验证

实现 #8：`createVolunteerCertificationApi` 与 `friends certification submit/status`。

- `submit` 仅接受独立 `via: api`、`intent: submit-volunteer-certification` 和确认；CLI 必须明确 `--via api --confirm`。Ego submit 在任何网络请求前拒绝。
- 支持已有草稿 ID，或导出草稿 `--input file|-`。所有路径保留本地草稿；dry-run 只验证及只读查询，不上传、不提交。
- 重新核实学校账号、角色/单位、活动管理权限、组织、名单的报名 UUID 和岗位。手动添加的学生另行查询核实。已有认证申请不会被此新建命令覆盖或自动重交。
- 当前生产表单没有附件控件或已核实的认证附件字段，带材料的草稿在副作用前拒绝。没有虚构上传、部分上传或清理功能。
- 最终 POST 必须返回学校业务 `code: "0"` 才有业务确认，随后独立 GET 回查名单/岗位/小时。`serverAcknowledged` 与 `readback.state` 分开报告；回查扩大名单不能算 `matched`。
- 请求可能已发送但响应丢失/格式异常：保留 UNKNOWN_OUTCOME，CLI exit 7，不重试。进行一次只读回查并报告恢复标识；即使读到匹配名单，也不抹去原始不确定结果。
- 回查保留未知学校状态，不把提交成功或待审申请说成已认证。

## 验证层次

受控 SDK：真实 HTTP 服务覆盖成功、dry-run、错误绑定、权限/业务拒绝、已存在申请、材料拒绝、丢响应、异常响应、失败回查及名单扩大。受控真实 CLI 进程：存储草稿/文件/stdin、JSON envelope、stderr、退出码、不重发、草稿字节保留、Ego 选择会话的只读 status（该入口测试用外部 Ego bridge fixture，不声称实际 Ego 填表）。

2026-10-22 使用现有 Ego 登录态，仅查询学校活动与认证：无申请时学校返回具有 uuid/activityId/activityInfo/nameList 等字段的全 null DTO；已根据实测修正解析，并加入回归测试。未输出个人名单或凭据，未导航当前页面。

生产最终 POST、实际人工提交以及学校真实认证后的回查未执行；这些需要明确的真实业务授权。此记录不把源码、受控 HTTP 或空申请的只读验收当作生产写入证明。
