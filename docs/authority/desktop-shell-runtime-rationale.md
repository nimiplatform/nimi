# Desktop Shell Runtime Rationale

> 本文为 rationale/历史散文，非规范权威；规范 = `.nimi/spec/desktop/shell-runtime.authority.yaml`。

## Rationale 完整性对账

### 已收录

- Bootstrap：`D-BOOT-001..004`、`D-BOOT-006..012` 的 Desktop shell 行为收录为 `rule.nimi.desktop.shell-runtime.r002..r012`、`r081..r083`；旧 bootstrap phase 与 feature-flag 机器事实收录为 `r001`、`r042`。
- Account session：`D-AUTH-001..014` 中的 Desktop redacted projection、login gate、Runtime-mediated operation、event continuity、External Principal UI 与 Web/cloud fence 收录为 `r008`、`r013..r022`、`r025`、`r033`、`r035`、`r044`。
- Security：`D-SEC-001..015` 中属于 Desktop shell 的 protected trust、credential non-custody、callback-only OAuth、CSP、model provenance、connector custody、scrubbing、External Agent projection 与 local-app leak boundary 收录为 `r002..r004`、`r014..r034`。
- State：`D-STATE-001` 的 redacted replacement、`D-STATE-002`、`D-STATE-004`、`D-STATE-005` 收录为 `r035..r041`；旧 store catalog 机器事实收录为 `r041`。
- DataSync：`D-DSYNC-000..013` 全部 non-admission 与 owner-selection 语义收录为 `r043..r057`。
- Offline degradation：`D-OFFLINE-001..005` 的 closed levels、connectivity classification、bounded outbox/cache、fresh reconnect 与 fail-closed mutation 语义收录为 `r058..r065`。
- Self-update：signed compatible pair、fixed-service release truth、immutable updater trust、fail-closed renderer/Web surface 与 update availability 收录为 `r066..r072`。
- Network：`D-NET-001..005` 的 retry、event、bounded shell fetch 与 error semantics，以及 `D-NET-006..007` 的 Runtime owner/non-admission fence收录为 `r073..r080`。
- 五份旧表的机器消费面已降级到 `config/desktop-shell-runtime-*.yaml`：bootstrap 绑定 `r001`/`r010`，store 绑定 `r041`，feature flags 绑定 `r042`，DataSync owner map 绑定 `r043..r056`，retry codes 绑定 `r073`；这些 config 不是产品权威。
- 下文完整保留八份旧契约散文，供历史 rationale 与逐条核对使用。

### 缺失

- 对账发现 3 项遗漏，现已补齐：host-only Agent route/memory cache-only + fail-closed（`r081`）、不以 Realm ready 阻塞 shell 且首个 admitted feature request 显式投影失败（`r082`）、shell-fatal bootstrap 的 redacted error-level observability（`r083`）。
- 补齐后缺失：无。

### 有意拒绝

- Web/browser 的 storage、cookie、logout persistence 细节不进入 `desktop.shell-runtime`；只保留 Web/cloud material 不得成为 local first-party Desktop truth 的围栏。
- Exact IPC command inventory、`afterSequence` native injection、`hasTauriInvoke` 与 invoke lifecycle 不在本容器重复定义；其产品语义由 `.nimi/spec/desktop/bridge-ipc.authority.yaml` 拥有。
- Runtime External Agent 的 scope evaluator、execution/completion verification、audit filter 与 ring-buffer retention 不进入 Desktop authority；Desktop 只保留 typed projection、one-time plaintext 与 fail-closed control UI。
- Desktop-owned PKCE verifier、client secret、token exchange/custody、direct-Realm route/fetch、bearer Socket.IO、port rewrite、session/replay/LRU 与 polling coordination 均拒绝准入。
- 旧 auth token slice、bearer-bearing bootstrap phase 描述、generic offline Runtime/Realm config staging、cache/outbox/signed-binary/loopback/synthetic-fixture pseudo-success 均拒绝准入。
- 历史 `loadCurrentUser()` direct-Realm implementation detail 不准入；`r082` 保留的是首个 independently admitted Runtime-mediated feature request 的可达性与可见失败语义。

## Normative migration dispositions

以下旧命题保留为历史 rationale，但不进入当前 `desktop.shell-runtime` 规范准入：

- `D-AUTH-003` 与 `D-SEC-010` 的 Web 浏览器持久化细节属于 Web 会话边界；新规范只保留 Web/cloud material 不得成为 Desktop local first-party account truth 的围栏。
- `D-SEC-003` 的 Desktop PKCE verifier、client secret 与 token exchange custody 被拒绝；当前准入只允许 native callback observation，exchange 与 custody 归 Runtime。
- `D-STATE-001` 与旧 `store-slices` 表中的 `auth.token`、token-bearing session setter 被拒绝；auth slice 只承载 Runtime-derived redacted projection。
- 旧 bootstrap phase 表中的 Realm base URL、access token 初始化描述被拒绝；生产 bootstrap 使用 verified protected carrier，不向 Desktop 注入 bearer。
- `D-AUTH-013` 的 Desktop direct-Realm route decision 被 Runtime-owned typed login-route decision supersede；Desktop 仅路由 UX。
- `D-NET-004` 的 authenticated Runtime/Realm proxy 解释被拒绝；保留的 shell fetch 仅限 exact public-origin allowlist，authenticated operations 走 typed Runtime/Realm broker surfaces。
- `D-NET-006` 与 `D-NET-007` 的 renderer bearer Socket.IO、port rewrite、session protocol、LRU replay、polling/realtime coordination 细节继续保持 blocked，直到 Runtime protocol authority 与 Desktop carrier integration 分别准入。
- 任何把 `bootstrapReady`、loopback、service running、cache/outbox、fallback text、signed binary presence 或 synthetic fixture 当作 product/security success 的解释均被拒绝。

## Preserved source: Bootstrap Contract

# Bootstrap Contract

> Authority: Desktop Kernel

## Scope

Desktop 应用启动序列契约。定义 renderer 进程从 `bootstrapRuntime()` 调用到 `bootstrapReady=true` 的多阶段异步初始化流程。

## D-BOOT-001 — Runtime Defaults 加载

启动序列首先读取 Desktop 自身的 signed release metadata，并通过 Kit 共享
native protected carrier 调用 typed Runtime service `status`。`runtime_defaults`
若保留，只能返回非安全 shell hints；它不得返回 Realm/JWKS/revocation URL、
access token、account/subject、provider/connector credential、Runtime endpoint、
binary path、service definition、trust record path 或配置文档。

Production Runtime 已由 signed installer/service updater 安装为独立 OS service。
Desktop 不 stage、选择、执行或探测候选 Runtime binary，不读取任何 Runtime
配置物理路径，也不通过 `PATH`、env、argv、`NIMI_RUNTIME_BINARY` 或用户文件
改变 production service。Service 缺失、停止、版本不受信或 protected handshake
失败时，Desktop 显示 typed unavailable/repair state；只有 `start` 可请求固定
service，`restart` 按 K-PLOCAL 的 Runtime-self-exit/service-manager 语义执行。

Product readiness state may still be projected from the Platform-owned product
control record, but Runtime security configuration and credential custody are
never inferred from that user-facing record.

### No Desktop Runtime Security-Config Sync

Desktop does not read/merge/write Runtime JSON and does not inject Realm JWT
verification inputs. Signed service/release boot configuration and
Runtime-owned protected configuration are the only authorities. Typed redacted
configuration operations, when independently admitted, return neither a path
nor a whole document. A restart-required result may request typed service
`restart`; it never grants Desktop stop, binary selection, or config-file access.

执行命令：

- `pnpm check:desktop-no-legacy-runtime-config-path`

## D-BOOT-002 — Platform Client 初始化

Desktop initializes the SDK in local Runtime-backed mode with the verified
protected host carrier. It supplies no Realm base URL, Realm bearer, subject
provider, refresh provider, or persisted auth session. `RegisterApp`/
`OpenSession` remain binding-only; the separate `OpenDesktopSession` connection
establishes Desktop protected origin. Unavailable protected verification is a
typed login/repair state, never anonymous product readiness.

