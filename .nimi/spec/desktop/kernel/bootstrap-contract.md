# Bootstrap Contract

> Authority: Desktop Kernel

## Scope

Desktop 应用启动序列契约。定义 renderer 进程从 `bootstrapRuntime()` 调用到 `bootstrapReady=true` 的多阶段异步初始化流程。

## D-BOOT-001 — Runtime Defaults 加载

启动序列的首个异步操作。通过 IPC 桥接调用 `runtime_defaults` 获取 `RealmDefaults`（realmBaseUrl、realtimeUrl、accessToken、jwksUrl、revocationUrl、jwtIssuer、jwtAudience）和 `RuntimeExecutionDefaults`（provider、model 与可透传的 runtime execution 字段）。

Desktop 只允许使用 canonical runtime 配置路径 `.nimi/config.json`；legacy 路径 `.nimi/runtime/config.json` 已硬切移除，不得在 bootstrap 或 backend fallback 中回流。

- `runtime_defaults` 读取不要求 daemon 已运行。
- packaged desktop 必须先完成 bundled runtime staging。release 模式下不允许依赖 `PATH`、用户手工 binary、或产品语义上的 `NIMI_RUNTIME_BINARY` 覆盖。
- 若 bundled runtime staging / 版本校验失败，Desktop shell 必须继续 bootstrap，但将 runtime 标记为 unavailable 并暴露结构化错误。
- 只有 source development 的 runtime 模式才允许 `go run ./cmd/nimi` / `PATH` 解析流程。
- 只有 shell 级致命错误才进入 `D-BOOT-008` 错误路径。
- 后续依赖：DataSync 初始化、Platform Client 初始化。
- `runtime_defaults.realm.accessToken` 仅是 operator/debug override 输入，不是 canonical persisted login source。

### Runtime JWT Config Sync

在 `D-BOOT-001` 之后、业务初始化之前，Desktop 必须将 Realm JWT 验签参数写入 Runtime 配置：

- 写入目标：`auth.jwt.jwksUrl`、`auth.jwt.revocationUrl`、`auth.jwt.issuer`、`auth.jwt.audience`（K-DAEMON-009）。
- 数据来源：`runtime_defaults.realm.{jwksUrl,revocationUrl,jwtIssuer,jwtAudience}`。
- 写入流程：`runtime_bridge_config_get` → 合并配置 → `runtime_bridge_config_set`。
- 若 runtime 当前 unavailable（例如 bundled runtime staging 失败），必须跳过该步骤，不得阻断 app shell。

重启分支（基于 `reasonCode`）：

- `CONFIG_APPLIED`：继续 bootstrap。
- `CONFIG_RESTART_REQUIRED` 且 daemon `running=true` 且 `managed=true`：Desktop 自动执行 `runtime_bridge_restart` 后继续 bootstrap。
- `CONFIG_RESTART_REQUIRED` 且 daemon `running=true` 且 `managed=false`：bootstrap fail-close，返回明确错误要求用户手动重启外部 Runtime。
- `CONFIG_RESTART_REQUIRED` 且 daemon `running=false`：继续 bootstrap（配置已落盘，等待后续启动生效）。

执行命令：

- `pnpm check:desktop-no-legacy-runtime-config-path`

## D-BOOT-002 — Platform Client 初始化

使用 `D-BOOT-001` 获取的 realmBaseUrl 与 resolved bootstrap auth session 初始化 SDK 根导出的 `createPlatformClient()`。

- 必须在 DataSync 初始化之前完成。
- resolved bootstrap auth session 的优先级：env override → `auth_session_load` 读取的共享持久会话 → anonymous。

## D-BOOT-003 — DataSync Facade 初始化

调用 `dataSync.initApi()` 注入 realm 配置和 proxy fetch 实例。

- `fetchImpl` 使用 `createProxyFetch()` 以绕过浏览器 CORS（参考 `D-IPC-004`）。
- 热状态通过 `globalThis.__NIMI_DATA_SYNC_API_CONFIG__` 跨 HMR 持久化。

## D-BOOT-004 — Runtime Host 装配

受 `enableRuntimeBootstrap` feature flag 门控（参考 `tables/feature-flags.yaml`）。

