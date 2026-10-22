# CQU Auth 原生登录验收（2026-10-22）

- 生产管理 API 创建 Friends CLI 原生 public client，`token_endpoint_auth_method=none`、`require_pkce=true`、`dpop_bound_access_tokens=true`。允许 `authorization_code` 和 `refresh_token`，回调 `http://127.0.0.1/callback`。
- 客户端公开 ID：`vhGxmjUdQnumYSvOeNjrcmILobbDpncq`。仅授予 `cqu:ticket:friends offline_access`；独立 CQU 服务权限仅为 `cqu:ticket:friends`。
- 通过现有 Ego 登录态读取公开 discovery：HTTP 200，issuer 为 `https://auth.cqu.moe/api/auth`，authorize/token 地址位于 `/api/v1/auth/oauth2/`。
- 实际 Node CLI 请求 `/api/auth/.well-known/openid-configuration` 返回 HTTP 403、`content-type: text/html`、`cf-mitigated: challenge`。因此生产原生授权、令牌交换、refresh、服务票据与学校登录尚未验收；没有浏览器凭据转发、静默换登录方式或降低 DPoP。
- CLI 对浏览器挑战现在返回 `NETWORK_PROTOCOL_ERROR` / exit 6，说明需要 Auth 运维允许原生 OAuth 请求；不再误报 issuer 不匹配或建议 local 登录。受控 SDK 与真实 CLI 回归覆盖该错误、HTTP 503 和非 JSON 元数据，不公开原始响应内容。
- 全套本地 SDK、真实 CLI、打包和受控浏览器测试：73 项通过。受控协议测试验证 S256、DPoP 签名、nonce、refresh 轮换和单次票据；这些不等于生产链路通过。
