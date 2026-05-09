# 跨界面连续性

> 状态：运行中 (Running)。ConversationAnchor 是运行时拥有的连续性原语；跨界面连接、后期加入和恢复机制已交付。

Nimi 代理并非仅存在于一个应用程序中。同一个对话可以在桌面聊天、Avatar、Web 之间来回切换——代理将其视为一个持续进行的会话线程。**跨界面连续性**是运行时契约，它使得这种切换成为可能，而不会让对话对用户而言坍缩成一个单一的全局会话。

## 连续性解决的问题

两种简单的设计会以相反的方式失败：

-   **每个代理一个全局会话。** 所有与同一代理通信的界面共享一个流。结果：用户永远无法与同一代理进行两个并行对话。
-   **每个界面一个会话。** 每个应用程序都有自己的线程。结果：在桌面聊天中开始的对话，当用户稍后打开 Avatar 时会*消失*。

运行时的解决方案是 `ConversationAnchor`：它按代理和对话进行键控，由运行时拥有，并可从任何界面连接。

## 锚点属性

| 属性         | 值                                                               |
| :----------- | :--------------------------------------------------------------- |
| 范围         | 每个代理 + 每个对话                                              |
| 所有者       | 运行时 (`RuntimeAgentService`)                                   |
| 身份范围     | `agent_id` 是身份，`conversation_anchor_id` 是连续性             |
| 多重性       | 一个代理可以托管多个锚点（多个并行对话）                         |
| 持久性       | 锚点真相可通过已提交的运行时真相重建                             |
| 所需身份     | `agent_id` + `subject_user_id` + `conversation_anchor_id` + 状态 + 最后提交的轮次/消息身份 |

`agent_id` 是**代理身份**。它不是对话连续性。两个与同一代理通信的界面不会自动处于同一对话中；它们必须显式地连接到（或打开）一个共享锚点。

## 连接与打开

界面可以选择：

-   **打开**一个新锚点：`OpenConversationAnchor` 需要显式的 `agent_id` + `subject_user_id`，并返回一个已提交的 `ConversationAnchorSnapshot`。
-   **连接**到一个现有锚点：`GetConversationAnchorSnapshot` 通过显式的 `agent_id` + `conversation_anchor_id` 恢复已提交的连续性。

界面**不得**默认推断“同一代理意味着同一对话”。后期加入的界面必须通过运行时拥有的快照重建锚点真相，而不是通过重放解析器内部状态或从应用程序本地历史记录中猜测。

## 同一锚点界面共享的内容

| 同一锚点界面共享的内容 | 形式                                   |
| :--------------------- | :------------------------------------- |
| 轮次投影               | `runtime.agent.turn.*` 事件            |
| 呈现投影               | `runtime.agent.presentation.*` 事件    |
| 轮次中断语义           | 锚点范围；中断会传播到所有已连接的界面 |
| 连续性身份             | `conversation_anchor_id`               |
| 轮次/消息 ID 范围      | 在一个锚点内唯一                       |
| 流 ID 范围             | 流是运行时拥有的呈现/轮次流，锚点范围  |

## 不同锚点界面不共享的内容

在**相同** `agent_id` 下的两个锚点，**不**会隐含地共享 `turn_id`、`message_id` 或中断传播。它们都可以观察代理范围的投影（`runtime.agent.state.*`、`runtime.agent.memory.*`、`runtime.agent.hook.*`），但消费者不得将这些代理范围的投影解释为一个对话流。

## 读者场景：一个对话，三个界面，一天

用户早上在桌面上与他们的代理开始聊天。午餐时，他们打开 Avatar——代理以实体形式出现在屏幕上。晚上，在手机上，他们打开 Web 应用程序。

