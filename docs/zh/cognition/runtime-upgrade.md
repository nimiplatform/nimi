# Runtime 能力升级

Runtime 升级契约描述能力升级如何在 Runtime 与 Cognition 之间流转，且不发生权威吞并。当 Cognition 的接口面在某个关注点上提供了比 Runtime 等价接口更丰富、或更强的语义时，就构成一次能力升级；这套契约负责把这种关系映射清楚。

## 为什么是"升级"，不是"吞并"

如果 Cognition 直接替换 Runtime 的记忆与知识接口，会出两件事：

- 既有消费 Runtime 的 App 必须重新接到 Cognition；
- Runtime 自己 bank 作用域模型（专为 Runtime 执行上下文设计）会被冲淡。

走升级契约：

- Runtime 与 Cognition 各自保留接口面。
- 升级矩阵把每个 Runtime 关注点映射到 Cognition 接口面，并标注**等价或更强**。
- 想要更丰富语义的 App 通过桥接显式接入；不接入的 App 继续直接用 Runtime。

## 升级矩阵

`runtime-capability-upgrade-matrix.yaml` 准入了按关注点的映射。

| Runtime 关注点 | Cognition 接口面 | 强度 |
| --- | --- | --- |
| 记忆召回 | Cognition 记忆服务 | 等价或更丰富 |
| 知识查询 | Cognition 知识服务 | 更丰富（一等关系） |
| 提示词组装 | Cognition 提示词服务 | 更丰富（通道隔离） |
| 技能束 | Cognition 技能服务 | 新增强类型 advisory |

矩阵已准入；强度声明按关注点逐项给出。

## 升级不做的事

| 关注点 | 不做的原因 |
| --- | --- |
| 替换 Runtime 的权威 | Runtime 自己 bank 作用域的标准真相仍由 Runtime 持有 |
| 吞并 Runtime 的 bank 作用域 | bank 作用域是 Runtime 的关注点 |
| 强制 App 迁移 | 桥接是可选项 |
| 压制 Runtime 契约 | Runtime 契约仍准入有效 |

升级是**叠加**，不是替换。

## 场景：App 接入 Cognition

某宿主项目决定让 Agent 用 Cognition 来做记忆与知识，而不仅仅依赖 Runtime bank。

1. **接线桥接**：在准入的接线流程下，Runtime 消费 Cognition。
2. **复制 / 投影**：记忆写入经准入投影通道流入 Cognition 记忆 substrate。
3. **通过桥接读取**：Runtime 查询 Cognition（更丰富的接口）。
4. **既有 Runtime 契约不变**：不知情的 App 看 Runtime 与之前一样。

升级的是宿主项目，不是平台。

## 场景：独立采用 Cognition

某项目仅用 `nimi-cognition`，不引入 `nimi-runtime`。

1. **采用 Cognition**：依赖 `nimi-cognition`。
2. **不需要升级矩阵**：直接使用 Cognition，没有要被升级的 Runtime 关注点。
3. **完整 Cognition 接口面**：项目拿到 Cognition 全部接口，不需要 Runtime 桥接。

独立使用绕开整个升级矩阵——矩阵存在是为了同时消费 Runtime 与 Cognition 的项目。

## 场景：能力漂移

假设 Cognition 知识服务演进，加入了一个新操作。Runtime 看得到吗？

1. **Cognition 内核准入新操作**：按 Cognition 自己的准入契约。
2. **桥接契约评估**：如果 Runtime 应当暴露这个新操作，则升级矩阵在 Runtime 侧也准入。
3. **若准入升级矩阵**：Runtime 的 `RuntimeCognitionService` 在准入面下暴露这个新操作。
4. **若不准入升级矩阵**：新操作只留在 Cognition 一侧。

矩阵就是那道闸门。Cognition 可以独立演进，不会强行扩展 Runtime；Runtime 仅在准入时扩展。

## 场景：审计员问"记忆权威在哪"

审计员想知道在同时使用 Runtime 与 Cognition 的项目里，标准记忆真相位于何处。

| 作用域 | 权威 |
| --- | --- |
| Runtime bank 作用域（`AGENT_CORE`、`AGENT_DYADIC`、`WORLD_SHARED`） | Runtime |
| Cognition 记忆 substrate | Cognition |
| 跨投影 | 由桥接契约映射 |

审计员读规范就能拿到强类型答案。权威不模糊，因为桥接是准入的，不是临时拼出来的。

## 来源依据

- [`.nimi/spec/cognition/kernel/runtime-upgrade-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/runtime-upgrade-contract.md)
- [`.nimi/spec/cognition/kernel/runtime-bridge-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/runtime-bridge-contract.md)
- [`.nimi/spec/cognition/kernel/tables/runtime-capability-upgrade-matrix.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/tables/runtime-capability-upgrade-matrix.yaml)
- [`.nimi/spec/cognition/kernel/cognition-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/cognition-contract.md)
- [`.nimi/spec/cognition/kernel/family-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/family-contract.md)
- [`.nimi/spec/runtime/kernel/runtime-memory-service-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/runtime-memory-service-contract.md)
- [`.nimi/spec/runtime/kernel/knowledge-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/knowledge-contract.md)
