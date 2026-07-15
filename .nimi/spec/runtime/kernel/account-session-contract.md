# Account Session Contract

> Owner Domain: `K-ACCSVC-*`

## K-ACCSVC-001 服务职责

**Owner-only authority allocation.** Runtime is the sole owner of authenticated Realm unary, realtime, and media data planes. Runtime alone owns account and token custody, private refresh, authenticated Realm credential exchange, local-app grant mutation, and the per-operation local-app decision coordinator. Platform owns app catalog, trust-class and permission vocabulary; `K-APP-*` owns the local-app principal/record and Developer Mode state; `K-GRANT-*` owns local-app grant truth; `K-PLOCAL-*` owns launch leases and local-app sessions. Desktop owns account-control UX, Developer Mode UX, grant UX and the verified native supervisor/launcher, but no Developer Mode security state. SDK and Kit own typed APIs and trusted carriers only; app-tools remains authoring and build tooling.

Apps MUST NOT own account or session truth, bearer or refresh tokens, or signed upload credentials. A Desktop host, Kit bridge, SDK client, renderer, app manifest, or app-supplied callback may carry only owner-attested opaque inputs and results; none may originate credentials, refresh authenticated Realm state, or become a parallel unary, realtime, or media authority.

This rule admits that single-owner allocation. `K-PLOCAL-*` is the sole
authority for transport, process, executable, challenge, boot-epoch and
security-ledger facts. `K-APP-*`, `K-GRANT-*`, and `K-ACCSVC-*` jointly admit
the common local-app decision without duplicating each other's state. Realm,
realtime and media operations still require their own exact operation rows;
local-app origin or grant never creates blanket authorization.

`RuntimeAccountService` 拥有本地机器层的 account session truth、custody、login lifecycle、refresh、logout、user switch、daemon restart recovery、Runtime-mediated Realm broker 和 Runtime-issued scoped app binding issuance。它是 local account authority 与 refresh-token custody 的唯一所有者。

`RuntimeAuthService`（`K-AUTHSVC-*`）继续负责 app session 与 external-principal session，二者不互相替代。`RuntimeAccountService` 不接受调用方提供的 `subject_user_id` 作为 account 真相，account subject 必须从 Runtime account custody 内部派生。

`RuntimeAccountService` 还是 Nimi 本地 app 的 shared auth broker 与唯一 Realm
credential mediation owner。`InvokeRealmUnary` 当前只对 matrix 中明确 admitted
的 Desktop/bundled caller 生效；`LOCAL_APP` 行保持 deny，直到某个 exact Realm
operation 独立完成 owner admission。checkpoint 的 selected RuntimeAgent/Cognition
operation 不借用 generic Realm unary。任何 caller 最终都只能获得 bounded
application result，不获得 Realm bearer。任何 app、Desktop、SDK、Kit、renderer
或 app-owned host 都不得持有 access/refresh token、durable shared session、login
bootstrap、subject truth，或把 token/session 反向写回 Runtime。

Public `GetAccessToken` and `RefreshAccountSession` have been removed from
the public protocol, generated clients, Runtime handlers, Kit, and app
projections. Runtime may access or refresh account bearer material only through
non-RPC private helpers while executing an
independently admitted broker or service operation.

## K-ACCSVC-002 方法集合（权威）

`RuntimeAccountService` 方法固定为：

1. `GetAccountSessionStatus`
2. `SubscribeAccountSessionEvents`
3. `BeginLogin`
4. `CompleteLogin`
5. `RequestPresenceVerification`
6. `InvokeRealmUnary`
7. `Logout`
8. `SwitchAccount`
9. `IssueScopedAppBinding`
10. `RevokeScopedAppBinding`
11. `IssueWorkspaceBinding`
12. `RevokeWorkspaceBinding`
13. `GetLocalAppGrantStatus`
14. `RequestLocalAppGrant`
15. `DecideLocalAppGrant`
16. `RevokeLocalAppGrant`

Admitted 方法集合为冻结集合。`IssueWorkspaceBinding` /
`RevokeWorkspaceBinding` are admitted only for workspace-specific attachment
mint/revoke under `K-ACCSVC-019` and `K-BIND-018`.
`RequestPresenceVerification` is admitted only for fresh local user-presence
checks under `K-ACCSVC-021`. Any further method must undergo a new rule
admission before proto / RPC table projection.