This is the Desktop production binding for the App-owned canonical renderer
factory required by `P-SIM-006`; it is not renderer construction itself. The
same factory can receive a host-neutral Simulator binding without executing
`D-BOOT-*`, constructing a protected carrier, or reaching Runtime/Realm. The
factory cannot detect which binding supplied it or select alternate UI/UX.

## D-BOOT-003 — Desktop DataSync Facade Retirement

Desktop 不再初始化 `apps/desktop/src/runtime/data-sync/**`，也不得恢复
`dataSync.initApi()` / app-local Realm facade 作为当前平台入口。

- Authenticated Realm operations must terminate inside Runtime custody and use
  an independently admitted typed Runtime-mediated operation. Desktop feature
  modules and SDK must not call Realm directly or inject a bearer.
- Until the exact Runtime-mediated operation row is admitted, the corresponding
  feature path remains unavailable rather than falling back to `realm-api.ts`,
  HTTP proxy, or a Platform Client direct-Realm adapter.
- No token, polling, hot-state, provider/model, or product truth may be stored in
  a resurrected DataSync facade.

## D-BOOT-004 — Runtime Host 装配

`RegisterApp(appMode=FULL, ...)` is retained only as `BINDING_ONLY` descriptor
validation/bootstrap and cannot make subsequent capabilities available.
Desktop opens a fresh K-PLOCAL-006 `OpenDesktopSession` on `desktop_control`
before account control or lifecycle mutation. Any Runtime/AI/Realm capability
also requires its independently admitted protected origin and operation policy;
AppMode success, SDK connection, or loopback reachability is not authorization.

受 `enableRuntimeBootstrap` feature flag 门控（参考 `tables/feature-flags.yaml`）。

- 设置 only the verified native protected carrier and redacted Runtime status projection; no store token or general HTTP proxy becomes auth context.
- SDK may call `RegisterApp(appMode=FULL, worldRelation=RENDER)` only for binding-only descriptor validation. Success confers no AppMode capability; every later method requires its exact protected origin and operation policy.
- 构建 runtime host capabilities（local LLM health check、execution kernel turn、OpenAPI context lock）。
- 配置 speech route resolver 和 missing data capability resolver。
- 确保 core world data capabilities 与 host-only Agent LLM data capabilities（route / memory）已注册。
- host-only Agent chat route capability 必须遵循 `D-LLM-002` fail-close 语义；host-only Agent memory capability 必须遵循 Runtime/Cognition memory authority 的 cache-only + fail-close 语义。
- local route bootstrap / hydration / health merge 时，RuntimeLocalService local model list/status 是唯一 readiness 真源；host-local snapshot 只能补充展示元数据。
- 当 selected local model 与 runtime authoritative local record 缺失、degraded、或状态冲突时，Desktop 可以保留原选择用于显示，但必须把 binding 视为 unavailable/not-sendable，不得继续 fail-open 发送。

The Desktop production host alone performs this Runtime assembly. The
Simulator Adapter must not call, emulate, partially execute, or return
success-shaped values for this bootstrap; it supplies only declared
presentation projections and commands through `nimi.simulator.module/v1`.

## D-BOOT-006 — External Agent 桥接

External Agent action bridge is Runtime-owned and SDK-projected.

Desktop bootstrap MUST NOT register renderer-local action descriptors, start a
Desktop-owned action bridge, or resync descriptors through Tauri as product
authority.

Desktop MAY initialize SDK projection subscriptions for Runtime-owned External
Agent gateway/status/action surfaces when the Runtime Config UI needs them.

## D-BOOT-007 — Auth Session 引导

Desktop account bootstrap consumes the Runtime-derived
`desktop_account_host` origin on the current non-portable control connection.
It never reuses the binding-only `RegisterApp`/`OpenSession` token as account
proof and fails closed to typed unavailable/repair-required UI when protected
verification cannot be established.

> **Authority Disposition**：
> 本规则已 superseded。Replacement authority：`K-ACCSVC-005` `GetAccountSessionStatus` / `SubscribeAccountSessionEvents` 与 Runtime-mediated Realm broker。`K-ACCSVC-013` 要求 Desktop bootstrap query Runtime account state，并删除 `bootstrapAuthSession` token 交换、匿名回退、共享 auth session 与任何 Desktop/SDK bearer provider。Public token accessor has been removed and reserved。

Desktop bootstrap MUST NOT call `bootstrapAuthSession`, perform token exchange,
read shared auth session files, clear shared auth session files, or create a
Desktop-owned anonymous auth fallback.

Desktop bootstrap queries Runtime account-session projection. When Runtime
projects an unauthenticated, unavailable, expired, or reauth-required account
state, Desktop must route to `not_logged_in` / login-gate product state. It
must not enter ordinary shell or default to Runtime as normal product use.

## D-BOOT-008 — Bootstrap 完成 / 错误处理

正常路径：
- `bootstrapReady = true`、`bootstrapError = null`。
- `bootstrapReady=true` only means shell bootstrap completed. Ordinary product
  use additionally requires `<runtime_owner_state_root>/nimi.json` state `ready_for_use`, selected
  `nimi_data`, authenticated account session projection, and first-run baseline
  evidence.
- 日志级别：shell/bootstrap 致命失败为 `error`。

错误路径（仅 shell-fatal）：
- `bootstrapReady = false`、`bootstrapError = message`。
- 清除 Desktop 内存中的 redacted account projection；不得修改 Runtime custody。
- 日志级别：`error`。

packaged desktop release 校验补充：

- Desktop OS code-signing identity、installer-owned active Runtime service release、
  running executable identity 或互验结果缺失/过期/不匹配时，不得由 renderer /
  backend 合成 fallback release info。
- Desktop 不尝试 staging 或替换 Runtime；修复动作交给 signed installer/service
  updater。错误保持为 runtime unavailable / release invalid typed state。

Canonical renderer factory construction/readiness is separate from production
bootstrap readiness. Simulator-visible readiness follows `P-SIM-014`; it must
not set or infer Desktop `bootstrapReady`, account readiness, product control
readiness, or protected-host availability.

## D-BOOT-009 — 幂等性守卫

`bootstrapRuntime()` 使用 `bootstrapPromise` 单例保证全局只执行一次。
重复调用返回同一 Promise。

This singleton is scoped to one Desktop production host. It must not live in
the canonical renderer factory or a module-scope resource reachable by
Simulator instances. Every renderer instance owns an independent provider,
store, route, query-client, localization, subscription, and cleanup graph.

The Electron production host MUST acquire its process-level single-instance
lock before registering the protected Runtime bridge or creating a renderer
window. A losing launch MUST NOT open a second protected Desktop session,
reuse the active Chromium profile, or classify that local contention as
Runtime unavailability. It exits without app bootstrap after asking the owning
instance to focus its existing window. This focus notification carries no
Desktop Open intent, account/session material, or queued work.

## D-BOOT-010 — 初始数据加载触发

Initial authenticated feature-data projections are not loaded synchronously in
`bootstrapRuntime()`. After Runtime projects `authenticated`, each feature may
request only an independently admitted Runtime-mediated operation. Private
refresh remains inside Runtime and can trigger projection refresh without
exposing a token. `bootstrapReady=true` does not imply feature-data readiness.

## D-BOOT-011 — Desktop 退出、Hide 与 Daemon 关闭

Desktop 在 menu bar shell 模式下必须区分“关闭主窗口”和“退出应用”：

- **主窗口 CloseRequested**：当 `enableMenuBarShell=true` 且运行于 macOS 时，`CloseRequested` 必须仅隐藏主窗口，不得触发 app 退出，不得停止 daemon。
- **Quit path**：menu bar `Quit Nimi`、系统级 Quit、或等效显式退出路径才允许进入 app 退出流程。

Quit path stops only Desktop-owned subscriptions/watchers and exits Desktop.
The production Runtime OS service remains running. `runtime_bridge_stop` is not
an admitted command and Desktop has no direct stop permission. Administrative
uninstall and signed updater drain/restart are external service-manager paths.
This rule is invariant whether menu bar shell is enabled or disabled.

## D-BOOT-012 — Realm 可达性策略

Realm SDK `ready()` 与 Runtime SDK `ready()` 都采用 fail-close 语义（`S-REALM-019` / `S-RUNTIME-015`）：探测失败必须抛错，不得伪装成“仅记录遥测”的软失败。

