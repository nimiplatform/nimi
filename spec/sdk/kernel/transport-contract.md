# SDK Transport Contract

> Owner Domain: `S-TRANSPORT-*`

## S-TRANSPORT-001 Runtime Transport 显式声明

Runtime SDK transport 必须显式声明：

- `node-grpc`
- `tauri-ipc`

禁止隐式默认 transport。

## S-TRANSPORT-002 Metadata 投影边界

Runtime SDK 必须遵循 metadata/body 分离：

- `connectorId` 在 request body
- provider endpoint/api_key 在 transport metadata

## S-TRANSPORT-003 流式行为边界

- SDK 不得隐式重连续流。
- 中断后必须由调用方显式重建订阅。

## S-TRANSPORT-004 Realm 请求引擎边界

Realm SDK 必须通过实例级配置完成 endpoint/token/header 合并，不允许共享全局 OpenAPI 运行态配置。

## S-TRANSPORT-005 SDK/Runtime 版本兼容边界

SDK 与 Runtime 的版本协商必须显式可判定：

- major 不兼容必须 fail-close，不允许静默降级为”部分可用”。
- minor/patch 差异允许通过能力探测或方法可用性检查做受控降级。
- 版本兼容判断结果必须可被上层读取（用于提示与治理），不得仅写日志。

发现机制：

- 版本信息通过初始连接的 metadata 交换获取。
- 方法可用性通过已知方法集合（`runtime-method-groups.yaml`）静态判定，不依赖运行时反射。
- 降级仅限于 Phase 2 deferred 方法标记为不可用，不改变 Phase 1 方法语义。

**blocked vs deferred 语义区分**：

- `blocked`：Phase 1 服务但 proto 依赖未就绪（如 ConnectorService，`SDKR-050`），SDK 返回 `SDK_RUNTIME_METHOD_UNAVAILABLE`。blocked 服务的方法一旦 proto 发布即可实现，不需要版本协商。
- `deferred`：Phase 2 服务（如 WorkflowService），在版本兼容降级中标记为不可用。deferred 服务的可用性取决于 runtime 版本支持。

## S-TRANSPORT-006 Trace 与可观测性边界

- SDK 必须支持将调用链 trace 标识透传到下游（如 metadata/header）。
- 任何可观测性输出禁止包含明文凭据（api key/token）。
- 可观测性是辅助面，不得改变请求成功/失败语义与重试判定。

## S-TRANSPORT-007 流式终帧投影

SDK 必须将 runtime 流式终帧（`done=true`）中的 `reason_code` 和 `usage` 投射给消费者：

- `done=true + REASON_CODE_UNSPECIFIED` = 正常完成。
- `done=true + 错误 reason_code` = 业务错误（非 gRPC 错误），SDK 必须作为流级错误投影，不可静默丢弃。
- 终帧语义权威定义：`K-STREAM-002`（建流阶段边界）、`K-STREAM-003`（文本流事件约束，含 usage 与 done 语义）、`K-STREAM-004`（语音流事件约束）。
- `SubscribeMediaJobEvents` 不使用 `done=true` 语义（`K-STREAM-005`），终态后 server 关流。

## S-TRANSPORT-008 流式超时投影

流式 RPC 超时由 runtime 侧强制执行（`K-STREAM-007`）：

- 首包超时默认 10s（由 runtime 侧配置控制，`K-DAEMON-008`），SDK 侧不可覆盖；超时触发 `DEADLINE_EXCEEDED + AI_PROVIDER_TIMEOUT`。
- 总超时默认 120s，独立计时，可由 runtime 配置调整（`K-DAEMON-008`，`K-DAEMON-009`）。
- SDK 不叠加独立客户端侧流超时（除非显式配置）。
- `AI_PROVIDER_TIMEOUT` 属于可重试 ReasonCode（`S-ERROR-007`）。

## S-TRANSPORT-009 Chunk 透传边界

- Runtime chunk 缓冲至最小 32 bytes（`K-STREAM-006`）。
- SDK 不重新拆分或合并 chunk，直接透传 runtime 边界。