The four local-app grant methods are protected methods governed by
`K-GRANT-014` and `K-ACCSVC-026`. They expose typed status and mutation results,
never a portable grant credential. The removed `GetAccessToken` and
`RefreshAccountSession` identities remain reserved and must not be reintroduced
under aliases.

## K-ACCSVC-003 Account Session 状态机

`RuntimeAccountService` 必须维护以下 account session 状态：

| 状态 | 含义 | 终止状态？ |
|---|---|---|
| `anonymous` | 无可用 account session | 否 |
| `login_pending` | 存在活跃 login attempt | 否 |
| `authenticated` | 拥有有效 account 材料与投影 | 否 |
| `refresh_pending` | 正在刷新 account 材料 | 否 |
| `expired` | 现有材料过期，无法授权工作 | 否 |
| `reauth_required` | 需要用户操作才能继续 | 否 |
| `switching` | 正在原子切换 active account | 否 |
| `logging_out` | 正在撤销本地材料与 binding | 否 |
| `unavailable` | 无法安全决定/托管 account state | 否，必须 fail-close |

**Single-active-account invariant**：单个 Runtime 实例同一时刻只能存在一个 `authenticated` account。`SwitchAccount` 必须为原子转换，不允许两个有效 account 投影同时存在。

## K-ACCSVC-004 状态转换表

| From | Trigger | To | Events | Idempotency / 排序 |
|---|---|---|---|---|
| `anonymous` | `BeginLogin` 接受 | `login_pending` | `login.started` | 同一 attempt 在 expiry 之前重复返回相同 pending attempt |
| `login_pending` | proof 完成且验证通过 | `authenticated` | `login.completed`、`account.status` | account projection 必须在 custody 写入成功后再发出 |
| `login_pending` | timeout / cancel / failure | `anonymous` 或 `reauth_required` | `login.failed` 或 `login.timed_out` | 过期 proof 必须 fail-close |
| `authenticated` | proactive / reactive refresh 启动 | `refresh_pending` | `refresh.started` | 同一 account 同时只允许一次 refresh 在飞 |
| `refresh_pending` | refresh 成功 | `authenticated` | `refresh.completed`、`account.status` | 新 token 必须原子替换旧 token |
| `refresh_pending` | refresh 可恢复失败 | `reauth_required` | `refresh.failed` | binding 按原因 suspend / revoke |
| `refresh_pending` | token 在恢复前过期 | `expired` | `refresh.failed`、`account.status` | authenticated 调用必须 fail-close |
| `authenticated` | `Logout` | `logging_out` | `logout.started` | 重复 logout 观察到相同转换 |
| `logging_out` | local / remote revoke 完成 | `anonymous` | `binding.revoked`、`logout.completed`、`account.status` | binding 必须在最终 anonymous 之前被 revoke |
| `authenticated` | `SwitchAccount` | `switching` | `switch.started` | 不允许两个有效 account 同时存在 |
| `switching` | 新 account 完成 | `authenticated` | `binding.revoked`、`switch.completed`、`account.status` | 旧 binding 必须在新 projection 之前 revoke |
| 任意非终止 | custody 不可用 | `unavailable` | `custody.unavailable`、`account.status` | fail-close |
| `unavailable` | custody 恢复且材料有效 | `authenticated` | `custody.recovered`、`account.status` | projection 必须在验证后再发出 |

## K-ACCSVC-005 RPC / IPC 语义

每个方法的最小契约：

- `GetAccountSessionStatus`: 返回当前 account state 与投影。投影最多包含 `account_id`、显示信息、`realm_environment_id`（admit 时）、和 `K-ACCSVC-018` admitted workspace membership projection， 不得返回 raw token、refresh token、JWT、或 `subject_user_id` 字段。
- `SubscribeAccountSessionEvents`: server-stream，必须先返回 `account.status` snapshot，再按单调 sequence 顺序投递事件。重连时若 replay 不可用，必须发出 `replay_truncated` 标志。
- `BeginLogin`: 创建 login attempt，返回 UX instruction envelope（如 `oauth_authorization_url`、`callback_origin`、`pkce_challenge`、`state`、`expires_at`）。kit / Desktop 不得获得 PKCE verifier。
- `CompleteLogin`: 接受 typed proof envelope（见 K-ACCSVC-008）。Runtime 验证后写入 custody 并转换状态。
- `InvokeRealmUnary`: Runtime 根据 `tables/realm-broker-operations.yaml`、
  Platform app capability/grant、Runtime app-session scope 与 host-bound caller
  envelope 执行单个 admitted Realm operation。Runtime 在内部取得/刷新 bearer，
  校验 canonical Realm base、operation/path/query/body 与 response size，并只返回
  bounded application JSON。响应 headers、bearer/access/refresh token、JWT、
  credential-like JSON keys/value 均不得返回 app；命中扫描器必须 fail-close。
