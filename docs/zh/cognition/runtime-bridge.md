# Runtime 桥接

## 状态：现在 (Running today)

Runtime 桥接契约定义了 Runtime 消费 Cognition 的边界；接口已交付。

Runtime 桥接是 Runtime 消费 Cognition 用的强类型接缝。这是消费，不是吞并。Runtime 可以读 Cognition 的接口面，Cognition 的权威仍然属于自己。

## 桥接做什么

| 关注点 | 行为 |
| --- | --- |
| Runtime 读 Cognition 记忆 | 通过准入桥接面 |
| Runtime 读 Cognition 知识 | 通过准入桥接面 |
| Runtime 读 Cognition 技能 | 通过准入桥接面 |
| Runtime 读 Cognition 提示词服务 | 通过准入桥接面 |
| 权威转移 | 没有，Cognition 仍是权威 |

桥接是 Cognition 接口面的"Runtime 端再发布"。`RuntimeCognitionService` 是 Runtime 一侧的接口，桥接契约定义 Runtime 可以消费什么。

## 为什么是桥接，不是吞并

如果 Runtime 把 Cognition 的权威吃下去，会发生两件事：

- **独立使用受影响**。仅使用 `nimi-cognition`、不引入 Runtime 的项目会失去权威对齐。
- **权威漂移**。Runtime 会悄悄延伸或改写 Cognition 的契约。

走强类型桥接：

- Cognition 以独立权威准入。
- Runtime 通过准入接口面消费。
- 两个项目各自演进，桥接契约是不变量。

## 桥接边界表

| 关注点 | 归属 |
| --- | --- |
| Cognition 对象模型 | Cognition |
| Runtime 记忆 bank 作用域 | Runtime |
| Runtime 端再发布 | Runtime（`RuntimeCognitionService`） |
| 桥接面契约 | `runtime-bridge-contract.md`（kernel） |
| 桥接准入权威 | Cognition kernel |

桥接是**有界的**：Runtime 不能消费 Cognition 全部内容，只能消费已准入的桥接面。

## RuntimeCognitionService

`RuntimeCognitionService` 是 Runtime 端的再发布面，覆盖记忆与知识中跨域的部分。

| 属性 | 值 |
| --- | --- |
| 持有方 | Runtime |
| 真相来源 | Cognition |
| 消费的接口面 | 已准入的记忆、知识、提示词服务 |
| Runtime 私有深度 | Runtime 自己 bank 作用域的标准真相仍在 Runtime |

Runtime 记忆有自己的标准真相（按 bank 作用域），Cognition 记忆有自己的标准真相（按作用域绑定的 substrate）。桥接统一的是读取面，标准真相留在各自家里。

## 场景：Agent 通过桥接召回记忆

Agent 在 Runtime 一次回合中需要记忆。

1. **Runtime 回合执行**：RuntimeAgentService 请求记忆。
2. **桥接咨询 Cognition**：通过 `RuntimeCognitionService` 查询记忆。
3. **Cognition 记忆服务回应**：在准入面下返回强类型记忆记录。
4. **Runtime 组装**：Agent 思考层使用召回的记忆。
5. **没有权威转移**：Cognition 的记忆权威仍在 Cognition，Runtime 没有变成记忆权威。

Runtime 是消费方，Cognition 是权威。

## 场景：Runtime 写入记忆并复制到 Realm

桥接同时与 Runtime 自己的记忆复制路径互动。

1. **Runtime 写入记忆**：Agent 写到 `AGENT_CORE` bank。
2. **复制到 Realm**：按 Runtime 的复制状态推进。
3. **桥接到 Cognition（宿主项目接线时）**：同一条记忆记录可经准入映射通道进入 Cognition，成为 Cognition 记忆产物。
4. **复制状态显式**：在每一层都有 `pending → synced | conflict | invalidated`。

同一条记忆既可以是 Runtime 的标准记录，又可以是 Realm 复制的记录，还可以是 Cognition 的记忆产物——都在准入的复制 / 映射契约下。

## 场景：不带 Runtime 的 Cognition

某项目仅使用 `nimi-cognition` 来支撑一个不带 Runtime 的 AI Agent。

1. **Cognition 独立运行**：`nimi-cognition` 不需要 Runtime 作为前置依赖即可构建、测试、运行。
2. **记忆 / 知识 / 技能 / 提示词都可用**：按各自的准入接口面提供。
3. **不需要桥接**：项目不必接线 Runtime 桥接。
4. **没有 Runtime bank 作用域**：bank 作用域是 Runtime 关注点，Cognition 自己有作用域模型。

Cognition 的独立可运行性是结构性的；桥接对 Runtime 消费方而言是可选项。

## 边界归属

| 关注点 | 归属 |
| --- | --- |
| Cognition 权威 | Cognition kernel |
| Runtime 消费面 | `RuntimeCognitionService` |
| 桥接契约 | `runtime-bridge-contract.md` |
| 标准真相（Cognition 侧） | Cognition substrate |
| 标准真相（Runtime 侧） | Runtime 记忆 bank 加复制 |

## 来源依据

- [`.nimi/spec/cognition/kernel/runtime-bridge-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/runtime-bridge-contract.md)
- [`.nimi/spec/cognition/kernel/cognition-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/cognition-contract.md)
- [`.nimi/spec/cognition/kernel/tables/runtime-bridge-boundary.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/tables/runtime-bridge-boundary.yaml)
- [`.nimi/spec/runtime/kernel/runtime-memory-service-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/runtime-memory-service-contract.md)
- [`.nimi/spec/runtime/kernel/runtime-memory-substrate-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/runtime-memory-substrate-contract.md)
