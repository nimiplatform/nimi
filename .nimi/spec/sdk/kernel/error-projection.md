# SDK Error Projection Contract

> Owner Domain: `S-ERROR-*`

## S-ERROR-001 双层错误投影

SDK 错误投影分两层：

- 上游运行时错误（gRPC/HTTP + reason_code）
- SDK 本地错误（参数校验、环境、边界违规）

## S-ERROR-002 ReasonCode 事实源

Runtime 相关 ReasonCode 以 `.nimi/spec/runtime/kernel/tables/reason-codes.yaml` 为权威。
SDK 文档不得重新分配 Runtime ReasonCode 数值。

执行命令：

- `pnpm check:reason-code-constants`

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

Runtime ReasonCode（权威源：`.nimi/spec/runtime/kernel/tables/reason-codes.yaml`）：

- `AI_PROVIDER_UNAVAILABLE`
- `AI_PROVIDER_TIMEOUT`
- `AI_PROVIDER_RATE_LIMITED`
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
- 非错误终端原因集合由 `.nimi/spec/runtime/kernel/tables/error-mapping-matrix.yaml` 中 `exit_shape: terminal_reason_non_error` 定义。
- 当前适用（完整集合，以 `error-mapping-matrix.yaml` 中 `exit_shape: terminal_reason_non_error` 为权威）：`AI_FINISH_LENGTH`、`AI_FINISH_CONTENT_FILTER`。
- 特例：`test_connector` 表面的 `AI_CONNECTOR_CREDENTIAL_MISSING` 使用 `exit_shape: payload_ok_false`（gRPC OK + ok=false payload），SDK 不应将其视为异常。
- 双模退出形态：`exit_shape: grpc_status_or_payload_ok_false` 表示同一 ReasonCode 在不同 surface 可能以 gRPC 错误或 `ok=false` payload 返回（当前适用：`AI_LOCAL_MODEL_PROFILE_MISSING`、`AI_LOCAL_MODEL_UNAVAILABLE`，surface 为 `local_consume_or_probe`）。SDK 须对两种退出形态等价处理：gRPC 错误路径按常规错误投影，`ok=false` payload 路径按非异常结果投影。

## S-ERROR-010 SDK 合成 ReasonCode 治理

SDK 在特定场景合成不在 `reason-codes.yaml` 中的 ReasonCode：

- 合成码必须在 `tables/sdk-error-codes.yaml` 的 `SDK_SYNTHETIC_REASON` family 中注册。
- 当前合成码：`OPERATION_ABORTED`、`RUNTIME_UNAVAILABLE`、`RUNTIME_BRIDGE_DAEMON_UNAVAILABLE`。
- 合成码与 runtime ReasonCode 共享 `isRetryableReasonCode()` 语义空间（`S-ERROR-007`）。

## S-ERROR-011 ExternalPrincipal 不可重试 ReasonCode

`AUTH_TOKEN_EXPIRED` 和 `AUTH_UNSUPPORTED_PROOF_TYPE`（来源：`K-AUTHSVC-013`）为 ExternalPrincipal 场景的细分错误码，均为不可重试 ReasonCode：

- `AUTH_TOKEN_EXPIRED`：ExternalPrincipal proof JWT 已过期，需应用层重新签发 proof。
- `AUTH_UNSUPPORTED_PROOF_TYPE`：不支持的 proof_type，需应用层修正注册参数。

两者均不进入 `isRetryableReasonCode()` 集合（`S-ERROR-007`），自动重试无法修复根因。

## S-ERROR-012 Mode D 流 CANCELLED 语义

Mode D 长生命周期订阅流（`K-STREAM-010`）在 daemon 进入 STOPPING 时以 gRPC `CANCELLED` 关闭。`CANCELLED` 不在 S-ERROR-004 的 retryable transport codes 中，SDK 处理规则：

