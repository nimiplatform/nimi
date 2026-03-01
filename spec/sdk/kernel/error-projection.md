# SDK Error Projection Contract

> Owner Domain: `S-ERROR-*`

## S-ERROR-001 双层错误投影

SDK 错误投影分两层：

- 上游运行时错误（gRPC/HTTP + reason_code）
- SDK 本地错误（参数校验、环境、边界违规）

## S-ERROR-002 ReasonCode 事实源

Runtime 相关 ReasonCode 以 `spec/runtime/kernel/tables/reason-codes.yaml` 为权威。
SDK 文档不得重新分配 Runtime ReasonCode 数值。

## S-ERROR-003 SDK 本地错误码事实源

SDK 本地错误码唯一事实源为 `tables/sdk-error-codes.yaml`。

## S-ERROR-004 重试语义

重试语义必须与底层 transport code 协同：

- `UNAVAILABLE` / `DEADLINE_EXCEEDED` / `RESOURCE_EXHAUSTED` / `ABORTED`（其中 `ABORTED` 受 ReasonCode 优先级约束，见下文）可标记为 retryable
- 流中断不做自动重连

ReasonCode 优先级：当 ReasonCode 为 `OPERATION_ABORTED`（SDK 合成码，不在 runtime reason-codes.yaml 中）时，即使 transport code 为 `ABORTED`，也不可重试（S-ERROR-008 优先）。
ReasonCode 级 retryable 判定优先于 transport code 级判定。

## S-ERROR-005 Realm 本地配置错误投影

Realm SDK 的本地配置错误（实例参数校验、请求引擎配置非法）必须使用 `SDK_REALM_*` family。
具体 code 名称以 `tables/sdk-error-codes.yaml` 为权威，不在 domain 文档重复枚举。

## S-ERROR-006 版本与方法兼容错误投影

SDK 在版本协商或方法可用性检查阶段触发的本地错误必须使用 `SDK_RUNTIME_*` 本地错误码：

- 版本不兼容（如 major 断裂）必须返回显式不兼容错误码。
- 方法在目标 runtime 不可用时必须返回显式方法不可用错误码。
- 不允许将上述兼容性错误降级为通用网络错误或空成功响应。

## S-ERROR-007 应用层 Retryable ReasonCode

公开 `isRetryableReasonCode()` 函数标记面向上层消费者（如 ai-provider）的
可重试应用级 ReasonCode。此集合与 S-ERROR-004 的 transport 级 retryable 是互补关系，不重叠。

retryable 集合分两类来源：

Runtime ReasonCode（权威源：`spec/runtime/kernel/tables/reason-codes.yaml`）：

- `AI_PROVIDER_UNAVAILABLE`
- `AI_PROVIDER_TIMEOUT`
- `AI_STREAM_BROKEN`
- `SESSION_EXPIRED`

SDK 合成 ReasonCode（SDK 本地生成，不在 runtime reason-codes.yaml 中）：

- `RUNTIME_UNAVAILABLE`
- `RUNTIME_BRIDGE_DAEMON_UNAVAILABLE`

## S-ERROR-008 Runtime 内部连接恢复重试

Runtime 内部 transparent retry（auto 连接模式）使用独立 retryable 集合，
包含 SDK transport 错误码（`SDK_RUNTIME_NODE_GRPC_UNARY_FAILED` 等）。
此集合仅用于内部连接恢复，不暴露为公开 API。
`OPERATION_ABORTED` 永不重试。

## S-ERROR-009 非错误终端原因投影

Runtime 响应可携带 `reason_code` 且 gRPC 状态为 `OK`，属于非错误终端原因：

- SDK 必须将这些投射为响应元数据或 `finishReason` 字段，不可作为抛出错误。
- 非错误终端原因集合由 `spec/runtime/kernel/tables/error-mapping-matrix.yaml` 中 `exit_shape: terminal_reason_non_error` 定义。
- 当前适用（完整集合，以 `error-mapping-matrix.yaml` 中 `exit_shape: terminal_reason_non_error` 为权威）：`AI_FINISH_LENGTH`、`AI_FINISH_CONTENT_FILTER`。
- 特例：`test_connector` 表面的 `AI_CONNECTOR_CREDENTIAL_MISSING` 使用 `exit_shape: payload_ok_false`（gRPC OK + ok=false payload），SDK 不应将其视为异常。

## S-ERROR-010 SDK 合成 ReasonCode 治理

SDK 在特定场景合成不在 `reason-codes.yaml` 中的 ReasonCode：

- 合成码必须在 `tables/sdk-error-codes.yaml` 的 `SDK_SYNTHETIC_REASON` family 中注册。
- 当前合成码：`OPERATION_ABORTED`、`RUNTIME_UNAVAILABLE`、`RUNTIME_BRIDGE_DAEMON_UNAVAILABLE`。
- 合成码与 runtime ReasonCode 共享 `isRetryableReasonCode()` 语义空间（`S-ERROR-007`）。
