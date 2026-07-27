# 虚拟形象控制客户端

## 状态：已准入契约；公开使用以 SDK package exports 为准

运行时虚拟形象控制客户端合约已在 SDK 内核级别被准入。该合约规定了 SDK 使用者如何从虚拟形象载体外部控制虚拟形象状态；只有出现在 SDK package exports 中的客户端 surface 才能作为公开 API 使用。

## 该客户端的作用

虚拟形象控制客户端是应用程序通过已准入的运行时事件来驱动虚拟形象状态（请求活动、设置情绪、推送展示更新）的SDK界面。它**不是**直接访问Live2D / VRM的方式；后端执行仍然在虚拟形象内部进行。

## 边界

| 拥有 | 不拥有 |
| --- | --- |
| 类型化的运行时虚拟形象控制界面 | Live2D / VRM 执行 |
| 通过已准入的运行时事件进行授权 | 每帧参数写入 |
| 锚点范围内的活动/情绪/展示请求 | 渲染器本地插值 |

SDK调用通过运行时进行；运行时发出类型化的`runtime.agent.presentation.*`事件；虚拟形象消费该事件。SDK不会绕过这一链路。

## 读者场景：应用程序触发虚拟形象挥手

应用程序希望在某个里程碑发生时用户的代理能够挥手。

1. **应用程序调用SDK。** `controlClient.requestActivity(activityId: 'wave', anchor)`。
2. **SDK验证。** 活动ID在已准入的活动本体中；锚点有效。
3. **运行时处理。** 发出`runtime.agent.presentation.activity_requested`事件。
4. **虚拟形象消费。** 事件通过活跃的后端分支路由；挥手动作播放。
5. **审计谱系。** 活动请求通过已准入的范围绑定归因于应用程序。

## 读者场景：应用程序推送展示更新

应用程序希望为UI时刻设置代理的表情。

1. **应用程序调用SDK。** `controlClient.requestExpression('happy', anchor)`。
2. **运行时发出。** `presentation.expression_requested`事件。
3. **虚拟形象消费。** 后端渲染。
4. **遵守锚点范围。** 变更应用于锚点的流；而不是作为没有已准入范围的全局代理状态。

## 该客户端不做的事情

- 它不会绕过`runtime.agent.*`事件。
- 它不会直接写入Live2D / VRM参数。
- 它不会在已准入的本体之外发明活动/情绪/姿势ID。
- 它不允许在没有已准入锚点的情况下进行控制。

## 来源依据

- [`.nimi/spec/sdks/feature-clients.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/feature-clients.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
