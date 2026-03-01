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
- `max_delegation_depth` 超限必须拒绝。默认值为 `3`（可通过 `K-DAEMON-009` 配置覆盖）。

## K-GRANT-006 Revoke 与链路可见性

- `RevokeAppAccessToken` 必须幂等。
- `ListTokenChain` 必须可观测父子链路，不得返回环。

## K-GRANT-007 错误与审计

- 认证失败统一遵循 `K-AUTHN-007`（失败语义统一）。
- 授权策略拒绝与 token 无效必须写入审计，字段集合遵循 `K-AUDIT-001`（最小字段）。

## K-GRANT-008 ScopeCatalog 版本化

- ScopeCatalog 是运行时 scope 定义的权威来源，带版本号（如 `sdk-v1`）。
- 每个版本固定 scope 集合，不可变。新增 scope 需发布新版本。
- `ValidateAppAccessToken` 响应包含 `issued_scope_catalog_version`，用于检测版本漂移。

**Phase 1 约束**：

- Phase 1 仅支持单版本（`sdk-v1`），不存在版本协商。版本化基础设施（`issued_scope_catalog_version` 字段）为 Phase 2 多版本协商预留，Phase 1 实现仅需硬编码 `sdk-v1`。
- 已签发 token 的 scope 按签发时版本评估（old token + new catalog = old version evaluation）。
- 多版本协商协议列为 deferred decision。

## K-GRANT-009 Scope 前缀识别规则

合法 scope 必须匹配以下前缀之一：

| 前缀 | 含义 |
|---|---|
| `runtime.*` | Runtime 服务访问 |
| `realm.*` | Realm 服务访问 |
| `app.*` | 应用自定义 scope |
| `read:*` | 读取权限 |
| `write:*` | 写入权限 |
| `grant:*` | 授权委托权限 |

不匹配任何前缀的 scope 在校验时拒绝（`APP_SCOPE_FORBIDDEN`）。

## K-GRANT-010 Scope 撤销语义

- Scope 撤销以版本为粒度：`(scope_catalog_version, scope_name)` 元组标记为 revoked。
- 已撤销的 scope 在 `ValidateAppAccessToken` 时从 `effective_scopes` 中排除。
- 撤销不影响已签发 token 的生命周期（token 仍有效，但 effective scope 收窄）。
- 撤销事件返回 `APP_SCOPE_REVOKED`。

## K-GRANT-011 ListTokenChain 请求字段

`ListTokenChain` 请求（`ListTokenChainRequest`）：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `root_token_id` | string | 是 | 链路根 token ID，从此节点向下遍历委托链 |
| `include_revoked` | bool | 否 | 是否包含已撤销 token（默认 `false`） |
| `page_size` | int32 | 否 | 分页大小（通用默认值见 K-PAGE-005） |
| `page_token` | string | 否 | 分页游标 |

## K-GRANT-012 ListTokenChain 响应字段

`ListTokenChainResponse` 返回有序的委托链条目：

| 字段 | 类型 | 说明 |
|---|---|---|
| `entries` | repeated TokenChainEntry | 链路条目列表 |
| `next_page_token` | string | 下一页游标（空表示无后续） |
| `has_more` | bool | 是否因深度截断（超出 `max_delegation_depth`，`K-GRANT-005`）而存在更多未返回的链路节点 |

`TokenChainEntry` 字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `token_id` | string | Token ID |
| `parent_token_id` | string | 父 Token ID（根节点为空） |
| `principal_id` | string | 主体 ID |
| `principal_type` | string | 主体类型 |
| `effective_scopes` | repeated string | 生效的 scope 列表 |
| `issued_at` | Timestamp | 签发时间 |
| `expires_at` | Timestamp | 过期时间 |
| `revoked` | bool | 是否已撤销 |
| `delegation_depth` | int32 | 委托深度（根=0） |

排序：`issued_at DESC`（最新签发在前）。

## K-GRANT-013 ListTokenChain 错误语义

| 场景 | gRPC Code | ReasonCode | 说明 |
|---|---|---|---|
| `root_token_id` 不存在 | `NOT_FOUND` | `GRANT_TOKEN_CHAIN_ROOT_NOT_FOUND` | Token 链根节点未找到 |
| `root_token_id` 为空 | `INVALID_ARGUMENT` | `GRANT_TOKEN_CHAIN_ROOT_REQUIRED` | 必填字段缺失 |
| 深度截断 | `OK` | — | 响应中 `has_more=true`，表示委托链超出 `max_delegation_depth`（K-GRANT-005）后仍有节点 |

分页语义遵循 K-PAGE-002（page_token）与 K-PAGE-005（通用默认值）。
