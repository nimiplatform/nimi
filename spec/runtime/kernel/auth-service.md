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

- `ttl_seconds` 必须落在服务端配置区间 `[sessionTtlMinSeconds, sessionTtlMaxSeconds]` 内（默认 `[60, 86400]` 秒，可通过 `K-DAEMON-009` 配置）。
- 超出区间必须 fail-close（`INVALID_ARGUMENT`）。
- `RefreshSession` 仅对仍有效的 `session_id` 生效。

## K-AUTHSVC-005 Revoke 幂等语义

- `RevokeSession` 与 `RevokeExternalPrincipalSession` 必须幂等。
- 重复撤销返回 `OK`，不得泄露“是否曾存在”细节。

## K-AUTHSVC-006 External Principal 注册与开会话

- `RegisterExternalPrincipal` 必须校验 `proof_type` 与 `signature_key_id` 的一致性。
- `OpenExternalPrincipalSession` 的 `proof` 验证失败统一映射到 `UNAUTHENTICATED` + `AUTH_TOKEN_INVALID`。

## K-AUTHSVC-007 审计与追踪

所有方法必须写审计（成功/失败），最小字段遵循 `K-AUDIT-001`（最小字段），且保留 `app_id`、`session_id`、`external_principal_id`（若适用）。

## K-AUTHSVC-008 与 AuthN 契约耦合

`RuntimeAuthService` 生成或续签的 token 必须满足 `K-AUTHN-002`（必校验 claims）与 `K-AUTHN-003`（算法与 Header 约束）的可验证性约束。

## K-AUTHSVC-009 AppMode 校验矩阵

`AppMode` 决定应用可访问的 domain 和 scope：

| AppMode | 允许 runtime.* domain | 允许 realm.* domain | 说明 |
|---|---|---|---|
| `LITE` | 否 | 是 | 轻量模式，仅 realm 功能 |
| `CORE_ONLY` | 是 | 否 | 核心模式，仅 runtime 功能 |
| `FULL` | 是 | 是 | 完整模式，全功能 |

域访问违规时返回 `APP_MODE_DOMAIN_FORBIDDEN`；scope 违规时返回 `APP_MODE_SCOPE_FORBIDDEN`。

**评估顺序**：AppMode gate 在 Scope prefix gate（`K-GRANT-009`）之前执行。AppMode 拒绝后不再评估具体 scope，直接返回 `APP_MODE_DOMAIN_FORBIDDEN` 或 `APP_MODE_SCOPE_FORBIDDEN`。

## K-AUTHSVC-010 Manifest 与 WorldRelation 组合规则

`AppModeManifest` 必须声明 `mode` 和 `world_relation`。`WorldRelation` 枚举：

| 值 | 含义 |
|---|---|
| `NONE` | 无世界关联 |
| `RENDER` | 渲染权限 |
| `EXTENSION` | 扩展权限 |

组合校验：非法组合返回 `APP_MODE_MANIFEST_INVALID`。`LITE` 模式不允许 `world_relation=EXTENSION`（需要 runtime 能力）。

## K-AUTHSVC-011 Session TTL 解析逻辑

- 默认 TTL：3600 秒（1 小时）。
- 客户端可通过 `ttl_seconds` 请求自定义 TTL，但必须落在服务端配置区间内（`K-AUTHSVC-004`）。
- TTL 下限由 `sessionTtlMinSeconds`（默认 60s）控制，上限由 `sessionTtlMaxSeconds`（默认 86400s）控制，两者均通过 `K-DAEMON-009` 配置文件或环境变量设置。
- 缺省 `ttl_seconds` 时使用默认值。

## K-AUTHSVC-012 Session 存储与重启行为

- Phase 1 session 存储使用进程内内存 map，不跨重启持久化。
- daemon 重启后所有 session 失效，客户端需重新调用 `OpenSession` 或 `OpenExternalPrincipalSession` 建立新会话。
- 客户端应实现 session 失效后的自动重连逻辑（检测到 `UNAUTHENTICATED` 后重新 `OpenSession`）。
- 未来版本可引入持久化存储（如文件或嵌入式 KV），但 Phase 1 明确不要求。

**跨消费方恢复协议差异（K-AUTHSVC-012）**：

daemon 重启导致内存 session 全部失效，不同消费方受影响程度和恢复策略不同：

| 消费方 | 使用 OpenSession? | 重启影响 | 恢复策略 |
|---|---|---|---|
| **Desktop** | 否（token 来自 Realm Backend） | 需重新 RegisterApp（D-BOOT-004），Realm token 不受影响 | Desktop 检测到 `runtime.disconnected`（S-RUNTIME-028）后重新执行 bootstrap 序列 |
| **External Agent（SDK 消费者）** | 是（K-AUTHSVC-006） | session 失效，所有需认证的 RPC 返回 `UNAUTHENTICATED` | 应用层检测到 `UNAUTHENTICATED` 后重新 `RegisterExternalPrincipal` + `OpenExternalPrincipalSession`。SDK `runtime.disconnected` 事件可检测连接断开但**无法区分**"网络故障"和"daemon 重启导致 session 失效"——两者恢复策略相同（重建连接 + 重建 session） |
| **独立 SDK 消费者** | 是（K-AUTHSVC-002） | 同 External Agent | 同 External Agent |

**SDK 层推荐实现模式**：SDK 消费者应在 `runtime.disconnected` 事件处理器中无条件重新 `connect()` + `OpenSession()`（或 `OpenExternalPrincipalSession()`），不需要区分断开原因。失败时按 S-RUNTIME-045 退避重试。

## K-AUTHSVC-013 ExternalPrincipal proof_type 枚举

`RegisterExternalPrincipal` 和 `OpenExternalPrincipalSession` 中 `proof_type` 的支持值：

| proof_type | Phase | 验证协议 |
|---|---|---|
| `JWT` | Phase 1 | JWT 签名验证 + `exp` 过期检查 + `iss` 签发者匹配 |

Proto 枚举冻结约束：

- `ExternalProofType` 仅允许 `EXTERNAL_PROOF_TYPE_JWT` 作为可用值；
- 历史值槽位 `2` 必须保持 `reserved`，不得复用。

**JWT 验证约束**：

- `signature_key_id` 必须指向已注册的公钥（通过 `RegisterExternalPrincipal` 的 `signature_key_id` 关联）。
- 签名算法限制：与 `K-AUTHN-003` 一致（RS256/ES256）。
- proof JWT 必须包含 `iat`，并参与时序校验。
- `nbf` 如存在，必须按 `K-AUTHN-005` 的 `±60s` skew 参与校验。
- proof JWT 最大生命周期固定为 `24h`，即 `exp - iat <= 24h`；超限必须 fail-close。
- `exp` 过期的 token 统一映射到 `UNAUTHENTICATED` + `AUTH_TOKEN_EXPIRED`。
- `iss` 不匹配统一映射到 `UNAUTHENTICATED` + `AUTH_TOKEN_INVALID`。
- 不支持的 `proof_type` 返回 `INVALID_ARGUMENT` + `AUTH_UNSUPPORTED_PROOF_TYPE`。
