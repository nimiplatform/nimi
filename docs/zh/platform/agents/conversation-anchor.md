# 对话锚

`ConversationAnchor` 是 Runtime 拥有的连续性身份，它让一段对话能跨多个面板（桌面端聊天、Avatar、网页端）共享，又不会塌成一个全局会话。

## 它解决什么

朴素的设计会说："这段对话就是一个用 agent_id 当 key 的 thread。" 两边都坏：

- 如果对话是全局的，那么用户同时在桌面端和 Avatar 跟同一个 Agent 说话，就会被并成一个 — 没法跟一个 Agent 同时开两段平行对话。
- 如果对话是按面板的，那么从桌面端开始的对话，晚一点到 Avatar 继续，就会断 — Avatar 把它当成新对话。

对话锚走中间那条路。它的 key 是**per-Agent + per-conversation**，不是 per-Agent 全局。

| 属性 | 值 |
| --- | --- |
| 范围 | per-Agent + per-conversation |
| 拥有者 | Runtime |
| 持续性 | 跨面板切换仍在 |
| 多重性 | 一个 Agent 可有多个锚（多段平行对话） |
| 发现 | 用户挑哪段对话继续时，面板解析到锚 |

## 实操是怎么走的

用户在桌面端聊天里跟一个 Agent 开了一段对话。Runtime 创建一个 `ConversationAnchor`，key 是 `(agent_id, conversation_id)`。后续每一轮在桌面端都锚定到它。

然后用户打开 Avatar。Avatar 解析用户意图："继续我刚才那段对话"。Avatar 按 conversation id 查找，复用同一个锚。Avatar 里 Agent 的回应继续同一条 thread；Avatar 这边的记忆写入也在同一个 conversation lineage 下。

后来在网页端，用户挑同一段对话。网页端做同样的锚解析。Agent 的回应继续同一条 thread。

整个过程**没有**让对话塌成"跟这个 Agent 的全局会话"。如果用户跟同一个 Agent 开另一段对话，它会有自己的锚 — 两段对话不会合并。

## 锚承载什么

锚是连续性身份，**不是对话内容**。内容住在 Realm chat。锚让多个面板在一段 Runtime 拥有的 thread 下共同参与一段对话。

| 锚的责任 | 拥有者 |
| --- | --- |
| "这段对话"的身份 | Runtime（锚） |
| 消息 thread | Realm chat |
| 范围在该对话的记忆写入 | Cognition 记忆 + Runtime 记忆库 |
| 具身面板的呈现流 | Runtime 呈现流 |

锚故意做得很窄。它就是让面板们能就"我们在哪段对话里"达成一致的那个东西；它不是聊天 thread 本身，不是记忆，不是呈现。

## 阅读场景：一段对话，三个面板

一个用户早上在桌面端开始跟自己的 Agent 聊。中午开 Avatar — Agent 现在在屏幕上视觉呈现。晚上在手机上开网页端。

整天三个面板共享**一段**对话。

- 桌面端聊天打开对话，锚被创建。
- Avatar 解析同一个 `(agent_id, conversation_id)` 复用锚。Avatar 里 Agent 的声音和具身反映当前的 turn 状态。一轮 turn 在桌面端开始，可以流到 Avatar 完成。
- 网页端按 id 打开对话。同一个锚。用户可以往上翻看到早上的消息，因为它们在同一条 Realm chat thread 下。

从用户视角，Agent 在三个面板上是同一个 Agent，说着同一段话。从平台视角，Runtime 拥有锚；Realm 拥有 chat thread；Avatar 拥有具身；每个东西都在自己的车道上。

## 阅读场景：跟同一个 Agent 开两段平行对话

用户有一个 Agent 当项目助手。今天有两件事想求助 — 一个编码项目，一个购物清单。希望两段对话分开。

- 用户开对话 A 聊编码。Runtime 给 `(agent_id, conversation_A_id)` 创锚。
- 用户开对话 B 聊购物。Runtime 给 `(agent_id, conversation_B_id)` 创另一个独立锚。
- 两段对话不合并。范围在 A 的记忆写入不会污染 B 的上下文；B 的记忆留在 B。
- 用户随时切换；每个锚保留各自的连续性。

没有 per-conversation 锚的话，一个用户跟一个 Agent 实际上就只有一段大对话。锚模型是让"跟一个 Agent 开多段对话"成为真功能的关键。

## 阅读场景：面板掉线，对话不丢

用户在 Avatar 里聊着，Avatar 应用崩了。对话不应该丢。

- 锚住在 Runtime，不在 Avatar。Agent 的对话 lineage 还在 Runtime。
- 用户重开 Avatar。Avatar 重连 Runtime，解析同一个锚，对话从中断处继续。
- Realm chat thread 保留消息。
- 崩溃时正在传送的记忆写入，由复制状态（`pending → synced | conflict | invalidated`）决定。

锚归 Runtime 拥有，让面板崩溃可以扛过去。

## 来源

- [`.nimi/spec/runtime/kernel/agent-conversation-anchor-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/agent-conversation-anchor-contract.md)
- [`.nimi/spec/runtime/kernel/runtime-agent-service-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/runtime-agent-service-contract.md)
- [`.nimi/spec/runtime/kernel/agent-presentation-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/agent-presentation-contract.md)
- [`.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md)
- [`.nimi/spec/realm/chat.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/chat.md)
- [`.nimi/spec/realm/kernel/chat-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/chat-contract.md)
- [`.nimi/spec/avatar/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/index.md)
