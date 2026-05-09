# 技能服务

Cognition 技能服务是技能产物的强类型权威。技能是能力蓝图——一组带强类型输入和已知引用的有序步骤。它属于 **advisory** 族，给 Agent 提供可重用的做事模式。

## 技能是什么

| 属性 | 值 |
| --- | --- |
| 类型 | advisory 产物（不是核心真相） |
| 形态 | 有序步骤 |
| 输入类型 | 强类型 |
| 引用 | 指向其它产物的已知引用 |
| 生命周期 | 保存 / 列出 / 加载 / 词法搜索 / 显式删除 / 历史 |
| 校验 | 步骤非空校验；引用目标核对 |

技能**不是**模型状态，而是一束强类型描述："要做 X，按这些步骤来。"Agent 可以搜索、加载、按步骤执行。

## 为什么把技能做成强类型束

模型自己幻觉出"做 X 的正确方式"很可能是错的。模型查阅一份强类型技能束，得到的是在准入契约下被审定过的模式，Agent 的可靠性会受益。

| 收益 | 给到了什么 |
| --- | --- |
| 可重用 | Agent 复用经过验证的模式，不必重新推导 |
| 可审计 | 技能束是强类型的，Agent 做了什么可被还原 |
| 可清理 | 陈旧技能可在摘要下被归档 |
| 跨会话 | 技能跟随 Agent 一起走 |

## 技能操作

| 操作 | 行为 |
| --- | --- |
| `Save` | 保存一份强类型技能束 |
| `Load` | 按 id 加载 |
| `List` | 在强类型筛选下列出 |
| `LexicalSearch` | 词法查询 |
| `Delete` | 显式硬删 |
| 历史 | 读取该技能的历史 |

## 引用校验

技能束里的引用必须指向准入的目标。

| 检查 | 行为 |
| --- | --- |
| 引用目标存在 | 必须存在；缺失则 fail-closed |
| 跨作用域引用 | 禁止；fail-closed |
| 类型兼容 | 引用类型与期望相符 |

引用了不存在或跨作用域产物的技能，在 Save 时校验失败。引用断裂的技能不会被静默接受。

## 场景：Agent 保存一份新技能

Agent 在与用户互动中学到了一个有用的模式。

1. **构造技能束**：有序步骤，强类型输入，引用相关的记忆 / 知识产物。
2. **提交 Save**：技能服务接收。
3. **校验**：
   - 步骤非空校验；
   - 引用目标核对（每条引用必须存在于作用域内）。
4. **准入**：技能以强类型形态保存。
5. **服务侧元数据**：支撑、血缘。
6. **后续可用**：Agent 可以搜索 / 加载。

这份技能从此进入 Agent 的强类型 advisory 集合。

## 场景：Agent 搜索某个技能

Agent 准备做一件以前做过的事。

1. **词法搜索**：调用 `SkillService.LexicalSearch` 加查询。
2. **服务返回匹配**：相关的强类型技能束。
3. **Agent 加载首选**：读取强类型步骤。
4. **按模式执行**：有序步骤指引推理，Agent 复用这个模式。

Agent 没有重新发明，而是查阅了强类型技能。

## 场景：技能引用陈旧

某个技能束引用的一份知识页已被删除。

1. **引用图推理**：技能的出边引用断裂。
2. **摘要轮次**：把这条断裂引用列为清理候选。
3. **提议归档**：技能被归档（可恢复）。
4. **用户可恢复**：用户恢复缺失的知识页，或修改技能去掉这条引用，技能即可恢复。
5. **或继续移除**：后续摘要轮次可移除已归档的技能。

清理是**可解释的**——引用图推理给出"为什么"。

## 为什么技能停留在 advisory

技能是 advisory，不是核心真相。它不能压制 kernel 真相。

| 关注点 | advisory 为什么重要 |
| --- | --- |
| 技能说 X | 模型可参考，可在推理中覆盖 |
| Kernel 说 Y | 不可侵犯的真相 |
| 冲突 | Kernel 胜出；技能不能压制 kernel |

写错或过时的技能不会污染 kernel 真相。Kernel 优先级是结构性的。

## 边界归属

| 关注点 | 归属 |
| --- | --- |
| 技能束存储 | Cognition 技能服务 |
| 校验 | 服务侧，在完成关卡下 |
| 引用图 | 引用图 |
| 清理 | 摘要 + 显式删除 |
| 真相权重 | advisory（非核心） |

## 来源依据

- [`.nimi/spec/cognition/kernel/skill-service-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/skill-service-contract.md)
- [`.nimi/spec/cognition/kernel/cognition-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/cognition-contract.md)
- [`.nimi/spec/cognition/kernel/family-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/family-contract.md)
- [`.nimi/spec/cognition/kernel/tables/skill-service-operations.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/tables/skill-service-operations.yaml)
- [`.nimi/spec/cognition/kernel/generated/skill-service-operations.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/generated/skill-service-operations.md)
- [`.nimi/spec/cognition/kernel/reference-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/reference-contract.md)
- [`.nimi/spec/cognition/kernel/completion-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/completion-contract.md)
