# WEE 消费者

## 状态：已准入平台方向

SDK WEE 消费者合约已在内核级别被准入。可运行的消费者表面也被准入为发展方向。

## 该消费者的作用

SDK WEE 消费者是应用程序用来**驱动**WEE状态的接口——提交事件提案、请求类型化的阶段转换、参与提交请求的暂存——通过已准入的运行时侧WEE引擎。

读取WEE状态是[WEE 投影](/sdk/wee-projection)的角色；驱动则在这里进行。

## 职责划分

| 拥有 | 不拥有 |
| --- | --- |
| 类型化事件提案提交API | WEE 阶段执行语义（运行时） |
| 类型化提交请求观察 | 领域提交信封权威（领域） |
| 面向消费者的读者场景形状 | 运行时本地执行证据语义 |

消费者提交；运行时执行；领域准入。消费者不能发明阶段或跳过运行时引擎。

## 读者场景：应用程序提交一个世界事件提案

应用程序希望在用户操作时提出一个类型化的世界事件。

1. **应用程序调用SDK。** `weeConsumer.submitProposal({ eventType, payload, anchor })`。
2. **运行时摄入。** WEE `INGRESS` 阶段接收提案。
3. **运行时阶段。** NORMALIZE → SCHEDULE → DISPATCH → TRANSITION → EFFECT → COMMIT_REQUEST。
4. **领域准入或拒绝。** 根据 `R-WSTATE-005` 授权矩阵。
5. **应用程序观察结果。** 通过WEE投影。

## 该消费者不做的事情

- 它不允许消费者跳过WEE阶段。
- 它不会绕过领域提交信封。
- 它不允许消费者发明 `effectClass` 值。
- 它不会将消费者负载提升为领域规范真相，除非在已准入的提交管道中。

## 来源依据

- [`.nimi/spec/sdk/kernel/world-evolution-engine-consumer-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/world-evolution-engine-consumer-contract.md)
- [`.nimi/spec/runtime/kernel/world-evolution-engine-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/world-evolution-engine-contract.md)
- [`.nimi/spec/realm/kernel/world-state-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/world-state-contract.md)