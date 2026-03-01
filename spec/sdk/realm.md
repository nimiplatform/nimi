# Realm SDK Domain Spec

> Status: Draft
> Date: 2026-03-01
> Scope: `@nimiplatform/sdk/realm` 领域增量规则（实例化 facade、HTTP/WS 请求引擎、命名规范化）。
> Normative Imports: `spec/sdk/kernel/*`

## 0. 权威导入

- Surface：`kernel/surface-contract.md`（`S-SURFACE-*`）
- Transport：`kernel/transport-contract.md`（`S-TRANSPORT-*`）
- Error projection：`kernel/error-projection.md`（`S-ERROR-*`）
- Boundary：`kernel/boundary-contract.md`（`S-BOUNDARY-*`）

## 1. 领域不变量

- `SDKREALM-001`: 入口固定为 `new Realm(options)` 实例模式。
- `SDKREALM-002`: endpoint/token/header 必须实例级隔离，不允许全局 OpenAPI 运行态写入。
- `SDKREALM-003`: 生成 facade 是唯一权威调用面（`S-SURFACE-004`），禁止手工旁路契约。
- `SDKREALM-004`: 传输与边界规则必须满足 `S-TRANSPORT-004` / `S-BOUNDARY-004`。

## 2. 请求引擎（领域增量）

- `SDKREALM-010`: 默认超时、重试和 abort 语义由实例配置控制。默认超时值为实现定义，须在 SDK 文档中明确标注。
- `SDKREALM-011`: Header 合并遵循调用参数优先，不破坏实例默认安全头。
- `SDKREALM-012`: endpoint 缺失或空字符串必须 fail-close（`SDK_REALM_ENDPOINT_REQUIRED`）。
- `SDKREALM-013`: token 缺失或空字符串必须 fail-close（`SDK_REALM_TOKEN_REQUIRED`）。
- `SDKREALM-014`: token 刷新策略必须显式声明（自动刷新或调用方手动刷新），禁止隐式全局刷新状态。**默认行为**：未配置 `auth.refreshToken` 时，SDK 不执行任何刷新（收到 401 直接抛出错误）。配置了 `auth.refreshToken` 时，启用 SDKREALM-028 的 401 触发刷新流程。SDK 不提供基于 token expiry 时间的内置定时刷新——定时刷新由应用层实现（如 Desktop D-AUTH-007）。
- `SDKREALM-015`: 认证失败（401/403）默认不做隐式重试；若启用刷新后重试，必须限制为单次且可观测。
- `SDKREALM-016`: `Realm.NO_AUTH` 静态常量允许显式跳过 SDKREALM-013 的 token fail-close；传入后 SDK 不校验 token 有效性。
- `SDKREALM-017`: NO_AUTH 模式仅适用于公开 endpoint；认证失败语义不变。
- `SDKREALM-018`: `connect()` / `ready({ timeoutMs? })` / `close({ force? })` / `state()` 生命周期方法签名与 Runtime 对齐（参考 SDKR-013 ~ SDKR-016），但语义存在差异：Realm `ready()` 探测失败不抛错（SDKREALM-019），而 Runtime `ready()` 探测失败必须抛出 `RUNTIME_UNAVAILABLE`（SDKR-015）。
- `SDKREALM-019`: `ready()` 探测失败不影响 client 状态（部分部署无 root endpoint），仅发射 error 事件。
- `SDKREALM-020`: `events.on('error', handler)` / `events.once('error', handler)` 订阅错误事件，返回 unsubscribe 函数。
- `SDKREALM-021`: 事件总线仅用于可观测性，不改变请求流（引用 S-TRANSPORT-006）。
- `SDKREALM-022`: `raw.request<T>(input)` 旁路生成 facade 发起 HTTP 请求。
- `SDKREALM-023`: raw 请求仍受实例级 header/timeout/auth 控制。
- `SDKREALM-024`: `services` 属性提供按 OpenAPI operationId 分组的类型安全 API 句柄。
- `SDKREALM-025`: 命名别名以 OpenAPI codegen 生成的 service 名称为权威，spec 有意不维护独立枚举（避免与 codegen 产出漂移）。完整列表由 codegen 自动生成，非 spec 管理范围。
- `SDKREALM-026`: `RealmOptions.telemetry.enabled/onEvent` 控制遥测；遵循 S-TRANSPORT-006。
- `SDKREALM-027`: `RealmOptions.auth.accessToken` 支持 `string | (() => Promise<string>)` 函数模式实现调用方手动刷新（SDKREALM-014 的实现方式）。
- `SDKREALM-028`: `auth.refreshToken` 支持 `string | (() => Promise<string> | string)`。提供时，SDK 在收到 401 后尝试：(1) 直接 fetch `POST {baseUrl}/api/auth/refresh`（不经过 `#requestUnknown`，不附带过期 Authorization 头），(2) 成功后调用 `auth.onTokenRefreshed` 回调，(3) 使用新 token 单次重试原请求。刷新失败调用 `auth.onRefreshFailed`。符合 SDKREALM-015（单次重试 + 可观测）。
- `SDKREALM-029`: 并发 401 使用 single-flight 协调器：同一 Realm 实例同一时刻只发起一次 refresh，后续 401 等待同一 Promise。

