# Runtime 桥

Runtime 桥是 Runtime 消费 Cognition 所走的**类型化接缝**。是消费，不是吸纳。Runtime 能读 Cognition 的面；Cognition 的权威留给自己。

## 桥做什么

| 关注 | 行为 |
| --- | --- |
| Runtime 读 Cognition 记忆 | 通过准入桥面 |
| Runtime 读 Cognition 知识 | 通过准入桥面 |
| Runtime 读 Cognition 技能 | 通过准入桥面 |
| Runtime 读 Cognition prompt 服务 | 通过准入桥面 |
| 权威转移 | 无 — Cognition 仍是权威 |

桥是 cognition 面在 runtime 一侧的再发布。`RuntimeCognitionService` 是 runtime 侧；桥合同定义 runtime 被允许消费什么。

## 为什么是桥而不是吸

如果 Runtime 把 Cognition 的权威吸了，两件事会断：

- **独立用。** 一个只用 `nimi-cognition`（无 runtime）的项目失去权威对齐。
- **权威漂移。** Runtime 会静默扩展或改 Cognition 的合同。

有了类型化桥：

- Cognition 作为独立权威被准入。
- Runtime 通过准入面消费。
- 两个项目独立演化，桥合同作为不变量。

## 桥边界表

| 关注 | 拥有者 |
| --- | --- |
| Cognition 对象模型 | Cognition |
| Runtime 记忆 bank 范围 | Runtime |
| Runtime 侧的再发布 | Runtime（`RuntimeCognitionService`） |
| 桥面合同 | `runtime-bridge-contract.md`（kernel） |
| 桥准入权威 | Cognition kernel |

桥是**有界**的 — Runtime **不能**消费 Cognition 里的所有东西；它消费准入桥面。

## RuntimeCognitionService

`RuntimeCognitionService` 是 runtime 侧重叠记忆 / 知识语义的再发布面。

| 性质 | 值 |
| --- | --- |
| 拥有者 | Runtime |
| 来源权威 | Cognition |
| 消费的面 | 记忆、知识、prompt 服务（准入） |
| 保留的 runtime 私有深度 | Runtime 为自己的 bank 范围保留规范化真相 |

Runtime 记忆有自己的规范化真相（按 bank 范围）。Cognition 记忆有自己的规范化真相（按 scope 绑定基底）。桥统一读面；规范化真相留在它住的地方。

## 阅读场景：Agent 通过桥回忆记忆

某 Agent 的 runtime 轮次需要记忆。

1. **Runtime 轮次执行。** RuntimeAgentService 要记忆。
2. **桥咨询 Cognition。** 通过 `RuntimeCognitionService`，记忆被查。
3. **Cognition 记忆服务响应。** 在准入面下的类型化记忆记录。
4. **Runtime 组合。** Agent 的 Brain 层用回忆的记忆。
5. **没权威转移。** Cognition 的记忆权威留在 Cognition；Runtime **没**变成记忆权威。

Runtime 是消费方；cognition 是权威。

## 阅读场景：Runtime 记忆写入复制到 Realm

桥跟 Runtime 自己的记忆复制交互。

1. **Runtime 记忆写。** Agent 写到 `AGENT_CORE` bank。
2. **复制到 Realm。** 按 Runtime 的复制状态。
3. **桥到 Cognition（宿主产品接的话）。** 同一条记忆记录可经准入桥流入 cognition 记忆工件。
4. **复制状态显式。** 每层都是 `pending → synced | conflict | invalidated`。

同一条记忆记录可以是 runtime 规范化记录、realm 复制记录、cognition 记忆工件 — 在准入复制 / 桥合同下。

## 阅读场景：没 Runtime 的 Cognition

某项目只用 `nimi-cognition` 做无 runtime 的 AI Agent。

1. **Cognition 独立。** `nimi-cognition` 不需要 runtime 作前置就能 build、test、跑。
2. **记忆 / 知识 / 技能 / prompt 全可用。** 在准入面下。
3. **没 runtime 桥。** 项目**不**需要接桥。
4. **没 runtime 记忆 bank 范围。** Bank 范围是 runtime 关注；cognition 有自己的 scope 模型。

Cognition 的独立可跑性是结构上的。桥对 runtime 消费方是 opt-in。

## 边界总结

| 关注 | 拥有者 |
| --- | --- |
| Cognition 权威 | Cognition kernel |
| Runtime 消费面 | `RuntimeCognitionService` |
| 桥合同 | `runtime-bridge-contract.md` |
| 规范化真相（cognition 侧） | Cognition 基底 |
| 规范化真相（runtime 侧） | Runtime 记忆 bank + 复制 |

## 来源

- [`.nimi/spec/cognition/kernel/runtime-bridge-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/runtime-bridge-contract.md)
- [`.nimi/spec/cognition/kernel/cognition-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/cognition-contract.md)
- [`.nimi/spec/cognition/kernel/tables/runtime-bridge-boundary.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/tables/runtime-bridge-boundary.yaml)
- [`.nimi/spec/runtime/kernel/runtime-memory-service-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/runtime-memory-service-contract.md)
- [`.nimi/spec/runtime/kernel/runtime-memory-substrate-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/runtime-memory-substrate-contract.md)
