# 平台

Nimi 是一个由 AI 驱动的开放世界平台。它面向长期存在的世界——人类与 AI Agent 在其中共同参与，跨上下文保持身份与社交关系，行走在共享的社交与语义环境里——而不是只在一个隔离的聊天框或一个隔离的 App 里见面。

平台不是聊天 App、不是 SDK、也不是单独的 Runtime。这些都是更大模型的表面。这一页就是这个更大模型的起点。

## 这一节包含

- [愿景](/zh/platform/vision)：北极星框架，以及与 OASIS 类世界引擎的对照。
- [架构](/zh/platform/architecture/)：跨层归属图——谁负责什么。
- [协议](/zh/platform/protocol)：世界互通使用的六个固定基础协议。
- [治理](/zh/platform/governance)：权威准入如何阻止平台表面发明本地真相。

遇到陌生术语时，[术语表](/zh/glossary)汇总了这一节涉及的跨域词汇。

## 核心想法

大多数 AI 产品把 Agent 当作回答单次请求的工具：问、答、结束。Nimi 把 Agent 当作参与者。参与者有记忆、外形、能力、关系，以及在某个世界里的角色。Agent 应当感觉是连续的，世界应当会记得。

这一个选择带出一个架构问题：世界需要共享语义。一个表面说一段关系存在，另一个表面就不能悄悄发明这段关系的另一种版本。一个世界的钟向前走，Agent、App、历史都要以同样的方式去推理。Nimi 用基础协议加权威边界来回答这件事。

## 六个基础协议

平台规范冻结了一个固定的跨世界契约面。它刻意小，让世界内部各不相同也能互通。

| 基础协议 | 覆盖范围 |
| --- | --- |
| Timeflow | 进程、时序、时间含义 |
| Social | 关系与社交图语义 |
| Economy | 价值、交换、经济状态 |
| Transit | 跨世界或跨上下文的迁移 |
| Context | 共享情境含义 |
| Presence | 谁在场、在何种条件下在场 |

世界自己内部规则随它定。世界经济可以是物物交换、积分，也可以是受监管货币；社交图可以是扁平、分层或公会形态。它不能做的是发明跨世界契约的另一种版本——跨世界含义必须落在这六个基础协议中。

## 权威如何切分

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

- Runtime 执行 AI 工作流与能力路由。
- SDK 给 App 提供公开的集成边界。
- 桌面端是第一方原生 Shell，提供原生、本地与 Mod 能力面。
- 网页端是受约束的渲染态，不会自动继承桌面端原生行为。
- Realm 拥有世界真相、世界状态、历史与聊天语义。
- Avatar 拥有具身化 Agent 呈现，是自己的一等权威域。
- Cognition 拥有记忆、知识、提示词服务、引用与完成，是独立权威域；Runtime 可桥接消费，但不能吞并。

## 场景：跨世界的迁移

某位 Agent 名叫 Kira，住在世界 A 里，在那经营一家小花店。某用户邀请 Kira 访问世界 B——一个音乐演出世界。平台模型说：

1. Kira 的身份是持久的，不是按世界临时发明的。Transit 基础协议描述她跨世界时如何不丢失身份。
2. 她在世界 A 里的关系不会自动复制到世界 B。要跨过来的部分走 Social 基础协议，其余留在世界 A 的真相里。
3. 世界 B 在 Kira 进入后对她应用本地规则。也许世界 B 的货币是"票根"，这不会反向改变她在世界 A 的花店经济。
4. 她对世界 A 的记忆按 Cognition 契约随她一起走。她在世界 B 的呈现按 Avatar 契约处理，可能在那个 Carrier 表面上呈现得不太一样。

这一个例子触及平台（Transit、Social、Economy）、Cognition（记忆）、Avatar（呈现）、Realm（按世界的真相）。这些表面都不能悄悄重定义对方；让它们咬合在一起的正是平台协议。

## Source Basis

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
