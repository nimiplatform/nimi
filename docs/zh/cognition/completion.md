# Completion

Cognition Completion 合同治理 cognition 输出怎么变成可用工件的闸口。它声明 completion gate — 输出在被准入为真实工件之前必须通过的类型化检查。

## Completion gate 是什么

Completion gate 在 `tables/completion-gates.yaml` 准入。每个 gate 声明：

| 字段 | 用途 |
| --- | --- |
| Gate id | 稳定身份 |
| 触发 | Gate 什么时候触发 |
| 校验器 | 校验什么 |
| Outcome | 通过 / 失败 / 隔离 |
| Reason code | Outcome 的类型化原因 |

未过 gate 的 completion **不**静默产出工件。要么输出在类型化 gate 下被准入，要么被隔离 / 拒。

## 为什么在 completion 设 gate

没 gate，模型输出直接流进类型化工件。有 gate，输出过准入校验：

- Schema 有效性
- 出处检查
- 敏感度分类
- 交叉引用校验
- 清理资格检查

Gate 就是阻止「模型说了什么」**不经显式准入**就变成「这是类型化规范化工件」的东西。

## 阅读场景：记忆 Save 通过 completion gate

某 Agent 存类型化记忆记录。

1. **Save 提交。** 记忆服务收到。
2. **Completion gate 评估。** Schema 校验；交叉引用检查（无跨 scope 泄漏）；准入。
3. **所有 gate 过。** 记忆记录以类型化形状准入。
4. **服务派生元数据计算。** Support、lineage。
5. **审计 lineage。** Save 事件被记下。

Agent 的 save 在显式 gate 下被准入。**没**「静默准入」。

## 阅读场景：知识 Save 缺目标引用

某 Agent 存一个知识页，引用一个不存在的别的页（交叉引用未命中）。

1. **Save 提交。** 知识服务收到。
2. **Completion gate 触发。** 交叉引用校验。
3. **缺目标。** 引用目标在 scope 里不存在。
4. **拒。** Fail-close；返类型化错误。
5. **Agent 看到原因。** 「缺引用目标 X」。

引用**不**被静默丢。平台拒绝准入指向无的知识页。

## 阅读场景：技能 bundle 步骤校验

某技能 bundle 有有序步骤。一步内容为空。

1. **技能 bundle save。** 技能服务收到。
2. **Completion gate。** 校验步骤排序；按步检查非空校验。
3. **找到空步。** 校验失败。
4. **拒。** Bundle 不被准入；类型化错误说明哪一步无效。

Bundle **不**在半成品状态下被准入。

## 独立 Completion 标准

Cognition 持严格标准：cognition 只在**生产级**时被准入，**不是**作为 MVP / 骨架。

| 禁止 | 原因 |
| --- | --- |
| 伪实现 | **不能**装作实现了 |
| 假成功 | 没真做事时**不能**返成功 |
| 占位清理 | **不能**没真清理就标记记录已清 |

这就是把 Cognition 跟「大致能跑的进行中服务」区分开的标准。要么 Cognition 为某工件家族被准入为生产级，要么那个家族保持 deferred。

## Completion **不**做什么

| 关注 | 为什么不 |
| --- | --- |
| 修改真相（kernel） | Kernel 是核心；建议**不能**降权 |
| 旁路校验 | 设计上 fail-close |
| 静默部分 save | **没**半准入工件 |

## 边界总结

| 关注 | 拥有者 |
| --- | --- |
| Gate 定义 | `tables/completion-gates.yaml` |
| 校验 | 服务侧 |
| Outcome | 准入 / 隔离 / 拒（类型化） |
| 生产级标准 | Cognition 准入策略 |

## 来源

- [`.nimi/spec/cognition/kernel/completion-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/completion-contract.md)
- [`.nimi/spec/cognition/kernel/cognition-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/cognition-contract.md)
- [`.nimi/spec/cognition/kernel/family-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/family-contract.md)
- [`.nimi/spec/cognition/kernel/tables/completion-gates.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/tables/completion-gates.yaml)
- [`.nimi/spec/cognition/kernel/reference-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/reference-contract.md)
