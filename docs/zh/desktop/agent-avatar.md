# Agent Avatar（桌面聊天界面）

> 状态：现已可用。桌面端聊天里的 Agent 状态展示由 Runtime 驱动；完整的形象载体是独立的 Avatar 应用。

在桌面端和 Agent 聊天时，你会看到一个小小的状态指示：空闲、思考、倾听、说话或过渡中。它**有意不是**形象载体。Avatar 应用才是载体，桌面端聊天是通向它的**桥**。

## 该界面是什么

| 概念 | 含义 |
| --- | --- |
| `AvatarInteractionState` | 当前锚点/当前界面上的临时状态 |
| `phase` | `idle` / `thinking` / `listening` / `speaking` / `transitioning` |
| `emotion` | 可选的情绪映射（从运行时获取，非自创） |
| `actionCue` | 可选的类型提示，描述 Agent 正在做什么 |
| `attentionTarget` | 可选的注视/注意力目标 |
| `visemeId` / `amplitude` | 可选的口型同步相关字段 |

这个状态指示是临时的：只反映当前这段对话，不会被存成持久数据。

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

这个分工是固定的。桌面端聊天不承载 Live2D / VRM；想看形象，打开 Avatar 应用。

## 桌面聊天如何桥接到 Avatar

1. **Runtime 发出状态事件。**
   `runtime.agent.presentation.*` 和 `runtime.agent.state.*` 事件携带阶段、情绪、动作提示、注意力目标和口型同步帧。
2. **桌面聊天标准化。** 根据 `.nimi/spec/desktop/agent-projection.authority.yaml` (D-LLM-053..D-LLM-054)，桌面将这些事件映射到统一的 `AvatarInteractionState`。
3. **可重用套件头像消费。** `kit/features/avatar` 和 `apps/avatar` 都消费标准化的界面输入。两者都不会越过合同去获取隐藏的桌面语义。

聊天窗口和独立的 Avatar 载体就是这样保持同步的：它们互不通信，听的都是同一批 Runtime 事件。

## 读者场景：一次语音回合驱动两个界面

用户与他们的 Agent 交谈。Avatar 应用已打开；桌面聊天也已打开。

1. **语音开始。** 运行时发出临时 `presentation.*` 事件：`phase: listening`，然后 `phase: thinking`，然后 `phase: speaking` 并带有口型同步帧。
2. **桌面聊天更新。** 聊天头像临时界面在消息气泡附近显示匹配的阶段指示器+情绪呈现。
3. **Avatar 载体更新。** `apps/avatar` 消费相同的运行时事件；载体通过 Live2D 渲染说话姿势+口型同步。
4. **两个界面同步。** 两者都不互相通信；两者都与运行时通信。

如果用户关闭了 Avatar 载体，桌面聊天的临时界面将继续渲染——它是自己的界面。

## 该界面不做的事情

- 不做 Live2D / VRM 渲染——那是 `apps/avatar` 的事。
- 不保存持久的呈现配置——那归 Runtime。
- 不定义消息与操作的封装——那是桌面聊天消息/动作契约的事。
- 不负责语音会话与工作流——那是桌面语音契约的事。
- 不会留下持久数据——`AvatarInteractionState` 是临时的，用完即弃。

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
