# SDK Realm Contract

> Owner Domain: `S-REALM-*`

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

实时传输具体协议细节由后端与客户端实现定义，SDK 合同只约束认证、状态事件与重连边界。

## S-REALM-036 Reconnect Delivery Guarantee

重连策略实现可变，但不得静默丢失已确认投递事件。

## S-REALM-037 Event Name Ownership

SDK 不维护实时事件名权威枚举，事件名以后端协议为准。

## S-REALM-038 Unauthenticated Decision Routing

Realm SDK 允许在 `accessToken` 为空时调用以下公开决策端点，返回类型化路由判定：

- `AuthService.checkEmail` → `CheckEmailEntryRoute`（register_with_otp / login_with_otp / login_with_password）
- `AuthService.requestEmailOtp` / `verifyEmailOtp` / `passwordLogin` — 认证端点本身不需要前置 token

此为 S-REALM-012 所述 "NO_AUTH 显式模式" 的正式边界。除上述端点外，`accessToken` 缺失时的所有其他 Realm 调用仍必须 fail-close。
