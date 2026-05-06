# 流式

流式不只是文字渐渐到达。Runtime 流式合同定义了四种类型化模式、终止帧、backpressure、fail-close 语义。App 把流看作权威事件时间线，不是任意 chunk 汤。

## 四种流式模式

| 模式 | 载什么 | 关闭语义 |
| --- | --- | --- |
| Mode A | 文本与语音生成；chunk 直到终止 | 显式 `done=true` 终止帧 |
| Mode B | 状态事件流（工作流事件、状态更新） | 终态状态后关闭 |
| Mode C | 审计导出 | `eof` 标记后关闭 |
| Mode D | 长存订阅（健康、App 间消息、实时事件） | 长存；只在 session 拆除时关闭 |

每种模式有显式关闭语义。消费 Mode A 流的 App 等 `done=true`；消费 Mode B 流的 App 等终态状态。流的模式是被声明的；App 不必猜。

## 终止帧

没有准入的终止信号就结束的流是合同违规。Runtime 发类型化失败终止，不是静默截断。

| 模式 | 终止信号 |
| --- | --- |
| Mode A | `done=true` 帧 |
| Mode B | 终态状态事件 |
| Mode C | `eof` 标记 |
| Mode D | session 拆除 |

如果 Provider 中途让合同失败 — 形状错、缺必填字段、schema 违规 — 流式合同发类型化失败终止帧。工作流搬到 `FAILED`。**没有静默截断**。

## Backpressure

流式有端到端 backpressure。预算从生产方共享到消费方；慢消费方对上游施压，而不是丢帧。

| 性质 | 值 |
| --- | --- |
| 预算 | 按流 |
| 方向 | 生产方 → 消费方 |
| 溢出 | App 通过 SDK 看到 backpressure；Runtime 不静默丢 |

长生成时这点重要。用户 30 秒不在 chat 窗口里打字；消费方施压；生产方暂停。消费方恢复后，流继续。**没有帧丢失**。

## Fail-close 语义

流式合同失败 fail-close：

| 失败类型 | 行为 |
| --- | --- |
| 帧形状错 | 类型化失败终止；工作流 `FAILED` |
| 缺必填字段 | 类型化失败终止 |
| Schema 违规 | 类型化失败终止 |
| MIME 不匹配 | 类型化失败终止 |
| 瞬时 transport 错误 | 按 transport 策略重试；可恢复则流继续 |
| 需要 auth 刷新 | 按 auth 策略刷新；可恢复则流继续 |

重试只救 transport 级失败。它**不救合同失败**。Schema 违规是合同失败、fail-close；它不会被重试救成成功。

## 阅读场景：Mode A 文本流式

App 发起一个流式文本生成。

1. **流打开。** Mode A。Runtime 开始发文本 chunk。
2. **Chunk 到达。** 每条 chunk 是类型化形状。App 增量渲染。
3. **Provider 抖动。** 瞬时 transport 错。Runtime 按 transport 策略重试。流从合适边界恢复。
4. **Provider 返回内容。** 流继续。
5. **生成完成。** Runtime 发 `done=true` 终止帧。
6. **App 标记响应完成。** 用户可以进入下一轮。

**没**发生：流从未静默截断。要么走到 `done=true`，要么发了类型化失败。

## 阅读场景：Mode B 工作流事件流

App 订阅一个工作流的事件流。

1. **流打开。** Mode B。Runtime 开始发工作流事件。
2. **事件到达。** `STARTED → NODE_STARTED → NODE_PROGRESS → NODE_COMPLETED → ...`
3. **工作流到终态。** Runtime 发终态状态事件（`COMPLETED` / `FAILED` / `CANCELED` / `SKIPPED`）。
4. **流关闭。** Mode B 关闭语义满足。

App UI 随事件到达增量更新。无 polling；事件流就是「这个工作流现在怎么样」的真相来源。

## 阅读场景：慢消费方触发 backpressure

App 在消费一段长 Mode A 流。用户打开了一个重 modal，渲染暂停。

1. **消费方变慢。** App chunk 处理速率下降。
2. **backpressure 应用。** SDK 流消费方向上游发 backpressure 信号。
3. **生产方暂停。** Runtime 按预算暂停 Provider 流消费。
4. **用户关 modal。** 消费方恢复。
5. **生产方恢复。** 流从合适边界继续。

没帧丢。没有队列无限增长。Backpressure 端到端。

## 来源

- [`.nimi/spec/runtime/kernel/streaming-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/streaming-contract.md)
- [`.nimi/spec/runtime/kernel/error-model.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/error-model.md)
- [`.nimi/spec/runtime/kernel/workflow-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/workflow-contract.md)
- [`.nimi/spec/runtime/kernel/scenario-job-lifecycle.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/scenario-job-lifecycle.md)
- [`.nimi/spec/runtime/kernel/tables/reason-codes.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/tables/reason-codes.yaml)
- [`.nimi/spec/runtime/kernel/tables/error-mapping-matrix.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/tables/error-mapping-matrix.yaml)
- [`.nimi/spec/runtime/kernel/audit-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/audit-contract.md)
- [`.nimi/spec/runtime/kernel/pagination-filtering.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/pagination-filtering.md)
