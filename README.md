# friends-cli

重庆大学第二课堂平台的本地 CLI 与可复用 SDK。SDK 提供共享业务契约；CLI 支持本地 API 与 Ego 会话查询、活动与认证准备、明确确认的 API 写入。Ego 写操作保留给用户审核并亲自最终提交。完整范围和验证层次见下文与 docs/verification。

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
friends course-offering prepare --input course-application.json --json
friends course-offering materials --input course-materials.json --via api --dry-run
friends course-offering materials --input course-materials.json --via api --confirm
friends course-offering next-step --input course-application.json --via api --confirm
friends course-offering submit --input course-application.json --via api --confirm
friends course-offering status <courseUuid> --json
friends course-offering prepare-ego --input course-application.json \
  --via ego --ego-task-space 16 --json
friends organizations list --json
friends organizations profile show <organizationUuid> --json
friends organizations members <organizationUuid> --page 1 --page-size 10 --json
friends organizations profile prepare <organizationUuid> \
  --via ego --ego-task-space 12 --ego-page p1 --blurb "新的组织简介" --json
friends volunteer-hours list --page 1 --page-size 10 --json
friends volunteer-hours show <transcriptUuid> --json
friends volunteer-certification-reviews list --via ego \
  --ego-task-space 16 --ego-page p1 --json
friends volunteer-certification-reviews show <reviewUuid> --json
friends volunteer-certification-reviews decide <reviewUuid> \
  --via api --decision pass --message "同意认证" --time 2026-10-22 --confirm --json
friends volunteer-certification-reviews prepare <reviewUuid> \
  --via ego --ego-task-space 16 --decision back --message "请补充材料" --json
friends drafts activities --via ego --ego-task-space 16 --ego-page p1 --json
friends drafts create --activity-id <activityUuid> --json
friends drafts edit <draftId> --expected-revision 0 --input patch.json --json
friends offerings prepare --input offering.json --via api --json
friends offerings materials --input offering.json --via api --dry-run --json
friends offerings materials --input offering.json --via api --confirm --json
friends offerings submit --input offering.json --via api --publicity-group-uuid <32-hex> --confirm --json
friends offerings status <offeringApplicationUuid> --via ego --ego-task-space 16 --json
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

const offering = await sdk.createCourseOfferingClient(session);
const prepared = await offering.prepare(application);
const staged = await offering.stageMaterials(prepared, files, {
  via: "api",
  intent: "stage-course-materials",
  confirm: true,
});

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

## 课程开办申请

以 [虚构输入示例](docs/examples/course-offering.json) 为结构参考，替换为当前账号、角色、身份单位、课程组织和字典代码。`prepare --input <file|->` 校验学校当前学年/学期、课程类型/级别与组织权限，并生成本地材料分组候选 UUID。它只查询来源数据，不创建学校申请；学校返回的学期编号保持原始类型。所有命令的输入、阶段和支持路径可通过 `friends schema course-offering.<command>` 查看。

`materials` 独立接受 `materials.files: [{"kind":"attachment","path":"/absolute/syllabus.pdf"},{"kind":"publicity","path":"/absolute/poster.png"}]`，其他命令拒绝这个字段。上传走 `POST /gateway/ek-agg-mob/biz-common/protected-file-upload`，AppKey 为 `zovecenter-saip-ek-agg-mob`，multipart 字段是 `files`、`groupId`。使用材料阶段返回的 `groups` 更新申请的 `materials` 后再执行下一阶段。海报与附件在公开课程表单源码中未启用必填校验，可分别准备；若声明已有组，写入前会回查该组。海报最多五张，文件格式与大小按课程上传组件检查。`--dry-run` 只校验并进行必要只读查询。

`next-step --via api --confirm` 新建时调用课程服务的 `POST apply/next-step`，已有 UUID 时调用 `PUT apply`；只保存第一步并返回课程 UUID，`finalSubmission:false`。将这个 UUID 放回申请的 `uuid`，再独立调用 `submit --via api --confirm`：复核身份、组织、材料和草稿/退回状态，调用 `POST apply/apply`，随后只读回查。不会自动从第一步续交。当前只支持空的问卷、岗位和院系/年级/学历限制数组；非空输入明确拒绝。`AUTO|MAN` 与签到设置独立校验；完整范围和限制见 [验收记录](docs/verification/2026-10-23-course-offering.md)。