- `Logout`: Runtime 撤销 local session 与所有 binding；幂等。Caller-facing
  logout success may be projected only after Runtime has accepted/completed the
  Runtime-owned logout transition or has emitted a corresponding account status
  projection. Local first-party apps may stop local side effects while logout is
  pending, but they MUST NOT claim "signed out locally" success while Runtime
  custody may still contain an authenticated session.
- `SwitchAccount`: 原子转换；旧 binding 在新 projection 之前 revoke。
- `IssueScopedAppBinding`: 见 `scoped-app-binding-contract.md`。account subject 内部派生。
- `RevokeScopedAppBinding`: 见 `scoped-app-binding-contract.md`。

`RequestPresenceVerification` invokes a Runtime-owned presence verifier chain
for a caller-stated purpose and bounded TTL. It must not treat an existing
account session, access token, refresh token, Realm server session,
app-local password prompt, or caller assertion as fresh presence. Runtime may
use a formal local OS verifier first, then a Runtime-owned fresh Nimi reauth
provider (`NIMI_REAUTH`) that forces a new Realm login interaction with
`prompt=login`, Runtime-generated state / nonce, and subject match. Missing or
unavailable presence capability returns `presence_verification_unavailable` and
fail-closes.

Public local account RPCs follow
`tables/account-rpc-permission-matrix.yaml`. `BeginLogin`, `CompleteLogin`,
`Logout`, and `SwitchAccount` are Desktop account UX operations and require
`ACCOUNT_CALLER_MODE_DESKTOP_SHELL`; non-Desktop local first-party apps,
third-party local apps, binding-only Avatar, and ordinary renderers must request
Desktop-owned account UX instead of calling them. Local apps may consume
admitted status/event, presence, grant and selected operation surfaces only
after principal, record, session and policy resolution, but cannot call login
completion, raw token, logout, or switch. Local apps require the common
host-bound local-app session; `app_id` or a host envelope is never sufficient.
Unauthenticated / anonymous status may be projected only after the caller mode's
registry/envelope admission succeeds; shape-only `AccountCaller` is never
sufficient.

For `ACCOUNT_CALLER_MODE_DESKTOP_SHELL`, admission is the live K-PLOCAL-006
`desktop_account_host` connection joined to the native host-owned app,
app-instance, device, caller-kind, and source-host envelope. The generic
binding-only `RegisterApp` registry is neither required nor sufficient for
Desktop account status or control. This keeps the request-body `AccountCaller`
non-authoritative while allowing the fixed production service, which exposes
no ordinary public TCP listener, to perform Desktop-owned login.

任何方法都不允许接受 raw Realm token、refresh token、raw JWT、或 caller 提供的 `subject_user_id` 作为 account truth。

The removed public token and refresh identities are reserved. No registry,
first-party, bundled, Desktop, Avatar, Zhiyu, local-app, renderer or test
posture may restore them. Runtime service code may obtain bearer material only
through a private helper and consume it inside the same Runtime-owned operation.

## K-ACCSVC-006 事件契约

事件家族：

- `account.status`
- `login.started`
- `login.completed`
- `login.failed`
- `login.timed_out`
- `refresh.started`
- `refresh.completed`
- `refresh.failed`
- `logout.started`
- `logout.completed`
- `switch.started`
- `switch.completed`
- `custody.unavailable`
- `custody.recovered`
- `binding.issued`
- `binding.activated`
- `binding.suspended`
- `binding.revoked`
- `binding.expired`
- `binding.superseded`
- `binding.replay_detected`

最小 payload 字段：`event_id`、`sequence`（单调递增）、`emitted_at`、`reason_code`、`account_projection_redacted`（仅在涉及 account 时）、`binding_id`（仅在涉及 binding 时）。

