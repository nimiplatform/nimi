# 真相

真相是世界的规范化定义：规则、Agent、读视图配置。真相由创作者治理、版本化、原子化、可审计。App 与 Agent 读真相；只有授权的创作者工具能改它。

## 真相装什么

| 概念 | 用途 |
| --- | --- |
| `WorldRule` | 创作者写的世界规则 |
| `AgentRule` | 绑到世界范围的 Agent 真相 |
| `WorldRelease` | 任何世界发布的官方锚点 |
| `CanonicalTruthPackage` | 上游真相 ingress 的官方对象 |
| 读视图输入 | 这个世界支持什么读视图 |
| 治理 / 发布元数据 | 版本、出处、审计 |

真相**由创作者治理**。App 与 Agent 能读；只有创作者工具（带合适授权）能改。Runtime 故事执行**永不**静默改真相。一个 App 的叙事档案必须是 App 拥有，不是 Realm 规范化。

## WorldRelease

一次发布是把世界发出去的原子事务性 commit。

| 字段 | 用途 |
| --- | --- |
| 包版本 | 这是包的哪个版本 |
| 出处 | 谁用什么工具发的 |
| Checksum | 可校验的 hash |
| Diff 元数据 | 跟前一发布相比改了什么 |
| 回滚 lineage | 这次发布接的哪一发、能回滚到哪一发 |

回滚是发布操作，不是临时改写。坏发布通过发新发布回滚回去；坏发布**不**从历史里删；它被替代。

## CanonicalTruthPackage

包区分：

| 组件 | 用途 |
| --- | --- |
| 规范化真相单元 | 世界规则、Agent 规则、Scene 规则等 |
| 派生 / 继承输入 | 世界真相怎么约束 Agent 真相 |
| 读视图输入 | 这个世界支持什么读视图 |
| 治理 / 发布元数据 | 版本、出处、审计 |

Lorebook 文本和 prompt payload **永不是包的规范化中心**。它们可能是读视图的输入，但本身不是真相。

## InheritanceLink

`InheritanceLink` 是从世界真相到 Agent 真相的形式派生边。

| 字段 | 用途 |
| --- | --- |
| Source | 世界真相范围 |
| Target | 被约束的 Agent 真相范围 |
| Materialization | 这条边在宿主层怎么呈现 |

这就是让「这个 Agent 是这个世界的公民」成为真实类型化关系（而不是约定俗成）的原因。从世界继承真相的 Agent 让自己的约束保持可见。

## Worldview、Lorebook、Browse DTO

真相通过 Realm 读聚合面来读。读聚合面**不**暴露原始真相；它暴露准入的聚合形状。

| 读聚合 | 暴露什么 |
| --- | --- |
| `detail-with-agents` | 公开读聚合；可能暴露 `activeRuleCount` 或 `agentRuleSummary` |
| Worldview | 一种只读聚合形状 |
| Lorebook | 选定的 lore 内容 |

读聚合**不**暴露原始 `AgentRule` 内容。读聚合面有意做窄。

## 阅读场景：创作者写世界真相

某创作者给一个世界写规则、Agent、Scene。

1. **写真相工件。** 世界规则、带继承链接的 Agent 规则、Scene 规则。
2. **暂存为草稿。** 本地工作集：`truthDraft`、`stateDraft`、`historyDraft`。
3. **打成 CanonicalTruthPackage。** 真相单元 + 派生输入 + 读视图输入 + 治理元数据。
4. **作为 `WorldRelease` 原子发布。** 真相被冻结，带出处与回滚 lineage。
5. **世界变成目的地。** App 通过准入读聚合面读真相；被 `AgentRule` 绑定的 Agent 是世界的一部分。

原子事务性形状是关键性质。半发布的世界**不被准入**。

## 阅读场景：真相**不是** App 的叙事档案

某 App 想给一个世界里发生的事建一份长形叙事档案。

- 叙事档案是 **App 拥有**的，不是 Realm 规范化的。Realm 真相是规范化世界定义；故事执行输出**默认**不是真相。
- App 可以把它的叙事存在 App 私有状态里、存在准入 Realm 资产里、或作为内容文档 — 但**不**作为 Realm 规范化真相。
- 想让叙事的一部分变规范化的创作者必须通过准入真相发布流（创作者工具 + WorldRelease）来升格。

这种切分重要，因为 Realm 真相是平台规范化的；叙事是 App 特定的。混在一起就会让任何 App 静默改写世界规则。

## 来源

- [`.nimi/spec/realm/truth.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/truth.md)
- [`.nimi/spec/realm/kernel/truth-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/truth-contract.md)
- [`.nimi/spec/realm/kernel/tables/truth-contract.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/tables/truth-contract.yaml)
- [`.nimi/spec/realm/world.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/world.md)
- [`.nimi/spec/realm/projection.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/projection.md)
