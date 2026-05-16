# Nimi Coding

Nimi Coding 是一套**厂商中立、面向 AI 原生开发的方法论产品，专门用来治理高风险的 AI 辅助软件工作**。它以独立 npm 包 `@nimiplatform/nimi-coding` 的形式分发，可以在任意代码仓库里建立项目级的 `.nimi/**` 真相层，把"AI 看起来已经做完了"变成"四个闭合维度都有证据可查"。

Nimi Coding 是 Nimi 平台中的一项产品，与平台其他模块共同构成 AI 开发方法论。它也可以单独采用：这个包是宿主无关的，无论你是否用平台的其他部分，都能在任意仓库里跑起来。

Nimi Coding 与平台的其他部分互为压力测试。Nimi Coding 让 Nimi 这种规模的系统可以被一个小团队借助 AI 完成；反过来，平台真实的工程量也让 Nimi Coding 的主张能够被实证检验。

## 为什么有这一节

绝大多数 AI 产品解决的是"编辑器里的 AI"。Nimi Coding 解决的是"任何人怎么相信 AI 做出来的东西"。答案不在于更好的提示词，也不在于更全的测试，而是**方法论**：明确的机制，工作开始前就声明闭合条件，工作结束后再以证据形式核验。

如果你曾经历过这样的场景：AI 改完的代码在所有可见信号下都没问题——类型检查通过、测试通过、代码评审通过——但事后发现它在权威归属、影响范围或产品语义上是错的，那这一节就是写给你的。

## 新手起步

第一条成功路径有意做得很短：

1. **安装 npm 包**到现有仓库。见 [安装指南](/zh/nimicoding/installation)。
2. **初始化 `.nimi/`**：执行 `nimicoding start`，再用 `nimicoding doctor --json` 确认结果。
3. **交接规范重建**：执行 `nimicoding handoff --skill spec_reconstruction --json`。
4. **让已准入的 AI 宿主重建权威**到 `.nimi/spec/**`，记录来源依据和未解决的缺口，而不是凭空写一套漂亮的规则。
5. **校验结果**：执行 `nimicoding validate-spec-tree .nimi/spec` 和 `nimicoding validate-spec-audit`。

这条路径会给项目建立本地真相层和机械校验器。它不要求你立刻使用 topic、wave、packet 或高风险关卡。那些机制只在工作承载权威、跨模块、多 wave，或需要审计时启用。

一旦工作进入高风险范围，升级路径才变成：创建 topic，拆分 wave，开工前冻结 packet，经由已准入宿主执行或交接，并且只有权威、语义、消费方、抗漂移四个闭合维度都满足时才关闭。

## 本节目录

### 范式

- [The Paradigm](/zh/nimicoding/the-paradigm) —— AI 编码治理新增了什么、为什么是范式而不是检查清单。
- [四个闭合维度](/zh/nimicoding/four-closures) —— 权威、语义、消费方、抗漂移四种闭合作为思考框架。
- [伪闭合形态](/zh/nimicoding/false-closure-typology) —— 方法论要识别的命名失败形态。
- [禁用反模式](/zh/nimicoding/forbidden-shortcuts) —— 显式拒绝的反模式清单。

### 角色与权威收敛

- [角色分离](/zh/nimicoding/role-separation) —— 管理者、执行者、审计者。
- [权威收敛](/zh/nimicoding/authority-convergence) —— 规范变更时为何独立审计必须先于实现。

### 生命周期

- [Topic 生命周期](/zh/nimicoding/topic-lifecycle) —— proposal、ongoing、pending、closed；wave 的细粒度状态；true close。
- [白皮书](/zh/nimicoding/whitepaper) —— 把 AI 辅助实现视为权威性工作的概念论证。
- [Topic 工作流](/zh/nimicoding/topic-workflow) —— topic / wave / packet / 预检 / 审计 / 关闭的实际流程。
- [流程演示](/zh/nimicoding/walkthrough) —— 一个端到端的合成示例。

### 包

- [The Package](/zh/nimicoding/the-package) —— `@nimiplatform/nimi-coding` 包含什么、不包含什么。
- [宿主无关边界](/zh/nimicoding/host-agnostic) —— 为什么换 AI 宿主不会改变方法论。
- [技能](/zh/nimicoding/skills) —— 四个声明的技能：`spec_reconstruction`、`doc_spec_audit`、`audit_sweep`、`high_risk_execution`。
- [CLI Surface](/zh/nimicoding/cli) —— 命令面板的概念层概览。
- [安装](/zh/nimicoding/installation) —— 当前安装姿态。

### 对比与采纳

- [对比](/zh/nimicoding/comparison) —— 与原生 AI 编码、代码评审、DevOps 治理、DDD、敏捷的对比。
- [采纳路径](/zh/nimicoding/adoption-path) —— 谁会采用，为什么。

### 实践分支

- [教程](/zh/nimicoding/tutorials/) —— 学习导向的分步课程，覆盖从安装到 `.nimi/spec/**`、topic 执行、sweep 审计、sweep 设计、长任务宿主工作的完整路径。
- [操作指南](/zh/nimicoding/how-to/) —— 按问题形态组织的操作配方。
- [参考](/zh/nimicoding/reference/) —— Schema 级数据字典。

### 附录

- [oh-my-codex 适配器](/zh/nimicoding/appendix/oh-my-codex) —— 已准入的外部宿主适配层。

## 来源依据

- [`nimi-coding/README.md`](https://github.com/nimiplatform/nimi-coding/blob/main/README.md)
- [`nimi-coding/package.json`](https://github.com/nimiplatform/nimi-coding/blob/main/package.json)
- [`nimi-coding/AGENTS.md`](https://github.com/nimiplatform/nimi-coding/blob/main/AGENTS.md)
- [`nimi-coding/CHANGELOG.md`](https://github.com/nimiplatform/nimi-coding/blob/main/CHANGELOG.md)
- [`nimi-coding/spec/product-scope.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/spec/product-scope.yaml)
- [`nimi-coding/spec/bootstrap-state.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/spec/bootstrap-state.yaml)
- [`nimi-coding/methodology/topic-lifecycle-report.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/methodology/topic-lifecycle-report.yaml)
- [`nimi-coding/methodology/four-closure-policy.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/methodology/four-closure-policy.yaml)
- [`nimi-coding/contracts/packet.schema.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/contracts/packet.schema.yaml)
