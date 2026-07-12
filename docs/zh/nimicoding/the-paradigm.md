# 范式

Nimi Coding 把问题从“AI 是否产出了看似合理的代码”改为“结果是否符合权威，
并在真实 consumer 中得到证明”。它围绕宿主自有执行提供治理，不是任务 runner。

## 五个结构动作

1. **明确权威。**每项高风险变更都指出 canonical spec owner，并拒绝平行真相。
2. **编辑前分类。**Preflight 区分 alignment 与 redesign；权威缺失时停止。
3. **Fail closed。**契约、证据、auth、runtime 或 provider 能力缺失时明确失败。
4. **验证 consumer。**测试、DOM 或原生结构检查、runtime 状态与视觉复核分别覆盖不同证据。
5. **分离产出与判断。**独立复核挑战权威和证据，但不成为另一名执行者。

## 使用宿主原生执行能力

当前宿主决定如何规划、委派、等待、恢复和完成任务。Nimi Coding 不复制这些决策。
它长期保存的是权威、方法论、validators 和证据契约。

Codex 的原生能力因此成为优势：App 可以管理长任务和子代理，仓库则提供稳定真相
与确定性验收条件。

## 场景

Codex 收到“增加一个 profile 字段”的请求。编辑前，它先判断字段属于 identity
权威还是 presentation。随后修改 owner 契约与公共 SDK 表面，迁移真实 consumer，
验证失败态，并检查真实 app。

真正有价值的创新不是更长的计划，而是每个歧义都有 owner、每条禁用捷径都明确、
每项完成结论都有可重建的证据。

## 来源依据

- [`.nimi/spec/platform/kernel/package-authority-admission-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/package-authority-admission-contract.md)
- [`.nimi/methodology/authority-convergence-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/authority-convergence-policy.yaml)
- [`.nimi/contracts/forbidden-shortcuts.catalog.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/forbidden-shortcuts.catalog.yaml)