上传、第一步保存或最终提交响应丢失时返回 `UNKNOWN_OUTCOME`（退出码 7）。`error.recovery` 保留可另存为申请 JSON 的 `input`、已确认上传项、待确认文件、材料组和已有课程 UUID；已知 UUID 或上传组只做只读回查。即使回查匹配仍保持未知，不重试、不继续下一写操作，也不跨 API/Ego 续交。首次创建丢失 UUID 时无法按 ID 回查，必须人工核实。确认提交后回查失败，也会保留 `serverAcknowledged:true` 并以未知结果停止。

`prepare-ego` 核验既有 Ego 页面中的账号、角色、路由和课程标识，只通过同源 iframe 内的可见控件准备名称、地址、介绍、类型、级别、组织和日期。既支持直接具名控件，也支持公开源码中的 Vant 标签、slot 和分行文本域；picker 等待选项选中及动画结束后才确认。已有人工值会保留，积分、认证设置、材料和下一页报名设置交给用户审阅；缺项及中途失败记录在 `missing`、`executionError` 中，然后 `handOff()`。`submitted:false`，不点“下一步/提交”，`--yes`、`--confirm` 无法绕过。dry-run 不导航、不录入、不点击、不交接。

`status <courseUuid> --via api|ego` 直接查询 `GET apply/approve-detail/{uuid}`；Ego 来源先核验登录上下文。只投影必要课程、组织与流程状态，未知枚举不解释为获批。材料上传、第一步保存、提交确认和开办批准是不同结果。本任务仅完成源码核对与受控 SDK/CLI/iframe 验证，真实 Ego 和生产写入尚未验收。

## 志愿认证草稿

`drafts create` 只读查询当前上下文可管理的志愿活动、活动详情和报名名单，然后绑定账号/角色/身份单位/活动创建本地草稿。草稿保存在仓库外专用目录，目录 `0700`、JSON `0600`，每次编辑通过临时文件和原子替换保存；过期 revision 的完整并发结果或 CLI patch 会保存为可恢复 conflict 文件。材料只记录本地路径、大小和 SHA-256，恢复时检查存在性与哈希；当前生产认证页面没有材料上传字段，包含材料的草稿不能通过正式完整校验。

草稿保存和恢复不调用志愿认证提交接口，也不上传材料。`drafts validate --mode complete` 只表示本地 payload 完整，不表示学校已接收或批准认证。

`drafts prepare <draftId> --via ego --ego-task-space 16 --ego-page p4 --ego-session-page p1` 通过既有学校页面核对身份，再核对活动、组织、岗位及人员。目标页必须已是对应认证页，或是明确选定的空白标签页；不会导航覆盖已有页面。只通过可见控件添加人员、选择岗位、填写小时和局部保存。人工新增选择或较新的时长会保留并提示审核；完成后交接并返回 `submitted:false`，最终“提交认证”由用户亲自点击。

`--dry-run` 仅验证和读取已有认证页，不导航、不点击、不交接。`drafts submit ... --via ego` 及 `--yes`、`--retry`、`--api-fallback` 都无法提交。遇到同名人员等无法从可见页面唯一确认的内容会明确列为待人工处理。

## 输出与错误

业务命令与 schema 输出为版本化 JSON；`auth login --method cqu-auth --no-open` 会先输出一行只含授权 URL 的 JSON 事件，完成后输出最终 JSON。`--help`/`--version` 使用普通文本，错误诊断写 stderr。退出码：0 成功，2 输入错误，3 认证失效，4 权限不足，5 业务拒绝/状态冲突，6 网络或协议错误，7 写入结果未知。HTTP 200 但 `code !== "0"` 不是成功；HTTP 非 2xx 即使业务码为 0 也不是成功。

