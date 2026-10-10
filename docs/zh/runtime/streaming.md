# 流与 Job 观察

流承载有序的强类型事件。连接关闭本身不能证明成功；需要消费该操作定义的终止信号，并区分传输失败与最后一次可信状态。

## 生成流

文本及受支持的语音生成使用强类型增量和明确的完成或失败结果。建流前，准入检查可拒绝调用；建流后，在仍能投递时通过规定的失败事件报告业务失败。传输断开或 Runtime 关闭可能导致终止事件无法到达，客户端不能把这种中断当成成功。

平台不承诺重连后普遍重放未完成的生成。共享实时层只提供有限重连机制，恢复由各 owner 决定。AI Realtime 会话是临时状态，Runtime 或 Driver 丢失时关闭；LocalAgent Conversation 从已提交快照恢复，不依赖持久事件重放。

## 异步 Job

统一流程是 Submit、反复 Get 原 Job、正式读取结果，以及用户明确要求时 Cancel。`GetScenarioJob` 可以为原生异步任务触发一次有界核对；没有后续 Get，Runtime 不会启动常驻 Provider 轮询。

`SubscribeScenarioJobEvents` 返回状态快照，能让界面更及时更新。它是 Get 之外的提示，不负责推动异步 Provider，也不能代替完整终态 Get。观察频率归 App。事件中的终态不替代 Get 或正式 artifact 读取接口中的专属结果字段。

`observationIssue` 与 Job 状态分开：它表示本次观察的问题，可伴随最后可信快照返回，但不能证明原任务失败。取消订阅、离开页面或断线只结束观察，不取消已准入工作。明确 Cancel 是另一项操作；仅有 canceled 状态也不能证明外部计费或执行停止，必须保留返回的 stop outcome。

恢复时保留原 Job 身份或预先保存的提交身份，查询并观察原工作，不重新生成。在 Runtime 的有限保留期结束前，把完整结果保存为 App 数据。

## 有界投递

Runtime 限制消息、缓冲、订阅延迟、重试与存活时间。慢消费者会收到反压或强类型资源/消费过慢失败，不承诺无限暂停与无损重放。独立通道和轨道相互隔离。

Wire 细节见 [流式协议](/zh/runtime/streaming-protocol)，可编译的 [Scenario Job 示例](https://github.com/nimiplatform/nimi/blob/main/examples/sdk/05-scenario-job.ts) 使用受保护 App 客户端。

## Source Basis

- [`.nimi/spec/runtime/rpc-foundations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/rpc-foundations.authority.yaml)
- [`.nimi/spec/runtime/service-operations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/service-operations.authority.yaml)
- [`sdks/typescript/runtime/scenario-jobs.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/runtime/scenario-jobs.ts)
