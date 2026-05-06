# 世界

世界（World）是 Nimi 里最重要的产品对象。平台存在的目的就是为了世界。

## 世界是什么

Nimi 里的世界是一个**长期存在的语义环境**：有创作者定义的规则、持续的共享状态、规范事实的仅追加历史，也有人和 AI Agent 共同参与其中。这些参与者的身份、社交图、经济地位**不**按世界发明，而是跨所有世界共享。

世界**不是**：

- 一个聊天室。聊天是世界里的一个面板；世界是赋予聊天意义的环境。
- 一场战役。战役是临时的玩法框架；世界即使没人在玩也持续演化。
- 一个关卡。关卡是设计好的遭遇；世界是有自己规则和历史、独立于任何单次访问的地方。
- 一个 App。App 把平台的一部分呈现出来；世界是 App 呈现的那个含义。

世界更像一个有一致规则的小宇宙 — 由创作者写出来，由参与者填满，跨时间持续。

## 世界承载的三件事

每个世界有三个相关但不同的概念。这些是规范的 Realm 语义；[世界真相、状态与历史](/zh/platform/worlds/truth-state-history) 页面分别详细走过。

| 概念 | 回答什么 | 拥有者 |
| --- | --- | --- |
| 真相 | 这里规范上是真的什么，不论何时写下 | Realm `R-TRUTH-*` |
| 世界状态 | 这个世界现在长什么样 | Realm `R-WSTATE-*` |
| 世界历史 | 这个世界怎么走到当前状态 | Realm `R-WHIST-*` |

把这三者无声混在一起的面板会丢信息。一个没有真相的世界没有规则。一个没有状态的世界没有当下。一个没有历史的世界没有过去。

## 相邻的 Realm 面板

世界还承载其他类型化面板，它们也参与世界含义：

| 面板 | 用途 |
| --- | --- |
| 聊天 | 当对话参与世界含义时的规范 thread / 消息 / 成员 / Agent slot 生命周期 |
| 社交 | 友谊准入图；门控聊天前置条件 |
| 经济 | 世界创作者经济 + 收益 + 结算 |
| 资产 / Bundle / Resource / Binding | 世界含什么、这些东西怎么挂到参与者和场景 |
| Transit | 通过 OASIS 的单跳连续协议，让参与者在世界之间移动 |

每一个由 Realm 拥有；它们一起让一个世界感觉像**一个地方**而不是数据库。

## 本节包含

- [世界真相、状态与历史](/zh/platform/worlds/truth-state-history) — 三个 Realm 概念，差别是什么，何时读哪个。
- [OASIS](/zh/platform/worlds/oasis) — 唯一的系统主世界。
- [生命周期](/zh/platform/worlds/lifecycle) — 世界如何被创建、发布、绑到 App、暂停、吊销。
- [世界演化引擎](/zh/platform/worlds/world-evolution-engine) — 世界在 Runtime 里跑时，replay、checkpoint、监督、commit-request 暂存的 Runtime 拥有语义。

字段级定义见 [Reference → World Fields](/zh/reference/world-fields)。

## 阅读场景：走进一个世界

你登入 Nimi，加入一个朋友创建的世界。

- 你的身份和你在别处用的身份是同一个。世界**接纳**你；它**不**发明你。
- 你的钱包、友谊、资产库在这个世界里都可见可用。它们**不**被复制；它们是平台真相。
- 这个世界有自己的规则 — 也许货币是「票根」，也许时间以 4 倍速跑。这些本地规则在世界里生效，**不**反向修改你在这个世界外的地位。
- 你和这个世界里 Agent 的对话是持续的。它们对你的记忆是它们的（经你同意），不是世界的。当你离开去另一个世界时，那段记忆在 Cognition 合同下仍随 Agent 保留。
- 你离开时通过 OASIS 跨越。创作者世界**不能**直接对等跨越；OASIS 是中枢。

这一段走读的每一行都对应一条已认可合同。架构存在的目的，是让这种体验跨世界保持一致，而不会让某个单独世界发明自己的身份规则。

## 阅读场景：创作者发布一个世界

你在设计一个世界。你不只是在出一个关卡 — 你在出一个**地方**。

- 你写世界的真相：规则、Agent、场景、读视图配置、release。真相由创作者治理，是版本化、原子化、可审计的。
- 你通过 `WorldRelease` 发布 — 一个事务性提交，冻结真相、读视图配置、包版本。如果出问题，回滚是一次 release 操作，不是临时改写。
- 如果你想，你的世界可以有自己的内部经济 — 但规范的平台经济仍然在平台上。这是有意的切分。
- 一旦发布，你的世界就是一个真实的 Nimi 目的地。参与者可以通过 OASIS 跨越过去。他们的身份、社交图、经济地位在任何世界里都一样。

这是世界创作者跟平台之间的契约：平台给你持久的身份和跨世界含义；你给平台一个尊重基础协议的连贯地方。

## 来源

- [`.nimi/spec/realm/README.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/README.md)
- [`.nimi/spec/realm/world.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/world.md)
- [`.nimi/spec/realm/truth.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/truth.md)
- [`.nimi/spec/realm/world-state.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/world-state.md)
- [`.nimi/spec/realm/world-history.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/world-history.md)
- [`.nimi/spec/realm/transit.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/transit.md)
- [`.nimi/spec/realm/world-creator-economy.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/world-creator-economy.md)
- [`.nimi/spec/realm/binding.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/binding.md)
- [`.nimi/spec/realm/asset.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/asset.md)
- [`.nimi/spec/realm/projection.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/projection.md)
- [`.nimi/spec/platform/vision.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/vision.md)
- [`.nimi/spec/platform/protocol.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/protocol.md)