## 验证边界

- `npm test`：TypeScript 构建、SDK 公开方法测试、真实 CLI 子进程测试、Node/Ego 桥安全测试、受控 OAuth/DPoP/学校 API 场景、macOS Keyring 与跨进程刷新锁测试。
- CQU Auth 生产 native/public client 尚未注册，线上真实 Auth 登录、同意、ST 核销和学校 API 验收由后续配置与主线程验收完成；仓库内受控 HTTP 服务通过不能替代这些生产验收。
- 课程接口和身份形状已按 2026-10-22 只读实测固化；接口资料中的历史 `verified` 不被当作当前生产验收。
- 本仓库测试使用虚构 HTTP/Ego 场景。学校登录与只读查询单独记录于 [验收记录](docs/verification/2026-10-22-local-courses.md)，CI 通过不代表生产写入能力。
- 课程开办的 SDK、真实 CLI 子进程和 strict Ego 脚本已用受控 HTTP/jsdom 场景验证；真实 Ego 页面、材料上传和最终开办写入尚未执行，不能宣称生产验收。
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

## 个人志愿时长与认证审批

`volunteer-hours` 查询学校成绩单分页和详情，时长按生产页面已核实的单位投影为小时；未知活动类型、状态和分页能力保留原值或 `null`，不把待审时长解释为已认定。`volunteer-certification-reviews` 先用学校返回的真实登录角色映射审批 `handleType`，角色不能由 CLI 参数指定或提升。

认证审批 API 决定只暴露生产页面可见的 `pass` 和 `back`。决定必须独立 `--via api`，并使用 `--confirm` 或 `--dry-run`；写入前会用当前学校会话重新核对账号、真实角色、待办列表、申请 UUID 和活动绑定，BACK 的回退节点只能来自学校 callback-list。请求确认和只读回查分开返回，写入响应丢失时即使回查匹配也保持 `UNKNOWN_OUTCOME`，不会重试。

Ego prepare 同样用已核验会话新建 review SDK client 并重新读取学校返回的账号、角色、待办申请和活动绑定，不信任 CLI 传入的角色或绑定。它会复用已打开的目标审批页；其他页面直接拒绝，只有调用者显式给出 `--allow-blank-navigation` 且当前页是 `about:blank` 时才导航。命令先取得页面快照再点击通过/打回；若审批意见已有非空人工输入则保留该值，只在空字段填入请求意见，然后输出 `submitted:false` 并交接页面。它不点击最终确认、不触发保存 PUT、不调用写入 API；BACK 的回退节点和最终提交由用户人工确认。

## 校内志愿活动开办申请

`offerings prepare` 会重新核验学校身份、志愿组织、活动类型/等级和当前学年学期，只构造公开源码核实过的第一页与报名字段。`SCHOOL_ACTIVITY` 先创建中间 UUID 再最终提交；`TEMP_ACTIVITY` 的 `next-step` 本身就是最终写入，并额外携带 `posts: []` 与 `nameList`。两类标识和输入不同，不能互换。

材料 JSON 引用本地文件，路径按输入文件目录解析（stdin 按 CLI 当前目录解析），也可以用 `name` 覆盖上传文件名：

```json
{"materials":{"publicityPictures":[{"path":"banner.png"}],"attachments":[{"path":"details.pdf","name":"虚构明细.pdf"}]}}
```

公开图片最多 5 张、每张 20 MiB，仅接受图片；附件最多 10 个，普通附件 20 MiB、视频 200 MiB。`offerings materials` 使用标准 `FormData` 上传到 protected upload 接口并逐组只读回查；部分失败时保留已完成资源和组 UUID，不重试、不清理。上传响应丢失时即使回查发现文件，也报告不确定，不宣称服务器已确认。

正式 API 提交必须独立 `--via api --confirm`，并传入材料阶段返回的 publicity/attachment 组 UUID；`--dry-run` 只重新校验与只读回查，不需要组 UUID。Ego 只支持可见 prepare：打开或复用对应开办页，可见填写文本、数字、日期和包装层选择器，保留人工已有值，不上传材料、不点击“下一步”或“提交申请”，交接后返回 `submitted:false`。`offerings submit --via ego` 在副作用前拒绝。进度查询可从 API 或 Ego 会话直接调用同一个只读详情接口，未知学校流程字段原样保留。

