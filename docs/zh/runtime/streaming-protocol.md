# 流式协议

> 状态：运行中 (Running)。流式合约 (`K-STREAM-*`) 是每个运行时服务器流式 RPC 的已发布关闭模式权威。

运行时拥有多个服务器流式 RPC（文本生成、语音合成、场景作业事件、工作流事件、审计导出、长期订阅）。流式合约明确了**每个流如何关闭**，以便消费者可以编写不依赖于协议形状猜测的恢复逻辑。

## 四种关闭模式

该合约将每个运行时服务器流式 RPC 分类为以下四种关闭模式之一：

| 模式 | 关闭信号 | RPC |
| --- | --- | --- |
| **A — `done=true` 终端帧** | 最终事件携带 `done=true` | `StreamScenario` (`TEXT_GENERATE`), `StreamScenario` (`SPEECH_SYNTHESIZE`) |
| **B — 终端事件后 gRPC OK 关闭** | 服务器发出终端事件，然后干净地关闭流 | `SubscribeScenarioJobEvents`, `SubscribeWorkflowEvents` |
| **C — `eof=true` 块后 gRPC OK 关闭** | 服务器发出 `eof=true` 块，然后关闭 | `ExportAuditEvents` |
| **D — 长期订阅流** | 无终端帧；任何一方都可关闭 | `SubscribeRuntimeHealthEvents`, `SubscribeAIProviderHealthEvents`, `SubscribeAccountSessionEvents`, `SubscribeMemoryEvents`, `SubscribeAgentEvents`, `SubscribeAppMessages`, `ReadRealtimeEvents`, `WatchLocalTransfers`, `grpc.health.v1.Health/Watch` |

模式 D 流没有终端信号。当守护进程进入 `STOPPING` (`K-DAEMON-003`) 时，它会使用 gRPC `CANCELLED` 关闭所有活动订阅。客户端通过 `runtime.disconnected` (`S-RUNTIME-028`) 或 gRPC 状态检测关闭，并决定是否重建。

## 流建立边界

对于 `StreamScenario` (`TEXT_GENERATE` / `SPEECH_SYNTHESIZE`)：

| 阶段 | 错误流向 |
| --- | --- |
| `K-KEYSRC-004` 评估链的第 1-9 步 | 建立前错误 → gRPC 错误 |
| 第 10 步（路由执行） | 流已建立；后续业务/上游错误 → 终端帧 (`done=true + reason_code`) |

这种划分是故意的：建立前的错误是连接失败（调用者从未开始流式传输）；建立后的错误是流内的业务结果（调用者已经在流式传输）。

## 模式 A 事件约束

文本流 (`TEXT_GENERATE`)：

| 事件形状 | 必须 |
| --- | --- |
| `done=false` 事件 | `text_delta` 必须非空 |
| `done=true` 终端 | 必须携带 `usage`；如果上游缺乏令牌统计信息，则填充 `-1`；可能携带最终 `text_delta` |

语音流 (`SPEECH_SYNTHESIZE`)：

| 事件形状 | 必须 |
| --- | --- |
| `done=false` 事件 | `audio_chunk` 必须非空 |
| `done=true` 成功 | `reason_code=REASON_CODE_UNSPECIFIED`；`audio_chunk` 为空 |
| `done=true` 失败 | 必须携带 `reason_code`；`audio_chunk` 为空 |

## 模式 B 事件约束

`SubscribeScenarioJobEvents` 和 `SubscribeWorkflowEvents`：

| 规则 | 值 |
| --- | --- |
| `done=true` 语义 | 不使用 |
| 稳态关闭 | 在终端事件后，服务器以 gRPC OK 关闭流 |
| `STOPPING` 预占 | 守护进程可能会使用 gRPC `CANCELLED` 预占活动流；终端事件传递不保证 |

同一个作业/工作流在非终端状态下可能会多次发出相同 `event_type` 的状态事件。消费者必须用最新事件内容覆盖先前快照；**不要** 假设严格的事件类型单调性。

## 读者场景：文本流式调用

应用程序调用 `StreamScenario` 进行文本生成。

1. **建立前验证。** `K-KEYSRC-004` 链的第 1-9 步：解析、JWT、app_id、密钥源、连接器加载、所有者检查、端点安全等。
2. **建立。** 所有建立前检查通过。流开始（第 10 步）。
3. **`done=false` 事件。** 每个事件携带非空 `text_delta`。
4. **终端 `done=true`。** 携带 `usage`。可能携带最终 `text_delta`。
5. **流关闭。** 收到终端帧后，gRPC OK 关闭。

如果在建立后发生故障，它将以带有 `done=true + reason_code` 的终端帧形式出现，而不是作为 gRPC 错误。

## 读者场景：长期订阅在守护进程重启后存活

应用程序订阅 `SubscribeAccountSessionEvents`。

1. **流打开。** 模式 D。随着会话状态变化，事件流式传输。
2. **守护进程进入 `STOPPING`。** 运行时使用 gRPC `CANCELLED` 关闭所有活动订阅。
3. **应用程序检测关闭。** 通过 `runtime.disconnected` 或 gRPC 状态。
4. **重新连接逻辑。** 应用程序决定在守护进程恢复时重建订阅；它不假设守护进程“应该”发送终端事件。

合约明确的“模式 D 中无终端信号”使得恢复逻辑正确——应用程序不会永远等待一个永远不会到来的事件。

## 读者场景：具有重复事件类型的作业事件

应用程序订阅 `SubscribeScenarioJobEvents`。

1. **作业运行。** 同一 `event_type`（例如 `progress`）在执行期间多次发出更新的快照内容。
2. **应用程序覆盖先前快照。** 不按事件类型去重。
3. **终端事件。** 当作业完成时，终端事件到达；服务器以 gRPC OK 关闭流。

如果守护进程首先进入 `STOPPING`，流可能会在终端事件之前以 gRPC `CANCELLED` 关闭——应用程序在下次守护进程可用时重建订阅，并从作业快照中重新推导终端状态。

## 流式协议不做的事情

- 它不允许消费者推断关闭行为；每个 RPC 的模式都在表中明确列出。
- 它不允许在模式 B/C/D 中使用 `done=true` 语义。
- 它不允许模式 D 流期望终端事件。
- 它不允许在模式 A 中将建立后的错误作为 gRPC 错误而不是终端帧显示。
- 它不允许消费者假设作业/工作流流中的严格事件类型单调性。

## 边界摘要

| 关注点 | 权威来源 |
| --- | --- |
| 关闭模式分类 | `K-STREAM-001` |
| 建立边界 | `K-STREAM-002` |
| 文本流事件 | `K-STREAM-003` |
| 语音流事件 | `K-STREAM-004` |
| 状态事件流 | `K-STREAM-005` |
| 块分帧 | `K-STREAM-006` |
| EOF 块关闭 | `K-STREAM-009` |
| 订阅流生命周期 | `K-STREAM-010` |
| 守护进程关闭耦合 | `K-DAEMON-003` |

## 来源依据

- [`.nimi/spec/runtime/kernel/streaming-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/streaming-contract.md)
- [`.nimi/spec/runtime/kernel/key-source-routing.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/key-source-routing.md)
- [`.nimi/spec/runtime/kernel/app-messaging-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/app-messaging-contract.md)