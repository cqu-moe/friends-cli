# friends-cli

重庆大学第二课堂平台的本地 CLI 与可复用 SDK。当前交付 Issue #2–#3 的最小只读课程链、Issue #4 的 CQU Auth OAuth/DPoP 登录与恢复、Issue #5 的志愿认证草稿与 #6 的可见 Ego 准备、Issue #13 的个人课程报名管理，以及 Issue #21 的学生组织查询、成员查询与组织资料受控维护：Ego 浏览器本地登录、学校 API 身份/上下文核验、课程与个人报名记录查询、课程报名/撤销/退出的显式 API 操作与人工 Ego 准备、可管理志愿活动/报名名单只读查询、志愿认证草稿/准备/API 提交、草稿编辑与恢复、组织/资料/成员查询。不包含组织活动报名、审批、成员写入、部门维护或课程认证提交。

## 安装与命令

```sh
npm ci
npm run build
npm install -g .
friends --help
friends schema courses.list --json
friends schema errors --json
```

默认登录会创建并复用 Ego 自己的 `friends-cli local login` task space；需要用户在浏览器完成学校登录时会把页面交给用户，取回控制后继续，成功后关闭自管 space。不要默认复用其他任务空间。只有在明确要复用已有自有空间时才传入数字 ID：

```sh
friends auth login --method local --json
friends auth login --method local \
  --ego-task-space 12 --ego-page p1 \
  --storage file --json
friends auth status --json
friends auth login --method cqu-auth \
  --issuer https://auth.cqu.moe/api/auth \
  --client-id <public-client-id> --json
friends auth login --method cqu-auth --no-open --storage file --json
friends courses list --page 1 --page-size 10 --keyword 周周艺 --json
friends courses show <courseUuid> --json
friends courses list --via ego --ego-task-space 12 --ego-page p1 --json
friends courses registrations list --page 1 --page-size 10 --keyword 周周艺 --json
friends courses registrations show <registrationUuid> --json
friends courses registrations apply <courseUuid> --dry-run --json
friends courses registrations apply <courseUuid> --via api --confirm apply --json
friends courses registrations withdraw <registrationUuid> --via api --confirm withdraw --json
friends courses registrations exit <registrationUuid> --via api --confirm exit --json
friends courses registrations apply <courseUuid> --via ego --ego-task-space 12 --ego-page p1 --confirm apply --json
friends organizations list --json
friends organizations profile show <organizationUuid> --json
friends organizations members <organizationUuid> --page 1 --page-size 10 --json
friends organizations profile prepare <organizationUuid> \
  --via ego --ego-task-space 12 --ego-page p1 --blurb "新的组织简介" --json
friends drafts activities --via ego --ego-task-space 16 --ego-page p1 --json
friends drafts create --activity-id <activityUuid> --json
friends drafts edit <draftId> --expected-revision 0 --input patch.json --json
```

多身份/多单位时，命令要求同时提供 `--level-no` 与 `--unit-no`，不会默认选择第一项。课程 UUID 只用于课程详情，不能替换报名记录、认证申请或其他领域 UUID。

查询默认 `--via api`，只读取已保存的本地会话并直接调用学校 API；不传 `--via` 的旧调用保持原行为。`--via ego` 必须显式给出已有数字 task space，页标签默认 `p1`；它会复用当前 Ego 页面读取会话，先通过学校 API 独立核对账号和身份单位，再用同一 SDK client 直接调用课程 API。该路径不读取或改写本地保存的 token，也不为只读查询导航、点击或模拟人工浏览。输出中的 `meta.selectedEntry`、`meta.requestMode` 和 `meta.verification` 分别记录用户选择执行方式、实际请求方式与已核对上下文。登录来源仍由 `auth login --method local|cqu-auth` 表达，不与执行方式混用。

## 凭据与会话

默认使用系统凭据库：macOS Keychain；Linux 固定要求 Secret Service，不在失败时静默退到重启即丢失的 keyutils。会话元数据保存在仓库外 `~/.local/state/friends-cli/session.json`，目录 `0700`、文件 `0600`；Keychain 模式的元数据不含 token。

CQU Auth 登录使用 native public client（`token_endpoint_auth_method: none`）、授权码 + S256 PKCE、固定回环 `http://127.0.0.1:<port>/callback`、`state` 关联和 DPoP。最小 scope 是 `cqu:ticket:friends offline_access`；`offline_access` 用于刷新，不申请其他取票权限。授权码、state、verifier、DPoP key、Auth access/refresh token、一次性 CAS ST 和二课 token 都不进入 argv、日志、schema、`auth status` 或命令结果 JSON。`--no-open` 输出的唯一授权 URL 是例外，它不包含 code/state/verifier/key/token。

