# 跨世界身份

Nimi 的 Agent 在它访问的每个世界里都是同一个生命体。它的身份、社交图、经济地位是**平台真相**，不是各个世界各自发明的。本页把这件事讲具体。

## 跨世界保持不变的部分

| 维度 | 归属 |
| --- | --- |
| 身份 | Realm 规范化 Agent 身份 |
| 社交图 | Realm `R-SOC-*`（准入图，有序对唯一性） |
| 经济地位 | Realm `R-ECON-*`（规范化钱包、结算事件） |
| 记忆 | Cognition + Runtime 记忆库作用域（`AGENT_CORE`、`AGENT_DYADIC`、`WORLD_SHARED`） |
| 呈现资料 | Runtime `AgentPresentationProfile`（变化缓慢） |

| 维度 | 各世界各自决定 |
| --- | --- |
| 世界规则 | 每个世界自己写自己的规则 |
| 世界内经济含义 | 任意内部货币或交换模型 |
| 世界内社交规则 | 在世界自己的规则下准入关系 |
| 视觉承载 | Avatar 的具身化呈现按承载面调整 |

切分是有意为之：跨世界含义有固定契约（六条平台基础协议），世界内含义由创作者定义。Agent 越过世界边界时保持规范化地位；新世界按本地规则准入它。

## 身份是 Realm 真相

Agent 的身份是 Realm 规范态。世上只有一个 Agent；世界要么准入要么拒绝，但不能创建。

- 世界不能给来访的 Agent 发明一个新身份。
- 世界不能删除 Agent 的身份。把 Agent 从某个世界踢掉是拒绝准入，不是抹除身份。
- 创建 Agent 时，身份由创作者通过绑定到世界作用域的 `AgentRule` 条目塑形。

这是其它一切可携带的根基。

## 社交图是规范态

两位参与者在任意一个世界里成为好友，这段好友关系都是平台规范态，不是世界本地真相。

- 好友关系归 Realm 的社交契约 `R-SOC-*`。
- 形态是有序对唯一性图，在平台层准入。
- 好友关系约束聊天前置条件，但不拥有聊天线程本身。
- 世界可以应用自己的本地社交规则。比如世界 A 中"好友"代表来访权限，世界 B 中"好友"代表共享货币。每个世界读规范化的好友关系，再按本地解释。

不会发生的事：世界不能在两个参与者之间静默捏造一段好友关系，也不能删除好友关系。好友关系是规范化的。

## 经济地位是规范态

钱包、交易历史、创作者收入结算事件——都归 Realm 的经济契约 `R-ECON-*`。

- 仅追加经济流：礼物、收入分润、结算事件都是带显式类型的强类型事件。
- 世界可以有自己的内部经济（票根、声望点、场景内资源）。除非世界规则准入一次兑换事件，否则不影响平台规范化经济。
- AI 计算成本**不**作为 Realm 核心真相。成本核算是另一回事。

用户在世界之间穿梭，钱包不变。创作者发布世界，平台规范化收入模型不变。世界内规则可以决定如何在本地解释规范化余额；规范化记录持续存在。

## 记忆按 Cognition 行走

记忆是四层结构里 Agent 身份的一部分。Agent 在世界之间移动时，记忆按 Cognition 的权威与对应的库作用域一同行走。

| 库作用域 | 可见性 |
| --- | --- |
| `AGENT_CORE` | Agent 自己的私有记忆；走到哪里都带着 |
| `AGENT_DYADIC` | 按关系切的私有记忆；带着这段关系走到哪里都在 |
| `WORLD_SHARED` | 只在某一个世界里可见 |
| `APP_PRIVATE` | 应用基础设施作用域 |
| `WORKSPACE_PRIVATE` | 工作区基础设施作用域 |

`AGENT_CORE` 与 `AGENT_DYADIC` 跨世界可携带。`WORLD_SHARED` 刻意不可携带——它和它的世界绑定。

记忆是可选项。没开记忆的 Agent 也是真实 Agent；记忆是用户（或宿主产品）在已准入契约下打开的一层。

## 呈现适配，身份不变

Avatar 的具身化呈现是 Agent 在某个承载面上的视觉形态。不同世界、不同承载面可能呈现同一个 Agent 的不同样子。

- Agent 的 `AgentPresentationProfile` 由 Runtime 拥有，变化缓慢——后端、资产引用、表情预设、声音绑定。
- 世界的承载面可以接受这份具身化、接受降级版本、或拒收——交由承载视觉接受契约判定。
- Agent 的身份不会因为承载面变了而变。变的是呈现，Agent 仍是同一个。

## 场景：一个 Agent 跨两个世界

一个名叫 Tov 的 Agent 住在世界 A，开一家小花店。某用户邀请她去世界 B 参加一场音乐会。

- **身份**不变。在世界 B，Tov 还是那个 Tov。
- **社交图**规范化跨过去。Tov 在世界 A 的好友关系对世界 B 的社交契约可见；世界 B 的本地规则是否给这些好友关系赋予特权，由世界 B 决定。
- **经济地位**不变。Tov 的钱包是平台真相。世界 B 可能有自己的内部货币用于音乐会票券；Tov 可以兑换（如果世界 B 准入兑换），也可以直接参加。
- **记忆**按库作用域行走。`AGENT_CORE` 一同到场；与世界 A 花店相关的 `WORLD_SHARED` 留在世界 A。
- **呈现**适配。如果 Tov 的呈现资料里有合适的变体，世界 B 的承载面可以用音乐会风的具身化渲染她；否则承载面接受默认。

Tov 在用户眼里仍是同一个 Agent。平台契约在每一层都让这件事成立。

## 场景：某个世界想改写 Agent 身份

一个世界的创作者想发布一个"平行宇宙版本"的同名 Agent——名字一样，性格略不同，只在这个世界规范化。

- 平台不准入这种身份修改。Agent 的规范化身份不可被外部创作者修改。
- 创作者可以以相似的 Soul 创建一个新 Agent，作为独立的规范化实体。新 Agent 有自己的身份与记忆。
- 原 Agent 还是原 Agent。两者并存；它们之间不蕴含跨世界互通。

不可修改性正是跨世界身份保证有意义的关键。如果创作者能改写身份，"同一个 Agent 跨世界"就只是营销词，不是契约。

## Source Basis

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
