# Streaming Contract

> Owner Domain: `K-STREAM-*`

## K-STREAM-001 适用 RPC

本契约覆盖 Runtime 全部 server-streaming RPC。按流关闭模式分类：

**模式 A — done=true 终帧**（K-STREAM-003/004）：
- `StreamScenario`（TEXT_GENERATE）
- `StreamScenario`（SPEECH_SYNTHESIZE）

**模式 B — 终态事件后 gRPC OK close**（K-STREAM-005）：
- `SubscribeScenarioJobEvents`（状态事件流）
- `SubscribeWorkflowEvents`（K-WF-004：终态事件后 server 正常关闭流）

**模式 C — eof=true 块后 gRPC OK close**（K-STREAM-009）：
- `ExportAuditEvents`（K-AUDIT-009：`eof=true` 后 server 关闭流）

**模式 D — 长生命周期订阅流**（K-STREAM-010）：
- `SubscribeRuntimeHealthEvents`（K-AUDIT-013）
- `SubscribeAIProviderHealthEvents`（K-AUDIT-013）
- `SubscribeAppMessages`（K-APP-003）

模式 D 的流没有终帧/eof 信号，客户端或 server 可单方关闭。server 关闭场景：daemon 进入 STOPPING（K-DAEMON-003）时以 gRPC `CANCELLED` 关闭所有活跃订阅流。客户端应以 `runtime.disconnected`（S-RUNTIME-028）或 gRPC status 检测到关闭后决策是否重建。

## K-STREAM-002 阶段边界

`StreamScenario`（TEXT_GENERATE/SPEECH_SYNTHESIZE）的建流边界固定为：

- K-KEYSRC-004 定义的 10 步评估链中，step 1-9（校验阶段）全部通过后，stream 才算建立；step 10（路由执行）即为流式推理的开始。
- 建流前错误统一走 gRPC error。
- 建流后业务/上游错误优先走终帧事件（`done=true + reason_code`）。

## K-STREAM-003 文本流事件约束

- `done=false` 事件：`text_delta` 必须非空。
- `done=true` 终帧：必须携带 `usage`；若上游缺失 token 统计则填 `-1`。
- `done=true` 终帧可携带最后一段 `text_delta`。

## K-STREAM-004 语音流事件约束

- `done=false` 事件：`audio_chunk` 必须非空。
- `done=true` 成功：`reason_code=REASON_CODE_UNSPECIFIED`，`audio_chunk` 为空。
- `done=true` 失败：`reason_code` 必填，`audio_chunk` 为空。

## K-STREAM-005 状态事件流约束

`SubscribeScenarioJobEvents` 不使用 `done=true` 语义；终态事件后 server 正常关闭流（gRPC OK）。

## K-STREAM-006 Chunk framing 规则

流式 AI 输出的 chunk 最小单元为 32 bytes。实现在达到最小单元前缓冲数据；终帧时刷出所有剩余缓冲。

## K-STREAM-007 首包超时独立于总超时

流式 RPC 有两个独立超时：

- **首包超时**：从请求发出到收到第一个非空 chunk 的等待上限（默认 60s，`K-DAEMON-008`）。
- **总超时**：从请求发出到流正常关闭的总耗时上限（默认 120s）。

首包超时触发时，流以 `DEADLINE_EXCEEDED` + `AI_PROVIDER_TIMEOUT` 终止。总超时独立计时，不因收到首包而重置。

## K-STREAM-008 流关闭模式统一分类

Runtime 全部 server-streaming RPC 归入四种关闭模式（K-STREAM-001 分类表）：

| 模式 | 关闭信号 | 适用 RPC | 详细规则 |
|---|---|---|---|
| A — done=true 终帧 | 最后一帧 `done=true` + 可选 `reason_code` | StreamScenario(TEXT_GENERATE), StreamScenario(SPEECH_SYNTHESIZE) | K-STREAM-003, K-STREAM-004 |
| B — 终态事件后 close | 终态事件（COMPLETED/FAILED/CANCELED 等）发出后 server gRPC OK close | SubscribeScenarioJobEvents, SubscribeWorkflowEvents | K-STREAM-005, K-WF-004 |
| C — eof=true 块后 close | `eof=true` 块发出后 server gRPC OK close | ExportAuditEvents | K-AUDIT-009 |
| D — 长生命周期订阅 | 无终帧/eof 信号；server 在 daemon STOPPING 时以 `CANCELLED` 关闭 | SubscribeRuntimeHealthEvents, SubscribeAIProviderHealthEvents, SubscribeAppMessages | K-STREAM-010 |

SDK 消费方实现流式 RPC 时必须按所属模式处理流关闭语义。新增 server-streaming RPC 时必须在本表中声明所属模式。

## K-STREAM-009 eof 标记流关闭协议

`ExportAuditEvents` 使用 eof 标记流关闭模式（模式 C）：

- 每个 chunk 携带 `eof` 布尔字段。
- `eof=true` 标记最后一个数据块。
- server 在发送 `eof=true` 块后正常关闭流（gRPC OK）。
- 客户端在收到 `eof=true` 后应停止读取。

详细字段定义见 K-AUDIT-009。

## K-STREAM-010 长生命周期订阅流协议

长生命周期订阅流（模式 D）没有业务层的终止信号，流的生命周期与订阅方/被观察资源的生命周期绑定：

- server 在以下场景关闭流：
  - daemon 进入 `STOPPING` 状态（K-DAEMON-003）
  - 被订阅资源不再可用
- server 关闭流时使用 gRPC `CANCELLED` 状态码。
- 客户端通过 gRPC status 或 `runtime.disconnected` 事件检测到流关闭。
- 重建策略由 SDK/Desktop 消费层定义，Runtime 不规定。

## K-STREAM-011 End-to-End Backpressure Budget

Runtime → SDK → Desktop 的流式路径必须共享显式背压预算，而不是把缓冲无限下推：

- Runtime 负责声明每类流的 server-side queue depth 和 flush 粒度。
- SDK 负责把慢消费者状态转化为可判定的取消、暂停或失败，而不是继续无限累积内存。
- Desktop/UI 层负责在不可及时消费时优先丢弃可重建的中间态，不得阻塞终态、错误态和审计态事件。

## K-STREAM-012 Slow Consumer Failure Mode

- 当 server-side queue depth 超过预算且客户端未及时消费时，Runtime 必须以确定性方式结束流：优先 `RESOURCE_EXHAUSTED` 或 `CANCELLED`，不得静默悬挂。
- 对于存在终态事件的流，Runtime 必须优先保证终态/失败态可达，再丢弃可重建的中间 delta。
- SDK 必须把慢消费者关闭原因投影为稳定的错误形态；Desktop 不得把该类关闭误报为“模型输出完成”。

## K-STREAM-013 Resume / Retry Boundary

- 背压触发后的恢复边界必须由流类型显式决定：订阅流可重建，非幂等执行流不得自动重放。
- SDK 自动重试只适用于订阅型或可安全重放的读取型流；执行型流是否重试必须由调用方显式决策。
- Desktop 在流因背压关闭后，必须展示“已中断/需重试”的用户可读状态，并保留 `trace_id` 供跨层排障。