Auth OAuth 凭据与 DPoP key 保存在 `cqu-auth-state.json` 对应的安全边界中；文件模式同样是目录 `0700`、文件 `0600`，Keyring 模式元数据只保存 issuer/client/JKT 标识。二课 token 仍独立保存在 `session.json`/会话凭据库。刷新轮换使用同一 DPoP key、跨进程文件锁串行保存；旧 refresh 重放、错误 DPoP key、密钥缺失和非 DPoP token 都失败关闭，要求重新授权，不生成替代 key，也不回退 Bearer 或本地登录。

`--storage file` 是显式后备，仅支持可执行 POSIX 目录/文件权限检查的平台（macOS/Linux）；Windows 文件后备不受支持。它同样要求仓库外专用目录和权限，可配合 `FRIENDS_HOME` 指定独立目录。

## SDK

```ts
import { createFriendsSdk } from "@cqu-moe/friends-cli";
import { readVerifiedEgoSession } from "@cqu-moe/friends-cli/node";
import { createCquAuthClient, generateCquDpopKeyPair } from "@cqu-moe/friends-cli/auth";
import { startCquAuthLoopback, loadCquAuthManager } from "@cqu-moe/friends-cli/auth-node";

const sdk = createFriendsSdk();
const session = await readVerifiedEgoSession({ taskSpaceId: 12, page: "p1" });
const courses = await sdk.createCourseClient(session);
await courses.list({ keyword: "周周艺" });

const organizationClient = await sdk.createOrganizationClient(session);
const organizations = await organizationClient.listManaged();
const profile = await organizationClient.get(organizationId(organizations[0].id));
const members = await organizationClient.listMembers(organizationId(organizations[0].id), {
  page: 1,
  pageSize: 10,
});
```

`@cqu-moe/friends-cli/auth` 是纯 SDK OAuth/DPoP 客户端，正式依赖 `oauth4webapi@3.8.8`：`None()` public client、S256 PKCE、`DPoP` proof/nonce 管理、同 key refresh 与 protected resource 请求均由该库实现；本仓库不手写密码学或协议签名。`@cqu-moe/friends-cli/auth-node` 只增加本机回调监听、浏览器打开和凭据存储。Better Auth 仍是 CQU Auth 授权服务器；不能声称 Better Auth 客户端自带这些 DPoP proof 能力。

`readVerifiedEgoSession` 复用既有 Ego bridge，并返回 `{ token, userLevel, account, context }`；其中 `context` 是学校 API 返回并经 `enterHall` 核对的完整 `levelNo/levelName/unit`。调用者可传 `baseUrl`、`selector`、`timeoutMs` 或受控 `command`，但该函数不包含任何课程业务。

普通 SDK 根导入不加载 Ego、文件系统或凭据库；这些 Node 集成从 `@cqu-moe/friends-cli/node` 按需加载。同一 SDK 实例拒绝将同一学校 token 同时绑定到不同身份单位/角色；跨客户端需要各自的学校会话，不能把服务器会话当作可并发切换的全局状态。课程 client 绑定学校返回的账号、角色和身份单位；身份单位不是学生组织 UUID，不能据此推断组织管理权限。恢复时重新核对学校身份。

课程列表使用实测的 `student-apply-page-list` 与 `key` 参数，不使用历史聚合接口的 `type: CURRICULUM` 过滤。详情只投影课程资料、报名限制和必要状态；未知状态保留标量原值并标记 `known: false`。详情保留岗位名称、积分与学时；非空问卷仅报告数量和 `unverified`，尚未解析其内容，不能据此宣称已展示全部报名要求。

## 课程报名与个人记录

`createCourseParticipationClient` 绑定已核验的学校账号/角色/身份单位。个人记录只通过 `apply/my-applied-page-list` 分页读取，并用课程内 `studentApplied` 投影报名记录 UUID 与学校返回的审批状态；未知审批状态保留原始标量和 `known: false`，不把课程开办状态映射成报名审批结果。

报名前 `inspectApply` 读取 `apply/approve-detail/{courseId}`，返回学校课程状态、角色和问卷定义。`prepareApply` 验证输入并生成 `student-apply/apply` payload，返回 `submitted:false`，不上传附件。CLI 用 `--input <file|->` 提供 `{ "questionnaire": [...] }`；单选、多选、文本、数字和日期分别使用 `choiceOptionId`、`choiceOptionIds` 或 `text`。题目和选项 ID 必须来自当前学校详情，选答题可省略。API 报名若存在角色，必须显式选择学校返回的 `roleId`，不会默认唯一角色或猜测名称、学时、积分。