`UNKNOWN_OUTCOME`（退出码 7）表示学校可能已接受请求；结果中会保留已发生的组 UUID、中间申请 UUID（若已取得）和只读回查状态，调用者必须先查 manager/status，不得自动重试或跨 API/Ego 续交。

## 学生组织

组织查询先通过生产前端已核实的 `POST /student-organization-info/my` 获取当前账号上下文返回的组织，再按返回对象推导 `principal`、`manager` 或 `member`。成员列表只调用已核实的 `organizational-members-list`，请求固定绑定 `organizationId` 和在岗状态，输出仅投影学号、姓名、职务与负责人/管理员标志，不透传学校返回的其他字段。

组织资料只接受 `logo`、`backgroundGroupUuid` 和 `blurb` 三个源码核实字段。API 保存必须同时显式 `--via api` 和 `--yes`；Ego prepare 不产生任何写入授权。写入前会重新核验同一账号和身份、刷新组织权限、读取学校完整详情，克隆后仅覆盖这三个字段，执行一次 PUT，再用只读 GET 回查。PUT 响应丢失时即使回查值匹配也保留 `UNKNOWN_OUTCOME`（退出码 7）；学校已确认但回查不可用时同样返回不可重试的 `UNKNOWN_OUTCOME`。命令不会重试 PUT。

```json
{"blurb":"新的组织简介","logo":"logo-reference","backgroundGroupUuid":"background-reference"}
```

Ego 资料修改只执行可见 prepare：先经现有页面会话核验权限，再检查当前路由；若目标组织编辑页已经打开则不重新导航。命令先取得页面快照，再从快照引用打开“组织简介及Logo”维护弹窗；若简介已有非空人工输入，会保留该值而不覆盖，只在空字段中填入请求的简介，随后把页面交接给用户。Logo 和背景图上传控件保留在页面上由用户人工处理；命令不点击最终保存、不调用 PUT，也不会把 `--yes` 用于 Ego prepare。

## 捕获人工修改

用户明确交还 Ego 控制后执行：

```sh
friends drafts capture <draftId> --via ego --ego-task-space 16 \
  --ego-page p3 --expected-revision 1 --user-returned-control
```

命令重新核验当前身份、组织和活动，通过可见编辑弹窗只读核对学号、岗位及小时，保存本地新修订。它不会点击弹窗“保存”、上传或提交认证。过期修订保留冲突文件；未完成输入、页面缺失人员和不可恢复材料会列出待处理项。未捕获的网页修改不保证在关闭浏览器后保留。

按需要用 `drafts edit` 明确修改选择和时长，再单独 `drafts prepare` 恢复录入。用户最终提交后只用 `certification status` 查询。详见[捕获验收](docs/verification/2026-10-22-certification-capture.md)。

志愿活动开办和报名审批是两个独立对象，用 `--type` 明确选择。查询可以使用 API 或当前 Ego 会话：

```sh
friends volunteer activity-reviews list --type registration --via ego --ego-task-space 16 --ego-page p3
friends volunteer activity-reviews show <申请UUID> --type offering
friends volunteer activity-reviews prepare <申请UUID> --type offering --decision pass --via ego --ego-task-space 16 --input review.json
friends volunteer activity-reviews decide <申请UUID> --type offering --decision pass --via api --input review.json --dry-run
```

