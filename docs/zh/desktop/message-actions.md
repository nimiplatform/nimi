# 消息操作

> 状态：运行中 (Running)。桌面代理聊天行为契约
> + 代理聊天消息操作契约已发布在
> `desktop/kernel/agent-chat-{behavior,message-action}-contract.md`。

桌面聊天中的每条消息操作（如重新生成、分支、编辑等）
通过类型化契约进行管理，这些契约规定了每个操作的功能、保留的对话连续性以及如何参与已准入的运行时轮次语义。

## 行为与消息操作分离

| 契约 | 负责 |
| --- | --- |
| 代理聊天行为 | 消息间的通用行为（轮次准入、重试行为、中途停止） |
| 代理聊天消息操作 | 每条消息的类型化操作（重新生成、分支、编辑） |

通用行为（例如，“中途停止会保留部分回复”）是行为契约。每条消息的操作（例如，“用户点击了此消息的重新生成”）是消息操作契约。

## 已准入的消息操作

| 操作 | 功能 |
| --- | --- |
| 重新生成 | 重新生成代理对同一锚点和轮次输入的回复 |
| 分支 | 从该消息开始分支对话；根据契约创建新的锚点或子锚点 |
| 编辑 | 编辑用户的先前消息并重新生成 |
| 其他已准入的操作见 `agent-chat-message-action-contract.md` |

每个操作都是类型化的；模块/应用程序代码不能发明新的操作。

## 边界

| 负责 | 不负责 |
| --- | --- |
| 每条消息操作的UI及类型化调度 | 轮次执行（运行时） |
| 操作引起的锚点生命周期 | `ConversationAnchor` 语义（运行时） |
| 面向用户的操作界面 | Realm聊天线程的真实状态（Realm） |

## 读者场景：用户重新生成回复

用户点击代理最后一条消息的重新生成。

1. **操作分发。** 桌面发出针对目标消息的类型化重新生成操作。
2. **锚点保留。** 同一 `ConversationAnchor`；根据已准入的重新生成语义创建新轮次。
3. **运行时处理。** 轮次生命周期重新运行。
4. **新回复流。** 替换（或根据契约堆叠）聊天线程中的前一个回复。

## 读者场景：用户从某条消息开始分支

用户希望从这一点开始探索另一个对话分支。

1. **分支操作分发。** 桌面发出类型化分支操作。
2. **创建新锚点。** 根据消息操作契约的分支语义。
3. **原始对话未受影响。** 用户可以在原始对话和分支之间切换。

## 消息操作不做的事情

- 它们不允许模块/应用程序代码发明新的操作。
- 它们不会绕过轮次生命周期。
- 它们不会静默修改Realm聊天线程的真实状态。
- 它们不会重新定义 `ConversationAnchor` 的结构。

## 来源依据

- [`.nimi/spec/desktop/kernel/agent-chat-behavior-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/agent-chat-behavior-contract.md)
- [`.nimi/spec/desktop/kernel/agent-chat-message-action-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/agent-chat-message-action-contract.md)
- [`.nimi/spec/runtime/kernel/agent-conversation-anchor-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/agent-conversation-anchor-contract.md)