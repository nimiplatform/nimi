# 世界的真相、状态、历史

Nimi 的世界有三个相关但不同的概念。远看相似，近看差别很大。知道你需要哪一个，是「能用的世界」与「悄悄丢信息的世界」之间的差别。

字段层面的定义见 [Reference → World Fields](/zh/reference/world-fields)。

## 三个概念

| 概念 | 它回答的问题 | 归属契约 |
| --- | --- | --- |
| **真相** | 在这个世界里，规范化为真的是什么，无关写入时间 | Realm `R-TRUTH-*` |
| **世界状态** | 这个世界此刻是什么样 | Realm `R-WSTATE-*` |
| **世界历史** | 这个世界是怎么走到当前状态的 | Realm `R-WHIST-*` |

三者不可互换。它们的读模式、变更规则、审计性质都不同。

## 真相

真相是世界的规范化定义。它是创作者发布的内容；任何对世界的读取，最终都锚定在它上面。

真相承载：

- **WorldRule** —— 创作者撰写的世界规则。
- **AgentRule** —— 绑定到世界作用域的 Agent 真相。
- **WorldRelease** 快照 —— 世界发布的官方锚点，带包版本、出处、校验和 / 差异元数据、回滚血缘。

真相由**创作者治理**。App 与 Agent 读真相；只有创作者（以及创作者授权的发布工具）能改它。Runtime 跑一段故事时永远不会偷偷改真相。App 自己的叙事档案归 App 自己持有，不是 Realm 规范化的。

真相是**有版本、原子、可审计**的。回滚是发布操作，不是临时改写。

## 世界状态

世界状态是持久的共享当下。它是世界这一刻的样子 —— 谁在场、东西放在哪、经济余额是多少、当前是哪一幕。

状态变更需要显式的 **commit envelope**。envelope 包含：

| 字段 | 用途 |
| --- | --- |
| `worldId` | 改的是哪个世界 |
| `appId` | 哪个 App 在提交 |
| `sessionId` | session 血缘 |
| `effectClass` | `NONE` / `STATE_ONLY` / `STATE_AND_HISTORY` |
| `scope` | `WORLD` / `ENTITY` / `RELATION` |
| `schemaId` 与 `schemaVersion` | 这次提交的 shape |
| `actorRefs` | 谁在做 |
| `reason` | 为什么 |
| `evidenceRefs` | 支撑证据 |

创作者工具与授权的世界端 App 走同一份 envelope 模型。没有特权的捷径。

## 世界历史

世界历史是发生事件的只追加规范化记录。

| 属性 | 取值 |
| --- | --- |
| 只追加 | 是 |
| 出处 | 强制必填 |
| 重放与规范 | `REPLAY` 运行不能追加；只有 `CANON_MUTATION` 运行可以追加 |
| 修正方式 | 取代事件或失效记录，不静默删除 |

强制出处加只追加姿态，让历史成为真实的审计面。每次改动都有证据；做修正时不会丢东西 —— 原记录被取代，不是被擦掉。

## 何时读哪一个

| 情况 | 读 |
| --- | --- |
| 想知道这个世界的规则 | 真相 |
| 想渲染世界此刻的样子 | 世界状态 |
| 想呈现世界是怎么走到这一步的 | 世界历史 |
| 想审计谁做了什么 | 世界历史（按需配真相上下文） |
| 想发布世界的新版本 | 真相，经由 `WorldRelease` |

混着读会悄悄丢信息。「只看当下状态」的视图缺少它怎么走到这里；「只看历史」的视图无法回答「这里什么是真的」；「只看真相」的视图看不到发布之后变了什么。

## 场景：一段关系随时间演进

Alice 和 Bob 两个月前在某个世界相识。一个月前两人成了朋友。再一个月，关系变得更深。读者要问的是：每一段事实存在哪儿？

| 问题 | 答案 | 在哪 |
| --- | --- | --- |
| Alice 与 Bob 当前是朋友吗？ | 是 | 世界状态（当前关系） |
| 他们什么时候认识的？ | 两个月前 | 世界历史（最初相遇事件） |
| 「朋友」是这个世界里有意义的概念吗？ | 是；这个世界准入社会关系 | 真相（世界的社交模型） |
| 关系什么时候变深的？ | 一个月后某个事件 | 世界历史（每次转移都是只追加事件） |

朋友关系在状态里；走到这一步的路径在历史里；朋友关系成立的可能性在真相里。三者合起来，才能回答关于 Alice 和 Bob 的常规问题。

## 场景：一次牵动多个面的变更

某参与者在公开场景里给另一位参与者送一件物品 —— 这是一次同时具有经济、社交、在场后果的动作。

- **真相**没变。「礼物是什么」「哪些物品可转让」「哪些社交关系允许送礼」这些规则早已在真相里。
- **世界状态**更新：接收方现在拥有这件物品；送出方不再拥有；社交关系强度可能变化。
- **世界历史**追加三条记录（或一条复合记录）：送礼事件、社交关系更新、围观者的在场记录。

动作只是一次产品瞬间，背后契约把后果分摊到对应的面。读对面的 App 能拿到对的答案，没有信息丢失。

## 场景：一次曾经写错的修正

世界创作者发现已发布的某条规则写错了，推一次修正。

- **真相**不会无声变化。创作者发布一份新的 `WorldRelease`，带修正后的规则。新 release 有自己的出处、版本、回滚血缘。
- **世界历史**把这次发布记为一次 `CANON_MUTATION` 运行（它在改真相）。旧规则不从历史中删除，它被取代。
- **世界状态**在修正暗示状态变化时同步更新。

后来的人读历史，能重建出修正前与修正后的真相。没有东西被丢掉。

## Source Basis

- [`.nimi/spec/realm/truth.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/truth.md)
- [`.nimi/spec/realm/world-state.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/world-state.md)
- [`.nimi/spec/realm/world-history.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/world-history.md)
- [`.nimi/spec/realm/kernel/truth-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/truth-contract.md)
- [`.nimi/spec/realm/kernel/world-state-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/world-state-contract.md)
- [`.nimi/spec/realm/kernel/world-history-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/world-history-contract.md)
- [`.nimi/spec/realm/kernel/tables/commit-authorization-matrix.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/tables/commit-authorization-matrix.yaml)
- [`.nimi/spec/realm/world.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/world.md)
