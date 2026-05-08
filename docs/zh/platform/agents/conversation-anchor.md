# 对话锚（Conversation Anchor）

`ConversationAnchor` 是 Runtime 持有的连续性身份。它让一段对话能跨多个面（桌面端聊天、Avatar、网页端）继续下去，又不至于塌成同一个全局会话。

## 它解决的问题

朴素的设计是把「这段对话」按 agent_id 当成一条线程。这样会有两个方向都坏：

- 如果对话是全局的，那么用户在桌面端和 Avatar 同时跟同一个 Agent 说话时，两端会被合并成一条，根本无法存在两段并行的对话。
- 如果对话是「按面隔离」的，那么从桌面端聊天开始的一段对话，到 Avatar 里继续就接不上了，Avatar 会把它当一段新的对话。

对话锚把这两端折中。它的键不是「按 Agent 全局」的，而是 **每个 Agent + 每段对话** 一把。

| 属性 | 取值 |
| --- | --- |
| 作用域 | 每个 Agent + 每段对话 |
| 归属 | Runtime |
| 持久性 | 跨面切换仍存在 |
| 多重性 | 同一 Agent 可以同时有多个锚（多段并行对话） |
| 解析 | 用户挑一段对话继续时，由面解析出锚 |

## 它在实践中怎么走

用户在桌面端聊天里跟某个 Agent 开始一段对话。Runtime 以 `(agent_id, conversation_id)` 为键创建一个 `ConversationAnchor`。后续在桌面端的回合都挂在这个锚上。

之后用户打开 Avatar。Avatar 解析用户的意图：「继续刚才那段对话」。Avatar 按对话 id 查到，复用同一个锚。Agent 在 Avatar 里给出的下一句继续这条线程；Avatar 这一边产生的 memory 写入也归在同一段对话血缘里。

之后又在网页端，用户挑了同一段对话。网页端做同样的锚解析。Agent 在网页端的回应继续同一条线程。

整个过程中，对话从来不会塌成「与该 Agent 的全局会话」。如果用户想跟同一个 Agent 另开一段对话，那就是另一把锚，两段对话不合并。

## 锚承载的内容

锚是连续性身份，不是对话内容。内容在 Realm 聊天里。锚让多个面在一条 Runtime 持有的线程下参与同一段对话。

| 锚的职责 | 归属 |
| --- | --- |
| 「这段对话」的身份 | Runtime（锚） |
| 消息线程 | Realm 聊天 |
| 对话作用域内的 memory 写入 | Cognition memory + Runtime memory bank |
| 实体化面的呈现流 | Runtime presentation stream |

锚本身有意做窄。它只是让多个面在「这段对话是哪一段」上达成一致；它不是聊天线程本身，不是 memory，不是呈现。

## 场景：一段对话，三块面

某用户早上在桌面端跟自己的 Agent 聊起来。中午打开 Avatar，Agent 这时在屏幕上有了形象。晚上在手机的网页端打开。

整整一天，三块面共享**同一段**与该 Agent 的对话。

- 桌面端聊天打开对话时，锚被创建。
- Avatar 解析同一组 `(agent_id, conversation_id)`，复用同一把锚。Agent 在 Avatar 里的声音和形象反映正在进行的回合状态。一个从桌面端开始的回合可以接着流入 Avatar。
- 网页端按对话 id 打开。同一把锚。用户能滚回早上的消息，因为它们都在 Realm 聊天里、同一条线程下。

从用户的角度看，三块面上是同一个 Agent 在说同一件事。从平台的角度看，Runtime 持有锚，Realm 持有聊天线程，Avatar 持有具身呈现，各管各的。

## 场景：跟同一 Agent 开两段并行对话

某用户的某个 Agent 是项目助手。今天他要分两件事：一段是写代码，一段是购物清单。两段他想分开。

- 用户开启 A：聊代码。Runtime 给 `(agent_id, conversation_A_id)` 建一把锚。
- 用户开启 B：聊购物。Runtime 给 `(agent_id, conversation_B_id)` 建另一把锚。
- 两段不合并。A 段作用域内的 memory 不会污染 B 段的上下文，反之亦然。
- 用户在 A 与 B 之间随意切换，每一把锚维持自己的连续性。

如果没有这种「按对话」的锚，一个用户对一个 Agent 就只剩一段大对话。锚模型才让「跟同一个 Agent 开多段对话」成为一个真实的能力。

## 场景：面崩了，对话还在

用户在 Avatar 里聊着，Avatar 突然崩了。这段对话不应丢失。

- 锚不在 Avatar 里，在 Runtime 里。Agent 的对话血缘仍在 Runtime。
- 用户重开 Avatar。Avatar 重新连上 Runtime，解出同一把锚，对话从断点继续。
- Realm 聊天线程保留消息。
- 崩溃时正在飞行的 memory 写入由复制状态管控：`pending → synced | conflict | invalidated`。

锚归在 Runtime 里，是面崩了对话还能续上的根据。

## Source Basis

- [`.nimi/spec/runtime/kernel/agent-conversation-anchor-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/agent-conversation-anchor-contract.md)
- [`.nimi/spec/runtime/kernel/runtime-agent-service-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/runtime-agent-service-contract.md)
- [`.nimi/spec/runtime/kernel/agent-presentation-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/agent-presentation-contract.md)
- [`.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md)
- [`.nimi/spec/realm/chat.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/chat.md)
- [`.nimi/spec/realm/kernel/chat-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/chat-contract.md)
- [`.nimi/spec/avatar/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/index.md)
