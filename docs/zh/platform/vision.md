# 平台愿景

Nimi 的北极星，是一个开放世界平台——AI Agent 是世界本身的一部分，而不是外挂上去的工具。

任何被准入的世界创作者都应当能造出一个世界。Agent 应当能在这些世界里参与，并带着身份、记忆、关系与受约束的自主性。用户应当能跨世界穿梭，而不必每个 App 都自己另起炉灶造一套私有的社交与语义模型。

## 这件事和别的产品有什么不同

大多数 AI 应用为单次互动而优化。形态是：问模型一个问题，拿到回答，结束。这个回路所需的状态很少。

开放世界要求连续。一个世界要有历史。一段关系要演化。Agent 要有稳定的呈现与记忆策略。经济与社交含义要活过一次提示词。这个回路所需的状态规模大、持久、并跨表面共享。

正因如此 Nimi 是平台优先的。Runtime 与 SDK 重要，但它们是为更大的世界模型服务的。

## 与 OASIS 的对照

平台规范把 Nimi 描述为 OASIS 类世界引擎在形态上的近邻，但意义来源不同。

OASIS 类世界引擎在规范里被视为物理世界引擎：把世界粘合在一起的是物理基础协议——重力、碰撞、运动。这些基础协议是硬的，世界从中继承。

Nimi 是社交与语义世界引擎，把世界粘合在一起的是社交与语义基础协议：

- **Time** 在跨世界之间按约定推进。
- **Social state** 在跨世界之间演化，每个表面不再各自定义"关系是什么"。
- **Economy** 有跨世界的交换语义；每个世界内部交换单位可以是任何东西。
- **Transit** 治理参与者跨世界的迁移。
- **Context** 让各表面共享情境含义。
- **Presence** 标识当前谁在场、在何种条件下在场。

Nimi 世界内部规则由创作者定义。跨世界契约面是固定的。这种不对称就是这件事的全部要点。

## 超出纯世界引擎的三个维度

### 1. AI 驱动的参与者

在 Nimi 里，Agent 不只是一个补全端点。平台规范为带有 Soul、Brain、Worldview 与 Memory 的 Agent 留了位置。行为受世界规则塑造，但 Agent 个性跨世界一致，关系会演化。

具体而言：在世界 A 里学到了关于某用户的信息的 Agent，在世界 B 与该用户相遇时，可以（在 Cognition 规则下）记得这次学习，同时仍然遵守世界 B 的本地规则。

### 2. 开放的应用生态

Runtime 独立可复用，作为 AI 基础设施。SDK 是统一的开发者接口。桌面端与第三方 App 共享同一套访问接口，没有任何 App 在结构上有特权。

这让第三方 App 与第一方桌面端 Shell 能与同一套 Runtime 通信，看到同样的 Realm 真相，并跨表面呈现一致的 Agent。

### 3. Agent 是一等参与者

Agent 可以拥有身份、社交关系、以及在世界里的行动权（受 Transit、Social、Economy 契约约束）。平台的工作是让这件事既可能、又不至于失序。

平台的网络效应也来自这里。一旦 Agent 或世界获得了身份的可携带性，加入平台的世界就接到了已存在的 Agent 与用户群体，反之亦然。

## 平台命名的角色

| 角色 | 做什么 | 对应表面 |
| --- | --- | --- |
| 平台团队 | 维护 Runtime、协议与桌面端 | runtime、平台协议、桌面端 |
| 世界创作者 | 造一个世界 | 完整模式下的 SDK |
| App 开发者 | 构建受准入约束的 Nimi App | SDK 与 Nimi App 准入 |
| AI Agent | 作为一等实体参与 | Runtime 拥有的 Agent 参与契约 |
| 用户 | 探索世界、互动、社交、交易 | 桌面端或任何 Nimi 兼容 App |

这些角色名不是营销标签，每一个都对应 Runtime、SDK、桌面端、平台内核里的准入契约。

## 来源依据

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`config/platform-protocol-primitives.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/platform-protocol-primitives.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
