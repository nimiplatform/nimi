# 经济

桌面端的经济面 — 钱包 — 把用户在 Realm 里规范化的经济状况读出来。币余额、交易历史、充值、订阅状态、提现、礼物系统都在这里露出。Realm `R-ECON-*` 是真相来源；桌面端是消费方。

## 钱包露出什么

| 面 | 行为 |
| --- | --- |
| 币余额 | 来自 Realm 的规范化平台余额 |
| 交易历史 | 仅追加的经济事件流 |
| 充值 | 加资金（在准入充值流程下） |
| 订阅状态 | 当前活跃订阅（如有） |
| 提现 | 提现资金（在准入提现流程下） |
| 礼物系统 | 发送 / 接收礼物 |

所有经济操作都需要一个有效 bearer token。Realm `R-ECON-003` 是收入与结算逻辑的真相来源。

## 仅追加的经济

Realm 经济是**仅追加**。每份礼物、每次收入分账、每次结算事件都是带显式类型的类型化事件。没有任何东西静默改写。

| 性质 | 值 |
| --- | --- |
| 存储 | 仅追加流 |
| 事件类型 | 显式；kernel 级准入 |
| 结算 | 类型化事件，不是自由账目 |
| 审计 | 每次变更可重建 |

这就是为什么桌面端里的"交易历史"是一份真引用、不是重建出来的视图。事件本身是规范化的。

## AI 算力成本不是 Realm 真相

一个不显然的设计选择：AI 算力成本**不**进 Realm 核心真相的建模。成本核算是跟规范化经济独立的关注点。

规范化经济关心平台级价值：礼物、收入结算、创作者经济事件。AI 算力成本是 Runtime 层关注，自有核算。两者**不**塌缩到一本 ledger 里。

## 阅读场景：发礼物

你想给好友发礼物。

1. **打开钱包。** 你看到规范化余额。
2. **构造礼物。** 桌面端向 Realm 提交类型化礼物事件 — 发送方、接收方、物品、金额。
3. **Realm 准入。** 经济合同校验：发送方余额够、接收方被准入、礼物事件类型正确。
4. **追加。** 礼物事件追加到经济流。
5. **结算。** 按 `R-ECON-*` 记结算。
6. **审计 lineage。** 发送方、接收方、礼物事件 id、结算记录 — 全部串联。

礼物是一次真实的经济事件，不是 UI 手势。它端到端可审计。

## 阅读场景：创作者收到收入结算

某个世界创作者的世界从礼物与购买产生收入。

1. **事件累积。** 每次礼物 / 购买作为类型化经济事件追加。
2. **分账方案。** 创作者的分账方案在 `R-ECON-*` 下准入。
3. **结算事件。** 到结算时，结算事件被追加；创作者的钱包余额更新。
4. **提现。** 创作者在准入提现流程下提现。
5. **审计。** 链上每个事件都可重建 — 礼物 → 结算 → 提现。

想知道「这笔收入从哪来」的创作者能通过类型化事件流回答。

## 钱包**不**显示什么

| 关注 | 为什么不 |
| --- | --- |
| 别人余额 | 每个用户的私有 |
| AI 算力成本细节 | Runtime 层独立关注 |
| 世界内部货币 | 世界创作者可以跑自己的内部货币；那些不是平台规范化货币 |

## 来源

- [`.nimi/spec/desktop/economy.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/economy.md)
- [`.nimi/spec/realm/economy.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/economy.md)
- [`.nimi/spec/realm/kernel/economy-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/economy-contract.md)
- [`.nimi/spec/realm/kernel/tables/economy-contract.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/tables/economy-contract.yaml)
- [`.nimi/spec/realm/world-creator-economy.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/world-creator-economy.md)
- [`.nimi/spec/realm/creator-revenue-policy.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/creator-revenue-policy.md)
