# Realm

Realm 是 Nimi 的语义真相层。它拥有世界的持久含义：真相、世界状态、世界历史、聊天，以及附属域如社交、经济、资产、绑定、资源、Transit。

Runtime 可以执行 AI 工作；SDK 可以暴露应用接入面；桌面端和网页端可以呈现体验。Realm 是**共享世界真相被锚定的地方**。

## 本章节包含

- [世界语义](/zh/realm/world-semantics) — 真相、状态和历史如何与平台六个基础协议挂钩。

跨域的 [术语表](/zh/glossary) 解释「世界」、「真相」、「世界历史」等词。

## Realm 为什么重要

开放世界需要的不只是即兴生成的回答。它需要稳定的状态与历史。当世界改变、关系演化、参与者行动时，平台需要一个**一致表达这些事实的地方**。

Realm 提供了这个语义内核。它也让跨世界的合同面有意义：六个基础协议需要锚定在某处，Realm 就是它们锚定的对象。

## 阅读场景：影响世界真相的对话

设想两个参与者进行了一段对话，按这个世界的规则，他们之间形成了一条新的连接。在 Realm 合同下：

1. 产生这条连接的聊天语义由 `R-CHAT-*` 规则治理。
2. 新的连接被记录在社交合同（`R-SOC-*`）下。
3. 世界状态在世界状态合同（`R-WSTATE-*`）下被更新。
4. 「这条连接形成了」这一历史事实被记录在世界历史合同（`R-WHIST-*`）下。

每一步都受一个已认可的 Realm 合同治理。一个 App 或 Mod **不能**在 Realm 之外发明「这条连接存在」的声明，并指望其他面板接受它。

## 阅读场景：读取世界历史

设想一个用户想查看一个世界是怎么走到当前状态的。Realm 把这个能力放在一条公开读路径上暴出来：

1. 当前状态走世界状态合同来读。
2. 走到这个状态的轨迹走世界历史合同来读。
3. 两个读返回的形状都能被 SDK 暴露给应用；详见 [SDK Realm And World Client](/zh/sdk/realm-world-client)。

要点是：**历史是一等概念**，不是衍生日志。世界的「发生过什么」是它真相的一部分，不是事后想起来的产物。

## 来源

- [`.nimi/spec/realm/README.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/README.md)
- [`.nimi/spec/realm/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/index.md)
- [`.nimi/spec/realm/kernel/truth-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/truth-contract.md)
- [`.nimi/spec/realm/kernel/world-state-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/world-state-contract.md)
- [`.nimi/spec/realm/kernel/world-history-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/world-history-contract.md)
- [`.nimi/spec/realm/kernel/chat-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/chat-contract.md)
- [`.nimi/spec/realm/kernel/social-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/social-contract.md)
- [`.nimi/spec/realm/kernel/economy-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/economy-contract.md)
- [`.nimi/spec/realm/kernel/asset-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/asset-contract.md)
- [`.nimi/spec/realm/kernel/transit-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/transit-contract.md)
