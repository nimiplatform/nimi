# Account Session Contract

> Owner Domain: `K-ACCSVC-*`

## K-ACCSVC-001 服务职责

`RuntimeAccountService` 拥有本地机器层的 account session truth、custody、login lifecycle、refresh、logout、user switch、daemon restart recovery、首方 short-lived app access-token projection、和 Runtime-issued scoped app binding issuance。它是 local account authority 与 refresh-token custody 的唯一所有者。

`RuntimeAuthService`（`K-AUTHSVC-*`）继续负责 app session 与 external-principal session，二者不互相替代。`RuntimeAccountService` 不接受调用方提供的 `subject_user_id` 作为 account 真相，account subject 必须从 Runtime account custody 内部派生。

`RuntimeAccountService` 不是所有 Realm data request 的 RPC proxy。Admitted local first-party app 可以通过 Runtime-issued short-lived access token 继续直接调用 Realm data API；developer-registered local app 只能使用 Runtime-owned account projection、app session、和 scoped binding，不能获得 raw Realm access token。任何 app 都不得拥有 refresh token、durable session、login bootstrap、或 subject truth。

## K-ACCSVC-002 方法集合（权威）

`RuntimeAccountService` 方法固定为：

1. `GetAccountSessionStatus`
2. `SubscribeAccountSessionEvents`
3. `BeginLogin`
4. `CompleteLogin`
5. `RequestPresenceVerification`
6. `GetAccessToken`
7. `RefreshAccountSession`
8. `Logout`
9. `SwitchAccount`
10. `IssueScopedAppBinding`
11. `RevokeScopedAppBinding`
12. `IssueWorkspaceBinding`
13. `RevokeWorkspaceBinding`

Admitted 方法集合为冻结集合。`IssueWorkspaceBinding` /
`RevokeWorkspaceBinding` are admitted only for workspace-specific attachment
mint/revoke under `K-ACCSVC-019` and `K-BIND-018`.
`RequestPresenceVerification` is admitted only for fresh local user-presence
checks under `K-ACCSVC-021`. Any further method must undergo a new rule
admission before proto / RPC table projection.

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
- `GetAccessToken`: 向 registry-admitted true local first-party app instance 返回当前 short-lived access token，或在 Runtime 内部 refresh 后返回新 access token。不得返回 refresh token、durable session、raw subject、或任何可由 app 自行刷新 token 的材料。Developer-registered local app 与 explicit binding-only Avatar embodiment 必须被拒绝；default `nimi.avatar` first-party app instance may use this method when registry-admitted.
- `RefreshAccountSession`: Runtime 主动或被动刷新；调用方不得提交 refresh token。
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

Public local account status / lifecycle RPCs require Runtime app registry admitted caller registration before status projection, refresh, logout, or switch execution. Developer-registered local app callers may use `GetAccountSessionStatus`, `SubscribeAccountSessionEvents`, `BeginLogin`, `CompleteLogin`, `RequestPresenceVerification`, `RefreshAccountSession`, and scoped binding issuance after the developer-registration double gate admits the instance, but must be rejected for `GetAccessToken`, `Logout`, and `SwitchAccount`. Unauthenticated / anonymous status may be returned to the Desktop login UI only when the caller is an explicitly admitted Desktop shell, local first-party app instance, or developer-registered local app instance; shape-only caller identity is not sufficient.

任何方法都不允许接受 raw Realm token、refresh token、raw JWT、或 caller 提供的 `subject_user_id` 作为 account truth。

`GetAccessToken` 允许返回 Realm access token，或未来 backend-issued scoped app token，但必须满足：

- caller 是 registry-admitted true local first-party app mode；
- caller app / instance registration 与 Runtime-owned app registry/admission policy 精确匹配；caller 不得通过 Desktop、SDK、Avatar、test fixture、或 app-local shape 自声明 first-party 权限；
- account state 为 `authenticated`，或 Runtime 能先完成 refresh；
- token 短生命、app-memory-only；
- token 不可自刷新；
- logout、user switch、refresh failure、remote revocation、policy revoke 后 Runtime 能使后续 provider 调用 fail-close；
- app 不得持久化该 token，不得把它作为 login truth，不得 decode JWT 作为 subject truth。

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
| macOS desktop | Runtime daemon 拥有的 system keychain entry | `unavailable`；authenticated 调用 fail-close |
| Windows desktop | Runtime daemon 拥有的 OS credential vault entry | `unavailable`；authenticated 调用 fail-close |
| Linux desktop | secret service / libsecret（如可用） | 无 secure backend 时 `unavailable` |
| Headless / server | 显式配置的 Runtime custody backend | 未配置时 fail-close |

