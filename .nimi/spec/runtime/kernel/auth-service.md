# Auth Service Contract

> Owner Domain: `K-AUTHSVC-*`

## K-AUTHSVC-001 服务职责

`RuntimeAuthService` owns binding-only app/external-principal session lifecycle
and the common process-bound local-app identity session. The former public
credential-grant family has been physically removed. Protected operation
decisions are Runtime-private and require the exact verified origin, current
separate grant and operation-owner policy.

`RuntimeAuthService` **不负责** local machine account session、login lifecycle、custody、refresh、logout、user switch、daemon restart recovery、或首方 scoped app binding；这些权威由 `RuntimeAccountService`（`K-ACCSVC-*`，见 `account-session-contract.md`）拥有。Protected-local origin、Desktop process verification 与 control-session authority 由 `K-PLOCAL-*` 拥有，Auth service 只消费其 immutable origin context。

## K-AUTHSVC-002 方法集合（权威）

`RuntimeAuthService` 方法固定为：

1. `RegisterApp`
2. `OpenSession`
3. `RefreshSession`
4. `RevokeSession`
5. `RegisterExternalPrincipal`
6. `OpenExternalPrincipalSession`
7. `RevokeExternalPrincipalSession`
8. `OpenDesktopSession`（仅 `desktop_control`）
9. `OpenLocalAppSession`（request-empty；仅已绑定 launch lease/process/record 的 `local_app_bootstrap`）

两种 protected session-open request 均为空。`OpenDesktopSession` keeps
Desktop account-control semantics; `OpenLocalAppSession` is the single
third-party app session path. Neither accepts app id, caller class, source host,
principal, trust, lease, process, account, grant, or portable proof override,
and neither returns a portable authorization bearer.

## K-AUTHSVC-003 RegisterApp 最小约束

- `app_id` 必填且不可为空。
- `app_instance_id` 在客户端缺省时可由服务端分配。
- `mode_manifest` 必须按 proto 枚举值校验，不允许未知值透传。
- 无论 registry 或 manifest gate 是否通过，`RegisterApp` 和
  随后的 `OpenSession` 只建立 `BINDING_ONLY`。其 app id、manifest、session
  id/token 或 source-host metadata 不得产生 account、broker、AI、artifact、
  realtime、media、lifecycle 或 local-app launch 权限；完整矩阵由
  `K-PLOCAL-001` 与 `tables/protected-local-rpc-transport-matrix.yaml` 拥有。

## K-AUTHSVC-004 OpenSession / RefreshSession TTL 约束

- `ttl_seconds` 必须落在服务端配置区间 `[sessionTtlMinSeconds, sessionTtlMaxSeconds]` 内（默认 `[60, 86400]` 秒，可通过 `K-DAEMON-009` 配置）。
- 超出区间必须 fail-close（`INVALID_ARGUMENT`）。
- `RefreshSession` 仅对仍有效的 `session_id` 生效。
- 本节 TTL 仅适用于 non-privileged binding/external-principal session；
  续签不升级 origin role，也不创建 portable protected privilege。

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

`AppMode` 不是授权源；它仅是未来 separately admitted non-binding session
的 static upper bound。所有 `BINDING_ONLY` registration/session 的 effective
domains 与 effective scopes 均为 empty，不受 `LITE`、`CORE_ONLY`、`FULL`、
manifest、project-local flag 或 grant row 影响。Mode/manifest
validation never upgrades protected origin、caller role、transport class、
account posture 或 token custody。
For `BINDING_ONLY`, effective domains and effective scopes are empty.

Ordinary `OpenSession` has no broker, AI, artifact, realtime, media, lifecycle,
or local-app launch authority. Local-app sessions are created only by
request-empty `OpenLocalAppSession` on a verified `local_app_bootstrap` connection
already bound to current lease/process/principal/record; success atomically
promotes that same connection to `local_app_host`. The following table
remains a ceiling, not blanket effective rights：

| AppMode | runtime.* ceiling | realm.* ceiling | 静态上限说明 |
|---|---|---|---|
| `LITE` | 否 | 是 | 最多允许 realm；仍需独立 session/origin/grant admission |
| `CORE_ONLY` | 是 | 否 | 最多允许 runtime；仍需独立 session/origin/grant admission |
| `FULL` | 是 | 是 | 最多允许两类 domain；不等于授予任何权限 |