`review.json` 含 `message`、`time`（YYYY-MM-DD）；开办审批还需 `isSafeEducation: 0|1`，打回多个节点时需 `callbackActivityId`。API 实际决定须显式 `--yes`；Ego 仅准备并交接，用户亲自点最终确定。响应不确定返回 exit 7，不会自动重试。见 [#11 验收记录](docs/verification/2026-10-22-volunteer-activity-reviews.md)。


## 组织活动开办与报名审批（#20）

`createOrganizationActivityReviewClient({ session })` 的 `offering` 与 `registration` 分别提供 `list/get/prepare/decide/verify`。操作既有学校申请，不要求由本工具创建活动。开办输入必须指定组织与开办申请 UUID；报名另需活动 UUID，报名 UUID 不能代替活动 UUID。

```sh
friends organization-activities offering-reviews list --organization <组织UUID>
friends organization-activities registration-reviews show <报名UUID> --organization <组织UUID> --activity <活动UUID>
friends organization-activities offering-reviews decide <开办申请UUID> --organization <组织UUID> --decision pass --input review.json --via api --dry-run
friends organization-activities registration-reviews prepare <报名UUID> --organization <组织UUID> --activity <活动UUID> --decision refuse --input review.json --via ego --ego-task-space 8 --ego-page p2
friends organization-activities registration-reviews verify <报名UUID> --organization <组织UUID> --activity <活动UUID> --via ego --ego-task-space 8 --ego-page p2
```

`review.json`（或 `--input -` 的 stdin JSON）只含 `message`（1–100 字）和 `time`（YYYY-MM-DD）。开办允许 `pass/back/refuse`，打回和拒绝可附 `callbackActivityId`，且必须匹配学校当前首个退回节点；报名只允许 `pass/refuse`。未支持字段和日期、空意见均拒绝。

API 真正执行必须同时显式指定 `--via api --yes`。开办通过按学校源码先保存现有活动资料，再审批；预览会列出 `saveBeforeApproval`，不会执行这两步。每次执行前重新核对学校身份、组织权限、活动/申请绑定和待办；准备结果是一次性执行计划。API 响应丢失或超时保留 `UNKNOWN_OUTCOME`/退出码 7，即使随后只读回查已不在待办中也不改判、不重试、不继续下一次写入。恢复信息保留申请/组织/活动标识及已确认的部分步骤。

Ego 查询使用刚核对的现有会话直接读 API；写操作仅打开源页面的审批弹窗、填入空意见，保留已有人工输入并交接。日期不同会列为人工处理字段。用户亲自点击最终“确定”，然后用 `verify` 只读核对；`prepare --yes` 和 `decide --via ego` 均拒绝。Ego `--dry-run` 不点击、不填表。

`readback: matched` 仅表示学校已确认请求且申请不再位于当前角色的待办，`decisionVerified: false` 不把源码尚未确认的流程记录字段解释成最终通过/拒绝证明。详情见 [#20 验证记录](docs/verification/2026-10-23-organization-activity-reviews.md)。

## 课程开办与报名审批

`courses reviews` 分别处理学校已有的开办申请和报名申请，无需先用本工具创建课程。`show` 返回待办归属和当前可用决定：开办为 `pass/back/refuse`，报名为 `pass/refuse`。审批 UUID 必须属于选定 `--type`；报名另外绑定课程 UUID 与学生。

```sh
friends courses reviews list --type offering --via api
friends courses reviews show <报名申请UUID> --type registration --via ego --ego-task-space 16
friends courses reviews decide <开办申请UUID> --type offering --decision pass --via api --input review.json --dry-run
friends courses reviews decide <开办申请UUID> --type offering --decision pass --via api --input review.json --yes
friends courses reviews prepare <报名申请UUID> --type registration --decision refuse --via ego --ego-task-space 16 --input review.json
```

`review.json` 只接受 `{"message":"审批意见","time":"2026-10-23"}`，也可用 `--input -` 从 stdin 读取。API 实际执行必须显式 `--via api --yes`，执行前刷新身份、待办和详情；`--dry-run` 只读。Ego 查询直接使用核验后的学校 API；Ego 写入只准备可见对话框并保留人工现值，交接后 `submitted:false`，用户亲自最终确定，`--yes` 无法绕过。返回 `UNKNOWN_OUTCOME`（exit 7）时即使回查匹配也不能自动重交；先用 `show` 只读检查。详情见 [#15 验收记录](docs/verification/2026-10-23-course-reviews.md)。
