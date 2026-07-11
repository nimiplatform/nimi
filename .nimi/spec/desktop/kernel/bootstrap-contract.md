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
> 本规则已 superseded。Replacement authority：`K-ACCSVC-005` `GetAccountSessionStatus` / `SubscribeAccountSessionEvents` 与 Runtime-mediated Realm broker。`K-ACCSVC-013` 要求 Desktop bootstrap query Runtime account state，并删除 `bootstrapAuthSession` token 交换、匿名回退、共享 auth session 与任何 Desktop/SDK bearer provider。Public `GetAccessToken` is a deny-all tombstone pending A.3d removal。

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
  use additionally requires `~/.nimi/nimi.json` state `ready_for_use`, selected
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

## D-BOOT-009 — 幂等性守卫

`bootstrapRuntime()` 使用 `bootstrapPromise` 单例保证全局只执行一次。
重复调用返回同一 Promise。

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