只有在 non-binding session、protected origin 和具体 operation/grant 已由其
canonical owner 独立准入后，域 ceiling 违规才返回
`APP_MODE_DOMAIN_FORBIDDEN`，scope ceiling 违规才返回
`APP_MODE_SCOPE_FORBIDDEN`。

**评估顺序**：先判定 `BINDING_ONLY`（effective set 直接为空），再验证
protected origin 与 independently admitted session，之后才应用 AppMode ceiling，
最后按 authority class 应用 base-entitlement boundary，或 admitted public
permission 的 current owner decision/selector 与 operation-owner policy。任一前置不成立均 fail
closed，且不得借由后续 ceiling/grant 反向升级。

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

## K-AUTHSVC-012 Session 存储与重启行为（split rule）

本规则已 split 为两个独立 owner 域：

**App session / external-principal session（`RuntimeAuthService` 拥有）：**

An app session created by `OpenSession` is `BINDING_ONLY`; reconnect or
refresh recreates only that empty-effective-rights binding and cannot restore
broker/AI/artifact/realtime/media/lifecycle privilege. External-principal
sessions remain their separately proven external path and never become local
account or protected process origin.

- Phase 1 session 存储使用进程内内存 map，不跨重启持久化。
- daemon 重启后所有 app session / external-principal session 失效，客户端需重新调用 `OpenSession` 或 `OpenExternalPrincipalSession` 建立新会话。
- 客户端应实现 session 失效后的自动重连逻辑（检测到 `UNAUTHENTICATED` 后重新 `OpenSession`）。
- 未来版本可引入持久化存储（如文件或嵌入式 KV），但 Phase 1 明确不要求。

**Local machine account session（`RuntimeAccountService` 拥有，见 `account-session-contract.md` `K-ACCSVC-007`、`K-ACCSVC-011`）：**

- Account session 必须使用 secure Runtime custody（macOS keychain / Windows credential vault / Linux secret service），由 daemon 拥有；调用方 / Desktop / app 不得拥有 durable account token custody。
- daemon 重启时必须从 secure custody 尝试恢复 account session：恢复成功 → `authenticated`；不可用 → `unavailable`；过期 → `expired`；不一致 → `reauth_required`。
- account session 与所有 scoped app binding 在 daemon 重启时全部失效；消费方必须重新申请。
- `OpenSession` / `OpenExternalPrincipalSession` 路径不允许作为 local machine account truth 入口；调用方提供的 `subject_user_id` 不得用于 local first-party account / binding 派生。

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
- 签名算法限制：与 `K-AUTHN-003` 一致，只接受 generated Realm JWKS
  contract 当前声明的 `RS256`。
- proof JWT 必须包含 `iat`，并参与时序校验。
- `nbf` 如存在，必须按 `K-AUTHN-005` 的 `±60s` skew 参与校验。
- proof JWT 最大生命周期固定为 `24h`，即 `exp - iat <= 24h`；超限必须 fail-close。
- `exp` 过期的 token 统一映射到 `UNAUTHENTICATED` + `AUTH_TOKEN_EXPIRED`。
- `iss` 不匹配统一映射到 `UNAUTHENTICATED` + `AUTH_TOKEN_INVALID`。
- 不支持的 `proof_type` 返回 `INVALID_ARGUMENT` + `AUTH_UNSUPPORTED_PROOF_TYPE`。

## K-AUTHSVC-014 Retired Developer Registration Boundary

The predecessor `RegisterAppRequest.developer_registration` gate is retired and
is physically absent from the public wire. Field number `7` and field name
`developer_registration` are both reserved and cannot be reused. No ignored
field, alias, compatibility decoder or alternate request intent may preserve
the predecessor shape. `RegisterApp` cannot create a local principal, project
authorization, account caller, grant, launch lease, or local-app session.

Local development enters only through Runtime-owned Developer Mode project
authorization, K-APP principal/record creation, K-PLOCAL protected launch, and
the common request-empty local-app session. `auth.developerRegistration`, its
environment/CLI/config projections, request intent, `RegisterApp`, app id,
manifest, ordinary app session, metadata, or a temporary bearer do not exist as
compatibility paths. Unknown predecessor config keys fail schema validation;
the service does not decode or special-case predecessor wire payloads.
