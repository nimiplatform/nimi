# Bootstrap Contract

> Authority: Desktop Kernel

## Scope

Desktop 应用启动序列契约。定义 renderer 进程从 `bootstrapRuntime()` 调用到 `bootstrapReady=true` 的多阶段异步初始化流程。

## D-BOOT-001 — Runtime Defaults 加载

启动序列的首个异步操作。通过 IPC 桥接调用 `runtime_defaults` 获取 `RealmDefaults`（realmBaseUrl、realtimeUrl、accessToken、jwksUrl、jwtIssuer、jwtAudience）和 `RuntimeExecutionDefaults`（provider、model、agent 绑定）。

Desktop 只允许使用 canonical runtime 配置路径 `.nimi/config.json`；legacy 路径 `.nimi/runtime/config.json` 已硬切移除，不得在 bootstrap 或 backend fallback 中回流。

- **daemon 就绪前置条件**：Tauri backend 在返回 `runtime_defaults` 前确保 daemon 可达。若 daemon 处于 `STARTING` 状态（K-DAEMON-001），backend 等待 daemon 就绪（最长等待 120s，对齐 K-LENG-004 SUPERVISED 模式首次启动最差情形——GPU backend 下载可能需要 120s，与 D-IPC-002 启动超时一致）。超时后返回错误，进入 `D-BOOT-008` 错误路径。
- 失败行为：抛出异常，进入 `D-BOOT-008` 错误路径。
- 后续依赖：DataSync 初始化、Platform Client 初始化。

### Runtime JWT Config Sync

在 `D-BOOT-001` 之后、业务初始化之前，Desktop 必须将 Realm JWT 验签参数写入 Runtime 配置：

- 写入目标：`auth.jwt.jwksUrl`、`auth.jwt.issuer`、`auth.jwt.audience`（K-DAEMON-009）。
- 数据来源：`runtime_defaults.realm.{jwksUrl,jwtIssuer,jwtAudience}`。
- 写入流程：`runtime_bridge_config_get` → 合并配置 → `runtime_bridge_config_set`。

重启分支（基于 `reasonCode`）：

- `CONFIG_APPLIED`：继续 bootstrap。
- `CONFIG_RESTART_REQUIRED` 且 daemon `running=true` 且 `managed=true`：Desktop 自动执行 `runtime_bridge_restart` 后继续 bootstrap。
- `CONFIG_RESTART_REQUIRED` 且 daemon `running=true` 且 `managed=false`：bootstrap fail-close，返回明确错误要求用户手动重启外部 Runtime。
- `CONFIG_RESTART_REQUIRED` 且 daemon `running=false`：继续 bootstrap（配置已落盘，等待后续启动生效）。

执行命令：

- `pnpm check:desktop-no-legacy-runtime-config-path`

## D-BOOT-002 — Platform Client 初始化

使用 `D-BOOT-001` 获取的 realmBaseUrl 和 accessToken 初始化 `initializePlatformClient`。

- 必须在 DataSync 初始化之前完成。

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
- 确保 core world data capabilities 已注册。

## D-BOOT-005 — Runtime Mods 注册

调用 `registerBootstrapRuntimeMods` 从本地清单注册 mods。

- 返回 `runtimeModFailures` 和 `manifestCount`。
- 部分 mod 注册失败不中断启动序列（degraded mode）。

## D-BOOT-006 — External Agent 桥接

注册 tier-1 external agent actions 并启动 action bridge。

- 调用 `registerExternalAgentTier1Actions(hookRuntime)`。
- 调用 `startExternalAgentActionBridge()` 和 `resyncExternalAgentActionDescriptors()`。

## D-BOOT-007 — Auth Session 引导

调用 `bootstrapAuthSession` 执行 token 交换或匿名回退。

- 成功时设置 `auth.status = 'authenticated'`。
- 失败时设置 `auth.status = 'anonymous'`。

## D-BOOT-008 — Bootstrap 完成 / 错误处理

正常路径：
- `bootstrapReady = true`、`bootstrapError = null`。
- 日志级别：有 mod 失败时 `warn`，否则 `info`。

错误路径：
- `bootstrapReady = false`、`bootstrapError = message`。
- 清除 auth session。
- 日志级别：`error`。

## D-BOOT-009 — 幂等性守卫

`bootstrapRuntime()` 使用 `bootstrapPromise` 单例保证全局只执行一次。
重复调用返回同一 Promise。

## D-BOOT-010 — 初始数据加载触发

`loadInitialData()`（`D-DSYNC-000`）不在 `bootstrapRuntime()` 内同步执行。触发时机：

- 认证状态从非 `authenticated` 转为 `authenticated` 时由应用层（auth state listener）调用。
- 这包括 `D-BOOT-007` 成功后的首次认证，以及后续 token 刷新后的重新认证。
- `bootstrapReady=true` 不依赖 `loadInitialData()` 完成。

## D-BOOT-011 — Desktop 退出与 Daemon 关闭

Desktop 窗口关闭时的 daemon 生命周期行为：

**触发条件**：Tauri `on_window_event(CloseRequested)` 或应用进程退出。

**行为**：
- **Desktop managed daemon**（D-IPC-002 `managed=true`）：Desktop 退出前调用 `runtime_bridge_stop`（D-IPC-002），等待 daemon 进入 `STOPPED` 状态。等待超时为 K-DAEMON-003 停机超时（默认 10s）+ 2s 缓冲。超时后 Desktop 强制退出，daemon 可能残留为孤儿进程。
- **外部 daemon**（`managed=false`）：Desktop 退出不停止 daemon。daemon 由外部管理者负责生命周期。
- **清理顺序**：停止所有轮询（D-DSYNC-000 `stopAllPolling`）→ 清除主动刷新计时器（D-AUTH-007）→ 发送 `runtime_bridge_stop`（仅 managed）→ 退出。

## D-BOOT-012 — Realm 可达性策略

Realm SDK `ready()` 采用 fail-open 语义（`S-REALM-019`）：探测失败不抛错，仅发射 error 事件。Runtime SDK `ready()` 采用 fail-close 语义（`S-RUNTIME-015`）：探测失败抛出 `RUNTIME_UNAVAILABLE`。Bootstrap 序列必须消化这一不对称性。

**策略**：Bootstrap 不显式调用 `Realm.ready()`。Realm 可达性通过 `D-BOOT-010` 触发的 `loadInitialData()` 中的首个业务请求（`loadCurrentUser()`）隐式验证：

- `loadCurrentUser()` 成功：Realm 可达，正常流程。
- `loadCurrentUser()` 失败（网络错误）：Realm 不可达。DataSync 通过 `emitDataSyncError` 记录错误。UI 进入降级状态——`bootstrapReady=true` 但数据为空，用户可见空列表和加载失败提示。
- 此设计意图：`bootstrapReady` 表示"应用骨架就绪"，不表示"所有后端可达"。Realm 不可达是运行时降级，不是启动失败。

**与 Runtime fail-close 的对比**：Runtime 不可达是启动失败（D-BOOT-001/004 错误路径），因为 Desktop 核心功能（AI 推理）依赖 Runtime。Realm 不可达是运行时降级，因为 Realm 功能（社交、聊天、世界）可以在恢复后补偿加载。

**跨层引用**：`S-REALM-019`（fail-open 语义）、`S-RUNTIME-015`（fail-close 语义）。

## Fact Sources

- `tables/bootstrap-phases.yaml` — 启动阶段枚举
- `tables/feature-flags.yaml` — feature flag 门控