图片与附件题 `PICTURE/MULTIPLE_PICTURE/FILE/MULTIPLE_FILE` 使用 `{ "questionId": "...", "attachments": [{ "path": "/absolute/path/proof.pdf", "mimeType": "application/pdf" }] }`。普通 SDK 对应传入 `{content: Blob, filename?}`；Ego 文件选择保留本地文件名，改名只支持 API 路径。图片接受 PNG/JPG/JPEG/GIF/BMP，文件接受 PDF，单文件不超过 20 MiB；单图/单文件题只接受一个文件。显式 API 写入通过 `/gateway/ek-agg-mob/biz-common/protected-file-upload` 上传，AppKey 为 `zovecenter-saip-ek-agg-mob`，每题使用独立分组，再生成报名答案。分组回查失败不会否认已收到的确定上传回执；缺少资源 UUID、响应丢失或分组不匹配则立即停止，保留 `UNKNOWN_OUTCOME` 及已知资源/分组 ID，不继续上传、报名、删除或重试。dry-run 不产生上传，也不调用副作用未知的 `student-apply/can-apply/{courseId}`。

API 写入要求 `--via api` 和字面确认：报名 `--confirm apply`、撤销 `--confirm withdraw`、退出 `--confirm exit`。学校前端把 `GET student-apply/{registrationId}` 用作确认后的撤销动作，所以它被标为业务写入，个人记录详情只通过列表定位。读取及每次写入前重新核对账号、角色和身份单位。确定的业务拒绝保留上游码及已完成上传；响应丢失返回退出码 7 / `UNKNOWN_OUTCOME`，即使只读回查匹配也不转成成功或自动续交。

查询和 dry-run 支持 `--via api|ego`。正式 `--via ego --ego-task-space ... --ego-page ...` 只准备可见表单/确认层，然后交接，返回 `submitted:false`、`status:"awaiting-user"` 和 `finalSubmissionBy:"human"`。Node SDK 的 `prepareCourseRegistrationInEgo` 必须传入学校 session，并独立重新核对学校状态和页面绑定。目标必须是正确课程页或明确选定的空白页；不导航覆盖已有编辑。问卷只通过当前同源 iframe 中的可见控件填入空值，已有人工值和附件保留。附件选择会触发学校控件上传，属于有副作用的准备阶段；中断后保留可见页面和完成/尝试步骤，立即停止。

当前公开源码的角色选择块被注释，因此 Ego 校验所选角色并列为人工核对事项，不注入隐藏模型；日期等只读选择器也交给用户。撤销/退出只打开与当前个人记录唯一匹配的确认层。最终按钮、提交 API、快捷键和 `--yes` 都不能代替用户亲自提交。上述路径通过源码与受控 SDK/CLI/DOM 测试，真实 Ego、学校生产读写及用户最终提交由集中验收另行确认。

## 志愿认证草稿

`drafts create` 只读查询当前上下文可管理的志愿活动、活动详情和报名名单，然后绑定账号/角色/身份单位/活动创建本地草稿。草稿保存在仓库外专用目录，目录 `0700`、JSON `0600`，每次编辑通过临时文件和原子替换保存；过期 revision 的完整并发结果或 CLI patch 会保存为可恢复 conflict 文件。材料只记录本地路径、大小和 SHA-256，恢复时检查存在性与哈希；当前生产认证页面没有材料上传字段，包含材料的草稿不能通过正式完整校验。

草稿保存和恢复不调用志愿认证提交接口，也不上传材料。`drafts validate --mode complete` 只表示本地 payload 完整，不表示学校已接收或批准认证。

`drafts prepare <draftId> --via ego --ego-task-space 16 --ego-page p4 --ego-session-page p1` 通过既有学校页面核对身份，再核对活动、组织、岗位及人员。目标页必须已是对应认证页，或是明确选定的空白标签页；不会导航覆盖已有页面。只通过可见控件添加人员、选择岗位、填写小时和局部保存。人工新增选择或较新的时长会保留并提示审核；完成后交接并返回 `submitted:false`，最终“提交认证”由用户亲自点击。

`--dry-run` 仅验证和读取已有认证页，不导航、不点击、不交接。`drafts submit ... --via ego` 及 `--yes`、`--retry`、`--api-fallback` 都无法提交。遇到同名人员等无法从可见页面唯一确认的内容会明确列为待人工处理。

## 输出与错误

业务命令与 schema 输出为版本化 JSON；`auth login --method cqu-auth --no-open` 会先输出一行只含授权 URL 的 JSON 事件，完成后输出最终 JSON。`--help`/`--version` 使用普通文本，错误诊断写 stderr。退出码：0 成功，2 输入错误，3 认证失效，4 权限不足，5 业务拒绝/状态冲突，6 网络或协议错误。HTTP 200 但 `code !== "0"` 不是成功；HTTP 非 2xx 即使业务码为 0 也不是成功。

