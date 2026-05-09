# 真相

真相是一个世界的规范定义：规则、agent、可读视图。它由创作者治理，可版本化、原子化、可审计。应用和 agent 读真相；只有获授权的创作者工具能改写真相。

## 真相承载哪些内容

| 概念 | 用途 |
| --- | --- |
| `WorldRule` | 创作者编写的世界规则 |
| `AgentRule` | 绑在某个世界范围里的 agent 真相 |
| `WorldRelease` | 任意世界发布动作的正式锚点 |
| `CanonicalTruthPackage` | 上游真相摄入的正式对象 |
| Projection 输入 | 该世界支持哪些读视图 |
| 治理 / 发布元数据 | 版本、来源、审计 |

真相由**创作者治理**。应用和 agent 可以读；只有创作者工具（持适当授权）能改写。一次 runtime 故事执行不会无声改写真相。一个应用持有的叙事归档由应用自己持有，不是 Realm 规范层数据。

## WorldRelease

发布是一次原子事务级别的提交。

| 字段 | 用途 |
| --- | --- |
| 包版本 | 这是该 package 的哪一版 |
| 来源 | 谁发布、用什么工具 |
| Checksum | 可校验哈希 |
| Diff 元数据 | 与上一次发布相比改了什么 |
| Rollback 血缘 | 这次发布接续了哪一次、可以回退到哪一次 |

回退是一次发布操作，不是临时的改写。一次有问题的发布通过另一次发布去取代；问题发布不会从历史里删除，而是被取代。

## CanonicalTruthPackage

Package 区分以下成分：

| 组成 | 用途 |
| --- | --- |
| 规范真相单元 | 世界规则、agent 规则、scene 规则等 |
| 派生 / 继承输入 | 世界真相如何约束 agent 真相 |
| Projection 输入 | 该世界支持哪些读视图 |
| 治理 / 发布元数据 | 版本、来源、审计 |

世界设定文本和 prompt 内容**永远不是 package 的规范中心**。它们可以是 projection 的输入，但本身不是真相。

## InheritanceLink

`InheritanceLink` 是从世界真相到 agent 真相的正式派生边。

| 字段 | 用途 |
| --- | --- |
| 源 | 世界真相范围 |
| 目标 | 受约束的 agent 真相范围 |
| Materialization | 该边在 host 层呈现的样子 |

正因为有它，"这个 agent 是这个世界的居民"才是一种真实的强类型关系，而不是一种约定俗成。从世界真相继承的 agent 把约束保持在可见处。

## Worldview、Lorebook、Browse DTO

真相通过 projection 读取。Projection 层不会暴露原始真相，只暴露已准入的 projection 形状。

| Projection | 暴露内容 |
| --- | --- |
| `detail-with-agents` | 公开读侧聚合；可能暴露 `activeRuleCount` 或 `agentRuleSummary` |
| Worldview | 读侧聚合 projection |
| Lorebook | 选取的设定内容 |

Projection 不会暴露原始的 `AgentRule` 内容。Projection 层是有意收窄的。

## 场景：创作者编写世界真相

某创作者要为一个世界写规则、agent 和 scene。

1. **编写真相单元**。世界规则、带 inheritance link 的 agent 规则、scene 规则。
2. **作为草稿暂存**。本地工作集：`truthDraft`、`stateDraft`、`historyDraft`。
3. **打包成 CanonicalTruthPackage**。真相单元 + 派生输入 + projection 输入 + 治理元数据。
4. **以 `WorldRelease` 原子发布**。真相被冻结，带来源和 rollback 血缘。
5. **世界变成可访问目的地**。应用可通过准入的 projection 读真相；按 `AgentRule` 绑定的 agent 是这个世界的一部分。

原子事务是关键性质。不会出现"发了一半"的世界。

## 场景：真相不是应用的叙事归档

某应用想为一个世界做长篇叙事归档。

- 这份叙事归档由**应用持有**，不是 Realm 规范数据。Realm 真相是世界的规范定义；故事执行的输出按默认不是真相。
- 应用可以把叙事存在自己的私有状态里、存在一个准入的 Realm 资产里、或作为内容文档存在，但不能作为 Realm 规范真相。
- 创作者如果希望叙事中的某一部分变成规范真相，必须走准入的真相发布流程（创作者工具 + WorldRelease）来抬升。

这层分离很重要：Realm 真相是平台规范层数据，叙事是应用层数据。如果混在一起，任何应用都能无声改写世界规则。

## 来源依据

- [`.nimi/spec/realm/truth.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/truth.md)
- [`.nimi/spec/realm/kernel/truth-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/truth-contract.md)
- [`.nimi/spec/realm/kernel/tables/truth-contract.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/tables/truth-contract.yaml)
- [`.nimi/spec/realm/world.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/world.md)
- [`.nimi/spec/realm/projection.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/projection.md)