- 收到 `CANCELLED` 时，SDK 发射 `runtime.disconnected` 事件（`S-RUNTIME-028`），不自动重连（`S-TRANSPORT-003`）。
- SDK 不将 `CANCELLED` 视为可重试错误——daemon STOPPING 是有意关闭，盲重试会持续失败直到 daemon 恢复。
- 应用层（Desktop/Agent）可在检测到 daemon 恢复 `READY` 状态后手动重新订阅。Desktop 通过 `runtime_bridge_status`（`D-IPC-002`）轮询检测 daemon 恢复；独立 SDK 消费者通过 `runtime.connected` 事件或 `ready()` 重试检测恢复。
- `CANCELLED` 与 `UNAVAILABLE` 的语义区分：`UNAVAILABLE` 表示暂时不可达（网络问题），可立即重试；`CANCELLED` 表示被服务端有意取消（daemon 关闭），需等待服务恢复后重建。

**跨层引用**：`K-STREAM-010`（Mode D 流协议）、`K-DAEMON-003`（STOPPING 状态）、`S-TRANSPORT-003`（禁止隐式重连）。

## S-ERROR-013 SDK 结构化归一化优先级

SDK（`asNimiError` 与 transport 适配层）必须按固定优先级归一化错误，避免结构化字段丢失：

1. 已是 `NimiError`：原样保留。
2. 结构化 JSON：优先解析 `details` 或 `message` 中可解析对象（支持嵌入 JSON）。
3. `CODE:` 前缀：提取前缀作为 `reasonCode`。
4. transport fallback：按 gRPC/HTTP 状态映射默认 `reasonCode`。
5. 最终兜底：使用 SDK 默认码（例如 `RUNTIME_CALL_FAILED` 家族）。

归一化过程不得覆盖上游已有的 `reasonCode/actionHint/traceId/retryable`。

## S-ERROR-014 Transport 投影一致性

`node-grpc` 与 `tauri-ipc` transport 必须对同一上游失败输出等价的 `NimiError` 形状：

- 字段一致：`reasonCode`、`actionHint`、`traceId`、`retryable`
- ReasonCode 提取一致：优先结构化 payload，其次 `CODE:` 前缀，其后状态映射
- 不允许一个 transport 保留结构化字段而另一个退化为纯字符串错误

## S-ERROR-015 NimiError 最小形状契约

`NimiError` 类型必须携带以下最小结构化字段（与 `K-ERR-009` 对齐）：

必填字段：
- `reasonCode: string` — 业务级错误码（来自 `reason-codes.yaml` 或 SDK 合成码）
- `message: string` — 人类可读错误描述
- `code: string` — SDK 统一错误码字段；默认与 `reasonCode` 对齐，必要时可承载 transport 派生码

可选结构化字段：
- `actionHint?: string` — 建议消费者的修复动作
- `traceId?: string` — 调用链追踪标识
- `retryable?: boolean` — 是否可安全重试
- `details?: Record<string, unknown>` — transport-safe 的结构化失败细节；当上游来自 `ScenarioJob` 终态失败时，SDK 必须保留 runtime 投影下来的 `reason_metadata`

S-ERROR-013/014 引用的字段稳定性保证在此正式升级为类型契约：任何 `NimiError` 实例必须满足上述最小形状，归一化过程不得产出缺失必填字段的实例。

## S-ERROR-016 Async ScenarioJob Failure Detail Projection

SDK 在轮询 `GetScenarioJob` 并遇到终态失败（`FAILED` / `CANCELED` / `TIMEOUT`）时，必须：

- 保留 `reasonCode` 的符号名；若 transport 给出的是 numeric enum，也必须还原为稳定字符串名
- 使用 `reasonDetail` 作为短 message，但不得丢弃 `reason_metadata`
- 将 runtime `ScenarioJob.reason_metadata` 原样投影到 `NimiError.details`

SDK 不得要求上层通过解析 `reasonDetail` 自由文本来恢复失败细节。
