# 流式事件与异步任务观察机制

在 Nimi 中，流式通信（Streaming）承载着实时的文本生成切片、音频帧以及模型状态事件；而长耗时操作（如图像生成、视频渲染或音乐合成）则通过异步任务（Scenario Job）模型进行统一调度与状态追踪。

## 生成流生命周期

- **结构化增量推送**：文本与语音生成通过流式通道实时返回增量数据分片，前端应用可实现低延迟的即时呈现。
- **显式完成与错误通知**：流式管道在生成正常结束或发生异常时均会发送明确的终态事件，使客户端能够准确区分网络传输断开与实际业务成功。
- **连接弹性与恢复策略**：若发生网络临时抖动，会话可基于当前会话快照重新同步。对于对话类交互，系统优先从已落地的权威轮次中恢复，确保上下文的一致性。

## 异步任务（Scenario Job）工作流

对于耗时较长的重型计算任务，系统采用标准的异步作业模式：

1. **提交任务（Submit）**：应用提交生成请求，Runtime 校验参数并返回唯一的 `jobId`；应用端可记录 `clientSubmissionId` 确保幂等性。
2. **状态轮询与事件订阅（Get & Subscribe）**：
   - 应用可通过 `GetScenarioJob` 轮询任务状态；
   - 也可结合 `SubscribeScenarioJobEvents` 实时接收中间进度事件，提升界面交互体验。
3. **获取最终产物（Artifacts）**：当任务状态转为 `COMPLETED` 时，应用调用读取接口获取生成的文件或结构化数据。
4. **用户主动取消（Cancel）**：若用户中途决定停止，可发送取消请求；应用端需检查返回的终态与 `stopOutcome` 以确认底层计算是否已真正中止或仍处于未确认状态。

## 背压与资源保护

为了确保系统长期稳定运行：
- **流量自适应控制**：Runtime 为每个活动连接设置了合理的缓冲区上限与超时阈值，防止高频事件淹没低性能消费端。
- **容量管理**：Runtime 维护队列上限与并发约束，防止计算任务耗尽系统内存与资源。

## 相关文档

- [底层流式协议细节](/zh/runtime/streaming-protocol)

## Source Basis

- [`.nimi/spec/runtime/rpc-foundations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/rpc-foundations.authority.yaml)
- [`.nimi/spec/runtime/service-operations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/service-operations.authority.yaml)
- [`examples/sdk/05-scenario-job.ts`](https://github.com/nimiplatform/nimi/blob/main/examples/sdk/05-scenario-job.ts)
