# friends-cli

重庆大学第二课堂平台的本地 CLI 与可复用 SDK。当前交付 Issue #2 的最小只读课程链：Ego 浏览器本地登录、学校 API 身份/上下文核验、课程列表、关键词搜索、分页和详情。不包含 OAuth、报名、认证、审批或任何业务写入。

## 安装与命令

```sh
npm ci
npm run build
npm install -g .
friends --help
friends schema courses.list --json
```

默认登录会创建并复用 Ego 自己的 `friends-cli local login` task space；需要用户在浏览器完成学校登录时会把页面交给用户，取回控制后继续，成功后关闭自管 space。不要默认复用其他任务空间。只有在明确要复用已有自有空间时才传入数字 ID：

```sh
friends auth login --method local --json
friends auth login --method local \
  --ego-task-space 12 --ego-page p1 \
  --storage file --json
friends auth status --json
friends courses list --page 1 --page-size 10 --keyword 周周艺 --json
friends courses show <courseUuid> --json
```

多身份/多单位时，命令会列出学校返回的 `levelNo/unitNo`，用 `--level-no` 与 `--unit-no` 显式选择。课程 UUID 只用于课程详情，不能替换报名记录、认证申请或其他领域 UUID。

## 凭据与会话

默认使用系统凭据库：macOS Keychain；Linux 固定要求 Secret Service，不在失败时静默退到重启即丢失的 keyutils。会话元数据保存在仓库外 `~/.local/state/friends-cli/session.json`，目录 `0700`、文件 `0600`；Keychain 模式的元数据不含 token。

`--storage file` 是显式后备，适合隔离验收。它同样要求仓库外专用目录和权限，可配合 `FRIENDS_HOME` 指定独立目录。token 不进入 argv、日志、schema、`auth status` 或命令结果 JSON。

## SDK

```ts
import { createFriendsSdk } from "@cqu-moe/friends-cli";
import { readEgoSession } from "@cqu-moe/friends-cli/node";

const sdk = createFriendsSdk();
const browser = await readEgoSession();
const activated = await sdk.activateLocalContext(browser);
const courses = await sdk.createCourseClient({
  ...browser,
  userLevel: activated.context.levelNo,
  account: activated.account,
  context: activated.context,
});
await courses.list({ keyword: "周周艺" });
```

普通 SDK 根导入不加载 Ego、文件系统或凭据库；这些 Node 集成从 `@cqu-moe/friends-cli/node` 按需加载。课程 client 每次创建都会重新调用学校身份接口，核对账号、等级和身份单位后才查询课程。

课程列表使用实测的 `student-apply-page-list` 与 `key` 参数，不使用历史聚合接口的 `type: CURRICULUM` 过滤。详情只投影课程资料、报名限制和必要状态；未知状态保留原值并标记 `known: false`。

## 输出与错误

成功输出为一个版本化 JSON 文档，业务日志和错误诊断写 stderr。退出码：0 成功，2 输入错误，3 认证失效，4 权限不足，5 业务拒绝/状态冲突，6 网络或协议错误。HTTP 200 但 `code !== "0"` 不是成功；HTTP 非 2xx 即使命码为 0 也不是成功。

## 验证边界

- `npm test`：TypeScript 构建、SDK 公开方法测试、真实 CLI 子进程测试、Node/Ego 桥安全测试。
- 课程接口和身份形状已按 2026-10-22 只读实测固化；接口资料中的历史 `verified` 不被当作当前生产验收。
- 本仓库测试使用虚构 HTTP/Ego 场景。真实学校登录、Ego 成品复验和真实只读课程查询须单独执行并记录，CI 通过不代表生产写入能力。
