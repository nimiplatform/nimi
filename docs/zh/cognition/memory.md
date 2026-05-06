# 记忆服务

Cognition 记忆服务是独立 Agent 推理的类型化记忆权威。它跟 Runtime 记忆 bank 范围（服务 runtime 规范化记忆）不同；Cognition 记忆讲的是 Agent 怎么**用**自己的记忆**思考** — episodic、semantic、observational 记录，带显式生命周期。

## Cognition 的六个工件家族

Cognition 有六个顶层工件家族。记忆是其中之一。

| 家族 | 用途 |
| --- | --- |
| `agent_model_kernel` | Agent 关于自己的本地模型 |
| `world_model_kernel` | Agent 关于自己世界的本地模型 |
| `memory_substrate` | 类型化记忆记录 |
| `knowledge_projections` | 带一等关系的类型化知识页 |
| `skill_artifacts` | 类型化建议 bundle（能力蓝图） |
| `working_state` | 瞬时认知脚手架（不持久） |

记忆位于**建议**层 — kernel 是核心真相；记忆 / 知识 / 技能是建议；working state **永不**作为真相服务。

## 记忆操作

| 操作 | 行为 |
| --- | --- |
| `Save` | 存一条类型化记忆记录 |
| `Load` | 按 id 加载 |
| `List` | 在类型化过滤下列 |
| `Search` | 在准入查询下搜 |
| `Delete` | 显式删（非静默衰减） |
| 历史 / lineage | 读记忆记录变更历史 |
| 派生视图 | 读服务派生的元数据视图 |

服务派生元数据（support、lineage、invalidation、cleanup）是**服务拥有**，不是调用方持久化的。App **不**自己构造元数据；它们读服务派生视图。

## Cognition Scope

每个 cognition 工件**恰好属于一个 scope**。一个 scope 装恰好一个 `agent_model_kernel` + 一个 `world_model_kernel`。删 scope 移除 scope 拥有的工件。

| 性质 | 值 |
| --- | --- |
| Scope 基数 | 每个 scope 一个 Agent kernel + 一个世界 kernel |
| 跨 scope 引用 | 禁止 |
| Scope 删除 | 移除 scope 拥有的工件 |

记忆记录**不能**引用别的 scope 里的工件；那会造成跨 scope 泄漏。

## 记忆工件生命周期

| 状态 | 通过什么到达 |
| --- | --- |
| Created | 显式 Save |
| Listed / Recalled | List / Search / Load |
| 派生视图读 | 服务派生视图方法 |
| Archived | Digest 清理 pass（可逆） |
| Removed | 归档后的后续 digest pass，或显式破坏性删 |

归档与移除是**独立 pass**。同 pass 归档加移除被禁 — 平台拒绝。这就是让归档可逆的原因。

## 阅读场景：Agent 存并回忆记忆

某 Agent 学到用户的生日。

1. **Save。** Agent 调 `MemoryService.Save` 提交一条描述这次学习的类型化记忆记录。服务准入。
2. **服务派生元数据。** 服务计算 support、lineage 等。调用方**不**需要构造这些。
3. **后来回忆。** Agent 搜索；记录在类型化查询下被返回。
4. **下一轮使用。** Brain 层消费回忆出的记忆；行为反映「我记得你的生日」。

记忆是持久的；回忆路径是类型化的。

## 阅读场景：Digest pass 归档过时记忆

Digest 例程定期建议哪些记忆该清理。

1. **Digest 扫描。** 第一个准入例程；作用于记忆 / 知识 / 技能（**永不**作用于 kernel）。
2. **Refgraph 推理。** 每个候选对照 refgraph 检查 — 入向 support、断引用、依赖健康。
3. **归档建议。** 过时候选被建议归档。
4. **归档（可逆）。** 通过的候选被归档。
5. **后续 pass。** 后续 digest pass 可能移除已归档项。
6. **审计 lineage。** 每步可追溯到具体 refgraph 推理。

清理是**可解释**的 — 不是启发式。问「这条为什么被归档」的用户（或审计员）拿到指向具体断引用的类型化答案。

## 阅读场景：显式删除

某用户想让一条具体记忆被永久删掉。

1. **显式删请求。** 用户对记录 id 调 `MemoryService.Delete`。
2. **级联检查。** 服务检查依赖；显式删是破坏性的。
3. **移除。** 在准入合同下删记录。
4. **审计。** 删除事件被记下。

显式删**跟 digest 清理独立**。Digest 是主动清理；显式删是用户驱动的破坏性。

## 清理资格

| 家族 | 清理资格 |
| --- | --- |
| Kernel（Agent / 世界） | 永不 |
| Working state | 只通过显式 clear |
| 记忆 / 知识 / 技能 | 通过 digest |

Kernel 不可侵犯。它们是核心真相；建议清理**永不**碰它们。

## 边界总结

| 关注 | 拥有者 |
| --- | --- |
| 记忆记录 | Cognition 记忆服务 |
| 服务派生元数据 | 服务（不是调用方） |
| Refgraph 推理 | Cognition refgraph |
| 清理决定 | Digest 例程 + 准入策略 |
| 跨 scope 引用 | 禁止 |

## 来源

- [`.nimi/spec/cognition/kernel/memory-service-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/memory-service-contract.md)
- [`.nimi/spec/cognition/kernel/cognition-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/cognition-contract.md)
- [`.nimi/spec/cognition/kernel/family-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/family-contract.md)
- [`.nimi/spec/cognition/kernel/tables/memory-service-operations.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/tables/memory-service-operations.yaml)
- [`.nimi/spec/cognition/kernel/tables/artifact-families.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/tables/artifact-families.yaml)
