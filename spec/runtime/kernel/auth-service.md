# Auth Service Contract

> Owner Domain: `K-AUTHSVC-*`

## K-AUTHSVC-001 服务职责

`RuntimeAuthService` 负责应用会话与外部主体会话生命周期，不承载授权决策（授权由 `RuntimeGrantService` 负责）。

## K-AUTHSVC-002 方法集合（权威）

`RuntimeAuthService` 方法固定为：

1. `RegisterApp`
2. `OpenSession`
3. `RefreshSession`
4. `RevokeSession`
5. `RegisterExternalPrincipal`
6. `OpenExternalPrincipalSession`
7. `RevokeExternalPrincipalSession`

## K-AUTHSVC-003 RegisterApp 最小约束

- `app_id` 必填且不可为空。
- `app_instance_id` 在客户端缺省时可由服务端分配。
- `mode_manifest` 必须按 proto 枚举值校验，不允许未知值透传。

## K-AUTHSVC-004 OpenSession / RefreshSession TTL 约束

- `ttl_seconds` 必须落在服务端配置区间内。
- 超出区间必须 fail-close（`INVALID_ARGUMENT`）。
- `RefreshSession` 仅对仍有效的 `session_id` 生效。

## K-AUTHSVC-005 Revoke 幂等语义

- `RevokeSession` 与 `RevokeExternalPrincipalSession` 必须幂等。
- 重复撤销返回 `OK`，不得泄露“是否曾存在”细节。

## K-AUTHSVC-006 External Principal 注册与开会话

- `RegisterExternalPrincipal` 必须校验 `proof_type` 与 `signature_key_id` 的一致性。
- `OpenExternalPrincipalSession` 的 `proof` 验证失败统一映射到 `UNAUTHENTICATED` + `AUTH_TOKEN_INVALID`。

## K-AUTHSVC-007 审计与追踪

所有方法必须写审计（成功/失败），最小字段遵循 `K-AUDIT-*`，且保留 `app_id`、`session_id`、`external_principal_id`（若适用）。

## K-AUTHSVC-008 与 AuthN 契约耦合

`RuntimeAuthService` 生成或续签的 token 必须满足 `K-AUTHN-*` 的可验证性约束（issuer/audience/alg/kid 可解析）。