Redaction 规则：

- 不得包含 access token、refresh token、PKCE verifier、auth code、secret material 的任何形式。
- account projection 仅包含 `account_id` 与显示信息。
- binding 事件仅包含 `binding_id` 与 relation tuple，不包含 carrier 内部材料。

Reconnect 行为：先 snapshot，再按 sequence 投递。replay 不可用时发出 `replay_truncated`，调用方必须假设状态需要重新拉取。

## K-ACCSVC-007 Custody 模型

| 平台 | Primary custody | 不可用时行为 |
|---|---|---|
| Windows | fixed non-interactive LocalSystem token user (`S-1-5-18`)；restricted `NT SERVICE\NimiRuntime` service SID；DPAPI-NG `LOCAL=user` protector；service-SID-only state ACL；process DACL grants the service SID full authority, denies interactive sensitive rights, and permits only read-only Runtime peer verification | host token、protector、ACL、active-logon query authority 或 service principal 不匹配时 `unavailable`；authenticated 调用 fail-close |
| Linux | dedicated non-login Runtime system UID；0600 encrypted store；root-loaded system credential key | dedicated UID、key 或 protected state 不可用时 `unavailable` |
| macOS | hardened LaunchDaemon Runtime principal；code-identity-ACL system Keychain item bound to the Runtime designated requirement | code identity、Keychain ACL 或 LaunchDaemon principal 不匹配时 `unavailable` |

固定规则：

- Runtime 拥有 refresh material；Desktop / app 不存储任何 durable token。
- access token 只存在于 Runtime custody/private service call chain；不得投影给
  app、Desktop、SDK、Kit、renderer 或 host，也不得用于 app 直连 Realm。
- refresh token rotation 必须原子：新 token 提交后再丢弃旧 token。
- Reuse detection：在 rotation 之后再次观察到旧 refresh token，必须 revoke 本地 chain，发出 `refresh.failed` reason `replay`，并进入 `reauth_required` 或 `unavailable`。
- audit 永远不记录 token 值、auth code、PKCE verifier、refresh material。
- Interactive-user generic keyring, Credential Manager/vault, login Keychain,
  secret-service/libsecret session store, Desktop secure store, and app-owned
  vault are forbidden production custody. No retained user-session credential
  is imported; fresh login and connector credential re-entry are required.

custody 不可用时不允许 fallback 到 in-memory durable account truth、Desktop shared auth、或 app-local custody。

## K-ACCSVC-008 Login Completion Proof

`BeginLogin` 创建：

- `login_attempt_id`
- PKCE verifier / challenge（仅 Runtime 内部存储）
- redirect URI / 允许的 callback origin
- state / nonce
- `expires_at`
- UX instruction envelope（kit 可读字段，不含 verifier）

`CompleteLogin` proof envelope：

- `login_attempt_id`
- callback `code` 或 sealed kit-produced completion ticket
- 返回的 state / nonce
- redirect / callback metadata
- Desktop UX trace metadata（不含 token 材料）

执行决策：

- local first-party 默认登录路径为 Nimi Auth Browser callback：app / kit 只接收 `code` / `state`，Runtime 持有 login attempt、state、PKCE verifier，并执行 code exchange。
- 当平台约束要求 kit 执行 OAuth exchange 时，kit 必须返回 sealed completion ticket。Desktop 不允许观察 bearer / refresh token。
- sealed completion ticket 不是默认 branch；在 crypto / key custody / replay 语义被单独 admit 之前，implementation 必须 fail-closed。
- 任何路径下 Desktop / kit 都不允许成为 refresh-token custody owner 或 durable account session owner。

Replay 行为：

- 已完成 attempt 的重复 proof 仅在不再暴露敏感材料时才返回幂等成功。
- 过期、不匹配、或已消费的 proof 必须 fail-close，原因码 `proof_expired` / `proof_mismatched` / `proof_consumed`。

## K-ACCSVC-009 Login Route Ownership

local first-party 模式下，login route decision 由 Runtime 拥有，默认产品路径为 Nimi Auth Browser callback `code/state`：

