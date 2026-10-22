# friends-cli

重庆大学第二课堂平台的本地 CLI 与可复用 SDK。当前交付 Issue #2–#3 的最小只读课程链、Issue #4 的 CQU Auth OAuth/DPoP 登录与恢复、Issue #5 的志愿认证本地草稿、Issue #21 的学生组织查询、成员查询与组织资料受控维护，以及 Issue #22 的组织加入/退出申请审批：Ego 浏览器本地登录、学校 API 身份/上下文核验、课程查询、可管理志愿活动/报名名单只读查询、草稿编辑与恢复、组织/资料/成员查询、加入/退出申请查询与受控决定。不包含组织活动报名、成员直接写入、部门维护或学校认证提交。

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
friends organizations list --json
friends organizations profile show <organizationUuid> --json
friends organizations members <organizationUuid> --page 1 --page-size 10 --json
friends organizations profile prepare <organizationUuid> \
  --via ego --ego-task-space 12 --ego-page p1 --blurb "新的组织简介" --json
friends organizations approvals list <organizationUuid> --type join --json
friends organizations approvals show <applicationUuid> --type join --json
friends organizations approvals prepare <organizationUuid> <applicationUuid> \
  --type join --decision approve --via ego --ego-task-space 12 --ego-page p1 \
  --message "同意加入" --time 2026-10-22 --json
friends organizations approvals decide <organizationUuid> <applicationUuid> \
  --type join --decision approve --via api --dry-run --json
friends organizations approvals decide <organizationUuid> <applicationUuid> \
  --type join --decision approve --via api --yes --message "同意加入" \
  --time 2026-10-22 --json
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

## 志愿认证草稿

`drafts create` 只读查询当前上下文可管理的志愿活动、活动详情和报名名单，然后绑定账号/角色/身份单位/活动创建本地草稿。草稿保存在仓库外专用目录，目录 `0700`、JSON `0600`，每次编辑通过临时文件和原子替换保存；过期 revision 的完整并发结果或 CLI patch 会保存为可恢复 conflict 文件。材料只记录本地路径、大小和 SHA-256，恢复时检查存在性与哈希；当前生产认证页面没有材料上传字段，包含材料的草稿不能通过正式完整校验。

草稿保存和恢复不调用志愿认证提交接口，也不上传材料。`drafts validate --mode complete` 只表示本地 payload 完整，不表示学校已接收或批准认证。

## 输出与错误

业务命令与 schema 输出为版本化 JSON；`auth login --method cqu-auth --no-open` 会先输出一行只含授权 URL 的 JSON 事件，完成后输出最终 JSON。`--help`/`--version` 使用普通文本，错误诊断写 stderr。退出码：0 成功，2 输入错误，3 认证失效，4 权限不足，5 业务拒绝/状态冲突，6 网络或协议错误，7 写入结果不确定且禁止自动重试。HTTP 200 但 `code !== "0"` 不是成功；HTTP 非 2xx 即使业务码为 0 也不是成功。

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

加入/退出申请查询分别调用生产前端已核实的 `POST /student-organization-apply/approve-list`：加入使用 `applyType: 1`，退出使用 `applyType: 0`，并绑定已验证组织 UUID。输出仅投影申请 UUID、组织 UUID、学号、姓名和当前流程消息。详情先调用 `GET /student-organization-apply/{uuid}`，要求返回的组织与学生标识存在，再按所选加入/退出列表分页核验申请类型，最后用 `organizationId + studentNo` 只读查询当前成员关系。普通成员上下文不能读取或审批申请。

申请决定只允许 `approve -> AGREEMENT` 和 `reject -> ADJUSTMENT`；生产页面可见的 `REJECTION`（打回）未纳入本任务公开契约。决定输入只接受不超过 100 字符的 `message` 和 `yyyy-MM-dd` 的 `time`。准备阶段会重新核验身份、刷新可管理组织、读取学校完整申请详情、确认组织归属、确认指定类型仍处于唯一“等待”流程状态，并读取当前关系；这些检查都不写入。API 决定必须独立给出 `--via api` 和 `--yes`，提交 exact payload `{identified,msg,handleType:"XS02",studentOrganizationInfoApproveAddReqDto:{...学校详情,uuid:申请UUID},time,uuid}`，执行一次 POST 后只读回查待办与关系，不重试 POST。POST 响应丢失时即使待办已消失也保留不可重试的 `UNKNOWN_OUTCOME`（退出码 7）并报告 readback 证据；学校已确认但回查失败同样是不可重试的 `UNKNOWN_OUTCOME`，已确认但申请仍在待办中则返回业务拒绝。

Ego 审批准备只执行可见步骤：先检查当前路由和可见非空人工输入，必要时才导航到对应加入/退出详情页；取得全页快照后用快照引用打开“通过”或“拒绝”弹窗，核验弹窗标题，并只填写空的审批意见。若意见已有相同值则保留，已有不同人工值则原样保留；日期留给用户复核，不替用户修改。随后命令把页面交接给用户，不点击“确认”，不调用审批 POST，`--yes` 会被拒绝。当前仓库只完成虚构 HTTP 与 strict DOM fixture 验收；真实 Ego、学校登录态只读查询、明确授权的 API 写入和用户人工提交未在本任务中执行。
