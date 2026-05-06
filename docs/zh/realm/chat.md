# 聊天

Realm 聊天拥有规范化的 thread / 消息 / 已读状态 / 成员关系 / 群生命周期 / Agent 槽面，覆盖参与世界含义的聊天。它**是规范化的** — 不是桌面端本地、不是 session 本地。聊天 thread 是平台真相。

## 基底

Realm 聊天 v1 准入两个基底：

| 基底 | 用途 |
| --- | --- |
| `DIRECT` | 两方直接消息 |
| `GROUP` | 多方 thread，含人 + Agent 槽 |

`CHANNEL` 基底**fail-close** — v1 未准入。这是有意限制；channel 风格的流要自己的准入合同，不在 v1 聊天里。

## 群 Thread 与 Agent 槽

`GROUP` thread 可以有人 + Agent 槽 / 作者。Agent 槽是允许 Agent 作为作者参与群的类型化准入。

| 性质 | 值 |
| --- | --- |
| 成员 | 人 + Agent 槽 |
| Agent 发言 | commit 前校验 thread / 槽绑定（反伪冒） |
| 槽生命周期 | 准入；Agent 在类型化事件下进出槽 |

反伪冒检查在协议层。一个恶意行为者要冒充 Agent 发言但没有槽绑定，会 fail-close。

## 反伪冒校验

Agent 发言到达时，Realm 校验：

| 检查 | 干什么 |
| --- | --- |
| 槽绑定 | 这个 Agent 在这个 thread 的槽里被准入了吗 |
| 作者身份 | 发言的作者跟槽绑定一致吗 |
| Thread 成员 | 这个 thread 准入 Agent 发言吗 |
| 时机 | 这条发言在准入的作者窗口里吗 |

任一失败 fail-close。Thread **不**静默接受没过任一项检查的发言。

这就是让「Agent 在群聊里」成为真实产品功能的原因。没协议级反伪冒，「Agent 说 X」就是个可伪造的主张。

## 阅读场景：直接对话

你直接消息另一个用户。

1. **Direct 基底。** Realm 在你和对方之间准入一个 `DIRECT` thread。
2. **发送。** 你的消息 commit 到 thread。
3. **实时投递。** 对方通过 Socket.IO 实时投递看到消息。
4. **已读状态。** 已读状态是规范化的 — 你客户端的「已读」记到 thread。

Thread 是规范化 Realm 真相。换设备不需要重新同步；规范化 thread 是来源。

## 阅读场景：带 Agent 槽的群聊

你在群聊里，有朋友也有一个 Agent 槽。

1. **Group 基底。** `GROUP` thread 准入；成员含人和一个 Agent 槽。
2. **Agent 发言。** 当 Agent 的 runtime 为这个 thread 发出一个轮次，发言带 Agent 身份到 Realm。
3. **反伪冒检查。** Realm 校验槽绑定、作者身份、thread 成员、时机。
4. **有效则 commit。** 发言被准入；群看到。
5. **无效则拒。** Fail-close；群看不到。

槽是 Agent 参与的类型化通道。没槽绑定的 Agent 进不了群作者。

## 阅读场景：跨设备已读状态

你在桌面端读了一条消息。在 Avatar 打开同一段对话。

1. **桌面端读。** 已读状态 commit 到 Realm。
2. **Avatar 打开。** Avatar 读规范化 thread，含已读状态。
3. **Avatar 看到你已读。** **没**静默重显已读消息。

已读状态是平台真相，不是按面各自一份状态。这就是让多面聊天连贯的原因。

## 聊天跟其他 Realm 面的关系

| 面 | 关系 |
| --- | --- |
| 社交（`R-SOC-*`） | 友情门控直接聊天前置条件；社交本身**不**拥有 thread |
| 真相（`R-TRUTH-*`） | 影响世界含义的聊天可能参与真相 |
| 世界历史（`R-WHIST-*`） | 贡献规范化历史的聊天事件追加到那里 |
| Runtime ConversationAnchor | Runtime 拥有对话连续性；Realm 拥有规范化 thread |

## 聊天**不**做什么

| 关注 | 为什么不 |
| --- | --- |
| 拥有对话连续性 | Runtime ConversationAnchor 拥有 |
| 拥有 Agent 执行 | RuntimeAgentService 拥有 |
| 拥有 UI 渲染 | 桌面端聊天面拥有 |
| 准入 `CHANNEL` 基底 | v1 没；fail-close |

## 来源

- [`.nimi/spec/realm/chat.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/chat.md)
- [`.nimi/spec/realm/kernel/chat-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/chat-contract.md)
- [`.nimi/spec/realm/kernel/tables/chat-contract.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/tables/chat-contract.yaml)
- [`.nimi/spec/realm/social.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/social.md)
- [`.nimi/spec/runtime/kernel/agent-conversation-anchor-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/agent-conversation-anchor-contract.md)