| 路由 | local first-party 拥有者 | Web / cloud 拥有者 |
|---|---|---|
| `checkEmail` | local first-party superseded；Nimi Auth Browser route owns UX decision | 仅在 explicit Web/cloud adapter 之后允许 |
| `passwordLogin` | local first-party superseded；Desktop 打开 Nimi Auth Browser flow | Web/cloud adapter |
| `oauthLogin` | Runtime 拥有 Nimi Auth attempt 与 callback code exchange；sealed proof 仅用于平台强制 kit token observation | Web/cloud adapter |
| `requestEmailOtp` | local first-party superseded；Nimi Auth Browser route owns UX decision | Web/cloud adapter |
| `verifyEmailOtp` | Runtime 完成 browser callback proof 与 custody | Web/cloud adapter |
| `walletChallenge` | local first-party superseded，除非 Nimi Auth Browser 内部委派 wallet UX | Web/cloud adapter |
| `walletLogin` | Runtime 完成 Nimi Auth callback 与 custody | Web/cloud adapter |

local first-party 模式下 Desktop 不允许直接调用 Realm route 作为登录权威。

## K-ACCSVC-010 Remote Revocation 与 Logout 顺序

最小检测面：refresh-time 失败与 JWKS / revocation 验证。push / poll channel 不在 Phase 1 admit 范围内。

Logout / 远程撤销事件顺序：

1. 检测到 revoke / 失败
2. suspend 或 revoke 所有 active binding
3. 清除 custody 材料
4. 发出 `account.status = reauth_required` 或 `anonymous`

任何顺序违反必须 fail-close 并发出 `logout.failed`。

If `Logout` fails, the caller-facing projection MUST fail closed into
`reauth_required`, `unavailable`, or an explicit logout-failed UX state; it MUST
NOT convert renderer-local cache clearing into account logout success. Local
first-party consumers may clear volatile streams, optimistic UI, or query
state as side effects, but account state remains Runtime-owned until Runtime
emits the authoritative transition.

## K-ACCSVC-011 Daemon Restart 行为

daemon 重启后：

- Runtime 必须从 secure custody 尝试恢复 account session。
- 恢复成功且材料未过期 → `authenticated` + `custody.recovered`。
- custody 不可用 → `unavailable`。
- custody 可读但材料已过期 → `expired`。
- custody 可读但 reuse / inconsistency 检测失败 → `reauth_required`。

binding 在 daemon 重启时全部失效；调用方必须重新申请。Runtime 必须在恢复 projection 前完成 binding revocation 事件投递（reason `daemon_restart_no_recovery`）。

## K-ACCSVC-012 App Registration Caller Matrix

| Caller | 注册路径 | 必需 account state | Binding 来源 | 禁止 |
|---|---|---|---|---|
| Desktop shell | Runtime-mediated Desktop host registration | `authenticated` 或 anonymous（仅 account UX） | Runtime account broker；account-control 仅此 caller mode | durable token custody、public refresh、renderer caller truth、任何 bearer projection |
| SDK local first-party app | bundled first-party bootstrap | current Runtime-owned account generation when required | Runtime-owned first-party binding | account control、token、app-provided subject/session |
| Third-party local app (`LOCAL_APP`) | `PrepareLocalAppLaunch` + verified process bind + request-empty `OpenLocalAppSession` | current Runtime-owned account generation when an operation requires account | local-app principal/record/session plus separate current grant | account control、token、caller-selected principal/account/grant、`app_id` fallback |
| Default Avatar app (`nimi.avatar`) | shipped bundled first-party bootstrap | current Runtime-owned account generation when required | Runtime-owned first-party binding | third-party local-app principal/grant posture、account control、token |
| Binding-only Avatar mode | 不允许直接 account registration | N/A | Runtime-issued scoped binding from owner surface | account access token、refresh token、anchor 创建、independent auth truth |
| Web / cloud app | 显式 Web/cloud adapter | Web/cloud session | Web/cloud adapter | local Runtime account authority claim |
| External principal | binding-only external-principal session | N/A for local account | none; public Grant family deny-all | every local protected account claim |

## K-ACCSVC-013 Activation Boundary

account broker 实现允许在 Desktop / SDK 切换前作为 inert substrate 落地。Inert 模式必须满足：

- 不得作为 active first-party local account truth
- 不得为 Desktop / Avatar / SDK 提供 production account projection
- 不得发布 production first-party scoped binding
- 不得读取 / 镜像 / 调和 Desktop shared auth
- 不得成为 Desktop / SDK local auth fallback

