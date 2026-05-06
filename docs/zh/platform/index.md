# Platform

Nimi 是一个 AI 驱动的开放世界平台。它面向**长期存在的世界**：人和 AI Agent 共同参与，跨上下文保留身份与关系，在共享的社会与语义环境中活动，而不是只在某一个孤立的聊天或 App 里出现。

平台本身不是某个聊天 App、不是某个 SDK、也不是某个 Runtime。这些都是更大模型的某一个面板。本页是这个模型的入口。

## 本章节包含

- [愿景](/zh/platform/vision) — 北极星定位，以及与 OASIS 风格世界引擎的对比。
- [架构](/zh/platform/architecture/) — 跨层地图：谁拥有什么。
- [协议](/zh/platform/protocol) — 世界之间互通的六个固定基础协议。
- [治理](/zh/platform/governance) — 权威准入如何防止某个面板自行发明真相。

术语不熟可查 [术语表](/zh/glossary)。

## 平台的核心想法

大多数 AI 产品里的 Agent 是回答请求的工具：发问、回答、结束。Nimi 里的 Agent 是**参与者** — 它有记忆、表现、能力、关系，以及在世界里的角色。Agent 的体验应当是连续的，世界应当**记得**发生过的事。

这一个设计选择就引出一个架构问题：世界需要**共享语义**。如果一个面板说某条关系存在，另一个面板就不能默默地发明另一份真相；如果世界推进时间，Agent、应用、历史就必须以同一种方式理解这次推进。Nimi 用六个基础协议和权威边界来回答这个问题。

## 六个基础协议

平台规范冻结了一个固定的跨世界合同面。这个面被有意做得很小，让世界内部可以差异极大、又仍然能互通：

| 基础协议 | 涵盖什么 |
| --- | --- |
| Timeflow | 时间推进、节奏、时序意义 |
| Social | 关系与社交图语义 |
| Economy | 价值、交换、经济状态 |
| Transit | 跨世界 / 跨上下文移动 |
| Context | 共享的情境含义 |
| Presence | 谁/什么在场，以什么条件在场 |

每个世界可以自由定义自己的内部规则。一个世界的经济可以是物物交换、积分或受监管的货币；社交图可以是平的、层级的或公会式的。但它**不能自己重写**这六个跨世界合同 —— 跨世界传递的含义必须收在这六个基础协议里。

## 权威如何切分

```
                Platform
        （世界模型 + 6 个基础协议
            + 权威规则）
                /        \
               v          v
            Runtime      Realm
         （执行）      （真相、世界
            |           状态、历史、
            |   bridge   chat）
            +- - - ->    
            |          |
        Cognition      |
       （记忆、知识、     |
        Prompt 服务、    |
        补全）          |
            \         /
             v       v
              SDK 边界
            /            \
           v              v
        桌面端           网页端
       （原生）          （受限版）

   Avatar 在表现层接 Realm + Cognition，
   走具身呈现合同。
```

- Runtime 执行 AI 工作流并做能力路由。
- SDK 给应用提供公开接入边界。
- 桌面端是 Nimi 第一方原生外壳，可承载原生、本地、Mod 等能力面。
- 网页端是受限版，不会因为概念相同就默默继承桌面端的原生能力。
- Realm 拥有世界真相、世界状态、世界历史和聊天语义。
- Avatar 是具身 Agent 表现层独立的独立产品域。
- Cognition 是记忆、知识、Prompt 服务、引用、补全的独立权威域。Runtime 可以接桥，但不会吸收。

## 阅读场景：跨世界移动

设想一个名叫 Kira 的 Agent 住在 World A，在那里经营一家小花店。一个用户邀请 Kira 去访问 World B（一个音乐演出世界）。平台模型说：

1. Kira 的身份是持久的，不会因为换世界就重新发明。Transit 基础协议说明她如何跨世界而不丢失身份。
2. 她在 World A 的人际关系不会自动复制到 World B。允许跨世界传递的部分走 Social 基础协议合同；其余部分仍留在 World A 的真相里。
3. World B 的本地规则适用于 Kira 在 World B 里的活动。即使 World B 的货币是「票根」，也不会反向改变她在 World A 的店铺经济。
4. 她对 World A 的记忆走 Cognition 合同伴随她移动；她在 World B 的呈现走 Avatar 合同，承载面板可能用不同方式表现她。

这一个例子涉及 Platform（Transit、Social、Economy）、Cognition（记忆）、Avatar（呈现）、Realm（每个世界的真相）。这些面板都不能默默地重新定义另一方；平台协议把它们拴在一起。

## 来源

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