## 验证边界

- `npm test`：TypeScript 构建、SDK 公开方法测试、真实 CLI 子进程测试、Node/Ego 桥安全测试、受控 OAuth/DPoP/学校 API 场景、macOS Keyring 与跨进程刷新锁测试。
- CQU Auth 生产 native/public client 尚未注册，线上真实 Auth 登录、同意、ST 核销和学校 API 验收由后续配置与主线程验收完成；仓库内受控 HTTP 服务通过不能替代这些生产验收。
- 课程接口和身份形状已按 2026-10-22 只读实测固化；接口资料中的历史 `verified` 不被当作当前生产验收。
- 本仓库测试使用虚构 HTTP/Ego 场景。学校登录与只读查询单独记录于 [验收记录](docs/verification/2026-10-22-local-courses.md)，CI 通过不代表生产写入能力。
- 查询类操作可使用 API；后续 Ego 写操作按阶段执行，需要审阅的表单只录入并交接，由用户亲自最终提交。
- Ego 查询的受控 SDK/CLI 验收见 [Ego 课程查询验收](docs/verification/2026-10-22-ego-course-query.md)；真实已安装 Ego 与学校登录态实测由集中操作另行记录，不能由本仓库受控测试替代。

志愿草稿可用 `friends drafts edit <id> --expected-revision <n> --input patch.json` 增补尚未报名的人员：

```json
{"addStudentNos":["20210002"],"includedStudentNos":["20210002"],"postIds":{"20210002":"post-id-from-school"},"durations":{"20210002":1.5}}
```

新增人员先通过当前学校会话只读核对姓名和草稿账号/组织/活动绑定，再保存在本地。`includedStudentNos` 始终是本次指定名单，不隐含全部认证。普通编辑和材料检查可以离线使用；新增学号需要可用学校会话。没有报名 UUID 的手动人员保留这一事实，不伪造报名记录。

课程与草稿的学校查询共用 `--via api|ego`：Ego 模式直接核验现有页面会话后调用查询 API，不导航或读取本地会话。新增学号的草稿编辑也支持同样的来源选项。

## 志愿认证 API 提交

志愿认证 API 提交必须独立明确选择，Ego 交接不产生提交授权：

```sh
friends certification submit <draftId> --via api --dry-run
friends certification submit <draftId> --via api --confirm
friends certification submit --input draft.json --via api --confirm
friends certification status <activityId> --via ego --ego-task-space 16
```

`--input -` 读取 stdin 导出的草稿。当前认证表单没有附件入口，带材料的草稿会在写入前拒绝。`UNKNOWN_OUTCOME`（退出码 7）时保留草稿，先用 `certification status` 回查，不自动重交。业务确认与回查结果分别返回；已有认证不会被这个新建命令覆盖。

## 学生组织

组织查询先通过生产前端已核实的 `POST /student-organization-info/my` 获取当前账号上下文返回的组织，再按返回对象推导 `principal`、`manager` 或 `member`。成员列表只调用已核实的 `organizational-members-list`，请求固定绑定 `organizationId` 和在岗状态，输出仅投影学号、姓名、职务与负责人/管理员标志，不透传学校返回的其他字段。

组织资料只接受 `logo`、`backgroundGroupUuid` 和 `blurb` 三个源码核实字段。API 保存必须同时显式 `--via api` 和 `--yes`；Ego prepare 不产生任何写入授权。写入前会重新核验同一账号和身份、刷新组织权限、读取学校完整详情，克隆后仅覆盖这三个字段，执行一次 PUT，再用只读 GET 回查。PUT 响应丢失时即使回查值匹配也保留 `UNKNOWN_OUTCOME`（退出码 7）；学校已确认但回查不可用时同样返回不可重试的 `UNKNOWN_OUTCOME`。命令不会重试 PUT。

```json
{"blurb":"新的组织简介","logo":"logo-reference","backgroundGroupUuid":"background-reference"}
```

Ego 资料修改只执行可见 prepare：先经现有页面会话核验权限，再检查当前路由；若目标组织编辑页已经打开则不重新导航。命令先取得页面快照，再从快照引用打开“组织简介及Logo”维护弹窗；若简介已有非空人工输入，会保留该值而不覆盖，只在空字段中填入请求的简介，随后把页面交接给用户。Logo 和背景图上传控件保留在页面上由用户人工处理；命令不点击最终保存、不调用 PUT，也不会把 `--yes` 用于 Ego prepare。
