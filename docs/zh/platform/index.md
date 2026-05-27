# 平台

Nimi 是一个由 AI 驱动的开放世界平台。它面向长期存在的世界——人类与 AI Agent 能够在其中共同参与，跨越上下文保持身份与社交关系，处于共享的社交与语义环境中——而非仅在孤立的聊天框或应用内进行交互。

平台本身不是聊天应用、不是 SDK，也不是独立的 Runtime。这些均是更宏大模型的组成表面。本页阐述了这一整体模型的起点。

## 本节包含的内容

- [愿景](/zh/platform/vision)：项目核心目标，以及与 OASIS 类世界引擎的结构对照。
- [架构](/zh/platform/architecture/)：跨层权责归属图——明确各组件的功能与责任。
- [协议](/zh/platform/protocol)：用于实现跨世界互通的六项基础协议。
- [治理](/zh/platform/governance)：权威准入机制如何防止不同平台表面产生冲突的本地“真相”。

遇到不熟悉的术语时，可查阅跨领域通用的[术语表](/zh/reference/glossary)。

## 核心理念

多数 AI 产品将 Agent 视作响应单次请求的工具。Nimi 将 Agent 视为对等的“参与者”。参与者具备记忆、外貌、特定能力、社交关系，并在特定世界中扮演角色。Agent 的存在应具备连续性，且世界应保留对其交互的记录。

这一选择提出了一项架构要求：世界需要共享语义。如果一个表面确认了某段关系的存在，其他表面则不能产生该关系的冲突版本。当世界的时间推进时，Agent、应用与历史记录必须依据统一的逻辑进行推演。Nimi 通过“基础协议”与“权威边界”来解决这一问题。

## 六项基础协议

平台规范设定了一个固定的跨世界契约面。其范围经过刻意精简，以确保在各世界内部规则迥异的情况下仍能实现互通。

| 基础协议 | 覆盖范围 |
| --- | --- |
| Timeflow | 进程、时序、时间含义 |
| Social | 关系与社交图谱语义 |
| Economy | 价值、交换、经济状态 |
| Transit | 跨世界或跨上下文的迁移 |
| Context | 共享情境含义 |
| Presence | 参与者的在场状态与条件 |

每个世界的内部规则可自行定义。例如，经济系统可以是物物交换或受限货币；社交图谱可以是扁平结构或层级形态。但各世界不可自行重定义跨世界的统一契约——跨世界交互的语义必须遵循上述六项基础协议。

## 权威切分

```
                平台
        （世界模型 + 6 个基础协议
              + 权威规则）
                /        \
               v          v
            Runtime      Realm
         （执行）   （真相、世界
            |            状态、
            |   桥接   历史、
            +- - - ->   聊天）
            |          |
        Cognition      |
       （记忆、         |
        知识、         |
        提示词、       |
        完成）         |
            \         /
             v       v
              SDK 边界
            /            \
           v              v
        桌面端         网页端
       （原生）     （受约束的
                     渲染态）

   Avatar 在具身化语义层契约下
   消费 Realm 与 Cognition。
```

- Runtime 负责执行 AI 工作流与能力的路由分发。
- SDK 为应用提供标准的公开集成边界。
- 桌面端是第一方原生外壳，提供原生、本地与 Nimi App 启动能力。
- 网页端是一种受约束的渲染呈现，不会自动继承桌面端的原生行为。
- Realm 掌握世界真相、当前状态、历史演进与聊天语义的权威。
- Avatar 管理 Agent 的具身化呈现，作为一个独立的权威域存在。
- Cognition 掌握记忆、知识、Prompt 服务、引用与内容生成的权威。Runtime 可通过桥接消费其服务，但无权干涉其内部逻辑。

## 场景演示：跨世界迁移

假设有一位名为 Kira 的 Agent，居住在世界 A 并经营一家花店。当某用户邀请 Kira 访问世界 B（一个音乐演出世界）时，平台模型将依据以下原则处理：

1. Kira 的身份是跨世界持久存在的，而非在进入新世界时临时生成。Transit 基础协议规范了她跨越世界时不丢失身份的机制。
2. 她在世界 A 中的社交关系不会自动复制到世界 B。涉及跨世界延续的关系部分由 Social 基础协议处理，其余部分作为世界 A 的专属真相保留。
3. 当 Kira 进入世界 B 后，必须遵守该世界的本地规则。例如，世界 B 的交易媒介可能是“票根”，但这不会反向修改她在世界 A 中花店的经济状态。
4. 她对世界 A 的记忆将遵循 Cognition 契约随她一同迁移。她在世界 B 中的形象呈现则由 Avatar 契约管理，可能会在新的呈现表面上展现不同的外观。

上述场景涉及平台（Transit、Social、Economy）、Cognition（记忆）、Avatar（外形呈现）以及 Realm（世界真相）。这些表面各自独立，不能私自重新定义对方。将其整合协同的，正是平台的底层协议。

## 来源依据

- [`.nimi/spec/platform/vision.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/vision.md)
- [`.nimi/spec/platform/architecture.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/architecture.md)
- [`.nimi/spec/platform/protocol.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/protocol.md)
- [`.nimi/spec/platform/kernel/architecture-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/architecture-contract.md)
- [`.nimi/spec/platform/kernel/protocol-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/protocol-contract.md)
- [`.nimi/spec/platform/kernel/tables/protocol-primitives.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/tables/protocol-primitives.yaml)
- [`.nimi/spec/realm/README.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/README.md)
- [`.nimi/spec/runtime/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/index.md)
- [`.nimi/spec/sdk/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/index.md)
- [`.nimi/spec/avatar/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/index.md)
- [`.nimi/spec/cognition/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/index.md)
