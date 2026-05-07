# Nimi Coding

Nimi Coding 是一套**在高复杂度场景下，保持 AI 开发一致性与准确性的辅助开发产品，具有支持任意更换模型、AI 原生等特点**。通过独立 npm 包（@nimiplatform/nimi-coding），可植入任意代码仓库，快速帮助建立项目 .nimi/** “唯一真相面”。它让“AI 看起来已经把活干完了”这种模糊的感受，转变为“四个可闭合维度上的事实基础”，最终实现”做完了，也做对了“。

Nimi Coding 是 Nimi 平台的核心产品之一，也是我们对外输出的一套标准 AI 开发方法论。但它的使用完全是解耦的：由于 npm 包本身不绑定任何特定宿主，你可以独立采纳它，而无需依赖 Nimi 平台的其他组件。

在内部，Nimi Coding 与 Nimi 平台互为试金石。一方面，Nimi Coding 让 Nimi 这样庞大且复杂的系统得以被一个小团队借助 AI 成功构建；另一方面，Nimi 真实的工程规模与复杂度，又为 Nimi Coding 的方法论主张提供了绝佳的、可证伪的压力测试样例。

## 为什么需要这套方法论？

当前大多数 AI 产品都在“让编辑器里的AI变得更强”，而 Nimi Coding 解决的是另一个问题”如何让整个工程团队相信ai交付的结果“？

这个答案不在于写出更好的 Prompt，也不在于堆砌更多的测试用例，而在于重塑开发方法论本身：在正式开发前，显式定义好验收的“闭环（Closure）”条件；在开发后，严格将这些条件作为核验的客观证据。

如果你曾经历过这样的 AI 辅助开发困境——代码过了类型检查、过了单元测试、甚至过了 Code Review，但在架构权威、影响范围或业务逻辑上依然存在致命偏差——那么，这一章就是专门为你写的。

## 新手入门指引

快速上手，只需以下几步：

1. **安装:** 在已有仓库里安装 `@nimiplatform/nimi-coding`，详见 [安装指南](/zh/nimicoding/installation)。
2. **初始化环境:** 运行 `nimicoding start`建立 `.nimi/`目录。，再用 `nimicoding doctor --json` 检查健康状态。
3. **重建项目规范:** 将项目现有的事实依据提取至 `.nimi/spec/**`；这一步的关键是：如实记录当前的来源依据以及尚未解决的历史遗留问题（unresolved gaps），而不是凭空捏造一套看似完美的规则。
4. **发起 Topic:** 为你的首个“高风险”或“涉及架构权威变更”的任务，创建一个 Topic。
5. **把 topic 拆成 wave。** 将该 Topic 拆解成更细粒度的 Wave，确保每个 Wave 都只对应单一的归属领域（owner domain）和一个明确的闭环目标。
6. **先冻结 packet，再开始做。** 在实际动工前，提前冻结工作包（Packet）的上下文：显式声明允许读取的范围、允许修改的边界、验收通过的恒定条件（invariants）、反向测试用例（negative tests）、止损红线（stop lines）以及允许重新开启任务（reopen）的触发条件。
7. **让AI大模型 接力执行。** 执行结果必须写成类型化证据，而不是只留在聊天里。
8. **按四个维度闭合 wave。** 权威、语义、消费方、抗漂移四项都成立，才算真的闭合。

以上是 Nimi Coding 核心产品理念的缩影：让 AI 的工作成果转化为持久的、边界清晰且可审计的工程状态，而不是一堆“当时像模像样”的聊天记录。
## 本章节包含

### 范式

- [范式](/zh/nimicoding/the-paradigm) —— AI 编程治理「新」在哪里，以及为什么这是范式而不是 checklist。
- [四个闭合](/zh/nimicoding/four-closures) —— 把权威闭合、语义闭合、消费方闭合、抗漂移闭合作为一个思维框架。
- [伪闭合形态学](/zh/nimicoding/false-closure-typology) —— 方法论要抓的具名失败形态。
- [禁用捷径](/zh/nimicoding/forbidden-shortcuts) —— 反模式目录。

### 角色与权威收敛

- [角色分离](/zh/nimicoding/role-separation) —— 明确 Manager（管理者）、Worker（执行者）与 Auditor（审计者）的职责边界
- [权威收敛](/zh/nimicoding/authority-convergence) —— 当需求（Spec）发生变更时，为什么独立审计必须走在代码实现之前。

### 生命周期

- [Topic 生命周期](/zh/nimicoding/topic-lifecycle) —— 深入解析从 proposal（提案）、ongoing（进行中）、pending（挂起）到 closed（已关闭）的状态机流转，以及 wave 状态和真正意义上的收尾（true close）。
- [白皮书](/zh/nimicoding/whitepaper) —— 为什么说“引入 AI 辅助实现”本质上是一项移交技术决策权威的工作。
- [Topic 工作流](/zh/nimicoding/topic-workflow) —— 涵盖 topic / wave / packet / preflight / audit / closeout 的完整运转机制。
- [End-to-end样例](/zh/nimicoding/walkthrough) —— 从一个 topic 从开始到结束的示例。

### 包

- [包](/zh/nimicoding/the-package) —— `@nimiplatform/nimi-coding` 提供什么、不提供什么。
- [宿主无关边界](/zh/nimicoding/host-agnostic) —— 换 AI 宿主为什么不改方法论。
- [技能](/zh/nimicoding/skills) —— 四个声明技能（`spec_reconstruction`需求重构、`doc_spec_audit`文档规范审计、`audit_sweep`审计扫描、`high_risk_execution`高风险执行）。
- [CLI 交互](/zh/nimicoding/cli) —— 命令行工具的概念级全局视角。。
- [安装指南](/zh/nimicoding/installation) —— 目前推荐的安装与初始化方式

### 对比与采纳

- [横向对比](/zh/nimicoding/comparison) —— Nimi Coding 与常规 AI 编程助手、传统 Code Review、DevOps 治理、领域驱动设计（DDD）及敏捷开发的差异。
- [采纳路径](/zh/nimicoding/adoption-path) —— 哪些团队适合引入这套方法论？核心驱动力是什么？

### 实操指南

- [Tutorials](/zh/nimicoding/tutorials/) —— 循序渐进的系统性学习路径，带你走完从安装配置 `.nimi/spec/`、创建执行 Topic、扫描审计、架构设计到长期平稳运行的完整流程。
- [How-to](/zh/nimicoding/how-to/) —— 面向具体问题的实战 Cookbook。
- [Reference](/zh/nimicoding/reference/) —— schema 级别的字典。

### 附录

- [oh-my-codex Adapter](/zh/nimicoding/appendix/oh-my-codex) —— 接入外部 AI模型的适配扩展层（Overlay）。

## 来源

- [`nimi-coding/README.md`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/README.md)
- [`nimi-coding/package.json`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/package.json)
- [`nimi-coding/AGENTS.md`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/AGENTS.md)
- [`.nimi/spec/product-scope.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/product-scope.yaml)
- [`.nimi/spec/bootstrap-state.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/bootstrap-state.yaml)
- [`.nimi/spec/high-risk-admissions.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/high-risk-admissions.yaml)
- [`.nimi/methodology/topic-lifecycle-report.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/topic-lifecycle-report.yaml)
- [`.nimi/methodology/four-closure-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/four-closure-policy.yaml)
- [`.nimi/contracts/packet.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/packet.schema.yaml)
