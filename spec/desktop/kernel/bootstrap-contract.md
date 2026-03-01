# Bootstrap Contract

> Authority: Desktop Kernel
> Status: Draft
> Date: 2026-03-01

## Scope

Desktop 应用启动序列契约。定义 renderer 进程从 `bootstrapRuntime()` 调用到 `bootstrapReady=true` 的多阶段异步初始化流程。

## D-BOOT-001 — Runtime Defaults 加载

启动序列的首个异步操作。通过 IPC 桥接调用 `runtime_defaults` 获取 `RealmDefaults`（realmBaseUrl、realtimeUrl、accessToken）和 `RuntimeExecutionDefaults`（provider、model、agent 绑定）。

- **daemon 就绪前置条件**：Tauri backend 在返回 `runtime_defaults` 前确保 daemon 可达。若 daemon 处于 `STARTING` 状态（K-DAEMON-001），backend 等待 daemon 就绪（最长等待 30s，与 D-IPC-002 启动超时一致）。超时后返回错误，进入 `D-BOOT-008` 错误路径。
- 失败行为：抛出异常，进入 `D-BOOT-008` 错误路径。
- 后续依赖：DataSync 初始化、Platform Client 初始化。

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

## D-BOOT-010 — 初始数据加载触发

`loadInitialData()`（`D-DSYNC-000`）不在 `bootstrapRuntime()` 内同步执行。触发时机：

- 认证状态从非 `authenticated` 转为 `authenticated` 时由应用层（auth state listener）调用。
- 这包括 `D-BOOT-007` 成功后的首次认证，以及后续 token 刷新后的重新认证。
- `bootstrapReady=true` 不依赖 `loadInitialData()` 完成。

## D-BOOT-009 — 幂等性守卫

`bootstrapRuntime()` 使用 `bootstrapPromise` 单例保证全局只执行一次。
重复调用返回同一 Promise。

## Fact Sources

- `tables/bootstrap-phases.yaml` — 启动阶段枚举
- `tables/feature-flags.yaml` — feature flag 门控