固定规则：

- Runtime 拥有 refresh material；Desktop / app 不存储任何 durable token。
- access token 短生命，可通过 `GetAccessToken` 投影给 admitted app 用于直接 Realm data calls；app 仅可内存使用，不得持久化或自刷新。
- refresh token rotation 必须原子：新 token 提交后再丢弃旧 token。
- Reuse detection：在 rotation 之后再次观察到旧 refresh token，必须 revoke 本地 chain，发出 `refresh.failed` reason `replay`，并进入 `reauth_required` 或 `unavailable`。
- audit 永远不记录 token 值、auth code、PKCE verifier、refresh material。

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
| Desktop shell | Runtime-mediated app registration | `authenticated` 或 anonymous（仅 UX shell） | Runtime account broker + optional short-lived access-token projection | durable token custody、refresh token、app-owned login |
| SDK local first-party app | Runtime local mode 注册 | 操作要求 authenticated 时必须 `authenticated` | Runtime-issued binding + optional short-lived access-token projection | app-provided token / subject providers、refresh token、session store |
| SDK developer-registered local app | Runtime developer-registration double gate | 操作要求 authenticated 时必须 `authenticated` | Runtime-issued app session + scoped binding | `GetAccessToken` raw Realm token、first-party permission ceiling、logout/switch authority、app-provided token / subject providers |
| Default Avatar app (`nimi.avatar`) | Runtime local first-party app registration | 同 local first-party app | Runtime account broker + optional short-lived access-token projection | independent auth truth、refresh token、durable session、Desktop launch auth/package/anchor truth |
| Binding-only Avatar mode | 不允许直接 account registration | N/A | Runtime-issued scoped binding from owner surface | account access token、refresh token、anchor 创建、independent auth truth |
| Web / cloud app | 显式 Web/cloud adapter | Web/cloud session | Web/cloud adapter | local Runtime account authority claim |
| External principal | 现有 external-principal 注册 | external proof | external-principal session / grant | local account projection claim |

## K-ACCSVC-013 Activation Boundary

account broker 实现允许在 Desktop / SDK 切换前作为 inert substrate 落地。Inert 模式必须满足：

- 不得作为 active first-party local account truth
- 不得为 Desktop / Avatar / SDK 提供 production account projection
- 不得发布 production first-party scoped binding
- 不得读取 / 镜像 / 调和 Desktop shared auth
- 不得成为 Desktop / SDK local auth fallback

active owner switch 必须原子闭合：Runtime broker 激活、SDK / kit local first-party seam 移除、Desktop login UX adapter 转换三件事必须在同一 authority transition 内闭合，并在 transition 完成前删除或 hard-block 替换的 Desktop shared-auth 与 SDK local token / subject owner 路径。

同一 active owner switch 还必须激活 Runtime-backed short-lived access-token provider，使保留 direct Realm data calls 的 admitted apps 不需要 app-owned refresh/session truth。

## K-ACCSVC-014 与既有 Auth 服务的关系

- account session 回答 “谁登录在本机 Runtime”。
- app session 回答 “哪个已注册 app instance 在调用”，由 `RuntimeAuthService` 拥有。
- external-principal session / grant 回答 “哪个外部主体被授权执行 scoped 操作”，由 `RuntimeAuthService` / `RuntimeGrantService` 拥有。

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

`RuntimeAccountService` owns workspace binding issuance, revocation, and the
internal resolver seam used by runtime knowledge authorization. Public proto /
RPC projection of workspace binding issue/revoke is admitted only for
`IssueWorkspaceBinding` and `RevokeWorkspaceBinding`; no caller-visible
workspace binding resolve/probe RPC exists.

Fixed rules:

- workspace binding issue/revoke is workspace-specific authority and must not be
  implemented by broadening `IssueScopedAppBinding` / `RevokeScopedAppBinding`
- `IssueWorkspaceBinding` and `RevokeWorkspaceBinding` public local
  first-party account RPCs may only mint/revoke workspace knowledge
  attachments; they must not return account truth, membership truth, Realm
  tokens, or resolver decisions
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
  fresh Realm OAuth login prompt, owns the loopback callback, validates
  state/code-verifier exchange, verifies the returned account subject matches
  the current Runtime account, and discards any token material instead of
  turning it into app-owned session truth.
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
