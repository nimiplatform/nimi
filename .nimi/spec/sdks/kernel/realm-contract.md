# SDK Realm Contract

> Owner Domain: `S-REALM-*`
>
> **Authority Disposition**：
> 本契约被分为两种显式 mode：
>
> - **Local Runtime app modes**：no authenticated Realm transport is admitted
>   by A.0. Future local Realm access must use an exact Runtime-mediated
>   protected operation after its operation row and the caller's A.1 child
>   carrier are independently admitted. All local modes prohibit app/host/SDK
>   bearer, token/refresh provider, session store, JWT subject decode,
>   `MeService.getMe` account truth, Realm login route and SDK-owned 401 refresh.
>   Public `GetAccessToken` and the entire public `RuntimeGrantService` family
>   are deny-all pending A.3d removal.
> - **Web / cloud adapter 与 external-principal mode**：可保留本契约的 app-provided token / subject / Realm route seams，但必须显式 fenced。
>
> Local account / login / refresh-token custody 与 Realm mediation 真相由
> `RuntimeAccountService`（`K-ACCSVC-*`）拥有；SDK 投影由
> `S-RUNTIME-109` / `S-RUNTIME-110` 约束。
>
> Web / cloud adapter mode 必须显式声明 mode 标记，且与 local first-party Runtime mode 在公共 surface 上严格 fenced；不得在 local first-party 消费者中可达。
>
> `realm-api-consumer-contract.md` owns the external Realm consumer
> boundary. This file may constrain SDK facade behavior, but it must not
> restate Realm server/domain authority or rely on `.nimi/spec/realm/**` as a
> mirrored source of truth.

## S-REALM-010 Instance Isolation

Realm SDK 入口固定为实例化 facade；endpoint/token/header 必须实例级隔离。

## S-REALM-011 Request Engine Boundary

Realm 请求引擎配置只能在实例作用域生效，不得写入全局 OpenAPI 运行态。

## S-REALM-012 Endpoint/Token Validation

endpoint 或 token 缺失时必须 fail-close（NO_AUTH 显式模式除外）。

## S-REALM-013 Refresh Strategy Declaration

auth 刷新策略必须显式声明，不允许隐式后台刷新状态。

## S-REALM-014 Default Refresh Policy

未配置 refreshToken 回调时不进行自动刷新，401 直接进入错误投影。

## S-REALM-015 Auth Retry Guard

认证失败重试最多一次，且必须可观测。

## S-REALM-019 ready() Fail-Close Semantics

Realm `ready()` 探测失败必须 fail-close 并抛出错误，不得再以事件遥测替代可用性判断。

## S-REALM-027 AccessToken Function Mode

`accessToken` 支持函数模式以承载调用方手动刷新。

## S-REALM-028 401 Refresh Flow

配置 refreshToken 后，SDK 在 401 时触发 refresh 并单次重试原请求。

## S-REALM-029 Single-Flight Refresh

并发 401 必须合并为单 flight refresh，避免刷新风暴。

## S-REALM-031 Auth Error Projection Integrity

401/403/429/5xx 语义不得伪装为成功响应。

## S-REALM-035 Realtime Governance Boundary

**Authority disposition:** Blocked detailed authority conflict. Realtime protocol and dependency details are conflict evidence only and are not independently admitted for implementation; Runtime realtime authority requires a separate admission under `S-REALM-040`.

实时传输具体协议细节由后端与客户端实现定义，SDK 合同只约束认证、状态事件与重连边界。

## S-REALM-036 Reconnect Delivery Guarantee

**Authority disposition:** Blocked detailed authority conflict. Reconnect, delivery, and replay details are conflict evidence only and are not independently admitted for implementation; compatibility evidence must precede a separate Runtime replay admission under `S-REALM-040`.

重连策略实现可变，但不得静默丢失已确认投递事件。

## S-REALM-037 Event Name Ownership

**Authority disposition:** Blocked detailed authority conflict. Realtime event-vocabulary details are conflict evidence only and are not independently admitted for implementation; exact event ownership requires a separate Runtime admission under `S-REALM-040`.

SDK 不维护实时事件名权威枚举，事件名以后端协议为准。

## S-REALM-038 Unauthenticated Decision Routing

Realm SDK 允许在 `accessToken` 为空时调用以下公开决策端点，返回类型化路由判定：

- `AuthService.checkEmail` → `CheckEmailEntryRoute`（register_with_otp / login_with_otp / login_with_password）
- `AuthService.requestEmailOtp` / `verifyEmailOtp` / `passwordLogin` — 认证端点本身不需要前置 token

此为 S-REALM-012 所述 "NO_AUTH 显式模式" 的正式边界。除上述端点外，`accessToken` 缺失时的所有其他 Realm 调用仍必须 fail-close。

## S-REALM-039 No Local Realm Authority Mirror

Realm facade behavior must be derived from generated Realm core, explicit SDK
consumer contracts, and runtime/client mode configuration. SDK must not consult
or recreate `.nimi/spec/realm/**` as Realm server authority inside this
repository.

## S-REALM-040 Runtime-Mediated Local App Default

**Owner-only authority allocation.** SDK owns typed Realm APIs and trusted carriers only. Runtime remains the sole owner of every authenticated Realm data plane, including bearer injection, private refresh, unary mediation, realtime connection authority, and media credential exchange. SDK and app inputs cannot turn an app id, endpoint, token callback, event name, or generated descriptor into authorization or canonical data-plane truth.

The realtime protocol, dependency, delivery, and replay details recorded by `S-REALM-035` through `S-REALM-037` remain blocked authority conflicts until Runtime admits the corresponding realtime authority. Runtime compatibility evidence must precede any replay posture; client caches, outboxes, event shapes, or reconnect success cannot establish replay guarantees. SDK media helpers likewise remain carrier-only until Runtime admits exact media states, limits, credential custody, and failure behavior.

`createRuntimeAccountMediatedRealmTransport` is a reserved typed constructor,
not an A.0 data-path admission. It returns protected-unavailable for every app
composition until the exact Runtime operation policy and caller carrier are
admitted. When enabled by a later authority batch, it may send only typed
operation ids on that verified carrier and can never accept/expose
`accessToken`, `refreshToken`, authorization headers, Realm base truth, session
persistence, refresh callbacks, public grants, or caller-selected origin.
Installed/developer/first-party facades must not export token wrappers or
`createRealmWithRuntimeAccountToken`.
