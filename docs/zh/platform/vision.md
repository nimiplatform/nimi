# 平台愿景

Nimi 的北极星是一个开放世界平台 — 在这个平台里，AI Agent 是世界的一部分，而不是从外面接进来的工具。

任何被准入的世界创作者都能建一个世界。Agent 可以带着身份、记忆、关系和有界的自主性参与这些世界。用户可以在世界之间穿梭，而不需要每个 App 都自己发明一套私有的社交和语义模型。

## 这跟其他 AI 产品有什么不同

大多数 AI 应用围绕"一次交互"做优化。流程是：问 Model 一个问题，拿到回答，结束。这个回路需要的状态很小。

开放世界要求的是连续性。一个世界要有历史；一段关系要演化；一个 Agent 要有稳定的呈现和明确的记忆策略；经济和社交意义要跨过一次对话。这种回路需要的状态既大、又持久、又跨多个面板共享。

这就是为什么 Nimi 是 platform-first。Runtime 和 SDK 重要，但它们是为更大的世界模型服务的。

## 与 OASIS 的类比

平台规范把 Nimi 框成"形状上类似 OASIS 风格世界引擎，但意义来源不同"。

OASIS 风格的世界引擎被规范当成**物理世界引擎**：把世界粘在一起的是物理基础协议 — 重力、碰撞、运动。这些基础协议是硬的，世界继承它们。

Nimi 是**社会与语义世界引擎**。把世界粘在一起的是社会与语义层的基础协议：

- **Time** 在世界之间以约定的方式推进。
- **Social state** 跨世界演化，不会让每个面板自己定义"什么是关系"。
- **Economy** 有跨世界的交换语义；单个世界内部的"交换单位"可以是任何东西。
- **Transit** 管理参与者如何在世界之间移动。
- **Context** 让面板共享情境含义。
- **Presence** 说明现在谁/什么在场，以什么条件在场。

Nimi 世界**内部**的规则由创作者定。**跨世界**的合同面是固定的。这种不对称是整套设计的关键。

## 三个超出"纯世界引擎"的维度

### 1. AI 驱动的参与者

在 Nimi 里，Agent 不只是一个补全端点。平台规范给"带 Soul、Brain、Worldview、Memory 的 Agent"留出了位置。行为受世界规则约束，但 Agent 的人格跨世界保持一致。关系会演化。

具体来说：一个 Agent 在 World A 里学到了关于某个用户的事，在 World B 再次遇到这个用户时，被允许（在 Cognition 规则下）记得这件事 — 同时仍然遵守 World B 的本地规则。

### 2. 开放的应用生态

Runtime 是独立可复用的 AI 基础设施。SDK 是统一的开发者面。桌面端和第三方 App 共享同一套接入接口，没有哪个 App 在结构上享有特权。

这让一个小 Mod、一个第三方 App、第一方桌面端外壳能够用同一个 Runtime、看同一份 Realm 真相、在不同面板里呈现一致的 Agent。

### 3. Agent 是一等参与者

Agent 被允许持有身份、社交关系、以及在世界里行动的权利（受 Transit、Social、Economy 合同约束）。平台的工作是让这件事**在不崩盘的前提下**成立。

这也是平台网络效应的来源。一旦 Agent 或世界获得身份可携带性，新加入平台的世界就立刻能接触到平台已有的 Agent 和用户群体；反过来也一样。

## 平台命名的角色

| 角色 | 做什么 | 面板 |
| --- | --- | --- |
| Platform team | 维护 Runtime、协议、桌面端 | runtime、平台协议、桌面端 |
| World creator | 建一个世界 | full 模式下的 SDK |
| Mod developer | 在桌面端做有界扩展 | SDK 加 Mod 面 |
| AI Agent | 作为一等实体参与 | Runtime-owned Agent 参与 |
| 用户 | 探索世界、互动、社交、交易 | 桌面端或任何 Nimi-aware App |

这些角色不是营销标签。每一个都在 Runtime、SDK、桌面端、平台 kernel 里有已认可合同支撑。

## 来源

- [`.nimi/spec/platform/vision.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/vision.md)
- [`.nimi/spec/platform/kernel/architecture-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/architecture-contract.md)
- [`.nimi/spec/platform/kernel/protocol-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/protocol-contract.md)
- [`.nimi/spec/platform/kernel/tables/protocol-primitives.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/tables/protocol-primitives.yaml)
- [`.nimi/spec/runtime/kernel/runtime-agent-service-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/runtime-agent-service-contract.md)