- 设置 HTTP context provider（runtime defaults + store token + proxy fetch）。
- 通过 SDK Runtime client 调用 `RegisterApp(appMode=FULL, worldRelation=RENDER)`（K-AUTHSVC-010）。成功后 Runtime 记录 app 注册信息，后续请求可通过 AppMode gate（K-AUTHSVC-009）。失败（如 `APP_MODE_MANIFEST_INVALID`）时中断 bootstrap，进入 D-BOOT-008 错误路径。
- 构建 runtime host capabilities（local LLM health check、execution kernel turn、OpenAPI context lock、hook runtime）。
- 装配 mod SDK host。
- 配置 speech route resolver 和 missing data capability resolver。
- 确保 core world data capabilities 与 host-only Agent LLM data capabilities（route / memory）已注册，供 mods 调用。
- host-only Agent chat route capability 必须遵循 `D-LLM-002` fail-close 语义；host-only Agent memory capability 必须遵循 `D-DSYNC-011` cache-only + fail-close 语义。
- local route bootstrap / hydration / health merge 时，RuntimeLocalService local model list/status 是唯一 readiness 真源；host-local snapshot 只能补充展示元数据。
- 当 selected local model 与 runtime authoritative local record 缺失、degraded、或状态冲突时，Desktop 可以保留原选择用于显示，但必须把 binding 视为 unavailable/not-sendable，不得继续 fail-open 发送。

## D-BOOT-005 — Runtime Mod Host Readiness / Deferred Hydration

Desktop bootstrap 只负责让 mod host 能力面进入可调度状态，不得把第三方 /
外部 mod entry import 或 `setup()` 执行作为 `bootstrapReady=true` 的前置条件。

启动期允许执行的 mod 相关工作固定为：

- 初始化 Desktop-owned mod SDK host、hook runtime 与 capability gate。
- 注册 host-only core data capabilities。
- 读取或刷新 manifest/source/diagnostic projection，用于 Mods UI 可见性。
- 安排 post-ready hydration coordinator。

启动期不得执行的工作：

- 不得同步 import sideload/catalog/dev mod entry。
- 不得在 `bootstrapReady=true` 前执行第三方 mod `setup()`。
- 不得把 timeout fallback 视为 lazy loading 成功。
- 不得创建第二套 mod registry 或 app-local shadow readiness truth。

Mod entry import、`setup()`、UI extension sync、styles injection、turn hook / data
capability registration 等属于 deferred hydration。触发时机只允许是：

- bootstrap ready 后的显式 post-ready hydration coordinator；
- 用户打开 Mods / Mod Workspace / mod route；
- UI slot、route、hook、data capability 或 reload/retry 流程首次需要对应 mod；
- source change / reload 事件要求重新 hydration。

Hydration 必须以 Desktop mod host 现有 registry / state 为唯一真源，并且按
`modId + generation/source revision` 幂等：同一 generation 的重复 hydration 请求不得重复执行
`setup()`。失败必须记录到 `runtimeModFailures` 或等价的 Desktop mod host failure projection，
但不得清除 shell bootstrap 成功状态。

任何需要未完成 hydration 的 slot / route / hook / data capability 的 consumer 必须 fail-close：
返回结构化 pending / unavailable / failed 状态，或触发明确 hydration 后再继续；不得把缺失
hydration 伪装成空成功。

## D-BOOT-006 — External Agent 桥接

注册 tier-1 external agent actions 并启动 action bridge。

- 调用 `registerExternalAgentTier1Actions(hookRuntime)`。
- 调用 `startExternalAgentActionBridge()` 和 `resyncExternalAgentActionDescriptors()`。

## D-BOOT-007 — Auth Session 引导

调用 `bootstrapAuthSession` 执行 token 交换或匿名回退。

- 成功时设置 `auth.status = 'authenticated'`。
- 失败时设置 `auth.status = 'anonymous'`。
- source=`persisted` 且 bootstrap 期间发生 unauthorized / decrypt / schema 失败时，必须清空共享 auth session 文件。
- `auth.status = 'anonymous'` 时，desktop shell 仍进入主壳并默认落到 `AI Runtime`；外层主导航隐藏，右上角提供显式 `Login` 入口，登录页可返回当前 Runtime 子页。

## D-BOOT-008 — Bootstrap 完成 / 错误处理

正常路径：
- `bootstrapReady = true`、`bootstrapError = null`。
- 日志级别：shell/bootstrap 致命失败为 `error`；post-ready mod hydration 失败只影响 mod failure projection，
  不得反向改写 bootstrap success。

