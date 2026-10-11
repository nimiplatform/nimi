# 底层流式协议与通信契约（Streaming Protocol）

Runtime 的 RPC 接口根据不同交互场景定义了清晰的流式事件结构与生命周期规范。通常情况下，应用开发者建议直接使用官方 SDK 提供的封装方法，无需手动解析底层的二进制 gRPC 流。

## 典型流式接口与生命周期行为

| RPC 接口 | 成功终态特征 | 异常与中断处理 |
| --- | --- | --- |
| `StreamScenario` | 发送携带 `completed` 的终态事件 | 发送明确的 `failed` 异常事件；若网络物理断开则触发连接超时 |
| `SubscribeScenarioJobEvents` | 持续推送中间进度快照，到达终态后优雅关闭 | 若观察流意外断开，可通过 `GetScenarioJob` 重新获取最新状态，作业本身继续执行 |
| `ExportAuditEvents` | 最后一批数据携带 `eof: true` 标记 | 中断流仅产生不完整结果；如需重新导出，需针对指定时间窗口发起新的导出请求 |
| **长连接事件订阅** | 遵循特定业务对象的生命周期 | 会话注销、服务重启时优雅通知客户端断开 |

## 生成事件流的处理原则

1. **严格保序性**：模型生成的增量文本分片（Deltas）在传输层保持严格的序列保序，客户端按顺序拼装即可保证文本连贯；
2. **状态与数据清晰区分**：流式管道中将纯文本切片、性能指标（如 Token 统计 `usage`）与状态变更事件（如启动、完成）以独立的结构体进行分发；
3. **断线与重连策略**：对于即时对话生成，若遇到底层网络断开，推荐前端向用户展示友好的断网提示并提供重试入口；对于长耗时异步任务，则依靠 `jobId` 进行状态轮询，避免重复提交相同请求。

## 背压与资源自适应调节

为了防止客户端消费速率过慢导致本地 Runtime 内存无限积压：
- **流控窗口限制**：传输通道维持一个有界的环形缓冲区，当达到阈值时自动对上游推理引擎施加背压调节；
- **优雅超时回收**：长期未响应或已断开的悬挂连接会被自动回收并释放底层 socket 句柄。

## Source Basis

- [`.nimi/spec/runtime/rpc-foundations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/rpc-foundations.authority.yaml)
- [`.nimi/spec/runtime/service-operations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/service-operations.authority.yaml)
- [`proto/runtime/v1/ai.proto`](https://github.com/nimiplatform/nimi/blob/main/proto/runtime/v1/ai.proto)
- [`sdks/typescript/runtime/scenario-jobs.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/runtime/scenario-jobs.ts)