**策略**：Bootstrap 不显式调用 `Realm.ready()`。Realm 可达性继续通过 `D-BOOT-010` 触发的 `loadInitialData()` 中的首个业务请求（`loadCurrentUser()`）隐式验证：

- `loadCurrentUser()` 成功：Realm 可达，正常流程。
- `loadCurrentUser()` 失败（网络错误）：Realm 不可达。Realm feature-data module 通过 `emitRealmDataError` 记录错误。UI 进入降级状态——`bootstrapReady=true` 但数据为空，用户可见空列表和加载失败提示。
- 此设计意图：`bootstrapReady` 表示"应用骨架就绪"，不表示"所有后端可达"。Realm 不可达是运行时降级，不是启动失败；但一旦显式调用 `Realm.ready()`，错误必须直接暴露给调用方。

**与 Runtime fail-close 的对比**：Runtime daemon 不可用在 Desktop 侧是运行时降级，不再阻断 app shell；需要 Runtime 的功能页展示 unavailable 提示并允许后续恢复。Realm 不可达同样是运行时降级，因为功能可以在恢复后补偿加载。

**跨层引用**：`S-REALM-019`（fail-close 语义）、`S-RUNTIME-015`（fail-close 语义）。

## Fact Sources

- `tables/bootstrap-phases.yaml` — 启动阶段枚举
- `tables/feature-flags.yaml` — feature flag 门控

## Preserved source: Auth Session Contract

# Auth Session Contract

> Authority: Desktop Kernel
>
> **Authority Disposition**：
> Desktop 不再拥有 local first-party 机器层 account session truth、token custody、refresh、logout、user-switch 权威。该权威由 `RuntimeAccountService`（`K-ACCSVC-*`，见 `.nimi/spec/runtime/protected-session.authority.yaml`）拥有。本契约下列规则的 disposition 固定为：
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
> Runtime-mediated Realm broker。Desktop shell 不使用已移除的 public token accessor；
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

Desktop login, logout, and account switching first establish a non-portable
Runtime `OpenDesktopSession` on the mutually authenticated `desktop_control`
transport. Desktop does not originate caller mode, source host, process proof,
or account authority; Runtime derives `desktop_account_host` from the verified
live Desktop process under K-PLOCAL-003..006. If protected-local verification
is unavailable, account-control UI exposes a typed unavailable/repair-required
state and does not fall back to public TCP, `RegisterApp`, `OpenSession`, or a
renderer/host-supplied session.

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
Desktop feature-data modules and renderer stores are in-process redacted
projections only. Local first-party consumers, including Avatar paths, consume
Runtime account-session projection, Runtime-mediated operations and scoped
binding projection as applicable; they never receive account bearer material or
read a shared Desktop auth session.

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
| `anonymous` | Runtime projects `anonymous` | Render explicit login state and disable account feature wiring |
| `login-pending` | Runtime projects `login_pending` | Keep the login UX active; do not enable account features |
| `authenticated` | `GetAccountSessionStatus` projects `authenticated` and the SDK Desktop composition can use an admitted Runtime-mediated Realm operation | Store redacted user/account display projection and enable authenticated feature wiring |
| `refresh-pending` | Runtime projects `refresh_pending` | Preserve the shell and projection; pause new Realm operations |
| `expired` | Runtime projects `expired` | Clear account memory/subscriptions and render an explicit expired login state |
| `reauth-required` | Runtime projects `reauth_required` | Clear account memory/subscriptions and render explicit reauthentication |
| `switching` | Runtime projects `switching` | Suspend account operations until the atomic switch completes |
| `logging-out` | Runtime projects `logging_out` | Stop account work while Runtime completes custody/binding revocation |
| `unavailable` | Runtime status/carrier/custody cannot safely project account truth | Render account/Runtime repair state; never synthesize anonymous or Cloud offline |

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

Desktop auth watcher consumes the exact protected Runtime account stream, not
local Zustand mutations. Electron and Tauri expose only
`runtime_account_session_events_open` and
`runtime_account_session_events_close`; renderer supplies only decimal-string
`afterSequence`, while native host injects caller/app/account/device/origin.

- `authenticated`: configure/revalidate the Runtime-mediated Realm transport
  and redacted projection, then enable feature subscriptions.
- `refresh_pending`: retain the shell/projection and pause new Realm work.
- `expired` / `reauth_required` / `anonymous`: clear account memory and feature
  subscriptions, clear stale L1, and route to the explicit login state.
- `unavailable`: expose account/Runtime repair state; do not project anonymous
  or Cloud offline.
- replay truncation, sequence gap, malformed decimal sequence, or delivery-order
  violation requires a fresh status query before later events are accepted.
- Desktop must not reintroduce a DataSync listener, token hot-state, refresh
  timer, or renderer-local auth truth as an auth owner.

## D-AUTH-006 — Token 刷新: Reactive

Superseded for Desktop first-party account sessions. Runtime owns reactive refresh
through `K-ACCSVC-004`; Desktop consumes the resulting session/status projection.

- SDK local app facades must not expose public account refresh helpers.
  Desktop must not own refresh token custody, token refresh scheduling, or
  durable refresh results; broker/private bearer refresh is Runtime-private.
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
- SDK and Desktop internals must not hold account bearer material. Runtime owns
  credential acquisition, refresh and network invocation; Desktop renderer
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
| SDK | typed broker/service transport ergonomics with no local bearer export | S-REALM-*、S-RUNTIME-* |
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

## Preserved source: Security Contract

# Security Contract

> Authority: Desktop Kernel

## Scope

Desktop 安全模型契约。定义 CSP 策略、AI 凭据委托、OAuth 安全、Bearer Token 处理、端点安全校验。

## D-SEC-001 — Endpoint 回环限制

Loopback restriction is not privileged-origin proof. Desktop account-control
and lifecycle mutation use only Runtime's protected `desktop_control`
endpoint, mutually authenticate the Runtime server process, and require
Runtime verification of the Desktop process and executable trust set. A TCP
port, app id, caller enum, source host, manifest, metadata, or portable bearer
cannot elevate a caller.

Before sending login/account/lifecycle material, Desktop also verifies the
Runtime service SID/UID/audit principal, live same-object executable identity,
platform-native code-signing policy and OS service-manager launch authority. A
correctly signed Runtime binary started by the interactive user, a squatted
pipe/socket, or an environment/argv-selected endpoint is rejected. Production
Desktop never directly spawns Runtime; start/restart invokes the typed OS
service-control gateway.

本地运行时端点必须为回环地址：

- 允许：`localhost`、`127.0.0.1`、`[::1]`
- 错误码：`LOCAL_AI_ENDPOINT_NOT_LOOPBACK`（`D-ERR-002`）

此规则防止本地 AI 推理流量意外路由到远程地址。

**安全深度说明**：Desktop renderer 层仅执行回环地址校验作为前端防线。完整的端点安全模型由 Runtime daemon 层执行（K-SEC-002~005），包括：HTTPS-only 默认策略、loopback 显式开关（`allow_loopback_provider_endpoint`）、高风险地址无条件拒绝（link-local `169.254.0.0/16`、私网 `fc00::/7`）、DNS 解析后 IP 重验证、TOCTOU pin 防护。两层协同保护确保本地端点安全。

## D-SEC-002 — Bearer Token 管理

- Desktop renderer, main process and SDK carrier must not receive account bearer
  material. Realm and protected Runtime calls use typed Runtime-mediated
  operations with server-side authorization.
- Refresh token custody, durable account session storage, refresh scheduling, and revocation reaction are Runtime account session responsibilities (`K-ACCSVC-*`).
- Desktop must not store bearer tokens in a resurrected DataSync hot-state, Zustand persistence, IndexedDB, or app-local durable files.
- Runtime secure custody failures and session projection failures must fail closed; Desktop must not recover by guessing, falling back to anonymous ordinary product use, or reading retired shared-session files.
- Token clear/update is driven by Runtime account session projection events and explicit login/logout UX outcomes.

## D-SEC-003 — OAuth 安全

OAuth 流程通过 Tauri IPC 执行（参考 `D-IPC-006`）：

