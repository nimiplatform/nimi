# Runtime 升级

Runtime 升级合同描述能力升级怎么在 Runtime 与 Cognition 之间流动而不吸纳权威。能力升级是指 Cognition 的面提供比 Runtime 等价面更多或更强的语义；升级合同映射这层关系。

## 为什么是「升级」而不是「吸纳」

如果 Cognition 简单替代 Runtime 的记忆与知识面，两件事会断：

- 已有消费 Runtime 的 App 得重绑到 Cognition。
- Runtime 的 bank 范围模型（针对 runtime 执行上下文的）会被稀释。

有了升级合同：

- Runtime 与 Cognition 都保留各自的面。
- 升级矩阵把每个 runtime 关注映到带**等价或升级强度**的 cognition 面。
- 想要更丰语义的 App 经桥 opt-in；不想的 App 继续直接用 Runtime。

## 升级矩阵

`runtime-capability-upgrade-matrix.yaml` 准入按关注的映射。

| Runtime 关注 | Cognition 面 | 强度 |
| --- | --- | --- |
| 记忆回忆 | Cognition 记忆服务 | 等价或更丰 |
| 知识查询 | Cognition 知识服务 | 更丰（一等关系） |
| Prompt 拼装 | Cognition Prompt 服务 | 更丰（道分开） |
| 技能 bundle | Cognition 技能服务 | 增类型化建议 bundle |

矩阵被准入；强度声明按关注。

## 升级**不**做什么

| 关注 | 为什么不 |
| --- | --- |
| 替代 Runtime 作权威 | Runtime 为 bank 范围保留规范化真相 |
| 吸纳 Runtime 记忆 bank 范围 | Bank 范围是 runtime 关注 |
| 强迫 App 迁移 | 桥是 opt-in |
| 降权 Runtime 合同 | Runtime 合同保持准入 |

升级是**累加**，不是替代。

## 阅读场景：App opt-in Cognition

某宿主产品决定 Agent 用 Cognition 做记忆与知识，而不是只用 runtime bank。

1. **接桥。** 通过准入设置，runtime 消费 cognition。
2. **复制 / 桥接。** 记忆写经准入桥流到 cognition 记忆基底。
3. **经桥读。** Runtime 查 cognition（更丰的面）。
4. **既有 runtime 合同不变。** 不知道 cognition 的 App 看到的 runtime 跟以前一样。

宿主产品升级了；平台没。

## 阅读场景：独立 Cognition 采纳

某项目用 `nimi-cognition` 而不用 `nimi-runtime`。

1. **采纳 cognition。** 项目依赖 `nimi-cognition`。
2. **不需要升级矩阵。** 项目直接用 cognition；没 runtime 关注要升级。
3. **Cognition 独立。** 项目拿到 cognition 的完整面，不需要 runtime 桥。

独立用绕过升级矩阵。矩阵的存在是给同时消费 runtime 与 cognition 的项目。

## 阅读场景：能力漂移

假设 Cognition 的知识服务演化（加新操作）。Runtime 看得见吗？

1. **Cognition kernel 准入新操作。** 按 cognition 自己的准入合同。
2. **桥合同评估。** 如果 runtime 该暴露新操作，升级矩阵也在 runtime 侧准入它。
3. **如准入到升级矩阵。** Runtime 的 `RuntimeCognitionService` 在准入面下暴露新操作。
4. **如未准入到升级矩阵。** 新操作只在 cognition 侧。

矩阵是门控层。Cognition 能演化而不强行扩展 runtime；runtime 只在被准入时扩展。

## 阅读场景：审计员问「记忆权威在哪」

某审计员想知道一个同时用 runtime 与 cognition 的项目里，规范化记忆真相住在哪。

| Scope | 权威 |
| --- | --- |
| Runtime bank 范围（`AGENT_CORE`、`AGENT_DYADIC`、`WORLD_SHARED`） | Runtime |
| Cognition 记忆基底 | Cognition |
| 跨桥接 | 桥合同映射 |

读 spec 的审计员拿到类型化答案。权威**不**模糊，因为桥是被准入的，不是即兴的。

## 来源

- [`.nimi/spec/cognition/kernel/runtime-upgrade-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/runtime-upgrade-contract.md)
- [`.nimi/spec/cognition/kernel/runtime-bridge-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/runtime-bridge-contract.md)
- [`.nimi/spec/cognition/kernel/tables/runtime-capability-upgrade-matrix.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/tables/runtime-capability-upgrade-matrix.yaml)
- [`.nimi/spec/cognition/kernel/cognition-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/cognition-contract.md)
- [`.nimi/spec/cognition/kernel/family-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/family-contract.md)
- [`.nimi/spec/runtime/kernel/runtime-memory-service-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/runtime-memory-service-contract.md)
- [`.nimi/spec/runtime/kernel/knowledge-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/knowledge-contract.md)
