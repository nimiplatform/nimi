# WEE 投影

## 状态：已准入平台方向

SDK WEE 投影合约已在内核级别被准入。
可运行的呈现表面已被准入为方向；运行时侧的 WEE 引擎本身也被准入为平台方向（参见 [WEE 执行](/platform/worlds/wee-execution)）。

## 该呈现是什么

SDK WEE 投影表面允许应用程序**读取** WEE 状态——即世界演化引擎的运行时本地执行证据，这些证据被转换为应用程序可以使用的类型化形状。读取是这个表面的作用；驱动 WEE 是 [WEE 消费者](/sdk/wee-consumer) 的作用。

## 职责划分

| 拥有 | 不拥有 |
| --- | --- |
| WEE 状态的类型化呈现 API | WEE 引擎语义（运行时 `K-WEV-*`） |
| 易于阅读的呈现形状 | 领域规范真相（领域） |
| 锚定范围的读取表面 | 运行时本地执行证据定义 |

WEE 状态是**运行时本地执行证据**，而不是领域的规范真相。呈现使这些证据可被消费，但不会将其提升为领域的权威。

## 读者场景：应用程序显示 WEE 阶段进度

应用程序希望向用户展示某个事件正在通过 WEE 阶段（NORMALIZE → SCHEDULE → DISPATCH → ...）。

1. **应用程序调用 SDK。** `weeProjection.subscribeStage(eventId)`。
2. **SDK 传递类型化的阶段事件。** 每个事件都携带类型化的阶段转换。
3. **应用程序显示。** "事件 X 处于 TRANSITION 阶段。"
4. **不声明领域真相。** 呈现层只是执行证据；它不会自我标榜为规范事实。

## 该呈现不做的事情

- 它不允许应用程序修改 WEE 状态。
- 它不会将运行时本地执行证据提升为领域的真相。
- 它不会发明阶段名称或转换。

## 来源依据

- [`.nimi/spec/sdk/kernel/world-evolution-engine-projection-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/world-evolution-engine-projection-contract.md)
- [`.nimi/spec/runtime/kernel/world-evolution-engine-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/world-evolution-engine-contract.md)