错误路径（仅 shell-fatal）：
- `bootstrapReady = false`、`bootstrapError = message`。
- 清除 auth session。
- 日志级别：`error`。

packaged desktop release 校验补充：

- release metadata 读取失败、bundled runtime staging 失败、或 runtime 自报版本与 packaged desktop 不一致，不得由 renderer / backend 合成 fallback release info。
- 这些错误属于 runtime unavailable / release invalid，可通过 `desktopReleaseError` 和设置页状态呈现；是否进入 shell-fatal 只取决于后续是否仍有必须依赖 runtime exact match 的 bootstrap 步骤被触发。

## D-BOOT-009 — 幂等性守卫

`bootstrapRuntime()` 使用 `bootstrapPromise` 单例保证全局只执行一次。
重复调用返回同一 Promise。

## D-BOOT-010 — 初始数据加载触发

`loadInitialData()`（`D-DSYNC-000`）不在 `bootstrapRuntime()` 内同步执行。触发时机：

- 认证状态从非 `authenticated` 转为 `authenticated` 时由应用层（auth state listener）调用。
- 这包括 `D-BOOT-007` 成功后的首次认证，以及后续 token 刷新后的重新认证。
- `bootstrapReady=true` 不依赖 `loadInitialData()` 完成。

## D-BOOT-011 — Desktop 退出、Hide 与 Daemon 关闭

Desktop 在 menu bar shell 模式下必须区分“关闭主窗口”和“退出应用”：

- **主窗口 CloseRequested**：当 `enableMenuBarShell=true` 且运行于 macOS 时，`CloseRequested` 必须仅隐藏主窗口，不得触发 app 退出，不得停止 daemon。
- **Quit path**：menu bar `Quit Nimi`、系统级 Quit、或等效显式退出路径才允许进入 app 退出流程。

Quit path 的 daemon 生命周期行为：

- **Desktop managed daemon**（D-IPC-002 `managed=true`）：Desktop 退出前调用 `runtime_bridge_stop`（D-IPC-002），等待 daemon 进入 `STOPPED` 状态。等待超时为 K-DAEMON-003 停机超时（默认 10s）+ 2s 缓冲。超时后 Desktop 强制退出，daemon 可能残留为孤儿进程。
- **外部 daemon**（`managed=false`）：Desktop 退出不停止 daemon。daemon 由外部管理者负责生命周期。
- **清理顺序**：停止所有轮询（D-DSYNC-000 `stopAllPolling`）→ 清除主动刷新计时器（D-AUTH-007）→ 停止 auth watcher / shell cleanup → 发送 `runtime_bridge_stop`（仅 managed）→ 退出。

当 `enableMenuBarShell=false` 时，Desktop 可继续沿现有非 menu bar 退出语义执行。

## D-BOOT-012 — Realm 可达性策略

Realm SDK `ready()` 与 Runtime SDK `ready()` 都采用 fail-close 语义（`S-REALM-019` / `S-RUNTIME-015`）：探测失败必须抛错，不得伪装成“仅记录遥测”的软失败。

**策略**：Bootstrap 不显式调用 `Realm.ready()`。Realm 可达性继续通过 `D-BOOT-010` 触发的 `loadInitialData()` 中的首个业务请求（`loadCurrentUser()`）隐式验证：

- `loadCurrentUser()` 成功：Realm 可达，正常流程。
- `loadCurrentUser()` 失败（网络错误）：Realm 不可达。DataSync 通过 `emitDataSyncError` 记录错误。UI 进入降级状态——`bootstrapReady=true` 但数据为空，用户可见空列表和加载失败提示。
- 此设计意图：`bootstrapReady` 表示"应用骨架就绪"，不表示"所有后端可达"。Realm 不可达是运行时降级，不是启动失败；但一旦显式调用 `Realm.ready()`，错误必须直接暴露给调用方。

**与 Runtime fail-close 的对比**：Runtime daemon 不可用在 Desktop 侧是运行时降级，不再阻断 app shell；需要 Runtime 的功能页展示 unavailable 提示并允许后续恢复。Realm 不可达同样是运行时降级，因为功能可以在恢复后补偿加载。

**跨层引用**：`S-REALM-019`（fail-close 语义）、`S-RUNTIME-015`（fail-close 语义）。

## Fact Sources

- `tables/bootstrap-phases.yaml` — 启动阶段枚举
- `tables/feature-flags.yaml` — feature flag 门控
