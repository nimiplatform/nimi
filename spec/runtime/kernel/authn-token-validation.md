# AuthN Token Validation Contract

> Owner Domain: `K-AUTHN-*`

## K-AUTHN-001 Bearer token 输入模型

- `Authorization` 仅接受 `Bearer <jwt>` 形式。
- 无 `Authorization` 视为 anonymous，不报错。
- 头存在但格式非法，必须 `UNAUTHENTICATED` + `AUTH_TOKEN_INVALID`。

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
- `kid` 缺失且无法定位有效公钥时必须拒绝。

## K-AUTHN-004 JWKS 缓存与刷新

- JWKS 读取采用缓存优先，缓存 miss 或 `kid` miss 触发单次刷新。
- 刷新失败时不得降级为 anonymous，必须返回 `UNAUTHENTICATED`。
- 必须具备失败回退窗口：可在短 TTL 内继续使用最近一次成功快照（仅用于已命中 `kid`）。

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

## K-AUTHN-008 上下文投影

AuthN 成功后向下游投影最小身份上下文：

- `subject_user_id`（来自 `sub`）
- `issuer`
- `audience`
- `session_id`（若存在）

下游 AuthZ 仅消费投影结果，不重复实现 JWT 解析逻辑。
