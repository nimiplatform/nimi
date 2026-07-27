# Agent Avatar（桌面聊天界面）

> 状态：运行中 (Running)。桌面聊天使用由运行时拥有的临时头像界面权威；Avatar 应用是一个独立的第一方应用。

桌面端 Agent 聊天显示一个临时头像界面——这个小的视觉信号表示 Agent 处于空闲、思考、倾听、说话或过渡状态。它**刻意不**是载体。Avatar 应用是载体；桌面聊天是一个**桥梁**。

## 该界面是什么

| 概念 | 含义 |
| --- | --- |
| `AvatarInteractionState` | 当前锚点/当前界面上的临时状态 |
| `phase` | `idle` / `thinking` / `listening` / `speaking` / `transitioning` |
| `emotion` | 可选的情绪映射（从运行时获取，非自创） |
| `actionCue` | 可选的类型提示，描述 Agent 正在做什么 |
| `attentionTarget` | 可选的注视/注意力目标 |
| `visemeId` / `amplitude` | 可选的口型同步相关字段 |

此界面是临时的：它仅存在于当前锚点/界面上。它不会成为规范的真实数据。

## 为什么桌面聊天不是载体

| 关注点 | 所有者 |
| --- | --- |
| 载体/渲染 | Avatar 应用 (`apps/avatar`) — Live2D/VRM 执行位于此处 |
| 持久性展示配置文件/默认声音 | 运行时 (`agent-presentation-contract.md`) |
| 临时运行时展示事件 | 运行时 (`agent-presentation-stream-contract.md`) |
| 消息/动作封装 | 桌面聊天消息/动作合同 |
| 语音会话/工作流 | 桌面聊天语音合同 |
| 桌面聊天头像临时界面 | 桌面（此界面） |
| 可重用套件头像模块 | `kit/features/avatar`（仅消费标准化输入） |

所有权划分是固定的。桌面聊天不托管 Live2D/VRM 载体；如果用户需要载体，Avatar 应用将提供。

## 桌面聊天如何桥接到 Avatar

1. **运行时发出临时呈现事件。**
   `runtime.agent.presentation.*` 和 `runtime.agent.state.*` 事件携带阶段、情绪、动作提示、注意力目标和口型同步帧。
2. **桌面聊天标准化。** 根据 `.nimi/spec/desktop/agent-projection.authority.yaml` (D-LLM-053..D-LLM-054)，桌面将这些事件映射到统一的 `AvatarInteractionState`。
3. **可重用套件头像消费。** `kit/features/avatar` 和 `apps/avatar` 都消费标准化的界面输入。两者都不会越过合同去获取隐藏的桌面语义。

这就是为什么聊天界面和独立的 Avatar 载体能够保持同步而无需相互协调——它们都消费相同的运行时呈现事件。

## 读者场景：一次语音回合驱动两个界面

用户与他们的 Agent 交谈。Avatar 应用已打开；桌面聊天也已打开。

1. **语音开始。** 运行时发出临时 `presentation.*` 事件：`phase: listening`，然后 `phase: thinking`，然后 `phase: speaking` 并带有口型同步帧。
2. **桌面聊天更新。** 聊天头像临时界面在消息气泡附近显示匹配的阶段指示器+情绪呈现。
3. **Avatar 载体更新。** `apps/avatar` 消费相同的运行时事件；载体通过 Live2D 渲染说话姿势+口型同步。
4. **两个界面同步。** 两者都不互相通信；两者都与运行时通信。

如果用户关闭了 Avatar 载体，桌面聊天的临时界面将继续渲染——它是自己的界面。

## 读者场景：群聊防伪

用户在一个包含人类和 Agent 插槽的群聊中。

1. **群聊线程。** Realm `R-CHAT-*` 接受 `GROUP` 类型。
2. **Agent 发帖。** Realm 在消息提交前验证 Agent 插槽绑定。防伪检查在协议层面进行。
3. **桌面聊天头像界面反映 Agent 作者。** Agent 作者的临时界面根据该轮次的运行时呈现事件进行更新。
4. **人类不能冒充 Agent。** 插槽绑定是已确认的 Realm 权威——头像临时界面永远不会显示在人类作者上。

临时界面信任 Realm 插槽绑定的身份。它不会发明作者身份。

## 该界面不做的事情

- 它不托管 Live2D/VRM 渲染——那是 `apps/avatar` 的职责。
- 它不拥有持久性展示配置文件——那是运行时的职责。
- 它不拥有消息/动作封装——那是桌面聊天消息/动作合同的职责。
- 它不拥有语音会话/工作流——那是桌面语音合同的职责。
- 它不会成为规范的真实数据——`AvatarInteractionState` 是临时的，不是持久的。

## 边界总结

| 关注点 | 所有者 |
| --- | --- |
| 桌面聊天头像临时界面 | 桌面 (`.nimi/spec/desktop/agent-projection.authority.yaml`, D-LLM-053..) |
| 持久性展示配置文件+默认声音 | 运行时 (`agent-presentation-contract.md`) |
| 临时轮次/呈现接口 | 运行时 (`agent-presentation-stream-contract.md`) |
| Avatar 载体+执行 | Avatar 应用 (`apps/avatar`) |
| 可重用套件头像消费者 | `kit/features/avatar` |
| 配置/调试工作台 | 桌面 (`.nimi/spec/desktop/agent-projection.authority.yaml`, `agent-avatar-debug-workbench-contract.md`) |

## 来源依据

- [`.nimi/spec/desktop/agent-projection.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/agent-projection.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)