- 支持 PKCE：`codeVerifier` 参数。
- 支持 `clientSecret` 模式。
- Redirect URI 监听：`oauth_listen_for_code` 命令在本地端口监听回调。
- 超时：`timeoutMs` 参数防止无限等待。

## D-SEC-004 — IPC 桥接安全

Renderer and app-owned Electron/Tauri host code are untrusted app principals.
They cannot construct protected origin metadata, select a trust set, mint a
Desktop session, or forward a portable protected credential. Desktop trust
comes from Runtime/OS process verification and Platform's exact executable
trust-set row, not from code calling itself trusted. For a Desktop-supervised
bundled Electron surface, Desktop main additionally owns the registry of exact
`BrowserWindow`/`WebContents` objects it created. Every protected call must bind
the invoking sender and main frame to that registry; renderer URL/origin and
navigation state are secondary integrity checks and cannot establish identity
or select a protected profile. Production builds cannot
load the non-product E2E trust set. Ordinary synthetic test Runtime
configuration cannot connect to a real account Realm. The separately signed
`dev_kernel_checkpoint` candidate is a closed exception: its installer-owned,
candidate-bound profile may bind the exact real Realm development deployment
used for browser OAuth while separately admitting only the isolated
service-owned checkpoint partition and an exact loopback provider fixture. A
checkpoint partition is bound to both the trial id and exact signed Runtime
candidate id; another candidate cannot inherit its databases or product state.
A user environment variable or renderer/argv override cannot select that account
authority, and the provider fixture cannot issue account authorization codes,
tokens, JWKS, revocation truth, or issuer authority.

Production Desktop configuration is immutable signed-release input. It must
ignore environment/argv overrides for renderer URL, Runtime binary/endpoint,
trust record/root, caller role, and Realm/account endpoint. Test overrides
exist only in a separately signed non-product build and cannot produce product
evidence. The isolated Runtime service principal owns account and
connector/provider credentials, ledger/anchor state, and process memory; a
native app-host probe must be denied direct keyring, filesystem, anchor, and
process-memory access.

- `hasTauriInvoke()` 检查 Tauri runtime presence（`__TAURI_INTERNALS__` / `__TAURI_IPC__` 或等价的显式 bridge 环境），不得要求 `window.__TAURI__` 全局暴露。
- 非 Tauri 环境抛出明确错误而非静默失败。
- 所有 IPC 调用通过统一入口 `invoke()` 执行，确保日志追踪覆盖。

## D-SEC-006 — 模型完整性校验

本地 AI 模型安装区分 verified 与 local-unverified 两类完整性语义：

- verified 安装路径（catalog / verified / 带 expected hashes 的 manifest）要求 `manifest.hashes` 非空，并在导入时执行 `LOCAL_AI_IMPORT_HASH_MISMATCH` 检查。
- 手工本地文件导入与 orphan scaffold 归类为 `local_unverified`，允许 `manifest.hashes` 为空；它表示用户确认信任的本地文件，而不是 provenance-verified 来源。
- 只有 verified 模型会因空哈希在启动前被 `LOCAL_AI_MODEL_HASHES_EMPTY` 拦截；`local_unverified` 不受该门槛阻塞。

**跨层引用**：Runtime `K-RPC-004` / `K-LOCAL-009` / `K-LOCAL-028` 是本地模型 import/install/transfer/lifecycle 的权威控制面。Desktop D-SEC-006 只定义前端 UX 安全边界，不得把 host-local 状态当成安装成功、下载完成或可启动的真相源。

**信任边界声明**：Desktop D-SEC-006 的 hash 校验只覆盖 verified 来源，防止用户通过 Desktop UI 启动宣称已验证但缺乏完整性证明的模型。`local_unverified` 是用户显式确认的本地导入信任边界，Desktop 会保留“未进行来源验证”的 provenance 标识，但不会追加同步 SHA256 阻塞启动。Runtime 仍然是格式/引擎校验、transfer 失败语义与健康判定的权威层。

## D-SEC-007 — External Agent Token 安全

- Token 通过 SDK Runtime External Agent / delegation API 签发。
- Token 可通过 SDK Runtime API 吊销。
- Token 列表通过 SDK Runtime projection 审计。
- Gateway 状态通过 SDK Runtime projection 监控。

**跨层引用**：Runtime K-AUTHSVC-006 定义 External Principal 注册与开会话的验证规则（`proof_type` + `signature_key_id` 一致性校验）。Runtime K-GRANT-003 定义 token 权限模型。Desktop 层只消费 SDK projection；Tauri backend 不得成为 External Agent token/gateway owner。

## D-SEC-008 — CSP 策略

Content Security Policy 约束：

- Tauri webview 默认启用 CSP，限制外部脚本和样式加载。
- `connect-src` 仅允许 realm API 域名和回环地址。
- 生产 `script-src` 禁止 `eval` 和 inline script。
- Desktop Tauri 开发态关闭 Vite HMR / React Fast Refresh，使 `devCsp` 与生产 `csp` 保持同等 `script-src` 约束。
- Web 模式下依赖服务端 CSP header 而非 Tauri webview 策略。

## D-SEC-009 — AI 凭据委托模型

AI provider 凭据（API key）的唯一托管者是 Runtime ConnectorService（K-CONN-001: custodian not distributor，定义于 .nimi/spec/runtime/ai-provider.authority.yaml）：

- Desktop renderer **不接触**原始 API key。用户通过 UI 输入凭据后，Desktop 调用 SDK `CreateConnector` / `UpdateConnector`（K-RPC-007/008）将凭据写入 Runtime，写入后即刻丢弃内存副本。
- AI 请求通过 `connector_id`（managed 路径，K-KEYSRC-001）路由到 Runtime，Runtime 在执行上下文中解密注入凭据（K-KEYSRC-004 step 6），下游不直接访问 CredentialStore。
- Realm access token（非 AI 凭据）仍由 `D-AUTH-002` / `D-AUTH-003` 管理，与 ConnectorService 无关。
- Desktop / Web 统一使用 SDK ConnectorService 接口，无平台差异。

**跨层引用**：K-CONN-001、K-RPC-003、K-RPC-007~009、K-KEYSRC-001/004。

## D-SEC-010 — Web 端 Token 存储安全

Web 环境 session 存储安全约束（参考 `D-AUTH-003`）：

- localStorage 不得持久化 raw access token 或 raw refresh token；浏览器持久化层只允许保存非敏感会话元数据并设置合理过期时间。
- 敏感页面（economy、auth）需在操作前重新验证 token 有效性。
- 禁止将 token 写入 cookie 以避免 CSRF 风险。
- logout 操作必须清除所有 localStorage 中的认证数据。

## D-SEC-011 — Error Message Credential Scrubbing

Bridge 错误归一化（D-ERR-005）必须在消息暴露到 UI 或日志前检测并脱敏凭据模式。

**检测模式**：
- HTTP header: `x-nimi-provider-api-key`
- 字段名 (snake_case): `provider_api_key`
- JSON key (camelCase): `"providerApiKey"`

**脱敏格式**: 所有匹配替换为 `[REDACTED_PROVIDER_API_KEY]`。

**作用域**: 同时应用于 `message` 和 `details.rawMessage` 字段。凭据安全优先于 D-ERR-005 的 raw 信息保留原则。

**扩展要求**: 当 Runtime proto 或 connector config 新增凭据字段时，须同步注册检测模式到 Bridge scrubbing 函数并更新此规则。

## D-SEC-012 — External Agent Token 状态机

External Agent token 状态机由 Runtime 拥有；Desktop 只投影其 typed state。
Runtime-owned lifecycle: **issued → valid → expired | revoked**。

- Desktop MUST display token id, principal, subject account, mode, expiry, and
  revoked/expired state exactly as projected by Runtime.
- Desktop MUST NOT persist token lifecycle state, recompute expiry/revocation,
  or maintain a Tauri SQLite token ledger as product truth.
- Runtime may use durable and in-memory layers internally, but those layers are
  Runtime implementation truth, not Desktop security authority.

## D-SEC-013 — External Agent Scope 绑定模型

Token scope 将 action ID 绑定到允许的操作阶段。Scope evaluation is
Runtime-owned and SDK-projected.

