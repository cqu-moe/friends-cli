# Issue #14：课程开办申请与进度

日期：2026-10-23。依据 SPEC #1 用户故事 31。证据层次为公开前端源码核对、受控 HTTP 服务、公开 SDK、真实 CLI 子进程和执行实际 DOM 回调的 jsdom iframe；没有使用真实 Ego、学校生产登录态、生产上传或生产业务写入。本记录不等于开办获批。

## 来源与范围

- `CourseInfo.ce5eecb6.js`：课程第一步字段、课程组织下拉、组织 `labelCode -> applyLabelCode`、`CCYL -> LEAGUE` 的映射、单个积分角色、认证方式、`next-step` 与 `PUT apply` 边界。
- `ReportSet.25311d4e.js`：报名设置与 `POST apply/apply` 最终提交边界。问卷和岗位的复杂编辑、非空院系/年级/学历限制未交付，输入会在业务副作用前拒绝；已通过课程的专门更新流程未交付。
- `Index.b64dc1a3.js`：`flowOverallState == 1` 可提交，`== 3` 可修改；待审、通过与未知状态不可进入本任务的写路径。
- `index.7ba42e14.js` 与课程 Request 工厂：课程接口位于 `/gateway/zovecenter-saip-ek-app-curriculum/mob`，AppKey 为 `zovecenter-saip-ek-app-curriculum`。
- `common.b21a4484.js`、`request.9fd33a2f.js`：通用字典、学年、学期与文件接口位于 `/gateway/ek-agg-mob/biz-common`，AppKey 为 `zovecenter-saip-ek-agg-mob`。当前标记接受学校返回的数字或字符串 `1`；只接受一个当前学年和学期，保留学期编号原始类型。
- `index.d1c12659.js`、`fileUploder.709dc576.js`：`files`、`groupId` multipart 上传、图片类型/大小与附件扩展名/大小；课程海报最多五张。课程表单对海报和附件的 `required` 校验均被注释，不据此声称学校强制两者齐全。声明已有材料组时，必须能回查到有效文件；海报组还校验图片扩展名及数量。SDK 上传不复刻前端图片压缩。

虚构可编辑输入见 [course-offering.json](../examples/course-offering.json)。示例中的账号、单位、组织和字典代码均为占位数据，必须替换。普通 JSON 仅接受已知字段；`materials.files` 仅在 CLI 的独立上传命令中解析，其他命令不会悄悄忽略文件声明。`schema course-offering.<command>` 提供输入结构和支持阶段。

## 操作及副作用

| CLI / SDK | 学校调用或页面动作 | 业务读写及阶段 | 支持路径与权限 |
| --- | --- | --- | --- |
| `prepare` / `prepare` | 身份核验、字典、学年/学期、课程组织下拉（查询使用 POST） | 只读；生成的组 UUID 仅在本地 | API；绑定当前账号、角色、身份单位及学校返回的课程组织 |
| `materials` / `stageMaterials` | `POST /gateway/ek-agg-mob/biz-common/protected-file-upload` | 上传写入，与申请提交分开；`finalSubmission:false` | 仅独立 API intent 和确认；dry-run 零上传 |
| `next-step` / `saveFirstStep` | 新建 `POST apply/next-step`；已有 UUID `PUT apply` | 第一步草稿写入；`finalSubmission:false`；新建 dry-run 没有课程 ID | 仅独立 API intent 和确认；已有课程先读组织及可编辑状态 |
| `submit` / `submitFinal` | 先读 `GET apply/approve-detail/{uuid}`，再 `POST apply/apply`，最后只读回查 | 最终申请写入；提交确认与学校批准分开 | 仅独立 API intent 和确认；重新核验身份、组织、材料、状态 |
| `status` / `status` | `GET apply/approve-detail/{uuid}` | 只读；投影必要状态，未知枚举不标为通过 | API 或经过核验的 Ego 会话；请求方式均为 direct-api |
| `prepare-ego` / Node `prepareCourseOfferingInEgo` | 同源 iframe 中的具名控件、源码 Vant slot、picker 与日期操作 | 可见准备和交接；不上传、不点下一步、不最终提交；`submitted:false` | 只支持可见准备；核对账号、角色、路由、UUID，保留人工值，`--yes`/`--confirm` 不产生提交 |

SDK 每个写边界重新核验绑定和课程组织，不把调用者可修改的 prepared 元数据当作权限凭证。已有课程仅允许源码确认的草稿/退回状态。Ego 仅准备第一步中的普通文本、类型/级别/组织与日期；积分角色、认证细节、材料和下一页报名设置交由用户审阅，结果列出缺项和中途错误并交接。这个阶段可以在字段尚不齐全时返回 `awaiting-user`，不代表全部表单已准备好。

