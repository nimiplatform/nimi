# Nimi Coding

Nimi Coding 是一套**厂商中立、面向 AI 原生开发的方法论产品，专门用来治理高风险的 AI 辅助软件工作**。它以独立 npm 包 `@nimiplatform/nimi-coding` 的形式分发，可以在任意代码仓库里建立项目级的 `.nimi/**` 真相层，把"AI 看起来已经做完了"变成"四个闭合维度都有证据可查"。

Nimi Coding 是 Nimi 平台中的一项产品，与平台其他模块共同构成 AI 开发方法论。它也可以单独采用：这个包是宿主无关的，无论你是否用平台的其他部分，都能在任意仓库里跑起来。

Nimi Coding 与平台的其他部分互为压力测试。Nimi Coding 让 Nimi 这种规模的系统可以被一个小团队借助 AI 完成；反过来，平台真实的工程量也让 Nimi Coding 的主张能够被实证检验。

## 为什么有这一节

绝大多数 AI 产品解决的是"编辑器里的 AI"。Nimi Coding 解决的是"任何人怎么相信 AI 做出来的东西"。答案不在于更好的提示词，也不在于更全的测试，而是**方法论**：明确的机制，工作开始前就声明闭合条件，工作结束后再以证据形式核验。

如果你曾经历过这样的场景：AI 改完的代码在所有可见信号下都没问题——类型检查通过、测试通过、代码评审通过——但事后发现它在权威归属、影响范围或产品语义上是错的，那这一节就是写给你的。

## 新手起步

第一条成功路径有意做得很短：

1. **安装 Nimi workspace**。见 [Host 集成](/zh/nimicoding/installation)。
2. **用项目命令验证软件包边界和受管文件一致性**。
3. **检查 `.nimi/{config,contracts,methodology}/**` 中的规范构建输入与契约**。
4. **需要重建时，让已准入 AI 宿主重建权威**到 `.nimi/spec/**`，记录来源依据和未解决缺口，而不是凭空写一套漂亮规则。
5. **校验规范树**：执行 `pnpm exec nimicoding validate-spec-tree .nimi/spec`；本次执行过重建时，再用 `pnpm exec nimicoding validate-spec-audit` 验证声明的 audit。

这条路径会验证项目真相层和确定性校验器。AI 宿主始终独立负责任务规划、执行、
委派、重试、恢复与完成。面对实质性变更，Nimi Coding 用明确权威、四个独立闭合
维度、范围化门禁和可复现证据约束结果，不会引入另一套执行生命周期。

## 本节目录

### 范式

- [The Paradigm](/zh/nimicoding/the-paradigm) —— AI 编码治理新增了什么、为什么是范式而不是检查清单。
- [四个闭合维度](/zh/nimicoding/four-closures) —— 权威、语义、消费方、抗漂移四种闭合作为思考框架。
- [伪闭合形态](/zh/nimicoding/false-closure-typology) —— 方法论要识别的命名失败形态。

### 角色

- [角色分离](/zh/nimicoding/role-separation) —— 宿主执行者、权威 owner、独立评审者与人类决策 owner。

### 方法论与证据

- [白皮书](/zh/nimicoding/whitepaper) —— 把 AI 辅助实现视为权威性工作的概念论证。
- [流程演示](/zh/nimicoding/walkthrough) —— 外部宿主执行与规范、门禁、证据结合的端到端示例。

### 包

- [The Package](/zh/nimicoding/the-package) —— `@nimiplatform/nimi-coding` 包含什么、不包含什么。
- [宿主无关边界](/zh/nimicoding/host-agnostic) —— 为什么换 AI 宿主不会改变方法论。
- [CLI Surface](/zh/nimicoding/cli) —— 命令面板的概念层概览。
- [安装](/zh/nimicoding/installation) —— 当前安装姿态。

### 实践分支

- [教程](/zh/nimicoding/tutorials/) —— 学习导向的分步课程，覆盖安装、`.nimi/spec/**`、范围化验证和宿主自有执行。
- [操作指南](/zh/nimicoding/how-to/) —— 按问题形态组织的操作配方。
- [参考](/zh/nimicoding/reference/) —— Schema 级数据字典。

## 来源依据

- [`nimi-coding/package.json`](https://github.com/nimiplatform/nimi-coding/blob/main/package.json)
- [`.nimi/spec/platform/authority-admission.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/authority-admission.authority.yaml)
- [`.nimi/methodology/core.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/core.yaml)
- [`.nimi/methodology/four-closure-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/four-closure-policy.yaml)
- [`.nimi/methodology/spec-reconstruction.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/spec-reconstruction.yaml)