1.  **桌面打开对话。** `OpenConversationAnchor` 为 `(agent_id, conversation_anchor_id)` 提交一个新的锚点。后续的轮次都将锚定于此。
2.  **Avatar 解析。** Avatar 通过 `GetConversationAnchorSnapshot` 连接到相同的 `conversation_anchor_id`。Avatar 中代理的声音和实体反映了正在进行的轮次状态。在桌面开始流式传输的轮次可以在 Avatar 中完成。
3.  **Web 连接。** Web 执行相同的锚点解析。用户可以回溯查看早上的消息，因为它们存在于 Realm 聊天中，位于由该锚点键控的同一线程下。

在一天中，代理是同一个实体，在三个界面上说着同样的话。运行时拥有锚点；Realm 拥有聊天线程；Avatar 拥有实体。

## 读者场景：与一个代理进行两个并行对话

用户有一个作为项目助手的代理。今天他们需要讨论两件不同的事情——一个编码项目和一个购物清单。

1.  **对话 A 开始。** `OpenConversationAnchor` 为编码对话返回一个新的锚点。
2.  **对话 B 开始。** 另一个 `OpenConversationAnchor` 调用为购物对话返回一个不同的锚点。
3.  **不合并。** 范围限定为 A 的内存写入不会污染 B 的上下文。范围限定为 B 的内存写入保留在 B 中。
4.  **用户可随意切换。** 每个锚点都保持其自身的连续性。用户无需手动管理“我处于哪个会话中”。

如果没有按对话划分的锚点，拥有一个代理的用户将实际上永远只有一个大型对话。

## 读者场景：界面崩溃，对话继续

用户正在 Avatar 中进行对话。Avatar 在轮次进行中崩溃。

1.  **锚点存在于运行时，而非 Avatar。** 运行时仍然拥有锚点和进行中的轮次状态。
2.  **用户重新打开 Avatar。** Avatar 重新连接到运行时，调用 `GetConversationAnchorSnapshot`，恢复锚点。
3.  **流恢复。** 轮次投影从运行时已提交的真相中恢复。
4.  **Realm 聊天保留消息。** 没有消息丢失；聊天线程由 Realm 拥有。

锚点的运行时所有权正是使界面故障可存活的关键。

## 读者场景：在活跃轮次期间后期加入

用户在桌面上观看代理的响应流。他们想起想在 Avatar 上看到这个。他们打开 Avatar。

1.  **Avatar 在轮次进行中连接。** 后期加入是已准入路径；它通过运行时所持的锚点 / 会话快照进行重建。
2.  **Avatar 加入正在进行的流。** 它不会重放解析器内部状态或从桌面的 UI 状态中猜测。运行时向 Avatar 提供已提交的快照。
3.  **两个界面都保持活跃直到完成。** 它们共享中断语义：如果用户在 Avatar 上点击停止，桌面的流也会中断。

## 跨界面连续性不实现的功能

-   它**不**会将 `ConversationAnchor` 变成一个全局会话。两个具有相同 `agent_id` 的锚点是独立的对话。
-   它**不**拥有桌面窗口生命周期。
-   它**不**拥有 Avatar 的位置或渲染器本地交互状态。
-   它**不**拥有提供者原生的转录真相。
-   它**不**允许界面在客户端构建影子锚点。`runtime.agent.turn.request` 只能引用一个已存在的已提交 `conversation_anchor_id`。

## 边界总结

| 关注点                   | 所有者                       |
| :----------------------- | :--------------------------- |
| 对话连续性身份           | 运行时 (`RuntimeAgentService`) |
| 跨界面连接 + 后期加入 + 恢复 | 运行时（锚点快照真相）       |
| 聊天线程内容             | Realm 聊天                   |
| 每个界面的 UI 状态       | 界面本身                     |
| 范围限定为对话的内存写入 | 认知内存 + 运行时内存库      |
| 实体界面的呈现流         | 运行时呈现流                 |

## 来源依据

-   [`.nimi/spec/runtime/kernel/agent-conversation-anchor-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/agent-conversation-anchor-contract.md)
-   [`.nimi/spec/runtime/kernel/runtime-agent-service-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/runtime-agent-service-contract.md)
-   [`.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md)
-   [`.nimi/spec/runtime/kernel/runtime-agent-participation-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/runtime-agent-participation-contract.md)