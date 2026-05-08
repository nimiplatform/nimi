# 横向对比

Nimi Coding 与你已知的工程实践相比是什么位置？这一页把它放在几个邻居身边：常规 AI 编码、传统代码评审、DevOps / GitOps 治理、领域驱动设计 / 资源驱动设计、敏捷 / Scrum。

## 与常规 AI 编码（Cursor / Copilot / 独立 Claude Code）

| 维度 | 常规 AI 编码 | Nimi Coding |
| --- | --- | --- |
| 权威 | 隐含 | 命名（`.nimi/spec/**`） |
| 验收 | 单维度（"看起来不错"） | 四闭合 |
| 范围 | 自由格式 | 冻结 packet，写入集合有界 |
| 闭合 | 开发者自报"完成" | 必须有证据 |
| 审计回路 | 与作者同一回路 | 结构性独立的审计员 |
| 与宿主耦合 | 是 | 否（厂商中立） |
| 禁用模式 | 隐含 | 命名目录 |

常规 AI 编码优化的是**写代码的速度**。Nimi Coding 优化的是**完成可证明的正确性**。

## 与传统代码评审

| 维度 | 代码评审 | Nimi Coding |
| --- | --- | --- |
| 回路分离 | 常常仍是写作者所在团队 | 结构性独立的审计员 |
| 输出 | 通过 / 请求修改 | 裁决（PASS / NEEDS_REVISION / FAIL / OVERFLOW） |
| 闭合维度 | 一维（同意 / 不同意） | 四维（权威 / 语义 / 消费方 / 抗漂移） |
| 它能抓到什么 | 函数级 bug | 权威漂移、并行真相、消费方失败 |
| 频率 | 每个 PR | 每次 wave（更宽的单元） |
| 工件 | PR 评论 | 冻结 packet + 审计 + 收尾记录 |

代码评审抓的是局部 bug。Nimi Coding 抓的是结构性漂移。两者互补，不是互替。

团队完全可以**把 Nimi Coding 嵌进 PR 流程里**：一个 PR 实现一次 wave；wave 的审计与收尾记录随 PR 同行；wave 收尾后再合并。

## 与 DevOps / GitOps 治理

| 维度 | DevOps / GitOps | Nimi Coding |
| --- | --- | --- |
| 层次 | 部署、基础设施即代码 | 规范层语义 |
| 它回答的问题 | "这次改动是否安全发布？" | "这次改动的含义是否正确？" |
| 工件 | 流水线、运行手册、基础设施 manifest | 议题、packet、审计记录 |
| 不变量 | build 通过、测试通过、部署成功 | 权威闭合、语义闭合、消费方闭合、抗漂移 |

DevOps 治理部署。Nimi Coding 治理改动在规范层的**含义**——什么真相被搬动、现在归谁、显式禁止了什么。

两者可叠加。Nimi Coding 在 DevOps **之前**生效，而不是与之并列。一次改动先过 Nimi Coding 收尾（含义正确），再过 DevOps 关卡（部署安全）。

## 与领域驱动设计 / 资源驱动设计

| 维度 | DDD / RDD | Nimi Coding |
| --- | --- | --- |
| 主体 | 领域形态 | 改动领域的工作 |
| 词汇 | 限界上下文、实体、值对象 | 议题、wave、packet、闭合维度 |
| 静态 / 动态 | 多为静态（设计领域本身） | 动态（治理推进领域演化的工作） |
| 输出 | 领域模型 | 可审计的改动记录 |

DDD 说"你的限界上下文是 X"。Nimi Coding 说"你这次 wave 的所有者域是 X，闭合条件是这四个维度"。两者衔接得很自然——DDD 塑造领域，Nimi Coding 塑造改动领域的工作。

同时采用两者，团队会得到：

- 来自 DDD 的清晰领域模型
- 来自 Nimi Coding 的可证明的改动纪律

## 与敏捷 / Scrum

