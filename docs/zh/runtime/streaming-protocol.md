# 流式协议

Runtime RPC 各自定义事件形状和关闭行为。App 通常消费受保护 SDK 接口，不自行构造直连 gRPC。

| 接口 | 正常完成 | 中断处理 |
| --- | --- | --- |
| `StreamScenario` | 强类型 completed 或 failed 终止事件 | 断线可能阻止终止投递，不能推断成功 |
| `SubscribeScenarioJobEvents` | 投递 Job 快照至终态后关闭 | 用 Get 重新观察原 Job；结束观察不取消工作 |
| `ExportAuditEvents` | 最后一块携带 `eof=true` | 中断的导出不完整 |
| 长连接订阅 | 遵循各 owner 生命周期，没有通用成功帧 | 会话、权限、传输或 daemon 变化都可关闭订阅 |

## 生成事件

建流前的准入失败是操作错误。建立后的生成流携带契约规定的 started、delta、usage、completed 或 failed 事件。消费者保留内容顺序，区分成功终止、失败与中断；语音字节和 MIME 必须满足确切输出契约。

断线后无法保证终止帧送达。不能把部分生成重试当成原操作续传；明确重新生成是 App 的另一个动作。

## Job 快照与完整结果

同一 Job 可以多次发出相同状态或事件类型的快照，不能因为类型重复就丢弃更新。事件不包含所有专属终态结果。

对同一身份持续调用 `GetScenarioJob`，每次可在有限工作范围内核对原 Provider 任务。读取完整终态响应，包括 VoiceAsset/VoiceReference、视觉定位等专属结果；含正式 artifact 输出的契约使用 `GetScenarioArtifacts`。合法空结果与缺少必要结果不同。

观察错误不能被伪造成 Job 终态。SDK 观察辅助函数保留原 Job、返回强类型问题，并区分结束观察和明确取消执行。另见 [流与 Job 观察](/zh/runtime/streaming)。

## 重连与资源限制

共享实时设施负责排序、代次隔离、取消、有界缓冲和安全生命周期元数据，不拥有通用重放或持久检查点。Realm 定义游标恢复，LocalAgent 从已提交 Conversation 快照恢复，AI Realtime 保持临时会话语义。

反压有界：慢消费者可能收到强类型失败并被关闭。Daemon 关闭或权限过期会关闭对应订阅并隔离迟到数据；客户端必须通过所属接口重新建立授权状态，才能接收新代次数据。

## Source Basis

- [`.nimi/spec/runtime/rpc-foundations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/rpc-foundations.authority.yaml)
- [`.nimi/spec/runtime/service-operations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/service-operations.authority.yaml)
- [`proto/runtime/v1/ai.proto`](https://github.com/nimiplatform/nimi/blob/main/proto/runtime/v1/ai.proto)
- [`sdks/typescript/runtime/scenario-jobs.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/runtime/scenario-jobs.ts)
