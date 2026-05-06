# 技能服务

Cognition 技能服务是技能工件的类型化权威 — 把能力蓝图表达为带类型化输入与已知引用的有序步骤。它是给 Agent 提供可重用做事模式的**建议**家族。

## 技能是什么

| 性质 | 值 |
| --- | --- |
| 类型 | 建议工件（不是核心真相） |
| 形状 | 有序步骤 |
| 输入类型化 | 是 |
| 引用 | 到其他工件的已知引用 |
| 生命周期 | Save / list / load / 词项搜 / 显式删 / 历史 |
| 校验 | 非空步骤校验；引用目标检查 |

技能**不是**模型状态。它是描述「要做 X，按这些步骤」的类型化 bundle。Agent 能搜索、加载、按技能里的步骤来。

## 为什么把技能做成类型化 bundle

幻觉「做 X 的对路子」的模型可能错。咨询类型化技能 bundle 的模型拿到的是在准入合同下作出的、被审过的模式。Agent 的可靠性受益。

| 益处 | 给什么 |
| --- | --- |
| 可重用 | Agent 重用经过测试的模式而不是再推 |
| 可审计 | 技能 bundle 是类型化的；Agent 做了什么可重建 |
| 清理 | 过时技能可在 digest 下归档 |
| 跨 session | 技能随 Agent 保留 |

## 技能操作

| 操作 | 行为 |
| --- | --- |
| `Save` | 存类型化技能 bundle |
| `Load` | 按 id 加载 |
| `List` | 在类型化过滤下列 |
| `LexicalSearch` | 按词项查询搜 |
| `Delete` | 显式破坏性删 |
| 历史 | 读这个技能的历史 |

## 引用校验

技能 bundle 的引用必须指向准入目标。

| 检查 | 干什么 |
| --- | --- |
| 引用目标存在 | 是 — 缺则 fail-close |
| 跨 scope 引用 | 禁止 — fail-close |
| 类型兼容 | 引用类型匹配预期 |

引用不存在或跨 scope 工件的技能在 save 时校验失败。**没**对断引用的静默接受。

## 阅读场景：Agent 存新技能

某 Agent 通过跟用户交互学到一个有用模式。

1. **写技能 bundle。** 有序步骤、类型化输入、对相关记忆 / 知识工件的引用。
2. **提交 Save。** 技能服务收到。
3. **校验。**
   - 非空步骤校验。
   - 引用目标检查（每个 ref 必须在 scope 里存在）。
4. **准入。** 技能以类型化形状被存。
5. **服务派生元数据。** Support、lineage。
6. **未来可用。** Agent 能搜 / 加载。

技能现在是 Agent 类型化建议 bundle 集合的一部分。

## 阅读场景：Agent 搜索技能

某 Agent 即将做之前做过的事。

1. **词项搜索。** `SkillService.LexicalSearch` 带查询。
2. **服务返回匹配。** 匹配的类型化技能 bundle。
3. **Agent 加载首位匹配。** 读类型化步骤。
4. **Agent 按模式来。** 有序步骤驱动推理；Agent 重用模式。

Agent **没**重新发明。它咨询了类型化技能。

## 阅读场景：技能里的引用过时

某技能 bundle 引用一个之后被删的知识页。

1. **Refgraph 推理。** 技能的出向引用是断的。
2. **Digest pass。** 把断引用识别为清理候选。
3. **建议归档。** 技能被归档（可逆）。
4. **用户能恢复。** 用户恢复缺的知识页（或修技能去掉 ref）的话，技能能解归档。
5. **或继续到移除。** 后续 digest pass 可能移除已归档技能。

清理是**可解释**的 — refgraph 推理给出「为什么」。

## 为什么技能保持建议性

技能是建议，不是核心真相。它**不能**降权 kernel 真相。

| 关注 | 为什么建议性重要 |
| --- | --- |
| 技能说 X | 模型可考虑、推理时可推翻 |
| Kernel 说 Y | 不可侵犯真相 |
| 冲突 | Kernel 赢；技能**不能**降权 kernel |

有 bug 或过时的技能**不能**腐蚀 kernel 真相。Kernel 优先性是结构上的。

## 边界总结

| 关注 | 拥有者 |
| --- | --- |
| 技能 bundle 存储 | Cognition 技能服务 |
| 校验 | 服务侧在 completion gate 下 |
| 引用图 | Refgraph |
| 清理 | Digest + 显式删 |
| 真相权重 | 建议（非核心） |

## 来源

- [`.nimi/spec/cognition/kernel/skill-service-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/skill-service-contract.md)
- [`.nimi/spec/cognition/kernel/cognition-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/cognition-contract.md)
- [`.nimi/spec/cognition/kernel/family-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/family-contract.md)
- [`.nimi/spec/cognition/kernel/tables/skill-service-operations.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/tables/skill-service-operations.yaml)
- [`.nimi/spec/cognition/kernel/generated/skill-service-operations.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/generated/skill-service-operations.md)
- [`.nimi/spec/cognition/kernel/reference-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/reference-contract.md)
- [`.nimi/spec/cognition/kernel/completion-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/completion-contract.md)
