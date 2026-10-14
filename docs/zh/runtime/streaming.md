# 流式事件与异步任务观察机制

在 Nimi 中，流式通道用于低延迟传输文本增量分片（tokens）、音频帧与模型状态呈现事件；而耗时较长的计算任务（如图像合成、视频生成或音乐渲染）则通过结构化的异步任务（Scenario Jobs）进行管理与状态追踪。

## 流式通道生命周期

- **结构化增量输出**：受支持的文本流发送增量分片，Realtime 媒体遵循独立的会话与通道契约；普通语音合成 Job 返回完成后的音频产物，并非所有生成都提供实时音频流。
- **显式终态与错误信号**：流式管道在成功完成或发生异常时均会发送明确的终态事件，使客户端能够清晰区分网络断开与实际操作成功。
- **弹性恢复机制**：若遭遇网络中断，会话可基于已提交的会话快照重新恢复，保证上下文完整性。

## 异步任务（Scenario Jobs）工作流

对于计算密集型操作，应用遵循标准化的异步任务流程：

1. **提交任务（Submit）**：应用提交任务说明，Runtime 校验参数并返回唯一的 `jobId`；支持恢复的任务类型可保存 `clientSubmissionId` 以查询原提交；它不是所有任务通用的自动重试键。
2. **观察状态（Get 与 Subscribe）**：
   - 通过 `GetScenarioJob` 轮询任务健康状况与终态；
   - 可选订阅 `SubscribeScenarioJobEvents`，实时接收进度回调与阶段变更。
3. **获取产物（Retrieve Artifacts）**：当任务状态转为 `completed` 时，读取最终生成的文件或结构化记录；文本向量通过同步 Scenario 调用获取。
4. **任务取消（Cancellation）**：若用户放弃任务，可发送 Cancel 指令请求中止计算；客户端应用应检查返回的终态与 `stopOutcome`，确认底层计算是已确认停止还是处于未确认状态。

## 背压与资源保护

为保护本机计算资源：
- **自适应限流**：Runtime 维持有界缓冲区与订阅超时，防止资源受限的客户端出现内存耗尽。
- **容量管理**：Runtime 维持队列上限与并发执行约束，防止计算任务耗尽系统内存与资源。

## 相关文档

- [底层流式协议细节](/zh/runtime/streaming-protocol)

## Source Basis

- [`.nimi/spec/runtime/rpc-foundations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/rpc-foundations.authority.yaml)
- [`.nimi/spec/runtime/service-operations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/service-operations.authority.yaml)
- [`examples/sdk/05-scenario-job.ts`](https://github.com/nimiplatform/nimi/blob/main/examples/sdk/05-scenario-job.ts)
