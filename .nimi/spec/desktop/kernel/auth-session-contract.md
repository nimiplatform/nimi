# Auth Session Contract

> Authority: Desktop Kernel
>
> **Authority Disposition**：
> Desktop 不再拥有 local first-party 机器层 account session truth、token custody、refresh、logout、user-switch 权威。该权威由 `RuntimeAccountService`（`K-ACCSVC-*`，见 `.nimi/spec/runtime/kernel/account-session-contract.md`）拥有。本契约下列规则的 disposition 固定为：
>
> | Rule | Disposition | Replacement Authority |
> |---|---|---|
> | `D-AUTH-001` | superseded | `K-ACCSVC-003`/`K-ACCSVC-005` Runtime account status query；Desktop 启动只 query Runtime account state |
> | `D-AUTH-002` | superseded | `K-ACCSVC-007` Runtime secure custody；Desktop 不持有 durable token 真源 |
> | `D-AUTH-006` | superseded | `K-ACCSVC-004` Runtime reactive refresh；Desktop 不再拥有 reactive refresh owner |
> | `D-AUTH-007` | superseded | `K-ACCSVC-004` Runtime proactive refresh；Desktop 不再拥有 refresh 计时器 |
> | `D-AUTH-008` | superseded | `K-ACCSVC-007` Runtime refresh-token custody；Desktop 永远不存储 refresh token |
> | `D-AUTH-009` | superseded | `K-ACCSVC-004`/`K-ACCSVC-010` Runtime token expiration / refresh / remote revocation owner |
> | `D-AUTH-013` | superseded | `K-ACCSVC-009` Runtime-owned login route decision；Desktop 仅执行 UX 指令 |
> | `D-AUTH-014` | superseded | `K-BIND-006` scoped binding stale-request rejection；Runtime 拥有 revalidation 真相 |
> | `D-AUTH-010` / `D-AUTH-011` / `D-AUTH-012` | retained | external-principal UI 仍由 Desktop 拥有，与 account session 分离 |
>
> Desktop 可以保留 feature-local Realm data calls，但默认且最终路径是
> Runtime-mediated Realm broker。Desktop shell 不使用 raw `GetAccessToken`；
> 不得持有 refresh token、durable session、或 app-owned login truth。
>
> Active owner switch 与代码删除由 `K-ACCSVC-013` 约束；不得保留 dual-read / fallback。

## Scope

Desktop account projection lifecycle contract. It defines the local
first-party Desktop consumption boundary for Runtime-owned account state and
the separate Web/cloud adapter boundary. It does not make Desktop an account
session, token custody, refresh, logout, or login-route authority.

> **Authority Note**：superseded 规则仅供历史参照；对应 product code 路径必须删除或 hard-block，且不得保留 dual-read / fallback。

## D-AUTH-001 — Session Bootstrap

Superseded for Desktop local first-party account sessions. Desktop bootstrap
MUST NOT run `bootstrapAuthSession`, read `runtime_defaults.realm.accessToken`
as durable account truth, call `auth_session_load`, or fall back to a Desktop
anonymous auth state as ordinary product use.

Desktop startup MUST query Runtime account-session projection
(`GetAccountSessionStatus` and, where reactive state is needed,
`SubscribeAccountSessionEvents`). Authenticated product use requires Runtime
to project an authenticated account session. Missing, unavailable, expired, or
reauth-required Runtime account state routes to the login/not-logged-in product
state and does not become ordinary shell success.

## D-AUTH-002 — Token 持久化（Desktop）

Superseded for Desktop local first-party account sessions. Desktop MUST NOT
treat `~/.nimi/auth/session.v1.json`, `auth_session_load`,
`auth_session_save`, or `auth_session_clear` as account-session persistence,
token custody, refresh, logout, or revalidation truth.

Runtime secure custody (`K-ACCSVC-007`) owns durable token/session material.
Desktop feature-data modules and renderer stores are in-process projections
only. Local first-party consumers, including Avatar paths, must consume
Runtime account-session projection, Runtime-issued short-lived access-token
projection, or scoped binding projection as applicable; they must not read a
shared Desktop auth session.

## D-AUTH-003 — Token 持久化（Web）

Web 环境只通过浏览器存储持久化非敏感会话元数据：

