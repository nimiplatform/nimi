# Grant Service Contract

> Owner Domain: `K-GRANT-*`

## K-GRANT-001 服务职责

`RuntimeGrantService` 负责授权签发、访问校验、委托链管理。其输入依赖 `RuntimeAuthService` 会话与外部主体身份。

## K-GRANT-002 方法集合（权威）

`RuntimeGrantService` 方法固定为：

1. `AuthorizeExternalPrincipal`
2. `ValidateAppAccessToken`
3. `RevokeAppAccessToken`
4. `IssueDelegatedAccessToken`
5. `ListTokenChain`

## K-GRANT-003 AuthorizeExternalPrincipal 约束

- `policy_mode=PRESET` 时必须提供合法 `preset`。
- `policy_mode=CUSTOM` 时必须提供 `scopes` 与 `resource_selectors`。
- `ttl_seconds` 必须受服务端上限约束。

## K-GRANT-004 ValidateAppAccessToken 决策输出

- `valid=true` 时必须返回 `effective_scopes`。
- `valid=false` 时必须返回可解析 `reason_code`，禁止空原因失败。
- 校验结果必须包含 `policy_version` 与 `issued_scope_catalog_version`（若可用）。

## K-GRANT-005 Delegation 约束

- `IssueDelegatedAccessToken` 只能在父 token 允许委托时成功。
- 子 token 的 scope/resource selector 必须是父 token 能力的子集。
- `max_delegation_depth` 超限必须拒绝。

## K-GRANT-006 Revoke 与链路可见性

- `RevokeAppAccessToken` 必须幂等。
- `ListTokenChain` 必须可观测父子链路，不得返回环。

## K-GRANT-007 错误与审计

- 认证失败统一遵循 `K-AUTHN-*`。
- 授权策略拒绝与 token 无效必须写入审计，字段集合遵循 `K-AUDIT-*`。
