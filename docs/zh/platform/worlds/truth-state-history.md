# 世界真相、状态与历史

Nimi 世界有三个相关但不同的概念。远看相似，近看差别很大。知道你需要哪个，是「有效的世界」和「无声丢信息的世界」之间的差别。

字段级定义见 [Reference → World Fields](/zh/reference/world-fields)。

## 三个概念

| 概念 | 回答 | 拥有者合同 |
| --- | --- | --- |
| **真相** | 这个世界规范上是真的什么，不论何时写下 | Realm `R-TRUTH-*` |
| **世界状态** | 这个世界**现在**长什么样 | Realm `R-WSTATE-*` |
| **世界历史** | 这个世界**怎么走到**当前状态 | Realm `R-WHIST-*` |

它们**不**可互换。读模式不同、修改规则不同、审计性质不同。

## 真相

真相是世界的规范定义。它是创作者发布的东西；它是世界的每次读最终锚定的东西。

真相承载：

- **WorldRule** 项 — 创作者写的世界规则。
- **AgentRule** 项 — 绑到世界 scope 的 Agent 真相。
- **WorldRelease** 快照 — 任何世界发布的官方锚点，带包版本、来源、校验和 / diff 元数据、回滚 lineage。

真相**由创作者治理**。App 和 Agent 读真相；只有创作者（和创作者授权的发布工具）能改它。一次 runtime 故事执行**永远不能**无声改真相。一个 App 的叙事归档必须由 App 拥有，不是 Realm 规范的。

真相是**版本化、原子、可审计**的。回滚是一次 release 操作，不是临时改写。

## 世界状态

世界状态是持续的共享当下。它是世界此刻的样子 — 谁在场、东西的位置、经济余额、当前场景。

状态修改要求一个显式的**提交信封**。信封含：

| 字段 | 用途 |
| --- | --- |
| `worldId` | 哪个世界在被改 |
| `appId` | 哪个 App 在提交 |
| `sessionId` | 会话 lineage |
| `effectClass` | `NONE` / `STATE_ONLY` / `STATE_AND_HISTORY` |
| `scope` | `WORLD` / `ENTITY` / `RELATION` |
| `schemaId` 和 `schemaVersion` | 这次提交的形状 |
| `actorRefs` | 谁动作 |
| `reason` | 为什么 |
| `evidenceRefs` | 支持证据 |

创作者工具和被授权的世界连接 App 用的是同一套提交信封模型。**没有**特权捷径。

## 世界历史

世界历史是发生过什么的仅追加规范记录。

| 性质 | 值 |
| --- | --- |
| 仅追加 | 是 |
| 来源 | 强制 |
| Replay vs canon | `REPLAY` run **不能**追加；只有 `CANON_MUTATION` run 才能 |
| 修正 | 通过 supersede 事件或失效记录，**永远不**无声删除 |

强制来源加上仅追加姿态合起来意味着：历史是一个真实的审计面。每次变化都有证据；做修正时不会丢东西 — 原始记录被 supersede，不被擦除。

## 何时读哪个

| 情境 | 读 |
| --- | --- |
| 想知道世界规则 | 真相 |
| 想渲染世界**现在**的样子 | 世界状态 |
| 想展示世界**怎么**到当前状态 | 世界历史 |
| 想审计谁做了什么 | 世界历史（必要时配合真相上下文） |
| 想发布世界新版本 | 真相，通过 `WorldRelease` |

把它们无声混在一起的面板会丢信息。「只有当前状态」的视图缺了"怎么到这"。「只有历史」的视图回答不了"这里规范上是真的什么"。「只有真相」的视图看不到"自发布以来什么变了"。

## 阅读场景：一段关系跨时间演化

Alice 和 Bob 两个月前在一个世界里见面。一个月前成为朋友。接下来一个月友谊深化。文档读者会问：每件事存在哪里？

| 问题 | 答案 | 在哪 |
| --- | --- | --- |
| Alice 和 Bob 是不是朋友？ | 是，当前 | 世界状态（当前关系） |
| 他们什么时候见面？ | 两个月前 | 世界历史（最初见面事件） |
| 「朋友」在这个世界里是不是有意义的概念？ | 是；这个世界接纳社交关系 | 真相（世界的社交模型） |
| 友谊什么时候深化？ | 一个月后的具体事件 | 世界历史（每次过渡是一次仅追加事件） |

友谊在状态里；过程在历史里；友谊存在的可能性在真相里。要回答关于 Alice 和 Bob 的正常问题，三个都需要。

## 阅读场景：一次修改触及多个面

参与者执行一个有经济、社交、在场后果的动作 — 比如在公开场景里送礼给另一个参与者。

- **真相**不变。世界关于"礼物是什么"、"什么物品可以转移"、"什么社交关系允许送礼"的规则都已经在真相里。
- **世界状态**更新：接收方现在拥有那件物品；送出方不再拥有；社交关系强度可能变化。
- **世界历史**追加三条记录（或一条复合记录）：送礼事件、社交关系更新、目击者在场记录。

动作是一次产品瞬间；底层合同把后果分散到合适的面。读对面的 App 得到对答案；不丢东西。

## 阅读场景：一次曾经写错的修正

世界创作者意识到发布过的某条规则是错的，推一个修正。

- **真相**不会无声变。创作者发布一个带修正后规则的新 `WorldRelease`。新 release 有自己的来源、版本、回滚 lineage。
- **世界历史**把这次 release 记成一次 `CANON_MUTATION` run（它在改真相）。旧规则**不**从历史里删；它被 supersede。
- 如果修正暗示状态变化，**世界状态**更新。

将来读历史的人能重建之前是真的什么、之后是真的什么。不丢东西。

## 来源

- [`.nimi/spec/realm/truth.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/truth.md)
- [`.nimi/spec/realm/world-state.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/world-state.md)
- [`.nimi/spec/realm/world-history.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/world-history.md)
- [`.nimi/spec/realm/kernel/truth-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/truth-contract.md)
- [`.nimi/spec/realm/kernel/world-state-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/world-state-contract.md)
- [`.nimi/spec/realm/kernel/world-history-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/world-history-contract.md)
- [`.nimi/spec/realm/kernel/tables/commit-authorization-matrix.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/tables/commit-authorization-matrix.yaml)
- [`.nimi/spec/realm/world.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/world.md)
