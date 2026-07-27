# 平台协议

平台协议给 Nimi 的世界提供了一种共同语言。它不限制世界创作者的发挥空间，只是让世界之间共享足够的结构，使身份、Agent、社交状态、迁移这些事在不同表面上仍然有意义。

本页是面向读者的概览。完整规则归在平台内核 `P-PROTO-*` 规则族里。

## 六个基础协议

每一个基础协议都是一小块固定的契约面。世界自己内部的规则可以随意定义，但凡是要跨世界传递的东西，必须归入这六个之一。

| 基础协议 | 覆盖范围 |
| --- | --- |
| **Timeflow** | 跨世界的进程、时序与时间含义 |
| **Social** | 社交关系与社交图语义 |
| **Economy** | 价值、交换、经济状态 |
| **Transit** | 跨世界或跨上下文的迁移 |
| **Context** | 共享的情境含义 |
| **Presence** | 谁在场、在何种条件下在场 |

这些基础协议是刻意抽象的。Timeflow 不规定"一小时是六十分钟"。它规定的是：当一个世界的时钟需要被另一个世界或表面解读时，进程如何被表达。

## 为什么先有协议、再有功能

没有协议，每个功能都会变成局部的。世界说一种事，桌面端表面暗示另一种事，Agent 又按第三种行动。平台协议把共享语义放在一个所有功能都不能悄悄改写的地方，正是为了挡住这种漂移。

由此带来一个实际后果：任何涉及跨世界含义的新产品功能，必须经过协议，而不是绕开它。一个自己另起炉灶搞社交图的功能，不是功能扩展，而是平行权威。

## 场景：两个世界识别同一段友谊

Alice 和 Bob 在世界 A 里是朋友。Bob 也访问世界 B。Social 基础协议描述这段友谊跨世界时如何表达：

1. 这段友谊的表达形式让两个世界都能读懂。
2. 世界 B 可以应用自己本地的社交规则。也许在世界 B "朋友"只授予聊天权限；也许世界 A 的朋友身份还附带经济权益。
3. Bob 访问世界 B 不会反向改变世界 A 对这段友谊的真相；如果有变更，必须按各自世界的权威记录。

Social 基础协议不强迫每个世界以同样的方式建模友谊，它强迫的是友谊在跨世界时表达成另一个世界能正确读懂的契约形态。

## 协议与 Realm 的关系

协议是跨世界含义的契约面。Realm 才是世界真相真正存在的地方。两者相关但不同：

- 协议是语言。
- Realm 是用这门语言表达的持久含义。

世界推进一次状态，变更就锚在 Realm。当这次变更需要让另一个表面看到时，由基础协议负责表达。

## 场景：触及多个基础协议的工作流

某个世界举办一次小型市集活动。在活动期间：

- **Timeflow** 推进活动状态：从"已排期"到"进行中"再到"已结束"。
- **Presence** 标识当前在活动空间里的 Agent 与用户。
- **Social** 记录两位参与者在活动中建立了一段连接。
- **Economy** 记录某位参与者购买了一件商品。
- **Transit** 治理某位参与者活动结束后离开前往另一个世界的方式。
- **Context** 让各个表面共享活动进行中的情境含义，参与的 Agent 不必逐一读取其它基础协议就能知道发生了什么。

六个基础协议单独看抽象，在一次正常的世界流程里它们会同时出现。

## 来源依据

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`config/platform-protocol-primitives.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/platform-protocol-primitives.yaml)
- [`config/platform-protocol-error-codes.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/platform-protocol-error-codes.yaml)