active owner switch 必须原子闭合：Runtime broker 激活、SDK / kit local first-party seam 移除、Desktop login UX adapter 转换三件事必须在同一 authority transition 内闭合，并在 transition 完成前删除或 hard-block 替换的 Desktop shared-auth 与 SDK local token / subject owner 路径。

同一 active owner switch 还必须激活 Runtime-mediated broker，使所有 local app
data calls 在 Runtime 内部完成 credential exchange、refresh 与 Realm invocation，
并删除 app/host/SDK bearer provider 或 direct Realm path。

## K-ACCSVC-014 与既有 Auth 服务的关系

- account session 回答 “谁登录在本机 Runtime”。
- app session 回答 “哪个已注册 app instance 在调用”，由 `RuntimeAuthService` 拥有。
- external-principal session remains a binding-only `RuntimeAuthService`
  concept. The removed public credential-grant family cannot be restored; no
  external session can upgrade into local protected account authority.

`K-AUTHSVC-012` 必须被 split：app session 保持内存且重启即失，account session 使用 secure Runtime custody 与重启恢复（见 K-ACCSVC-007、K-ACCSVC-011）。

scoped binding 的 subject 必须由 Runtime 从 account custody 内部派生，禁止使用调用方的 `subject_user_id`。

## K-ACCSVC-015 审计

- account 生命周期、binding 发放、binding 撤销、login attempt、refresh、logout、switch、custody 不可用 / 恢复 必须写审计。
- 最小字段遵循 `K-AUDIT-001`。
- 任何场景下都不得记录 token 值、auth code、PKCE verifier、refresh material。
- 审计字段必须包含 `account_id`（如适用）、`login_attempt_id`（如适用）、`binding_id`（如适用）、`reason_code`、`device_id`。

## K-ACCSVC-016 Device Identity

`device_id`（已在 `proto/runtime/v1/auth.proto` `RegisterApp` 中存在）参与：

- account custody 分区键
- login attempt audit 上下文
- scoped binding relation

`device_id` 不允许暴露给 Avatar 或本地首方 app 作为 account 真相。

## K-ACCSVC-017 Web / Cloud 边界

Web / cloud 模式不属于 local first-party Runtime account 模式。Web 应用可能没有本地 daemon，必须使用显式 Web/cloud adapter 与 Realm 直接交互。Web / cloud adapter 不得在 local first-party SDK / Desktop / default Avatar app 中可达。

任何 Web / cloud exception 都必须显式 fence，禁止泄漏到 local first-party Runtime 模式。

## K-ACCSVC-018 Realm-Owned Workspace Membership Projection

Workspace membership truth is Realm-owned product authority and is projected into
Runtime account custody/login/refresh as a redacted membership projection.
Runtime must not create a local workspace registry, accept caller-provided
workspace membership, or infer membership from `workspace_id`,
`subject_user_id`, app-local cache, SDK state, Desktop state, or knowledge bank
metadata.

Admitted projection shape:

- `workspace_id`
- `membership_state` in `active`, `suspended`, `revoked`, `unknown`
- `realm_environment_id`
- `observed_at`
- optional redacted display metadata

Fixed rules:

- workspace membership projection is derived only during account login,
  account refresh, custody recovery, or an admitted Realm membership refresh
  owned by `RuntimeAccountService`
- a missing, stale, unavailable, or `unknown` projection fails closed for
  workspace binding issuance and workspace binding consumption
- `active` membership is required at both issue time and consume time
- membership loss, realm-environment mismatch, custody unavailable, refresh
  failure, logout, account switch, policy revocation, or daemon restart must
  revoke or invalidate related workspace bindings before any positive
  WORKSPACE_PRIVATE allow can be returned
- projection may be surfaced to local first-party status only as redacted
  account projection; it must not expose Realm tokens, raw JWT claims,
  `subject_user_id`, or membership proof material that apps can replay

## K-ACCSVC-019 Workspace Binding Account Surface And Resolver Ownership