- **Ops 枚举**: `discover`, `dry-run`, `verify`, `commit`, `audit`, `events`。通配符 `*` 允许所有 ops。
- **Action ID 通配符**: `*` 匹配任意 action。
- **默认 scope 生成**: Runtime signing path owns any default scope generation.
- **阶段强制执行**: Runtime must find a matching scope 条目（action_id 匹配或通配符 AND phase 在 ops 列表中或 ops 通配符）。
- **无 scope 提升**: Token 不可获得超出签发时授予的权限。

## D-SEC-014 — External Agent 执行上下文验证

Action dispatch 前的 execution context verification 由 Runtime-owned gateway
执行。Desktop renderer / Tauri must not become the verification owner.

Runtime verification floor:

1. `execution_id` 存在且非空
2. Token/grant 在 Runtime ledger 中存在且未吊销
3. Token 未过期
4. Claims 与 Runtime ledger 记录匹配: `principal_id`, `subject_account_id`,
   `mode`, `issuer`
5. execution/completion ledger 证明该 execution 仍可提交
6. 执行所有者匹配: `principal_id` 和 token/grant identity

任一步骤失败必须 fail closed，不提供泄露性诊断详情。

## D-SEC-015 — Local App Carrier Custody And Leak Boundary

The local-app child renderer and application code may observe only typed Kit
session/permission posture, selected business inputs/results and stable reason
codes. Desktop main/native supervisor, preload, renderer storage, network,
telemetry, logs and errors must not expose or persist account bearer/refresh
material, Runtime endpoint, authorization header, local-app principal/record/
grant/session ids, immutable lineage, attestation refs, SID partition, launch
lease/challenge, process proof, Runtime epoch or native carrier handles.

Electron preload and Tauri commands expose exact named typed operations only.
There is no generic Runtime unary/stream, method-id/bytes forwarder, renderer
auth callback, endpoint/env override or caller-selected trust posture. On
revoke, account switch, mode off, process replacement or Runtime restart the
native host invalidates the old carrier before projecting the failure; retry
must traverse the owner-approved new launch/session path.

## Fact Sources

- `tables/error-codes.yaml` — 安全相关错误码（`LOCAL_AI_ENDPOINT_NOT_LOOPBACK`、`LOCAL_AI_ENDPOINT_INVALID`）
- `config/desktop-ipc-commands.yaml` — non-authoritative Desktop IPC command inventory

## Preserved source: State Contract

# State Contract

> Authority: Desktop Kernel

## Scope

Desktop 状态管理契约。定义 Zustand store 的 slice 架构、运行时字段映射、持久化策略。

本契约只拥有 store 结构、字段映射与持久化 mechanics。Agent Chat orchestration、
message/action semantics、voice workflow、media execution、prompt/context assembly、
and Runtime Agent execution truth are Runtime-owned. State surface 只能承载
Desktop UI state、SDK / Runtime projection cache、或 visible lifecycle projection，
不得成为平行 Agent Chat 语义 owner。

## D-STATE-001 — Auth Slice

`createAuthSlice` 管理认证状态：

- `auth.status: AuthStatus`（`'bootstrapping' | 'anonymous' | 'authenticated'`）
- `auth.user: Record<string, unknown> | null`
- `auth.token: string`

操作：`setAuthBootstrapping`、`setAuthSession`、`clearAuthSession`。

## D-STATE-002 — Runtime Slice

`createRuntimeSlice` 管理运行时执行字段：

- `runtimeFields: RuntimeFieldMap`（Runtime/SDK route projection 与可透传的 non-authority execution context 字段）
- `runtimeDefaults: RuntimeDefaults | null`

初始 `RuntimeFieldMap`：
- `targetType: ''`
- `mode: 'STORY'`
- `turnIndex: 1`
- `localProviderEndpoint: ''`

`RuntimeFieldMap` 必须保持 string-keyed extensible map 语义；Desktop 可以预置核心字段，但不得将额外 runtime field key 视为非法。Desktop core 不得预置 Agent chat launcher 语义。

`runtimeFields` 的 route-related 字段在 `.nimi/spec/desktop/agent-projection.authority.yaml`（`D-LLM-015` ~ `D-LLM-021`）下只允许作为 execution projection / transient input；不得继续承担 selection truth、projection truth 或 thread-global route owner 语义。
这些 route-related 字段不得从 `runtime_defaults`、renderer env fallback、或 Desktop-owned provider/model defaults 派生。

若 Desktop 持久化 Agent Chat UI settings，仅允许表达 local UI preference / placement
intent。`runtimeFields`、slice-local derived state、thread metadata 或 UI 临时字段都不得拥有
Runtime Agent Chat behavior、turn planning、message/action、voice workflow、or
execution policy truth，也不得在 hydration / migration 时猜默认值。

若 Desktop 为 runtime-owned deferred continuation / `HookIntent` 建立 anchor-bound pending
indicator、为 modality action 建立执行投影或历史记录，这些字段也只能承载 admitted resolved
outputs 的 projection / lifecycle evidence。store、hydration、migration、timer recovery、或
UI state 不得决定 deferred continuation / `HookIntent` 是否存在、是否继续有效、是否应被
delivery、或 `promptPayload` 应是什么；缺失合法 resolved message/action outputs 或
runtime-owned hook outputs 时必须 fail-close。

当前 admitted pending continuation state 只允许 process-local projection ownership；
持久化 store 不得在 hydration 后自动恢复旧 pending continuation timer，也不得把
thread/anchor metadata 升格成递归 continuation chain 的 owner。

## D-STATE-004 — UI Slice

`createUiSlice` 管理 UI 导航状态：

- `activeTab: AppTab`、`navigationBackStack: AppTab[]`
- `selectedChatId`、`selectedProfileId`、`selectedProfileIsSource`
- `profileDetailOverlayOpen`：共享资料详情弹层占据主内容区时为 `true`，shell 左 rail 需要隐藏
- `statusBanner: StatusBanner | null`
- `bootstrapReady: boolean`、`bootstrapError: string | null`

导航操作：`setActiveTab`、`navigateToProfile`、`navigateToWorld`、`navigateBack`。
`navigationBackStack` 是 Desktop detail route 返回链的唯一 process-local truth：
detail 跳转 push 当前 `activeTab`，同一 detail tab 内切换不自我入栈，
`navigateBack` pop 栈顶，栈空时才回到默认 `chat`。不得恢复单槽
`previousTab` 或在 detail panel 内另建返回来源字段。

## D-STATE-005 — Store 组合

所有 slices 通过 canonical `createAppStore()` factory 合并为每个 renderer
instance 独立的 Zustand store。Desktop production host binds exactly one
instance and may expose its bound `useAppStore` hook; `useAppStore` cannot be a
module-scope mutable singleton captured by the canonical renderer factory.
Simulator opens a fresh factory result per instance and disposal releases every
subscription/cache. No instance may observe another instance's state.

- 不使用 middleware（无 devtools、persist）— Tauri webview 环境下 Zustand middleware 与 HMR 热替换存在兼容性问题；持久化通过 admitted Tauri backend IPC（`D-IPC-001`）或 owner-specific Runtime/Realm projections 实现，无需 Zustand persist middleware。
- HMR 连续性只能保存 process-local UI/projection cache，不得保存 token custody、Realm business truth、Runtime execution truth、或恢复已退休的 DataSync hot-state。
- Simulator projection state enters the store only through App-owned Adapter
  projections/commands and is erased by scenario reset. It cannot hydrate the
  Desktop production instance or enter any persistence path.

## Fact Sources

- `.nimi/spec/desktop/agent-projection.authority.yaml` — D-LLM-022 ~ D-LLM-026 Desktop Agent Chat projection boundary
- `.nimi/spec/runtime/agent-service.authority.yaml` — Runtime Agent Chat execution/projection authority
- `tables/store-slices.yaml` — Slice 枚举
- `tables/app-tabs.yaml` — AppTab 枚举

## Preserved source: DataSync Non-Admission Contract

# DataSync Non-Admission Contract

> Authority: Desktop Kernel

## Scope

Desktop does not admit a DataSync product/platform facade. Desktop is a Nimi
ecosystem app: it may compose product views and own bounded shell/scaffold
concerns, but it must not own Realm, Runtime, Cognition, SDK, or Kit truth.

