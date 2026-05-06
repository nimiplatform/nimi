# 对比

Nimi Coding 跟你已熟悉的工程实践放一起在哪？这页对照邻居：vanilla AI coding、传统 code review、DevOps / GitOps 治理、Domain-Driven Design / Resource-Driven Design、agile / scrum。

## vs. Vanilla AI Coding（Cursor / Copilot / Claude Code 独立用）

| 维度 | Vanilla AI Coding | Nimi Coding |
| --- | --- | --- |
| 权威 | 隐式 | 命名（`.nimi/spec/**`） |
| 接受度 | 单维（「看着行」） | 四闭合框架 |
| 范围 | 自由 | 冻结 packet 带有界写集 |
| 闭合 | 开发者说「done」 | 闭合必须有证据 |
| 审计循环 | 跟写作同循环 | 结构上分离 auditor |
| Host 耦合 | 是 | 否（厂商中立） |
| 禁用模式 | 隐式 | 命名目录 |

Vanilla AI coding 优化写作速度。Nimi Coding 优化**完成的可证正确性**。

## vs. 传统 code review

| 维度 | Code Review | Nimi Coding |
| --- | --- | --- |
| 循环分离 | 常跟写者同团队 | 结构上分离 auditor |
| 输出 | 通过 / 请求改 | 裁定（PASS / NEEDS_REVISION / FAIL / OVERFLOW） |
| 闭合维度 | 一（通过 / 不） | 四（权威 / 语义 / 消费方 / 漂移） |
| 抓什么 | 函数里的 bug | 权威漂移、并行真相、消费方失败 |
| 节奏 | 按 PR | 按 wave（更宽单位） |
| 工件 | PR 评论 | 冻结 packet + 审计 + closeout 记录 |

Code review 抓局部 bug。Nimi Coding 抓结构漂移。它们互补、**不**互相替代。

团队能在他们的 PR 工作流**内**用 Nimi Coding：PR 实现一个 wave；wave 的审计与 closeout 记录跟着 PR；merge 在 wave closeout 后。

## vs. DevOps / GitOps 治理

| 维度 | DevOps / GitOps | Nimi Coding |
| --- | --- | --- |
| 层 | 部署、infrastructure-as-code | Spec 级含义 |
| 回答的问题 | 「这次改动安全落地了吗」 | 「这次改动意思对不对」 |
| 工件 | Pipeline、runbook、infrastructure manifest | Topic、packet、审计记录 |
| 不变量 | Build 过、test 过、deploy 成功 | 权威闭合、语义闭合、消费方闭合、抗漂移 |

DevOps 治理部署。Nimi Coding 治理改动**含义**在 spec 级 — 什么真相搬了、谁现在拥有、什么被显式禁。

两者组合。Nimi Coding 在 DevOps **前面**，**不**在它旁边。一个改动过 Nimi Coding closeout（含义对）、然后过 DevOps 闸门（部署安全）。

## vs. Domain-Driven Design / Resource-Driven Design

| 维度 | DDD / RDD | Nimi Coding |
| --- | --- | --- |
| 主题 | 域形状 | 改域的工作 |
| 词汇 | Bounded context、entity、value object | Topic、wave、packet、闭合维度 |
| 静态或动态 | 多数静态（设计域） | 动态（治理演化域的工作） |
| 输出 | 域模型 | 审计可追改动记录 |

DDD 说「你的 bounded context 是 X」。Nimi Coding 说「你 wave 的 owner 域是 X，闭合条件是这四个」。两者组合得好 — DDD 塑域；Nimi Coding 塑改域的工作。

同时采纳两者的团队拿到：

- 从 DDD 拿到干净域模型
- 从 Nimi Coding 拿到可证改动纪律

## vs. Agile / Scrum

| 维度 | Agile / Scrum | Nimi Coding |
| --- | --- | --- |
| 主题 | 节奏、沟通、迭代 | 权威漂移、AI 失败模式 |
| 层 | Process | Methodology |
| 时间单位 | Sprint | Topic / wave |
| 输出 | Story → Done | Wave → closed（4 维） |
| 对 AI 漂移沉默？ | 是（前 AI 时代发明） | 否（就是回应） |

Agile / Scrum 管节奏与 stakeholder 沟通。它们对权威漂移、并行真相、AI 引发的伪闭合沉默（因为它们早于这些问题）。

Nimi Coding 对节奏沉默（不同层）。它们**不**冲突；它们住不同层、能共存。

## 差异化总结

| 独特 | 给什么 |
| --- | --- |
| Spec-first 权威 | 真相住在 `.nimi/spec/**`，**不**在 PR 或聊天 transcript |
| 四闭合框架 | 闭合多维；四个全要 |
| 独立 auditor | 审计来自分离循环、**不是**作者 |
| 禁用捷径目录 | 反模式被命名、packet 声明 |
| 宿主无关边界 | 换 AI host 而**不**改方法学 |
| 处处 fail-close | 缺权威时输出被拒 |
| Topic / wave / packet / preflight / 审计 / closeout | 一个连贯世界观、不是模板堆 |

## 阅读场景：同时采纳 DDD 与 Nimi Coding

某团队有一个既有 DDD 形状的代码库。想引入 AI 辅助而**不**丢结构完整。

1. **保留 DDD 域模型。** Bounded context、entity、value object 留着。
2. **为 AI 辅助改动采纳 Nimi Coding。** AI 参与改代码库时，改动走 topic / wave / packet 纪律。
3. **每次 AI 辅助改动命名它的 bounded context 为 wave 的 owner 域。** DDD context 是天然 wave-domain 锚。
4. **闭合维度检结构完整。** 「AI 改动是否跨了 bounded context」是 Nimi Coding 准入的结构检查。

两层合作。DDD 塑域；Nimi Coding 治理改它的工作。

## 阅读场景：组织采纳 code review + Nimi Coding

某组织有严格 code review。它们引入 AI 工具。它们想留着 code review 加 Nimi Coding。

1. **Code review 继续。** 按 PR review 局部 bug、style、惯用法。
2. **Nimi Coding 包 PR。** 每个 PR 实现一个 wave；wave 的审计与 closeout 工件随 PR。
3. **审计 reviewer 是分离循环。** 不同 AI session 或厂商做审计；review 读审计工件。
4. **Reviewer 检两层。** 「代码工作吗」（code review）与「wave 闭四维了吗」（Nimi Coding）。

两个互补闸门。一起抓任一单独都抓不到的。

## Nimi Coding 不适合在哪

| 情况 | 为什么不 |
| --- | --- |
| 极小低风险改动 | Topic 开销真的有；显式适用规则说小改动不需要 topic 纪律 |
| 一次性脚本 | Wave / packet 模型对短暂工作太重 |
| 无 AI 暴露的前 AI 代码库 | 方法学回应 AI 失败模式；经典工程卫生已覆盖 |

方法学**对它的适用范围显式** — 高风险或承载权威工作；复杂 remediation；多 wave 迭代。强加到小改动上加成本不加闭合价值。

## 来源

- [`nimi-coding/README.md`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/README.md)
- [`.nimi/methodology/topic-lifecycle-report.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/topic-lifecycle-report.yaml)
- [`.nimi/methodology/four-closure-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/four-closure-policy.yaml)
- [`.nimi/methodology/role-separation-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/role-separation-policy.yaml)
