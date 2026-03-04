# AuthN Token Validation Contract

> Owner Domain: `K-AUTHN-*`

## K-AUTHN-001 Bearer token 输入模型

- gRPC metadata 认证头键固定为 `authorization`（HTTP `Authorization` 在 gRPC 层归一化为该键）。
- `authorization` 仅接受 `Bearer <jwt>` 形式。
- 无 `Authorization` 视为 anonymous，不报错。
- `authorization` 存在但格式非法，必须 `UNAUTHENTICATED` + `AUTH_TOKEN_INVALID`，不得降级为 anonymous。

## K-AUTHN-002 必校验 claims

Realm JWT 最小必校验集合：

- `iss`
- `aud`
- `sub`
- `exp`
- `iat`

如存在 `nbf`，必须参与时序校验。

## K-AUTHN-003 算法与 Header 约束

- 仅允许配置白名单算法（Phase 1 默认 `RS256`/`ES256`）。
- `alg=none` 必须拒绝。
- `kid` 缺失必须拒绝。

## K-AUTHN-004 JWKS 缓存与刷新

- JWKS 读取采用缓存优先，缓存 miss 或 `kid` miss 触发单次刷新。
- 刷新失败时不得降级为 anonymous，必须返回 `UNAUTHENTICATED`。
- 必须具备失败回退窗口：可在短 TTL 内继续使用最近一次成功快照（仅用于已命中 `kid`）。
- `auth.jwt.jwksUrl` 是 Runtime 验签公钥的唯一来源；`publicKeyPath` 不属于有效验签链路。

## K-AUTHN-005 时钟偏差

- `exp`/`nbf` 校验必须应用固定时钟偏差窗口（Phase 1: `±60s`）。
- 超过窗口后 token 视为无效，不允许软容忍。

## K-AUTHN-006 会话失效与撤销

- token 通过签名校验后仍需检查会话撤销状态（若会话域可用）。
- 已撤销或已过期会话必须返回 `UNAUTHENTICATED` + `AUTH_TOKEN_INVALID`。

## K-AUTHN-007 失败语义统一

所有 AuthN 失败（格式、验签、claims、会话撤销）统一：

- gRPC code: `UNAUTHENTICATED`
- reason code: `AUTH_TOKEN_INVALID`

> **注脚**：K-AUTHSVC-013 为 ExternalPrincipal 场景定义了细分码 `AUTH_TOKEN_EXPIRED`（proof JWT 过期）和 `AUTH_UNSUPPORTED_PROOF_TYPE`（不支持的 proof_type），作为本规则在 ExternalPrincipal 上下文的例外。通用 AuthN 路径仍统一使用 `AUTH_TOKEN_INVALID`。

## K-AUTHN-009 跨服务 Token Claims 契约

Realm 后端签发 JWT，Runtime 校验 JWT。两者的 claims 契约必须对齐：

- **`iss`（签发者）**：Runtime 接受的 `iss` 值由配置定义（`K-DAEMON-009` 的 `auth.jwt.issuer` 字段）。部署者必须确保 Realm 后端签发的 token 的 `iss` claim 与 Runtime 配置的 `auth.jwt.issuer` 一致。
- **`aud`（受众）**：Runtime 接受的 `aud` 值由配置定义（`K-DAEMON-009` 的 `auth.jwt.audience` 字段）。部署者必须确保 Realm 后端签发的 token 的 `aud` claim 包含 Runtime 配置的 `auth.jwt.audience` 值。
- **JWKS 端点**：Runtime 通过配置中的 `auth.jwt.jwksUrl` 获取 Realm 后端的公钥集合（`K-AUTHN-004`）。

**不一致后果**：`iss` 或 `aud` 不匹配时，Runtime 对所有携带 Realm token 的请求返回 `UNAUTHENTICATED` + `AUTH_TOKEN_INVALID`（`K-AUTHN-007`）。Desktop 用户将无法执行任何认证操作。

**跨层引用**：`D-AUTH-004`（Desktop 消费 Realm 签发 token）、`K-DAEMON-009`（配置三层优先级）。

## K-AUTHN-008 上下文投影

AuthN 成功后向下游投影最小身份上下文：

- `subject_user_id`（来自 `sub`）
- `issuer`
- `audience`
- `session_id`（若存在）

下游 AuthZ 仅消费投影结果，不重复实现 JWT 解析逻辑。
