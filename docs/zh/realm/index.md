# Realm

Realm 是世界真相的所在地。一个世界的持久语义都归在它名下：真相本身、当前状态、状态如何走到这里的历史，以及聊天，再加上社交、经济、资产、绑定、资源、Transit 这些相关域。

Runtime 跑 AI 工作。SDK 给应用一道访问边界。桌面端和网页端负责呈现体验。一个世界的共享真相则锚在 Realm 上，其他所有层最终都指向它。

## 本节内容

- [世界语义](/zh/realm/world-semantics)：真相、状态、历史与平台六项基础协议之间的对应关系。

如果不熟悉"世界"、"真相"、"世界历史"这几个词，可以查阅跨域的[术语表](/zh/glossary)。

## 为什么需要 Realm

开放世界要的不只是模型生成的回答。它需要稳定的状态和历史。世界发生变化、关系发生演化、参与者做了某个动作时，平台需要一个地方把这件事一致地表达出来。

Realm 就是这块语义底座。它也让跨世界的契约面变得有意义：基础协议需要一个锚点，Realm 就是那个锚点。

## 场景：一段对话改变了世界真相

两个参与者聊了一段，按这个世界的规则，他们之间产生了一条新的关系。在 Realm 契约下：

1. 产生这段关系的对话语义，按 `R-CHAT-*` 规则走。
2. 这条新关系记在社交契约 `R-SOC-*` 名下。
3. 世界状态按 `R-WSTATE-*` 契约更新。
4. "这条关系产生了"这件历史事实，记在世界历史契约 `R-WHIST-*` 名下。

每一步都按一份已准入的 Realm 契约走。应用或 mod 不允许在 Realm 之外凭空声明"这条关系存在"，并要求其他层接受这个声明。

## 场景：读取一个世界的历史

用户想看这个世界是怎么走到现在的状态的。Realm 把这件事公开为一条读取路径：

1. 当前状态从世界状态契约读出。
2. 走到这个状态的轨迹从世界历史契约读出。
3. 两次读取返回的形状都可以由 SDK 渲染，详见 [SDK Realm 与世界客户端](/zh/sdk/realm-world-client)。

要点是：历史是一等概念，不是派生日志。一个世界"发生了什么"是它真相的一部分，不是事后补的附属物。

## Source Basis

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