`RuntimeAccountService` is the only possible owner of workspace binding
issuance, revocation, and the internal resolver seam used by runtime knowledge
authorization. This rule admits no transport or origin for public
`IssueWorkspaceBinding` or `RevokeWorkspaceBinding`; both are explicit
`blocked_pending_authority` rows and ordinary authenticated, SDK, Desktop,
binding-only, local-app, Web/cloud, and external-principal callers
are denied. A future admission must name the exact protected origin and
operation policy before either method may be implemented or exported.

Fixed rules:

- workspace binding issue/revoke is workspace-specific authority and must not be
  implemented by broadening `IssueScopedAppBinding` / `RevokeScopedAppBinding`
- if independently admitted later, issue/revoke may only mutate workspace
  knowledge attachments and must not return account truth, membership truth,
  Realm tokens, or resolver decisions
- `ResolveWorkspaceBinding` is not a public RPC, not an SDK/Desktop-visible
  method, and not a probing surface; it is an internal Go/runtime capability
  consumed by `RuntimeCognitionService` through the cognition
  `KnowledgeAuthorizer` seam
- resolver matching must use Runtime-authenticated caller identity from the
  app session/envelope and account projection: `runtime_app_id`,
  `app_instance_id`, `device_id`, `account_id`, and `realm_environment_id`
- resolver matching must not use `KnowledgeRequestContext.app_id`,
  `subject_user_id`, attachment self-claims, app-local cache, Desktop state, or
  SDK state as proof
- issue-time validation and consume-time validation both require
  `K-ACCSVC-018` active membership for the target workspace
- account state other than `authenticated`, refresh/custody uncertainty, or
  stale workspace membership projection fails closed

## K-ACCSVC-021 Fresh Local Presence Verification

`RequestPresenceVerification` is a Runtime-owned user-presence check for
app surfaces that need a second confirmation before revealing sensitive local
data. The method confirms that the currently present operator passed a local
interaction owned by Runtime within a bounded TTL; it is not durable identity
proof. Realm may participate only through a Runtime-owned fresh Nimi reauth
provider; ordinary Realm session state remains insufficient.

Fixed rules:

- Runtime selects and executes the concrete provider chain: OS credential /
  Windows Hello/PIN / macOS LocalAuthentication first, Nimi reauth fallback, or
  another admitted local interaction.
  Apps and SDKs must not select providers by passing passwords, tokens, secrets,
  or raw challenge material.
- A current authenticated account session is necessary for account projection
  but is never sufficient for positive presence verification.
- Realm login, access-token refresh, `GetAccessToken`, `InvokeRealmUnary`,
  server-side `/me`, or app-owned session checks do not satisfy this method.
- Runtime-owned `NIMI_REAUTH` may satisfy this method only when Runtime forces a
  fresh Realm OAuth login prompt, owns the loopback callback, allocates that
  callback only on loopback ports `1024..49151` below the OS dynamic-port
  range, validates state/code-verifier exchange, verifies the returned account subject matches
  the current Runtime account, and discards any token material instead of
  turning it into app-owned session truth.
- On Windows, the fixed restricted-service principal cannot acquire an
  interactive-user token merely to launch a browser. For a protected Desktop
  control operation only, Runtime may therefore deliver its generated
  authorization URL to a single-use, random, loopback-only Desktop browser
  launcher. Runtime MUST first derive the protected Desktop transport/process
  origin and MUST reject non-loopback, redirected, or malformed launchers. The
  launcher endpoint MUST be random and single-use; reuse or delivery failure
  fails closed. Runtime MUST retain the OAuth attempt, state, nonce, PKCE
  verifier, callback, exchange, subject match, and final presence verdict. The
  launcher receives no bearer or verifier, cannot select a provider, cannot
  assert completion, and is neither authorization nor presence proof. The
  launcher endpoint is request-scoped technical metadata only and MUST NOT be
  persisted or logged.
- The request must carry a non-empty `purpose` and a bounded TTL. Runtime may
  clamp TTL downward. A positive response must include a `verified_until`
  timestamp no later than the accepted TTL window.
- If Runtime has neither a formal local presence verifier nor a formal fresh
  Nimi reauth fallback for the host / Realm configuration, the method returns
  `accepted=false`, state `unavailable`, account reason
  `presence_verification_unavailable`, and no sensitive app data may be shown.
- Provider result, method, state, and expiry may be projected to the caller, but
  provider secrets, password material, bearer tokens, and OS challenge details
  must never be returned or logged.