## 3. 错误语义（领域增量）

- `SDKREALM-030`: HTTP status 与 reasonCode 投影遵循 `S-ERROR-001`（双层错误投影）与 `S-ERROR-002`（ReasonCode 事实源）。
- `SDKREALM-031`: 401/403/429/5xx 语义不得伪装为成功响应。
- `SDKREALM-032`: Realm 本地配置类错误码必须来自 sdk kernel 的 `SDK_REALM_*` family（`S-ERROR-005`）。

## 4. 与 Runtime Auth 的边界

- `SDKREALM-040`: Realm SDK 不承担 runtime token 签发/校验职责；runtime auth 语义由 runtime kernel 定义，Realm SDK 仅负责透传与错误投影。

## 5. 实时传输（领域增量）

- `SDKREALM-035`: Realm SDK 的实时传输（WebSocket/Socket.IO）协议层规则不在 SDK spec 定义。实时连接协议由 Realm 后端定义（事件名称、帧格式、会话管理），不在 SDK spec 管辖范围。Desktop 实现细节（Socket.IO transport、端口映射、事件去重）定义在 D-NET-006。SDK spec 仅约束：实时连接的 token 注入遵循 SDKREALM-002（实例级隔离），认证失败语义遵循 SDKREALM-031。
- `SDKREALM-035a`: SDK Realm 实时连接必须暴露连接状态事件：`realtime.connected`（连接建立/重连成功）、`realtime.disconnected`（连接断开，含断开原因）、`realtime.reconnecting`（正在重连，含重连次数）。事件通过 SDKREALM-020 的 events 总线发射。
- `SDKREALM-035b`: 实时连接重连上限为实现定义，但必须：有最大重连次数或最大重连持续时间上限（不允许无限重连）；达到上限后发射 `realtime.disconnected` 事件，应用层决策是否重新 `connect()`。Desktop 实现见 D-NET-006。
- `SDKREALM-035c`: 实时连接断线重连时必须重新注入最新 token（SDKREALM-002），不允许使用断线前的过期 token 尝试重连。
- `SDKREALM-036`: 实时连接断线重连策略为实现定义，SDK spec 不规定具体策略。约束：重连不得静默丢失已投递事件（Desktop D-NET-006 通过 `chat:session.sync_required` 增量同步保证）。
- `SDKREALM-037`: SDK 不维护 Realm 实时事件名称枚举。事件名称由 Realm 后端定义，Desktop 层在 D-NET-006 描述当前使用的事件集。

## 6. 非目标

- 不定义 runtime gRPC 规则
- 不定义 scope/mod 领域规则