## 受控验证

使用 `npm run build` 后运行：

```sh
node --test tests/course-offering.test.js tests/course-offering-cli.test.js tests/course-offering-ego.test.js
```

该批次 39 项通过，覆盖：

- 公开 SDK 申请校验、材料准备、第一步保存、独立最终提交、状态回查；严格完整 URL、AppKey、原始学期类型及课程组织审批标签。
- 未知字段、未支持问卷/岗位/受众、非法日期、身份/组织不符、权限变化、材料为空/类型不符/数量超限、待审/通过/未知流程状态和最终业务冲突。
- 首次/后续上传、第一步新建/更新和最终提交的响应丢失；保留 `UNKNOWN_OUTCOME`、可恢复 `input`、组 ID、已确认文件和待确认文件。已知 ID/组只读回查，即使匹配仍为未知，无自动重试、跨路径续交、回滚或后续写入。首次创建丢失 UUID 时明确无法按 ID 回查。
- 最终确认形状含糊，或最终已确认但回查被拒：退出码 7；后一种保留 `serverAcknowledged:true`。明确权限/业务拒绝保留原错误分类及已发生的部分上传事实。
- 真实 CLI 子进程调用真实 SDK；全部六个命令的 help/schema，文件/stdin，非交互确认，版本化单 JSON stdout、stderr、退出码与执行方式；API dry-run 和不支持组合零业务写入。
- strict Ego runner 执行生成脚本中的实际 DOM 回调，不伪造 evaluate 结果。测试具名控件和源码中的分行文本域/slot 两种同源 iframe 形状，外层大厅 URL 与内层课程 URL 独立，按内层路由及会话校验；input 事件更新独立表单模型，picker 必须等待所选项与动画结束，最终按钮连接可观测 HTTP 写请求。验证准备、人工值保留、中断交接、错误会话、dry-run、禁止越界提交，业务写请求为零。

实现前已复现完整 URL 错误、prepared 输入可伪造/过期、缺少状态复核、假定表单包装层、错误材料必填约束、含糊确认被当成功、回查失败丢失提交确认、CLI 忽略文件声明、日期/当前学期校验缺口及丢失输入/回查信息等失败；修复后对应公开边界测试通过。

合入集成分支 `6bd109c` 并解决命令、导出及 README 冲突后，完整 `npm test` 通过：174 项通过、0 失败、0 跳过。首轮合入前完整测试为 135 项通过；这些均为本地受控测试，不是 CI 或生产验收。

## 尚未验收的层次

真实课程 Ego 页面和 picker 兼容性、学校当前登录态的课程开办只读查询、明确授权的生产材料上传/API 写入、用户最终人工提交和生产服务器回查均未执行。没有 CI、生产部署或获批结论。WAF/native Auth 限制由主集成任务记录，本任务没有修改 WAF。生产层次必须由主任务分别记录，不能由上述受控测试替代。


## 真实页面反馈后的内层控件修复

主任务随后报告：真实 SDK prepare 已使用学校组织和字典成功，但 p3 填完名称、地点和介绍后，点击课程类型未打开 picker。公开源码 `CourseInfo.ce5eecb6.js.txt` 第 177–211 行确认，类型、级别、主办方及两个日期的回调绑定在 Vant custom-control 的内层 slot div；外层容器不是点击目标。主任务另已验证直接点该内层元素能打开真实六选项 picker，确认按钮文字为“确认”。这些是主任务提供的实测反馈，本 worker 没有访问真实浏览器。

修复将定位标记落到 `.van-field__body > .van-field__control--custom > div`，保留旧具名控件的支持；再次准备前只清除本助手以前的定位标记，防止旧外层和新内层同时匹配，保留表单中的已有值。严格 iframe fixture 仅让内层节点绑定打开回调，外层 click 不会打开；还模拟上次准备遗留的外层标记。旧实现分别复现 picker 超时和重复匹配，修复后公开 SDK 与真实 CLI 回归通过，五个选择/日期值均由实际 DOM 回调写入独立表单模型。

移除 #14 运行时及 Node 结果类型、桥接检查中的硬编码 `finalSubmitActions:0`。提交数是受控 fixture 的观测值；测试断言真实 fixture 的 `submits` 和 `remoteWrites` 均为零，运行时结果不再伪装成真实浏览器计数。补丁仍不上传、不点下一步、不最终提交；真实页面补丁复验由主任务单独记录。