- 获取：从 localStorage 读取用户投影与过期元数据；raw access token 不从浏览器持久化存储恢复。
- 更新：仅写入 user/expiresAt/updatedAt 等非敏感字段。
- 清除：删除 localStorage 条目。

## D-AUTH-004 — Runtime Account Projection State

Desktop local first-party auth state is a redacted projection of
`RuntimeAccountService`, not a Desktop-held Realm SDK session.

| Desktop projection | Required Runtime / SDK condition | Desktop allowance |
|---|---|---|
| `bootstrapping` | Runtime account status has not been resolved or the Runtime-backed Platform client is not assembled | Render startup / login-gate pending state only |
| `authenticated` | `GetAccountSessionStatus` projects `authenticated` and the SDK Desktop composition can use an admitted Runtime-mediated Realm operation | Store redacted user/account display projection and enable authenticated feature wiring |
| `anonymous` | Runtime projects `anonymous`, `expired`, `reauth_required`, `unavailable`, or broker admission is unavailable/fail-closed | Render login / reauth / unavailable product state and disable authenticated feature wiring |

Fixed rules:

- Desktop MUST configure the Platform client through the SDK Runtime account
  projection and mediated Realm broker surface. It MUST NOT pass an
  app-owned access token, refresh token, session store, JWT hook, or subject
  provider into local first-party Runtime or Realm transport.
- Desktop renderer stores, profile/settings screens, `public-web` facades, and
  bootstrap watchers MUST NOT contain or propagate `auth.token`,
  `accessToken`, `refreshToken`, raw JWT, or token-bearing session setter
  parameters for local first-party auth state.
- Realm data calls retained in Desktop feature modules MUST use SDK Realm
  clients backed by `InvokeRealmUnary`. Runtime owns bearer injection and
  internal refresh; Desktop may observe only redacted account/user projection
  and bounded broker results.
- `RuntimeAuthService` remains the app-session / external-principal session
  authority (`K-AUTHSVC-*`). It does not replace `RuntimeAccountService`, and
  Desktop app registration is not account-session custody or login truth.
- Explicit Web/cloud adapter mode is a separate admitted boundary. It may use
  SDK/Realm web session plumbing where admitted, but it MUST stay fenced from
  local first-party Desktop app-store state and MUST NOT become Desktop local
  account truth.

## D-AUTH-005 — Auth 事件联动

Desktop auth watcher listens to Runtime account-session projection events:

- `isAuthenticated = true`：配置或 revalidate SDK Platform Client 的
  Runtime-mediated Realm transport and redacted account projection.
- `isAuthenticated = false`：清空 renderer redacted auth projection，停止
  feature-local subscriptions / polling。
- Desktop must not reintroduce a DataSync listener, token hot-state, or refresh timer as an auth owner.

## D-AUTH-006 — Token 刷新: Reactive

Superseded for Desktop first-party account sessions. Runtime owns reactive refresh
through `K-ACCSVC-004`; Desktop consumes the resulting session/status projection.

- SDK local app facades must not expose public account refresh helpers.
  Desktop must not own refresh token custody, token refresh scheduling, or
  durable refresh results; broker/token projection refresh is Runtime-private.
- Refresh failure projection clears renderer auth projection and disables
  authenticated Realm feature data.

## D-AUTH-007 — Token 刷新: Proactive

Superseded for Desktop first-party account sessions. Runtime owns proactive
refresh scheduling through `K-ACCSVC-004`.

- Desktop may decode token expiry only for non-authoritative UX display.
- Desktop must not schedule a proactive refresh timer or persist refresh outcomes.

## D-AUTH-008 — refreshToken 持久化

Superseded for Desktop first-party account sessions. Desktop must not persist or
cache refresh tokens.

- Runtime secure custody owns refresh token storage (`K-ACCSVC-007`).
- SDK client/provider internals may hold an in-memory short-lived access token
  projection long enough to execute an admitted request. Desktop renderer
  app-store state, public-web facades, profile/settings screens, and bootstrap
  watchers MUST NOT carry access-token or refresh-token fields.
