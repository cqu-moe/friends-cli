# #13 课程报名、退出与个人记录验收

更新：2026-10-23。保留此前 `e14a970` 及未提交附件 follow-up 的工作，继续在 #13 专用 worktree 实现。所有 HTTP、账号、课程、报名和 Ego fixtures 均为虚构数据；没有生产会话或真实名单。

## 源码证据与协议

- 根据共享笔记 `course-operation-evidence.md` 与 `common-api-prefix-review.md`，报名详情使用课程页面实际调用的 `GET /gateway/zovecenter-saip-ek-app-curriculum/mob/apply/approve-detail/{courseId}`；个人记录通过 `POST .../apply/my-applied-page-list` 分页/关键词读取。单条个人记录从列表定位，课程 UUID 与报名 UUID 分离。
- `CourseDetail.557b158a.js` 的报名 payload 为 `curriculumId/questionnaireResult/studentNo/uuid` 和显式角色字段；多选题的 `itemUuid` 来自选项的 `itemUuid`，不误用问题 UUID。支持五类非附件题及四类附件题，题目、选项、角色均由当前学校详情约束。
- `index.d1c12659.js`、`formFileUploader.107e6b2a.js`、`common.b21a4484.js` 和请求工厂核实上传生命周期：每题生成去连字符的 UUID 分组，multipart `files/groupId` 上传；图片 MIME 白名单为 PNG/JPG/JPEG/GIF/BMP，文件为 PDF，上限 20 MiB。单附件题限制一个文件，多附件题顺序处理。
- 上传和只读分组列表必须使用 `/gateway/ek-agg-mob/biz-common/protected-file-upload`、`/gateway/ek-agg-mob/biz-common/list-group-resource?groupUuid=...`，AppKey 必须为 `zovecenter-saip-ek-agg-mob`。严格 HTTP fixture 拒绝旧前缀或错误 AppKey；没有 fallback。
- `GET student-apply/{registrationId}` 在个人课程页面确认后作为撤销使用；按可能写入处理，不用于只读查询。退出为 `DELETE student-apply/quit/{registrationId}`。`can-apply` 的 GET 可能报名，所有准备和 dry-run 禁止调用。
- 生产课程角色选择块被注释。API 必须显式选择学校返回角色；Ego 不再对含角色课程一概拒绝，而是验证请求角色并交接为 `human-required`，不操作隐藏 Vue 模型。只读日期选择器保留为人工输入事项。

## 受控公开 SDK / 真实 CLI 验收

- SDK 直接调用 `createFriendsSdk().createCourseParticipationClient`，覆盖分页/筛选、未知状态保留、领域 ID、报名条件/状态、明确确认、上游权限/业务拒绝、成功后的只读回查、身份变化和非附件问卷。
- 四类附件覆盖无副作用准备、MIME/数量约束、分组绑定和一次提交。每次上传前重新核验会话。上传响应丢失或 `code:0` 缺失资源回执都返回不可重试 `UNKNOWN_OUTCOME`；即使回查匹配也不继续。保留分组和已确认资源 UUID；账号变化、最终报名业务拒绝也保留先前上传，不删除或回滚。
- CLI 用真实 Node 子进程调用真实 SDK，覆盖所有本票命令、help/schema、文件/stdin、明确执行路径与确认、JSON stdout/stderr/退出码、API 报名/撤销/退出及附件上传。API 和 Ego 部分上传中断都断言退出 7、恢复信息、后续上传/最终提交为零。
- Node 公开 `prepareCourseRegistrationInEgo` 直接验证学校账号、角色、单位和当前课程/个人报名；可见页还核对 route、课程名称和同源 iframe 会话。错误账号、目标、角色、学校关闭报名和同名歧义均拒绝。已有页面不被导航覆盖。
- `tests/fixtures/course-participation-ego.mjs` 使用 jsdom 执行真正的页面 evaluate 回调与原生 input/change/click 事件。表单包含同源 iframe、直接 textarea/input 控件、四类 uploader 以及撤销/退出确认按钮；snapshot 使用 `[ref=N]` 和下一行标签。它不以预制 evaluate 结果代替 DOM。
- 上传 change 回调向本地受控 HTTP 服务发送真实 multipart 请求，反映准备阶段的实际副作用。SDK 直调和 CLI 均覆盖四类附件；已存在及较晚的人工作答保留。丢失上传/桥接回执后保留页面、完成和尝试步骤，交接一次且不再上传。
- Ego 最终报名按钮和对话框确认按钮有计数回调，SDK/CLI 场景断言最终写入始终为零。代码没有最终提交 API、快捷键或确认绕过。

## 自动化结果

- 本票 `npm run build && node --test tests/course-participation.test.js`：8 项通过，0 失败、0 跳过。
- 严格 common 前缀/AppKey、缺失资源回执、源码详情路由/多选绑定和实际 iframe 行为均先观察到修复前失败，再通过修复。
- 已合入 integration `3865ab6`（合并提交 `e1b7fb3`）和更新后的 `6bd109c`（合并提交 `0749ef3`）。最终完整 `npm test`：143 项通过，0 失败、0 跳过；包含 TypeScript 构建。完整日志位于共享 notes 的 `issue13-integration-npm-test.log`。
- 首次合入后的全量测试发现 fixture origin 与 integration 新的 `baseUrl` 会话契约不一致；`26ed63b` 修复后，完整 132 项通过；再次合入最新 integration 后 143 项通过。生产默认 origin 仍为学校域名，受控测试的页面和 API 使用同一 loopback origin。
- 增加外层同名表单回归：fixture 按 Ego 文档优先定位 outer document，生产适配器在动作前拒绝可能截获 iframe 选择器的外层控件；不误填、不触发外层 change 副作用。

## 未验收与限制

- 本 worker 未访问真实浏览器或生产 API，未执行 GitHub 操作、推送或最终提交。仅运行 `ego-browser skill` 读取静态使用说明，所有 Ego 执行均指向本地受控 fixture 可执行文件。
- 真实 Ego 选择器/可见准备、学校登录态只读、明确授权的 API 写入、用户亲自最终提交和学校服务器回查仍由主 agent 集中验收；受控通过不能替代这些层次。
- Ego 当前角色选择控件缺失，日期只读选择器及已有人工冲突交给用户；不会伪造角色已选择。Ego 中断后的恢复步骤包含课程/报名 ID、题目和文件名；真实页面未暴露的资源 UUID 不凭空生成，保留可见上传状态供人工核对，不提供自动恢复/续交。
- 图片 API 直接上传已验证 MIME/大小的输入；生产图片控件自身另有压缩步骤，本 SDK 不声称复现图片压缩算法。撤销 GET 的服务端实际效果和所有生产业务结果仍未实测。
- #16/#17 已撤回，未实现课程认证。
