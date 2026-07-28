# 流式

流式不是把文本"慢慢输出"这么简单。Runtime 的流式契约定义了四种强类型模式、终止帧、反压，以及 fail-closed 语义。App 把流当作权威事件时间线消费，不是任意 chunk 拼盘。

## 四种流式模式

| 模式 | 承载内容 | 关闭语义 |
| --- | --- | --- |
| Mode A | 文本与语音生成；连续 chunk 直到终止帧 | 显式 `STREAM_EVENT_COMPLETED / STREAM_EVENT_FAILED` 终止帧 |
| Mode B | 状态事件流（ScenarioJob 事件、状态更新） | 终态状态后关闭 |
| Mode C | 审计导出 | `eof` 标记后关闭 |
| Mode D | 长连接订阅（健康、App 消息、实时事件） | 长连接；只在会话拆除时关闭 |

每种模式的关闭语义都是显式的。消费 Mode A 的 App 等 `STREAM_EVENT_COMPLETED / STREAM_EVENT_FAILED`；消费 Mode B 的 App 等终态状态。流的模式由声明给出，App 不需要猜。

## 终止帧

如果一个流没有按准入的终止信号结束，那就是契约违反。Runtime 会发出强类型的失败终止帧，而不是悄悄截断。

| 模式 | 终止信号 |
| --- | --- |
| Mode A | `STREAM_EVENT_COMPLETED / STREAM_EVENT_FAILED` 帧 |
| Mode B | 终态状态事件 |
| Mode C | `eof` 标记 |
| Mode D | 会话拆除 |

如果某个 provider 在流中违反契约（形状错误、缺必填字段、schema 违例），流式契约会发一个强类型失败终止帧。当前操作 fail closed。不存在静默截断。

## 反压

流式具备端到端反压。预算从生产者贯通到消费者；消费者慢就向上施压，而不是丢帧。

| 属性 | 值 |
| --- | --- |
| 预算 | 每流独立 |
| 方向 | 生产者 → 消费者 |
| 溢出处理 | App 通过 SDK 看到反压；Runtime 不会静默丢帧 |

这点在长生成里很关键。用户在聊天窗口停手 30 秒，消费者向上施压，生产者暂停。消费者恢复后，流继续。一帧不丢。

## Fail-Closed 语义

流式契约失败按 fail-closed 处理：

| 失败类型 | 行为 |
| --- | --- |
| 帧形状错误 | 强类型失败终止帧；操作失败 |
| 缺必填字段 | 强类型失败终止帧 |
| Schema 违例 | 强类型失败终止帧 |
| MIME 不匹配 | 强类型失败终止帧 |
| 瞬时传输错误 | 按传输策略重试；可恢复则流继续 |
| 需要刷新鉴权 | 按鉴权策略刷新；可恢复则流继续 |

重试只救得回传输级失败，不救契约失败。schema 违例属于契约失败，按 fail-closed 处理，不会被重试救成"成功"。

## 场景：Mode A 文本流

App 发起一次会流式返回的文本生成。

1. **流打开。** Mode A。Runtime 开始发送文本 chunk。
2. **Chunk 到达。** 每个 chunk 都是强类型形状。App 增量渲染。
3. **Provider 抖动。** 出现一次瞬时传输错误。Runtime 按传输策略重试。流从合适的边界恢复。
4. **Provider 继续返回内容。** 流继续。
5. **生成完成。** Runtime 发出 `STREAM_EVENT_COMPLETED / STREAM_EVENT_FAILED` 终止帧。
6. **App 标记响应完成。** 用户可以进入下一轮。

没有发生过的事情：流从未静默截断。要么到达 `STREAM_EVENT_COMPLETED / STREAM_EVENT_FAILED`，要么发出了强类型失败。

## 场景：Mode B ScenarioJob 事件流

App 订阅某个 ScenarioJob 的事件流。

1. **流打开。** Mode B。Runtime 开始发送 job 事件。
2. **事件到达。** `SUBMITTED → RUNNING → ...`
3. **ScenarioJob 到达终态。** Runtime 发出 `COMPLETED`、`FAILED`、`TIMEOUT` 或 `CANCELED`。
4. **流关闭。** Mode B 关闭语义达成。

App 的 UI 随事件到达增量更新。无须轮询；事件流就是“这个 job 在干什么”的真值来源。

## 场景：慢消费者引发反压

App 正在消费一段长 Mode A 流。用户打开了一个重型 modal，渲染暂停。

1. **消费者变慢。** App 的 chunk 处理速率下降。
2. **反压上行。** SDK 流消费方向上游发出反压信号。
3. **生产者暂停。** Runtime 按预算暂停 provider 流消费。
4. **用户关闭 modal。** 消费者恢复。
5. **生产者恢复。** 流从合适的边界继续。

无丢帧，无队列爆涨。反压是端到端的。

## 来源依据

- [`.nimi/spec/runtime/rpc-foundations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/rpc-foundations.authority.yaml)
- [`.nimi/spec/runtime/model-catalog.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/model-catalog.authority.yaml)
- [`.nimi/spec/runtime/service-operations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/service-operations.authority.yaml)
- [`config/runtime-reason-codes.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/runtime-reason-codes.yaml)
