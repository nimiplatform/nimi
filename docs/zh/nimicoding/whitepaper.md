# Nimi Coding 白皮书

Nimi Coding 把 AI 辅助实现视为承载权威的工作。AI 产出的代码可以编译、通过测试、
看起来也很合理，却仍然误解产品真相、所有权、consumer 行为或失败语义。

答案不是再造一套 agent framework。Codex 或其他已准入宿主继续规划并执行任务；
Nimi Coding 为宿主提供项目本地机制，用来确认什么是真相、什么被禁止、必须检查
什么，以及哪些证据足以支撑完成结论。

## 治理分工

| 宿主持有 | Nimi Coding 增强 |
| --- | --- |
| 任务定义与计划 | `.nimi/spec/**` 规范权威 |
| 子代理与并行工作 | Authority owner 与 work type 预检 |
| 重试、等待、恢复、完成 | Fail-closed 方法论与契约 |
| 代码与产品编辑 | 确定性脚本和 validators |
| 真实 app 与 runtime 交互 | 强类型本地证据和验收 |

这条边界避免两套系统同时驱动一项工作，也防止流畅的最终总结成为高风险变更成功
的唯一证明。

## 四个独立问题

高风险任务完成前，证据必须回答：

1. **权威：**变更是否遵循 canonical owner？
2. **语义：**实现表达的含义是否与权威一致？
3. **消费方：**真实 consumer 是否使用预期行为？
4. **抗漂移：**测试与门禁能否发现回归或 owner bypass？

Build 可以回答部分语义问题，但不能独自回答另外三个问题。

## 为什么必须有真实 Runtime 证据

UI 与 app 变更最容易暴露差距。单元测试可以通过，而真实 shell 仍存在按钮不可用、
auth 状态过期、窄屏布局破损、console error 或 SDK 断连。宿主因此必须检查真实
应用、DOM 或原生结构、runtime 状态和视觉输出。

## 为什么必须有项目真相

缺少 canonical authority tree 时，AI 会用貌似合理的规则填补空白。`.nimi/spec/**`
明确所有权；方法论要求宿主在 owner 缺失或冲突时停止，而不是编造局部真相；
确定性门禁随后保护这条边界。

## 最终形态

Nimi Coding 最理想的状态，是成为宿主周围安静而精确的基础设施：开工前提供真相，
实现中约束边界，结束后验证证据。宿主继续使用原生任务、计划、委派和恢复能力，
仓库不建立竞争性的执行状态。

## 来源依据

- [`.nimi/spec/platform/kernel/package-authority-admission-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/package-authority-admission-contract.md)
- [`.nimi/methodology/four-closure-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/four-closure-policy.yaml)
- [`.nimi/methodology/role-separation-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/role-separation-policy.yaml)
