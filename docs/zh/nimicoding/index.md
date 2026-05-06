# Nimi Coding

Nimi Coding 是一款**面向高风险 AI 辅助软件开发的、宿主无关、AI-原生的方法论产品**。它以独立 npm 包（`@nimiplatform/nimi-coding`）的形态对外，可以装到任何仓库里 bootstrap 出一个项目级的 `.nimi/**` 真相面，把「AI 看着已经把这件事做完了」变成「四个闭合维度都拿得出证据」。

Nimi Coding 是 Nimi 平台内部的产品之一，也是平台跟其他产品一起对外的那套 AI 开发方法论。它同样可以独立采用：包本身是宿主无关的，跟你用不用 Nimi 平台的其他部分没关系。

Nimi Coding 跟平台其他部分互相做压力测试。Nimi Coding 让一个像 Nimi 这么大的系统可以被一个小团队配合 AI 真正做完；反过来，平台真实的工程规模又给 Nimi Coding 的主张提供了可证伪的样本。

## 这一节为什么存在

多数 AI 产品在解决「编辑器里的 AI」。Nimi Coding 想解决的是另外一个问题：**怎么让一个团队真正相信 AI 把这件事做完了**。答案不在更好的 prompt，也不在更多的测试，而在方法论本身：在工作开始之前显式声明闭合条件，在工作结束之后把这些条件作为证据来核验。

如果你曾经看过这样一种 AI 辅助的改动 —— 类型检查通过、测试通过、code review 通过，可在权威、范围或产品含义上还是错的 —— 这一节就是写给你的。

## 本章节包含

### 范式

- [范式](/zh/nimicoding/the-paradigm) —— AI 编程治理「新」在哪里，以及为什么这是范式而不是 checklist。
- [四个闭合](/zh/nimicoding/four-closures) —— 把权威闭合、语义闭合、消费方闭合、抗漂移闭合作为一个思维框架。
- [伪闭合形态学](/zh/nimicoding/false-closure-typology) —— 方法论要抓的具名失败形态。
- [禁用捷径](/zh/nimicoding/forbidden-shortcuts) —— 反模式目录。

### 角色与权威收敛

- [角色分离](/zh/nimicoding/role-separation) —— manager、worker、auditor。
- [权威收敛](/zh/nimicoding/authority-convergence) —— 当 spec 要变，为什么独立审计必须走在实现前面。

### 生命周期

- [Topic 生命周期](/zh/nimicoding/topic-lifecycle) —— proposal、ongoing、pending、closed 的状态机；wave 细粒度状态；true close。
- [白皮书](/zh/nimicoding/whitepaper) —— 为什么 AI 辅助实现是一种承担权威的工作。
- [Topic 工作流](/zh/nimicoding/topic-workflow) —— topic / wave / packet / preflight / audit / closeout 的运作流程。
- [走查](/zh/nimicoding/walkthrough) —— 一个合成 topic 从开始到结束的端到端示例。

### 包

- [包](/zh/nimicoding/the-package) —— `@nimiplatform/nimi-coding` 提供什么、不提供什么。
- [宿主无关边界](/zh/nimicoding/host-agnostic) —— 换 AI 宿主为什么不改方法论。
- [技能](/zh/nimicoding/skills) —— 四个声明技能（`spec_reconstruction`、`doc_spec_audit`、`audit_sweep`、`high_risk_execution`）。
- [CLI 表面](/zh/nimicoding/cli) —— 命令面的概念级总览。
- [安装](/zh/nimicoding/installation) —— 当前安装姿态。

### 比较与采纳

- [比较](/zh/nimicoding/comparison) —— 跟普通 AI 编程、code review、DevOps 治理、DDD、敏捷的对比。
- [采纳路径](/zh/nimicoding/adoption-path) —— 谁会采纳、为什么。

### 实操子树

- [Tutorials](/zh/nimicoding/tutorials/) —— 学习导向的逐步课程。
- [How-to](/zh/nimicoding/how-to/) —— 问题导向的菜谱。
- [Reference](/zh/nimicoding/reference/) —— schema 级别的字典。

### 附录

- [oh-my-codex Adapter](/zh/nimicoding/appendix/oh-my-codex) —— 准入的外部宿主适配 overlay。

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
