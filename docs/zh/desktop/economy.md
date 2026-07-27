# 经济

桌面端的经济面就是 Wallet——把用户在 Realm 的规范化经济状态呈现出来。余额、交易历史、充值、订阅、提现、礼物系统都从这里读到。Realm `R-ECON-*` 是真相来源，桌面端是消费方。

## Wallet 暴露什么

| 子面 | 行为 |
| --- | --- |
| 余额 | 来自 Realm 的平台规范化余额 |
| 交易历史 | 仅追加的经济事件流 |
| 充值 | 在准入流程下加资金 |
| 订阅状态 | 当前订阅（如有） |
| 提现 | 在准入流程下提资金 |
| 礼物系统 | 收发礼物 |

所有经济操作都需要有效的 bearer token。Realm `R-ECON-003` 是收入与结算逻辑的真相来源。

## 仅追加的经济流

Realm 经济是**仅追加**的。每一份礼物、每一次收入分润、每一次结算都是带显式类型的事件。没有任何内容会悄悄被改写。

| 维度 | 取值 |
| --- | --- |
| 存储 | 仅追加流 |
| 事件类型 | 显式，在 kernel 层准入 |
| 结算 | 强类型事件，不是自由格式账目 |
| 审计 | 任何变更都可重建 |

这是为什么桌面端的"交易历史"是真实引用，不是重新拼装的视图。事件本身就是规范态。

## AI 计算成本不是 Realm 真相

有一个设计不太直观：AI 计算成本**不**作为 Realm 的核心真相。成本核算是另一回事，与规范化经济分离。

规范化经济关心的是平台层价值：礼物、收入结算、创作者经济事件。AI 计算成本归 Runtime，自己有一套核算。两者不会合并到同一个账本。

## 场景：发一份礼物

你想给好友发一份礼物。

1. **打开 Wallet**。看到自己的规范化余额。
2. **构建礼物**。桌面端向 Realm 提交强类型礼物事件：发件人、收件人、物品、金额。
3. **Realm 准入**。经济契约校验：发件人余额够、收件人允许、礼物事件类型对。
4. **追加**。礼物事件追加进经济流。
5. **结算**。按 `R-ECON-*`，结算被记录。
6. **审计血缘**。发件人、收件人、礼物事件 id、结算记录全部联通。

礼物是真实的经济事件，不是 UI 上的一个动作，端到端可审计。

## 场景：创作者收到收入结算

世界创作者的世界从礼物与购买中产生收入。

1. **事件累积**。每次礼物 / 购买都被追加为强类型经济事件。
2. **分润计划**。创作者的分润计划在 `R-ECON-*` 下准入。
3. **结算事件**。结算时，结算事件被追加；创作者的 Wallet 余额更新。
4. **提现**。创作者按准入的提现流程提取。
5. **审计**。整条链可重建：礼物 → 结算 → 提现。

如果创作者要追问"这笔收入从哪儿来"，强类型事件流能给出回答。

## Wallet 不展示什么

| 关注点 | 原因 |
| --- | --- |
| 其他用户的余额 | 每个用户私有 |
| AI 计算成本细节 | 归 Runtime，是另一回事 |
| 世界内部货币 | 创作者可以在自己的世界里跑内部货币，但那不是平台规范态 |

## 来源依据

- [`.nimi/spec/desktop/product-surfaces.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/product-surfaces.authority.yaml)
- [`docs/spec/realm-readme.md`](https://github.com/nimiplatform/nimi/blob/main/docs/spec/realm-readme.md)
- [`docs/spec/realm-external-anchor.md`](https://github.com/nimiplatform/nimi/blob/main/docs/spec/realm-external-anchor.md)
- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
