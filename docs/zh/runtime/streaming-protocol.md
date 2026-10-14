# 底层流式协议与通信契约（Streaming Protocol）

Runtime 的 RPC 接口根据不同交互场景定义了清晰的流式事件格式与生命周期语义。在日常开发中，建议直接通过官方 SDK 消费数据流，无需手动解析底层的二进制 gRPC 数据帧。

## 典型流式接口与生命周期行为

| RPC 接口 | 成功终态特征 | 异常与中断处理 |
| --- | --- | --- |
| `StreamScenario` | 发送携带 `completed` 状态的终态帧 | 发送明确的 `failed` 异常事件；网络断开时触发连接超时 |
| `SubscribeScenarioJobEvents` | 持续推送状态快照直至终态，随后关闭 | 若观察流意外断开，可通过 `GetScenarioJob` 重新获取最新状态；停止观察不会取消后台计算 |
| `ExportAuditEvents` | 最后一批数据携带 `eof: true` 标记 | 流中断仅产生不完整输出；若需重新导出，需针对目标时间窗口发起新的导出请求 |
| **长连接事件订阅** | 遵循特定所属资源的生命周期 | 会话失效或守护进程重启时干净断开 |

## 生成事件流的处理原则

1. **严格保序性**：模型生成的增量文本分片（deltas）在传输层保持严格的顺序传递，客户端按序拼接即可保证文本连贯。
2. **指标与数据严格隔离**：内容分片、性能指标（如 Token 统计 `usage`）与生命周期信号（启动、完成）封装在独立的消息包中。
3. **断线与重连策略**：对于即时交互流，短暂断线应向用户提供明确的重试入口；对于异步作业，客户端应用使用持久化的 `jobId` 重新绑定即可。

## 背压与资源保护

为了防止慢客户端导致本地 Runtime 内存耗尽：
- **有界滑动窗口**：流式通道采用有界的滑动窗口，缓冲区饱和时向上游推理工作进程施加背压。
- **超时连接清理**：无响应或悬挂的套接字连接会在到达设定超时后自动回收，及时释放系统 socket 句柄。

## Source Basis

- [`.nimi/spec/runtime/rpc-foundations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/rpc-foundations.authority.yaml)
- [`.nimi/spec/runtime/service-operations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/service-operations.authority.yaml)
- [`proto/runtime/v1/ai.proto`](https://github.com/nimiplatform/nimi/blob/main/proto/runtime/v1/ai.proto)
- [`sdks/typescript/runtime/scenario-jobs.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/runtime/scenario-jobs.ts)