`apps/desktop/src/runtime/data-sync/**`, `@runtime/data-sync`, `dataSync.*`
business methods, and any equivalent Desktop-local DataSync facade are
non-admitted. The `D-DSYNC-*` rules below define the final owner map for product
data responsibilities that would otherwise drift into Desktop.

## D-DSYNC-000 — Non-Admitted Facade Infrastructure

The DataSync facade infrastructure is not an admitted Desktop platform layer.

- Realm transport, auth custody, token refresh, generated service access,
  request parsing, and reason-code handling belong to SDK Realm/Platform Client.
- Reusable chat, commerce, shell, bridge, accessibility, UI, and headless
  interaction patterns belong to Kit.
- Desktop may keep bounded shell/scaffold adapters for offline cache, query
  invalidation, local upload placeholders, and product-specific view-model
  composition.
- Desktop shell/scaffold adapters must consume SDK/Kit public surfaces; they
  must not re-wrap generated Realm services as a second platform API.
- `globalThis` hot state may only preserve process/HMR continuity for admitted
  shell state. It is not session truth and must not carry durable auth custody.

## D-DSYNC-001 — Auth Owner Map

Auth credential exchange, session truth, token custody, and local first-party
Runtime account state belong to Runtime/Realm through SDK Platform Client and
Kit auth shell helpers.

- Desktop may wire auth UI intent and post-auth navigation.
- Desktop DataSync must not expose `login`, `register`, `logout`, password,
  OAuth, OTP, 2FA, or token-refresh authority.

## D-DSYNC-002 — Account/Profile Owner Map

Current-user, public-user profile, account settings, notification preferences,
creator eligibility, and account data actions are Realm truth surfaced through
SDK Realm helpers or SDK Platform Client domains.

- Desktop may own product-specific profile panels, form state, validation, and
  query invalidation.
- Desktop DataSync must not wrap `MeService`, `UserService`, `AuthService`, or
  account-data services as app-local platform access.

## D-DSYNC-003 — Human Chat Owner Map

Human chat canonical truth belongs to Realm. Typed chat access, realtime event
assembly, composer adapters, timeline parsing, and reusable chat primitives
belong to Kit/SDK.

- Desktop may own local offline cache/outbox scaffold, upload placeholders,
  selected-chat UI state, and product-specific query wiring.
- Desktop human chat UI must consume Kit Realm chat helpers or a bounded
  Desktop scaffold that itself consumes Kit/SDK public surfaces.
- Desktop DataSync must not expose `loadChats`, `startChat`, `loadMessages`,
  `sendMessage`, `syncChatEvents`, `flushChatOutbox`, or `markChatRead`.

## D-DSYNC-004 — Social Owner Map

Relationship graph, friend requests, block state, social snapshots, and
friend-quota truth belong to Realm. Reusable typed access belongs to SDK or Kit
headless surfaces.

- Desktop may own relationship UI, confirmation dialogs, optimistic query
  invalidation, and local offline mutation scaffold.
- Desktop DataSync must not remain the product authority for relationship or
  social graph operations.

## D-DSYNC-005 — World Owner Map

World list/detail/history/lore/binding/scene/audit canonical truth belongs to
Realm. Typed read helpers belong to SDK; reusable world display/headless
composition belongs to Kit when shared by multiple apps.

- Desktop may own product page composition and navigation state.
- Desktop DataSync must not act as a second world service registry.

## D-DSYNC-006 — Economy Owner Map

Economy canonical truth belongs to Realm. Desktop economy surfaces consume Kit
commerce Realm helpers from `@nimiplatform/kit/features/commerce/realm` for
balances, transaction history, subscription reads, Spark checkout, withdrawal,
gift actions, and gift review writes.

- Desktop may own Wallet/Notification/Gift UI state, query cadence, checkout
  redirect handling, and user-intent wiring.
- Desktop DataSync must not expose economy facade methods or re-wrap
  `EconomyCurrencyGiftsService` / `ReviewsEconomyTrustService`.

## D-DSYNC-007 — Feed/Resource Owner Map

Post, feed, like, moderation-report, resource-upload, and attachment truth
belong to Realm. Upload transport helpers and request builders belong to SDK;
reusable composer/headless primitives belong to Kit.

- Desktop may own create-post modal state, local attachment previews, query
  invalidation, and product-specific error presentation.
- Desktop DataSync must not remain the canonical post/resource facade.

## D-DSYNC-008 — Explore Source Discovery Owner Map

Explore search, public recommendation, public source profile, and discovery feed
truth belong to Realm. Typed helpers belong to SDK/Kit.

- Desktop may own Explore panel state and preview composition.
- Desktop DataSync must not wrap Search/Explore/source discovery services as app-local
  platform truth.

## D-DSYNC-009 — Notification Owner Map

Notification canonical list and read-state truth belongs to Realm. Desktop
notification surfaces consume SDK Realm notification helpers for unread count,
list, and read mutations.

- Desktop may own panel filtering, optimistic read overrides, and query
  invalidation.
- Desktop DataSync must not expose notification list/read mutations.

## D-DSYNC-010 — Settings Owner Map

Account settings, notification preferences, creator eligibility, password
updates, OAuth linking, and two-factor authentication truth belong to Realm.
Desktop settings surfaces consume SDK Realm account/settings helpers.

- Desktop may own settings form state, autosave timers, input validation,
  localized messages, and post-mutation query/session refresh wiring.
- Desktop DataSync must not expose settings/security/OAuth facade methods.

## D-DSYNC-011 — Source Owner Map

Creator source lists and public source profile reads belong to Realm. LocalAgent
execution, local lifecycle, LLM routing, memory, and Runtime substrate
state belong to Runtime/Cognition.

- Desktop may own source display pages but not Realm source creation surfaces.
- Desktop DataSync must not own LocalAgent LLM route, memory, lifecycle, or mixed
  runtime/realm authority.

## D-DSYNC-012 — Transit Owner Map

World transit canonical state belongs to Realm and any explicitly admitted
Runtime/Realm transit contracts. Typed access belongs to SDK/Kit when reused.

- Desktop may own transit UI intent wiring and display state.
- Desktop DataSync must not remain the transit service authority.

## D-DSYNC-013 — Replacement Path Guidance

Owner selection order is mandatory:

| Responsibility | Owner |
|---|---|
| canonical Realm business truth | Realm |
| Runtime execution, readiness, state, jobs, local lifecycle | Runtime |
| memory/knowledge/skill access policy and records | Cognition |
| typed access, schemas, decoders, transport, method IDs, request builders, response parsers, stream assemblers, test harnesses, non-authoritative client orchestration | SDK |
| reusable UI, shell, bridge, accessibility, token, headless product primitives | Kit |
| product screens, user-intent wiring, view-model composition, ephemeral UI state, bounded OS helpers | Desktop |

When a shared surface exists for a product data responsibility, Desktop must
consume that surface and Tester must prove it through a materially different
consumer flow. If no shared surface exists, the owning layer must define it
before Desktop can consume the responsibility.

## Fact Sources

- `tables/data-sync-flows.yaml` — DataSync non-admission owner map

## Preserved source: Offline Degradation Contract

# Offline Degradation Contract

> Authority: Desktop Kernel

## Scope

Desktop 离线/断联降级策略。定义 Runtime daemon 和 Realm 云服务不可达时的分级降级行为、本地数据缓存策略、消息队列行为和重连冲突解决。

## D-OFFLINE-001 — 降级等级定义

Desktop 按照以下三级降级模型运行：

| 等级 | Runtime | Realm | 可用功能 | 不可用功能 |
|---|---|---|---|---|
| **L0 全功能** | 可达 | 可达 | 全部 | — |
| **L1 Realm 离线** | 可达 | 不可达 | 本地 AI 推理、离线 agent 交互 | 云同步、在线社交、经济交易、跨设备状态同步 |
| **L2 全离线** | 不可达 | 不可达 | UI 浏览已缓存数据、设置页面 | 所有 AI 推理、数据写入 |

Bootstrap 阶段检测到 Runtime 不可达时执行 D-BOOT-008 错误/降级路径。此合约覆盖**运行时**（非启动阶段）的降级。

