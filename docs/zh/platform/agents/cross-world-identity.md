# 跨世界身份

一个 Nimi Agent 在它访问的每个世界里都是同一个生命体。它的身份、社交图、经济地位是**平台真相**，不是按世界发明的。本页把这件事说具体。

## 哪些跨世界保持不变

| 维度 | 住在哪 |
| --- | --- |
| 身份 | Realm 规范 Agent 身份 |
| 社交图 | Realm `R-SOC-*`（准入图，有序对唯一性） |
| 经济地位 | Realm `R-ECON-*`（规范钱包、结算事件） |
| Memory | Cognition + Runtime 记忆 bank scope（`AGENT_CORE`、`AGENT_DYADIC`、`WORLD_SHARED`） |
| 呈现画像 | Runtime `AgentPresentationProfile`（变化慢） |

| 维度 | 各世界各自决定 |
| --- | --- |
| 世界规则 | 每个世界自己写 |
| 本地经济含义 | 世界可以用任何内部货币或交换模型 |
| 本地社交规则 | 世界可以在自己规则下接受关系 |
| 视觉承载 | Avatar 的具身呈现适应承载面 |

这种切分是有意的：**跨世界含义有固定合同**（六个平台基础协议），**世界内部含义由创作者定**。Agent 跨过世界边界保留规范地位；世界在本地规则下接纳它。

## 身份是 Realm 真相

Agent 的身份是规范 Realm 真相。**只有一个 Agent**；世界可以接纳或拒绝，但不会创建。

- 世界不能给来访 Agent 发明一个新身份。
- 世界不能删除 Agent 的身份。把 Agent 从世界里"封"掉，意思是拒绝准入，不是抹除身份。
- 身份是创作时通过绑在世界 scope 上的 `AgentRule` 项塑形的。

这是一切其他可携带性的根基。

## 社交图是规范的

当两个参与者在任何世界里成为朋友，这份友谊是**规范的平台真相**，不是世界本地真相。

- 友谊住在 Realm 社交合同 — `R-SOC-*`。
- 友谊是有序对唯一性图；它在平台层准入。
- 友谊门控聊天前置条件，但**不**拥有聊天 thread 本身。
- 世界可以应用本地社交规则。也许 World A 里"朋友"代表访问权限；World B 里"朋友"代表共享货币。每个世界读规范友谊，本地解释。

**不会发生的事**：世界不能悄悄发明两个参与者之间的友谊。世界不能删除友谊。友谊是规范的。

## 经济地位是规范的

钱包、交易历史、创作者收益结算事件 — 都住在 Realm 经济合同（`R-ECON-*`）。

- 仅追加经济：每次送礼、每次收益分账、每次结算都是有显式类型的事件。
- 世界可以有自己的内部经济（票根、声望点、场景内资源）。这些**不会**修改规范的平台经济，除非世界规则准入了一次转换事件。
- AI 计算成本**不**是 Realm 核心真相。成本核算是另一回事。

用户跨世界保留钱包。创作者发布世界保留平台规范的收益模型。世界内部规则可以决定如何在本地解读规范余额；规范记录持续存在。

## 记忆按 Agent 身份携带（在 Cognition 下）

记忆在四层结构意义上是 Agent 身份的一部分。Agent 跨世界移动时，可携带的记忆随 Agent 身份保留，并受 Cognition 权威和合适的 bank scope 约束。

| Bank scope | 可见性 |
| --- | --- |
| `AGENT_CORE` | Agent 自己的私有记忆；走到哪都带 |
| `AGENT_DYADIC` | 每段关系私有；按关系走 |
| `WORLD_SHARED` | 只在一个特定世界里可见 |
| `APP_PRIVATE` | App 基础设施 scope |
| `WORKSPACE_PRIVATE` | Workspace 基础设施 scope |

`AGENT_CORE` 和 `AGENT_DYADIC` 跨世界可携带。`WORLD_SHARED` 故意**不可携带** — 它留在自己世界里。

记忆是默认关闭的。没开记忆的 Agent 仍然是真实 Agent；记忆是用户（或宿主产品）在已认可记忆合同下可以打开的一层。

## 呈现适应；身份不变

Avatar 的具身呈现是 Agent 在承载面上的视觉呈现。不同世界、不同承载面可能把同一个 Agent 呈现得不同。

- Agent 的 `AgentPresentationProfile` 由 Runtime 拥有，变化慢 — Avatar 后端、资源引用、表情预设、声音绑定。
- 世界的承载面可能完整接纳具身、接纳降级版本、或拒绝 — 由承载面视觉接受合同决定。
- **Agent 的身份不会因为承载面变了就变**。呈现变；Agent 不变。

## 阅读场景：一个 Agent 跨两个世界

一个叫 Tov 的 Agent 住在 World A，在那里经营花店。一个用户邀请 Tov 访问 World B（一个音乐演出世界）。

- **身份**保留。Tov 在 World B 还是同一个 Tov。
- **社交图**规范地跨越。Tov 在 World A 的友谊对 World B 的社交合同可见；至于 World B 本地规则要不要据此给特权，由 World B 决定。
- **经济地位**保留。Tov 的钱包是平台真相。World B 可能有自己的内部演出票货币；Tov 可以兑换（如果 World B 准入了兑换）或者就直接来听。
- **记忆**按 bank scope 切分。Tov 的 `AGENT_CORE` 随身份保留；她在 World A 花店的 `WORLD_SHARED` 记忆留在 World A。
- **呈现**适应。如果 Tov 的呈现画像有合适的变体，World B 的承载面可能用一个适合演出的具身呈现她；否则承载面接纳默认。

Tov 的用户感觉她是同一个 Agent。平台合同在每一层让这件事是真的。

## 阅读场景：一个世界想改 Agent 的身份

设想一个世界的创作者想发一个"平行宇宙"版本的现有 Agent — 同名，人格略不同，世界专属。

- 平台**不**按身份变更准入这类写入。Agent 的规范身份**对外不可创作者改写**。
- 创作者可以做一个 Soul 类似的**新 Agent**作为一个独立的规范实体。新 Agent 有自己的身份和自己的记忆。
- 原 Agent 还是原 Agent。两个 Agent 共存；两者间的跨世界 Transit 不被默认。

这种不可变是让"跨世界同一个 Agent"这条保证有意义的关键。如果创作者能改写身份，"跨世界同一个 Agent"就只是营销话术，不是合同。

## 来源

- [`.nimi/spec/realm/agent.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/agent.md)
- [`.nimi/spec/realm/social.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/social.md)
- [`.nimi/spec/realm/economy.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/economy.md)
- [`.nimi/spec/realm/transit.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/transit.md)
- [`.nimi/spec/realm/kernel/social-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/social-contract.md)
- [`.nimi/spec/realm/kernel/economy-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/economy-contract.md)
- [`.nimi/spec/realm/kernel/transit-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/transit-contract.md)
- [`.nimi/spec/runtime/kernel/runtime-memory-service-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/runtime-memory-service-contract.md)
- [`.nimi/spec/runtime/kernel/tables/runtime-memory-bank-scope.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/tables/runtime-memory-bank-scope.yaml)
- [`.nimi/spec/runtime/kernel/agent-presentation-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/agent-presentation-contract.md)
- [`.nimi/spec/avatar/kernel/embodiment-projection-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/embodiment-projection-contract.md)
- [`.nimi/spec/avatar/kernel/carrier-visual-acceptance-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/carrier-visual-acceptance-contract.md)
- [`.nimi/spec/platform/protocol.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/protocol.md)