| 维度 | 敏捷 / Scrum | Nimi Coding |
| --- | --- | --- |
| 主体 | 节奏、沟通、迭代 | 权威漂移、AI 失败模式 |
| 层次 | 流程 | 方法论 |
| 时间单位 | sprint | 议题 / wave |
| 输出 | story → 完成 | wave → 已闭合（四维） |
| 对 AI 漂移是否沉默？ | 是（早于 AI 出现） | 否（正是它的回应） |

敏捷 / Scrum 管节奏与利益相关方沟通。它们对权威漂移、并行真相、AI 引发的假闭合保持沉默（因为这些问题诞生在它们之后）。

Nimi Coding 不管节奏（属于另一层）。两者并不冲突，处在不同层次，可以共存。

## 差异化总结

| 特点 | 它带来什么 |
| --- | --- |
| 规范优先权威 | 真相在 `.nimi/spec/**`，不在 PR 描述或聊天记录里 |
| 四闭合 | 闭合是多维的，四维都需满足 |
| 独立审计员 | 审计来自独立回路，不是作者本人 |
| 禁用快捷方式目录 | 反模式有名字，由 packet 显式声明 |
| 宿主无关边界 | 换 AI 宿主时方法论不变 |
| 处处 fail-closed | 权威缺失时输出被拒绝 |
| 议题 / wave / packet / 预检 / 审计 / 收尾 | 一套连贯的世界观，不是模板堆 |

## 读者场景：同时采用 DDD 和 Nimi Coding

某团队已有 DDD 形态的代码库。他们想引入 AI 协作，但不想破坏结构完整性。

1. **保留 DDD 领域模型。**限界上下文、实体、值对象继续生效。
2. **把 Nimi Coding 用在 AI 协作的改动上。**AI 参与代码库改动时，改动走议题 / wave / packet 纪律。
3. **每次 AI 协作的改动，把它涉及的限界上下文命名为 wave 的所有者域。**DDD 上下文是天然的 wave-domain 锚点。
4. **闭合维度核验结构完整性。**"这次 AI 改动是否越界跨过了限界上下文？"是 Nimi Coding 准入的一种结构性核查。

两层之间互相配合。DDD 塑造领域，Nimi Coding 治理推进领域演化的工作。

## 读者场景：组织同时采用代码评审和 Nimi Coding

某机构有严格的代码评审。他们要引入 AI 工具，希望保留代码评审，再加上 Nimi Coding。

1. **代码评审继续。**逐 PR 审看局部 bug、风格、惯用法。
2. **Nimi Coding 包住 PR。**每个 PR 实现一次 wave；wave 的审计与收尾工件随 PR 同行。
3. **审计员属于独立回路。**另一个 AI 会话或另一个厂商承担审计；评审者读这些审计工件。
4. **评审者核两层。**"代码能跑吗？"（代码评审）与"这次 wave 在四个维度上是否闭合？"（Nimi Coding）。

两道关卡互补。合在一起，能抓到任何单独一道关卡都抓不到的问题。

## Nimi Coding 不适合的场景

| 情形 | 原因 |
| --- | --- |
| 极小的低风险改动 | 议题开销是真实的；显式适用规则规定小改动不必走议题纪律 |
| 一次性脚本 | wave / packet 模型对临时工作过重 |
| 与 AI 完全无关的旧代码库 | 方法论是对 AI 失败模式的回应；经典工程卫生已经够用 |

方法论**对适用范围明确**——高风险或承载权威的工作；复杂修复；多 wave 迭代。把它强加到小改动上，只增加成本而不带来闭合价值。

## Source Basis

- [`nimi-coding/README.md`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/README.md)
- [`.nimi/methodology/topic-lifecycle-report.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/topic-lifecycle-report.yaml)
- [`.nimi/methodology/four-closure-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/four-closure-policy.yaml)
- [`.nimi/methodology/role-separation-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/role-separation-policy.yaml)