Realm connectivity is a tri-state projection: `unknown | reachable |
unreachable`. Only explicit Realm transport failure (DNS, connect, TLS,
timeout, response-read failure, or HTTP 408/502/503/504) may set
`unreachable` and enter L1. Authentication/reauth, permission, validation,
rate-limit, conflict, not-found, contract, and ordinary operation errors do
not mutate connectivity. A successful refresh or admitted Realm operation
sets `reachable`; account `anonymous`, `expired`, `reauth_required`, or
`unavailable` clears stale L1 without claiming Realm reachability. L2 remains
the distinct Runtime-unavailable projection.

## D-OFFLINE-002 — Realm 离线行为（L1）

Realm 不可达时的行为规则：

- 聊天消息写入 Desktop bounded chat shell scaffold 的本地 outbox 队列（DataSync non-admission owner map records this ownership boundary; current code must not depend on a DataSync facade）。
- outbox 消息按 FIFO 顺序排列，每条消息附带 `enqueued_at` 时间戳。
- outbox 最大容量 1000 条消息；超出后拒绝新写入并提示用户。
- 社交 post interaction 操作（例如点赞/取消点赞）可静默排队，重连后批量提交。Friendship / source materialization / LocalAgent linkage 相关 mutation 不得进入 generic social outbox；离线时必须失败关闭，除非 Realm Social/Core contract 明确提供后端持久化 intent。
- 本地 outbox 是 Desktop shell/scaffold 的待提交 intent transport，不能表示 Realm commit success，也不能作为 Chat/Social canonical state。重放必须通过 Realm/SDK public API，只有 Realm 接受后才可删除待提交记录；非网络失败必须标记 `failed` 并停止自动重放。
- 经济交易（充值、打赏）不得离线排队，必须在线执行。向用户展示明确提示。
- 世界/source 浏览使用本地缓存数据，标记"离线模式"水印。

## D-OFFLINE-003 — 全离线行为（L2）

Runtime 和 Realm 均不可达时的行为规则：

- UI 切换为只读模式：用户可浏览已缓存的聊天历史和设置。
- 所有 AI 推理请求返回用户可读错误"运行时不可用"。
- 本地模型管理命令（install/start/stop）不可用（依赖 Runtime daemon）。
- 设置页面保持可编辑，配置变更暂存本地，Runtime 恢复后自动同步。

## D-OFFLINE-004 — 重连策略

After reconnect, `OpenSession` may restore only `BINDING_ONLY`. Desktop must
repeat the complete protected endpoint/process/executable handshake and
`OpenDesktopSession` before account-control commands. A local app cannot resume
until the final carrier supplies a fresh launch lease, exact process bind and
request-empty `OpenLocalAppSession`; cached metadata/session ids never authorize replay.

断联后的重连行为：

- 使用指数退避重连，初始间隔 1s，最大间隔 30s。
  - **适用范围**: Realm REST 断联重连 + Socket.IO 断联重连。
  - **与 D-NET-002 的区别**: D-NET-002 定义单次 HTTP 请求重试退避（120ms/900ms），本规则定义连接级别恢复退避（1s/30s），两者独立。
- Realm 重连成功后立即触发 Desktop chat shell scaffold outbox flush。
- 冲突解决策略：Last-Write-Wins（LWW）based on server timestamp。
- outbox 消息发送失败（非网络原因）时标记为 `failed`，不重试，向用户展示失败原因。
- Runtime 重连成功后重新初始化 SDK session（D-BOOT-004 re-bootstrap），遵循 `S-RUNTIME-070` session recovery 协议执行 `connect()` + `OpenSession()`。
- Runtime Config 在 Realm 离线但 Runtime 可达时保留 `local` / `runtime` 页面可用，云 connector 写操作投影为排队或在线要求。
- Runtime 与 Realm 同时不可达时，Runtime Config 降级为只读浏览；daemon 管理、本地引擎启停、connector 写入与 external-agent token 签发不可用。
- Runtime 重连成功后，Runtime Config 通过 SDK projection 刷新 daemon status、
  provider health、connector 配置与 Runtime-owned External Agent gateway
  status。

## D-OFFLINE-005 — 本地缓存策略

- 聊天历史：最近 50 条消息/会话，最近 20 个会话。
- Source/World 元数据：用户已访问的 source/world profile 缓存。
- Runtime local model / asset inventory must be read from Runtime/SDK local asset
  projections when Runtime is reachable. Desktop must not persist a browser or
  IndexedDB model-manifest fallback as local readiness/capability truth.
- 缓存使用 IndexedDB 存储。
- IndexedDB-backed cache / outbox managers may expose an explicitly named
  ephemeral store for test/development harnesses only. In production renderer
  paths, missing IndexedDB support must fail closed; Desktop must not silently
  degrade offline cache or outbox persistence into process memory.
- 缓存无 TTL 自动过期；在线时通过 Realm 增量同步更新。

**存储拓扑**:
- **Zustand store** (in-memory): 运行时活跃状态，HMR 通过 globalThis 保活。
- **Tauri IPC / Runtime secure custody / Realm projections** (owner persistence): app-level persistence must be owned by the admitted Runtime/Realm/IPC owner, not by renderer hot-state.
- **IndexedDB cache stores** (offline cache): 离线降级期间的只读缓存层，仅用于 D-OFFLINE-005 定义的缓存数据集。在线时由 feature-local Realm data loaders / SDK public services refresh，不作为数据修改通道。
- **IndexedDB outbox stores** (shell/scaffold intent transport): D-OFFLINE-002 admitted outbox stores are separate from the offline cache manager. They may persist pending chat/social submit intents, but they remain non-authoritative transport records and must not be read as Realm Chat/Social truth.

## Fact Sources

- `config/desktop-ipc-commands.yaml` — 非权威 IPC 命令清单
- Cross-reference: D-BOOT-008（Runtime bootstrap 失败/降级路径）, D-BOOT-012（Realm 可达性策略）, D-NET-006, D-NET-007

## Preserved source: Self-Update Contract

# Self-Update Contract

> Authority: Desktop Kernel

## Scope

Desktop self-update and its coordination boundary with the independently
installed Runtime OS service. Desktop is not a Runtime installer, stager,
binary selector, service owner, or stop authority.

## Signed Compatible Release Pair (D-BOOT-001, D-IPC-014)

- The Desktop package contains only its own signed release metadata and the
  Platform release-root public key; it does not contain or stage a production
  Runtime binary.
- Signed installer/service updater installs each Runtime release into the
  immutable OS release layout, writes the signed protected-local trust record,
  and atomically activates the signed service definition.
- Desktop and Runtime may update independently only when both signed trust
  records name the same protected-local protocol version and mutually list the
  observed peer release ids. Semver, PATH lookup, `NIMI_RUNTIME_BINARY`, user
  choice, argv, env, cache, and manifest guess are not compatibility proof.
- When a Desktop update requires a new Runtime release, the service updater
  must finish the compatible Runtime activation before Desktop reports the
  update ready. Failure leaves the old coherent pair active or marks protected
  control unavailable; no partially compatible success is allowed.

## Installed Runtime Truth Source (D-BOOT-001, D-IPC-002)

- Typed service status derives from the fixed OS service definition, running
  service principal, protected mutual handshake, platform-native code signing, and
  same-open-file executable verification.
- Desktop never executes a stopped/candidate Runtime for version discovery and
  never reads `~/.nimi/runtime/versions`, `current.json`, a user config path, or
  a candidate binary path.
- Missing, expired, rollback, incompatible, or mismatched service/record/binary
  state returns typed unavailable/repair-required status. Renderer/backend
  cannot synthesize fallback release information.

## Updater Configuration Contract (D-IPC-015)

- updater pubkey 与 endpoint 的单一来源是 Rust builder 的编译期内嵌配置。
- Packaged product updater configuration accepts no runtime env override.
  Separately signed synthetic non-product fixtures use an external test trust
  root and cannot provide production evidence.
- renderer 不得直接拼装 updater 细节；desktop update surface 必须经受管 Tauri commands 暴露。

## Renderer / Web Surface Contract (D-IPC-015)