- Desktop renderer stores, settings/profile pages, bootstrap watchers, and the
  `public-web` bootstrap facade MUST NOT expose a `refreshToken` field or pass a
  refresh token through app-level session setters. Non-local-first-party
  Web/cloud refresh handling, where admitted, must stay inside SDK/Realm client
  session plumbing and must not become Zustand/app-store state.

## D-AUTH-009 — Token 过期检测与刷新所有权

Desktop token 过期检测与刷新所有权已迁移到 Runtime account session service。

**所有权链**：

| 层 | 职责 | 实现位置 |
|---|---|---|
| Runtime | token custody、refresh、revocation reaction、account session status projection | K-ACCSVC-004、K-ACCSVC-005、K-ACCSVC-007 |
| SDK | typed access-token provider plumbing and public Realm/Runtime transport ergonomics | S-REALM-*、S-RUNTIME-* |
| Desktop | renderer auth projection, login-gate UI, feature data enable/disable wiring | D-AUTH-004、D-AUTH-005 |
| Realm Backend | token 签发、刷新、校验 | 不在 spec 管辖范围 |

## D-AUTH-010 — ExternalPrincipal Token UI Flow

Desktop 对 ExternalPrincipal 的 UI 投影固定在 Runtime Config 的 External Agent Access 面板：

- 首屏必须通过 SDK Runtime projection 读取 gateway status 与已签发 token
  ledger。
- `Issue Token` 表单固定字段为 `principalId`、`subjectAccountId`、`mode`、`actions`、`ttlSeconds`。
- 明文 token 只允许在签发成功后的当前会话内展示一次；后续列表页只保留 `tokenId`、`principalId`、`mode`、`subjectAccountId`、过期状态与 revoke 能力。
- gateway 不可用时，签发与吊销操作必须禁用，并向用户展示可读错误。

## D-AUTH-011 — ExternalPrincipal Token State & Revocation

- token ledger 的 single source of truth 为 Runtime External Agent gateway /
  grant ledger；Desktop 前端不持久化明文 token。
- `Refresh` 必须重新通过 SDK 从 Runtime gateway 拉取状态与 token ledger，不得
  依赖本地缓存或 Tauri gateway state 推断 token 状态。
- `Revoke` 成功后，若当前面板仍持有同一 token 的明文显示，必须立即清空。
- 过期 token 与 revoked token 都保留在 UI ledger 中，但状态必须显式区分为 `expired` / `revoked`。

## D-AUTH-012 — External Agent 吊销与审计

- **吊销 token 保持可见**: 吊销后 token 保留在 ledger 中，`revoked_at` 时间戳已设置。不删除记录。
- **审计主体隔离**: 审计查询 (`/audit` endpoint) 按请求方 `principal_id` 过滤。Agent 无法查询其他 principal 的审计记录。
- **审计事件来源**: 审计记录源自 Runtime audit store 与 Runtime-owned
  External Agent action/completion ledger。
- **审计保留策略**: 受 runtime audit ring buffer 配置 (`cfg.AuditRingBufferSize`) 约束；external agent audit 无独立保留策略。

## D-AUTH-013 — Email Entry Route Typed Decision

anonymous 状态下 desktop 可调用 `Realm.AuthService.checkEmail` 获取类型化登录路由（S-REALM-038）。

- 返回 `CheckEmailEntryRoute` 三值判定：`register_with_otp`、`login_with_otp`、`login_with_password`。
- Desktop 根据判定结果路由到对应的注册/OTP/密码登录表单。
- 此调用不需要 accessToken，属于 S-REALM-038 允许的公开决策端点。

## D-AUTH-014 — Local Consumer Revalidation

Superseded for shared Desktop auth session. Local consumer revalidation MUST
use Runtime account-session projection, Runtime-mediated Realm broker, and
scoped binding validation. It MUST NOT poll `auth_session_load`, depend on
`auth_session_clear`, or infer user-switch/logout from Desktop-owned session
files.

Logout, token expiry, revocation, user switch, same-user token rotation,
realm mismatch, and unavailable custody are Runtime account-session events or
status projections. Desktop consumers must fail closed on the corresponding
Runtime state instead of waiting for incidental Realm 401s or renderer-local
cache invalidation.

## Fact Sources

- `tables/bootstrap-phases.yaml` — Auth session 阶段
- `tables/store-slices.yaml` — Auth slice 定义
