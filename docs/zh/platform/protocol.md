# 平台协议

平台协议给 Nimi 的世界一套共享语言。它不会拿走世界创作者的创作自由，但给世界提供足够的共同结构，让身份、Agent、社交状态和移动这些东西在跨面板时仍然有意义。

权威协议规则在平台 kernel 的 `P-PROTO-*` 规则族里。

## 六个基础协议

每个基础协议是一个小而固定的合同面。世界内部规则可以自由定义，但**跨世界传递**的东西必须收到这六个之一里。

| 基础协议 | 涵盖什么 |
| --- | --- |
| **Timeflow** | 世界之间的时间推进、节奏与时序意义 |
| **Social** | 关系与社交图语义 |
| **Economy** | 价值、交换、经济状态 |
| **Transit** | 跨世界 / 跨上下文移动 |
| **Context** | 共享的情境含义 |
| **Presence** | 谁/什么在场，以什么条件在场 |

这些基础协议有意做得抽象。Timeflow 不会规定"一小时等于六十分钟"，它规定的是当一个世界的时钟需要被另一个世界或面板理解时，"推进"以什么方式被表达。

## 为什么协议要走在功能前面

没有协议，每个功能都会变成局部的。一个世界说一件事，桌面端面板暗示另一件事，Agent 按第三件事行动。平台协议给"共享语义"一个家，没有任何单独的功能可以悄悄重新定义它，从而防止漂移。

这条原则有一个实际后果：新的产品功能如果触及跨世界含义，必须**走协议**，不能绕过。一个自己发明社交图的功能不是功能扩展 — 它就是一个并行权威。

## 阅读场景：两个世界识别同一份友谊

设想 Alice 和 Bob 在 World A 里是朋友。Bob 也访问了 World B。Social 基础协议说明这份友谊跨世界时如何被表达：

1. 友谊有一种两个世界都能读的表示。
2. World B 可以应用自己的本地社交规则。也许在 World B 里"朋友"只代表聊天权限，而 World A 的友谊带经济特权。
3. World A 关于这份友谊的真相**不会**因为 Bob 访问了 World B 就被反向修改；如果有什么变了，那必须在各自世界的权威下记录。

Social 基础协议不会强迫每个世界用同一种方式建模友谊。它强迫世界把友谊表达在一个其他世界能正确读懂的合同面上。

## 协议和 Realm 的关系

协议是跨世界含义的合同面，Realm 是世界真相实际居住的地方。两者相关但不同：

- 协议是语言。
- Realm 是用这种语言表达出来的、持久存在的含义。

当一个世界推进状态，变化锚定在 Realm。当变化要被另一个面板看到时，基础协议是它被表达出来的方式。

## 阅读场景：一个工作流触及多个基础协议

设想一个世界举办一个小集市活动。活动期间：

- **Timeflow** 把活动状态从"已排期"推进到"进行中"再到"结束"。
- **Presence** 说明哪些 Agent 和用户当前在活动空间里。
- **Social** 记录两个参与者在活动期间形成了一条新连接。
- **Economy** 记录某个参与者购买了一件物品。
- **Transit** 决定活动结束后参与者如何离开去往另一个世界。
- **Context** 让面板在活动进行时共享情境含义 — 这样一个 Agent 参与者不必把每个其他基础协议都重新读一遍才知道现在发生了什么。

单独看，六个基础协议听起来抽象。在一个正常的世界流程里，它们一起出场。

## 来源

- [`.nimi/spec/platform/protocol.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/protocol.md)
- [`.nimi/spec/platform/kernel/protocol-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/protocol-contract.md)
- [`.nimi/spec/platform/kernel/tables/protocol-primitives.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/tables/protocol-primitives.yaml)
- [`.nimi/spec/platform/kernel/tables/protocol-error-codes.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/tables/protocol-error-codes.yaml)