- `desktop_release_info_get` 只有在 release metadata 初始化成功时才允许返回 `DesktopReleaseInfo`。
- 初始化失败时，command 必须返回错误；renderer 单独持有 `desktopReleaseError`，不得由 bridge 合成默认版本信息。
- web adapter 对 desktop self-update / release metadata surface 必须 fail-close。`unsupported` 是唯一允许的结果，不得返回 `null`、`idle`、no-op unsubscribe 等伪状态。

## 更新器可用性投影

- `DesktopReleaseInfo` 必须暴露 `updaterAvailable`，并可选暴露 `updaterUnavailableReason`。
- Bootstrap 与 Settings UI 必须使用该投影判定 desktop self-update actions 是否可用。
- 当 `updaterAvailable=false` 时，静默检查必须 no-op；手动 update 操作必须直接展示 `updaterUnavailableReason`，而不是调用已知会失败的 updater command。
- Settings projects Desktop release id, verified installed Runtime service
  release id, mutual compatibility state, target Desktop release and updater
  state. It exposes no Runtime path or credential. Desktop restart means only
  Desktop process restart.
- Runtime service update/repair errors remain visible as service-updater state
  and are never hidden by fallback version information.

## Preserved source: Network Contract

# Network Contract

> Authority: Desktop Kernel

## Scope

Desktop 网络层契约。定义代理 fetch 机制、请求重试策略、指数退避算法、可重试状态码、实时 WebSocket 传输。

## D-NET-001 — 可重试状态码

以下 HTTP 状态码触发自动重试（参考 `tables/retry-status-codes.yaml`）：

- `408` Request Timeout
- `425` Too Early
- `429` Too Many Requests
- `500` Internal Server Error
- `502` Bad Gateway
- `503` Service Unavailable
- `504` Gateway Timeout

## D-NET-002 — 重试策略

`requestWithRetry` 实现指数退避重试：

默认参数：
- `maxAttempts: 3`
- `initialDelayMs: 120`
- `maxDelayMs: 900`

退避算法：`delayMs = min(maxDelayMs, initialDelayMs * 2^(attempt-1) + uniform_jitter[0, initialDelayMs/2])`

重试条件：
- **状态码重试**：`RETRYABLE_STATUS_CODES.has(error.status)` — `RetryReasonKind: 'status'`
- **网络错误重试**：`AbortError` 或 `TypeError` — `RetryReasonKind: 'network'`

**跨传输重试参数差异说明**：Desktop HTTP 重试参数（120ms initial / 900ms cap）与 SDK Runtime gRPC 重试参数（S-RUNTIME-045: 200ms initial / 3000ms cap）不同。此差异是设计意图：

**参数选取依据**（同 K-DAEMON-006/007 注释模式）：
- HTTP（Realm API）初始退避 120ms：Realm REST API 平均响应 <50ms，120ms 足以覆盖瞬时抖动且不引入用户可感知延迟。Cap 900ms：3 次重试总等待 ≈120+240+480≈840ms（含 jitter <1.2s），用户体验上限约 1s。
- gRPC（Runtime）初始退避 200ms：AI 推理 RPC 本身延迟高（首包 1-10s），200ms 退避在推理超时上下文中忽略不计。Cap 3000ms：推理场景更可能因 provider 过载导致暂时不可用，更大退避区间降低 thundering herd 风险。

## D-NET-003 — 重试事件

`RetryEvent` 通过 `onRetryEvent` 回调通知：

- `retrying`：开始重试，包含 delayMs、reasonKind、status。
- `recovered`：重试后恢复，包含 retryCount。
- `retry_exhausted`：重试耗尽，最终失败。

## D-NET-004 — 代理 Fetch

`createProxyFetch()` 创建通过 Tauri backend 代理的 fetch 实现：

- 仅 Runtime / Realm configured origins may be forwarded through
  `http_request`（`D-IPC-004`）。
- It is not a general CORS bypass and must not proxy arbitrary HTTPS,
  private-LAN, provider, model, app, or user-entered URLs.
- SDK connector-auth acquisition provider requests use their own
  `connectorAuthProfileId` + `connectorAuthPurpose` admission metadata and the
  exact generated profile endpoint allow-list; they do not inherit
  `createProxyFetch()` access.

## D-NET-005 — 错误归一化

`normalizeApiError(error, fallbackMessage?)` 统一错误格式：

- API 错误：保留 status、message。
- 网络错误：转为统一 Error 对象。
- fallbackMessage：无法解析时的兜底消息。

## D-NET-006 — Realtime Transport

**Owner-only authority allocation.** Desktop owns account-control and lifecycle UX and verified process launch. Runtime remains the sole owner of authenticated Realm unary, realtime, and media transport. Desktop may carry opaque Runtime-attested connection state through a trusted host boundary, but Desktop, Electron/Tauri main, preload, renderer, and app code cannot mint, request, inject, cache, or refresh Realm bearer or signed-upload credentials as data-plane owners.

Only this owner allocation and its prohibited parallel-truth clauses are admitted here. D-NET-006 and D-NET-007 detailed clauses remain blocked authority conflicts until Runtime admits realtime protocol/dependency authority and Desktop separately admits its carrier integration. Runtime compatibility evidence must precede any replay posture; host-local outboxes, event caches, reconnect observations, or renderer state cannot prove replay or delivery authority.

**SDK 契约引用**：SDK S-REALM-035/036/037 定义 Realm 实时传输的 SDK 层约束（token 注入、事件不丢失保证）。D-NET-006 是 Desktop 层的具体实现，满足 SDK 层约束。

Socket.IO WebSocket 传输层：

- `resolveRealtimeUrl()`：从 `realmBaseUrl` / `realtimeUrl` 解析 WebSocket 连接地址。本地环境 3002 端口自动映射为 3003。
- 传输固定为 `['websocket']`，路径 `/socket.io/`。
- 认证：通过 `auth.token` 在握手时传递 Bearer Token。
- 连接生命周期：`connect` 事件触发 session 恢复和 outbox 刷新。
- 会话管理：`chat:session.open` / `chat:session.ready` / `chat:event.ack` 协议。
- 事件去重：客户端维护 `seenEvents` LRU 映射（上限 3000 条）防止重复处理。达到上限时按 LRU 策略驱逐最久未访问的条目，确保内存占用可控。
- 断线恢复：`chat:session.sync_required` 触发增量同步回填。

## D-NET-007 — 轮询与实时传输协同

**Authority disposition:** Blocked detailed authority conflict. Polling/realtime coordination, cache, reconnect, delivery, and replay details are conflict evidence only and are not independently admitted for implementation; Runtime compatibility evidence and separate Runtime/Desktop admissions are required under `D-NET-006`.

Kit Realm chat realtime controller 的 `syncChatEvents` 增量回填与 D-NET-006
的 Socket.IO 实时传输操作同一数据域（聊天消息）。Desktop may wire these
through bounded chat shell scaffold, but a Desktop DataSync facade is not the chat authority and must not be reintroduced.
两个通道的协同规则：

**主/辅通道关系**：

- **实时连接活跃时**：Socket.IO 为主通道，chat 轮询（`syncChatEvents`）停止。实时事件通过 `chat:event.*` 协议实时推送，无需轮询补偿。
- **实时连接断开时**：轮询恢复为主通道。断连触发 `chat:session.sync_required` 增量同步回填（D-NET-006），同时恢复 `syncChatEvents` 周期轮询。
- **通道切换时机**：Socket.IO `connect` 事件触发停止 chat 轮询；`disconnect` 事件触发恢复 chat 轮询。

**跨通道消息去重**：

- 通道切换瞬间可能产生重叠（轮询结果和实时事件同时到达）。
- 去重机制统一使用 D-NET-006 的 `seenEvents` LRU 映射（上限 3000 条）。轮询结果和实时事件共享同一 LRU 实例。
- 去重键：消息/事件的唯一 ID。已在 `seenEvents` 中存在的事件静默丢弃。

**通知轮询不受影响**：SDK Realm notification helper 的 unread-count 轮询独立于实时连接状态，始终按固定间隔执行。

**跨层引用**：D-NET-006（实时传输）；DataSync non-admission owner map only records chat/notification ownership boundaries.

## Fact Sources

- `tables/retry-status-codes.yaml` — 可重试 HTTP 状态码