## K-ACCSVC-020 Fail-Close Doctrine

Fresh presence verification also follows this doctrine: a missing, unavailable,
cancelled, expired, or non-verified provider must fail closed and must not be
replaced by ordinary login state, access-token state, Realm server state, or
app-owned prompts. The only Realm-backed exception is the Runtime-owned
`NIMI_REAUTH` flow defined in `K-ACCSVC-021`.

以下情况必须 fail-close，禁止伪造成功：

- account state unknown
- custody unavailable
- binding 不存在 / state 非 `active`
- login proof expired / replayed / mismatched
- refresh 失败且无可恢复路径
- daemon restart 后无法恢复 custody
- remote revocation 检测失败但无法证明本地 session 仍有效
- account projection 缺少必需字段

## K-ACCSVC-022 Local App Caller Posture

`K-PLOCAL-008` admits a local-app session only from an atomically consumed
launch lease on the verified child channel. The `LOCAL_APP` caller class and
`local_app_principal_id` are Runtime-derived; the request cannot select caller
class, account, principal, record, grant, release or capabilities.
Account-control and credential-bearing methods remain denied. A zero-grant
session is valid origin proof and must still be denied for protected Nimi API
operations until an exact grant and owner policy allow the operation.

`RuntimeAccountService` owns the private provenance-agnostic per-operation
coordinator. On every selected local-app operation it combines the current
account generation when required, `K-APP-*` principal/record resolution,
`K-PLOCAL-*` live process/session resolution, `K-GRANT-*` exact current grant,
presence when required, and the canonical operation owner policy. The
coordinator returns one immutable decision and audit context; it owns none of
those inputs and creates no secondary cache or portable credential. Missing,
expired, revoked, tombstoned, superseded, process-mismatched or account-mismatched
inputs deny the operation. Immutable provenance remains an opaque input seam and
returns typed unavailable until 0P/P admits a producer.

## K-ACCSVC-023 Runtime Shared Auth Broker

Exact per-operation Realm unary authority remains blocked pending a separate
Runtime admission under K-ACCSVC-001. Existing operation tables and code are
conflict inventory, not an admitted product surface. A future admission must
retain Runtime-only bearer injection/private refresh, response credential
denial, exact payload limits, and a verified protected origin; no public grant,
portable envelope, renderer/app token provider, or direct Realm path is a
fallback.

## K-ACCSVC-024 Account RPC Permission Matrix

The Desktop account projection/control, scoped-binding control, local-app grant
control, selected local-app operations and Realm-broker transport prerequisites
are admitted only through their exact protected-transport and owner rows. This
admits no portable envelope, blanket local-app authority or raw-token
projection. Unlisted broker/realtime/media operation rows remain denied.

`tables/account-rpc-permission-matrix.yaml` is the executable authority for
per-caller RuntimeAccountService admission. Runtime handlers must enforce the
matrix before state mutation or token/credential access. `InvokeRealmUnary`
uses broker-consumer admission, not the account-control helper.
Runtime-private refresh is a non-RPC internal capability and has no public
local-app caller mode.

## K-ACCSVC-025 Host-Bound Caller Envelope

App id, source host, caller enum, manifest, renderer metadata, host
self-description, launch id and portable bearer remain non-authorizing. Local
app authority comes only from the inherited native channel and its verified live
peer. Direct local gRPC and Electron/Tauri renderer envelopes remain deny-all.

## K-ACCSVC-026 Local App Operation Coordinator And Presence

For each protected local-app operation, Runtime must evaluate the exact
principal, local record, process-bound session, current account id and account
generation when required, exact grant revision, presence proof when the owner policy requires
it, and the selected operation owner's resource policy in one decision. Grant
issuance is separate from session issuance; enabling Developer Mode, admitting
a project, or opening a session grants nothing.

Presence follows `tables/local-app-presence-protocol.yaml`. Only a
Runtime-owned OS verifier or fresh `NIMI_REAUTH` result can satisfy it. Caller
assertions, renderer prompts, login state, bearer state and prior sessions do
not. The coordinator records `local_app_principal_id`, the exact immutable or
development principal-lineage branch, record/grant/session identifiers and
revisions, account id/generation, process
identity, operation and deny reason in the Runtime audit context without
logging credentials. No downstream service may reinterpret or weaken this
decision.
