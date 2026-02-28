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

- `UNAVAILABLE` / `DEADLINE_EXCEEDED` / `RESOURCE_EXHAUSTED` / `ABORTED` 可标记为 retryable
- 流中断不做自动重连
