# 传输与错误

> 状态：运行中 (Running)。SDK 传输合同和 SDK 错误转换合同已发布在 `sdk/kernel/transport-contract.md` + `sdk/kernel/error-projection.md`。

SDK 传输与错误表面涵盖了 SDK 如何通过已准入的传输方式与运行时通信，以及运行时错误如何转换为类型化的 SDK 错误，以便应用程序可以可靠地处理这些错误。

## 传输

| 关注点 | 权威 |
| --- | --- |
| 传输绑定 | `sdk/kernel/transport-contract.md` |
| 连接生命周期 | 每个已准入的传输 |
| 重连策略 | 仅限传输层（不修复合同级错误） |

合同中准入的传输方式规定了 SDK 调用如何到达运行时。传输层负责字节传输；它不负责“修复”合同级错误。

## 错误转换

| 关注点 | 权威 |
| --- | --- |
| 从运行时到 SDK 的错误转换 | `sdk/kernel/error-projection.md` |
| 原因代码显示 | 类型化；永远不会静默丢弃 |
| 解码/内容类型/模式失败 | 显示为类型化的 SDK 错误；不会重试 |
| 认证/传输失败 | 显示为类型化的 SDK 错误；根据传输策略可能重试 |

边界：**重试/认证刷新仅是传输/认证机制**。它们不会修复解码、内容类型、模式或合同级错误。模式无效的响应不会通过重试变得有效。

## 读者场景：模式无效的响应

运行时返回一个在 SDK 中未能通过模式验证的响应。

1. **SDK 转换错误。** 具有模式失败原因代码的类型化 SDK 错误。
2. **无静默重试。** 传输可能会重试传输失败；这不属于此类情况。
3. **应用程序处理类型化错误。** 显示用户可见的原因，而不假装成功。

## 读者场景：传输断开

运行时守护进程进入 STOPPING 状态；SDK 传输断开。

1. **SDK 检测到。** 根据 `S-RUNTIME-028` `runtime.disconnected` 或 gRPC 状态。
2. **传输重连策略。** 根据已准入的传输策略。
3. **应用程序接收类型化的传输错误。** 应用程序决定是否在重新连接后重试调用。
4. **不伪造成功。** 传输断开不会静默产生一个伪造的响应。

## 传输与错误不做的事情

- 它们不会通过重试来修复模式/内容类型/解码/合同级错误。
- 它们不会静默丢弃原因代码。
- 它们不会让认证刷新替代修复模式错误。

## 来源依据

- [`.nimi/spec/sdk/kernel/transport-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/transport-contract.md)
- [`.nimi/spec/sdk/kernel/error-projection.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/error-projection.md)
- [`.nimi/spec/runtime/kernel/streaming-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/streaming-contract.md)