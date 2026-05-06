# 社交与经济

社交与经济是 Realm 的两个规范化面，分别管「谁跟谁有关」与「价值怎么流动」。两者在权威层都仅追加；两者都是平台真相。

## 社交

友情是规范化准入图。有序对唯一性 — Alice 和 Bob 之间一段友情，规范化记下。

| 性质 | 值 |
| --- | --- |
| 存储 | Realm `R-SOC-*` |
| 形状 | 有序对唯一性图 |
| 跨世界可见性 | 是 — 每个世界里都是同一段友情 |
| 跨 App 可见性 | 是 — 每个 Nimi App 里都是同一段友情 |
| 修改 | 通过准入 Realm 合同 |

### 社交做什么

- 跟踪友情与准入图。
- 门控人对人聊天前置条件 — 两个用户之间的聊天可能要求准入的社交状态。
- **不**拥有 thread 本身；thread 归 Realm 聊天拥有。

### 为什么友情规范化

如果友情是按 App 或按世界，两个 App 可能对「这两人是不是好友」意见不同。App 需要同步；同步会冲突；用户体验会破碎。

规范化友情是平台之上的同一份真相。App 读；Realm 是权威。

## 经济

平台规范化经济是**仅追加**：每份礼物、每次收入分账、每次结算事件都是带显式类型的类型化事件。

| 性质 | 值 |
| --- | --- |
| 存储 | Realm `R-ECON-*` |
| 形状 | 仅追加事件流 |
| 事件类型 | 显式；kernel 级准入 |
| 结算 | 类型化事件 |
| AI 算力成本 | **不**作为 Realm 核心真相建模（独立关注） |

### 经济拥有什么

- 参与者之间的礼物。
- 创作者内容的收入分账。
- 结算事件。
- 钱包余额读视图。

### 经济**不**拥有什么

- AI 算力成本（独立 runtime 关注）。
- 世界内部货币（世界可能有自己的票据；那不是平台规范化经济）。
- 订阅 / 支付处理器内部（住在自己的准入面）。

### 仅追加姿态

经济流在规范化层仅追加。错的结算事件**不**被删；它被一条修正事件替代。完整链可重建。

这点重要，因为经济正确性可审计。想精确知道自己收入怎么结算的创作者能端到端读事件流，没有歧义。

## 阅读场景：跨世界的友情

Alice 和 Bob 都在世界 A 里访问，他们成了好友。

1. **好友请求。** Alice 发；Realm 准入请求。
2. **Bob 接受。** Realm 准入；`R-SOC-*` 里建有序对记录。
3. **处处可见。** Alice 访问世界 B 时，跟 Bob 的友情可见。世界 B 的本地社交规则可能适用（也许「好友」在世界 B 给不同特权），但规范化友情是同一条记录。
4. **跨 App。** 任何读社交状态的 Nimi App 看到同一段友情。

新启动的 App 不需要再准入这段友情。

## 阅读场景：礼物结算

某用户给创作者内容送礼物；收入结算给创作者。

1. **礼物事件。** 发送方的礼物 commit 到经济事件流。发送方钱包减少。
2. **结算事件触发。** 按当前活跃分账方案，结算被调度或算出。
3. **结算事件 commit。** 分账被记下；每个创作者的钱包读视图更新。
4. **审计 lineage。** 发送方 → 礼物事件 → 结算事件 → 每个创作者的结算记录。
5. **创作者查看。** 通过桌面端钱包，创作者看到「在分账方案 Z 下，从礼物事件 Y 收到 X 的结算」。

完整链可重建。想知道「为啥我收到这么多」的创作者能沿着事件回溯。

## 阅读场景：带内部货币的世界

某创作者世界用票据做世界内交易。

1. **世界内票据。** 创作者世界规则描述票据语义 — 本地经济、本地规则。
2. **不是 Realm 规范化。** 票据是世界本地；它们**不**出现在 `R-ECON-*` 事件流。
3. **如准入则可换。** 如果世界准入了一个票据跟平台货币之间的兑换事件，那次兑换作为类型化规范化经济事件出现。
4. **跨世界身份不变。** 世界 A 里的票据**不**影响 Bob 的规范化钱包余额，除非有准入兑换事件记下。

切分是有意的。世界获得内部经济创造力；平台规范化经济保持一份可审计真相。

## 社交与经济怎么连接

某些事件涉及两边：

| 事件 | 触及 |
| --- | --- |
| 送礼物 | 经济事件 + 可能加强社交关系 |
| 成为好友 | 社交事件；可能解锁社交门控经济功能 |
| 群活动 | 可能涉及社交状态变化与经济事件两者 |

事件触及两边时，平台**不**把它们塌缩成一条记录。每个面拿自己的类型化事件；完整链通过审计 lineage 串联。

## 来源

- [`.nimi/spec/realm/social.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/social.md)
- [`.nimi/spec/realm/economy.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/economy.md)
- [`.nimi/spec/realm/kernel/social-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/social-contract.md)
- [`.nimi/spec/realm/kernel/economy-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/economy-contract.md)
- [`.nimi/spec/realm/kernel/tables/social-contract.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/tables/social-contract.yaml)
- [`.nimi/spec/realm/kernel/tables/economy-contract.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/tables/economy-contract.yaml)
- [`.nimi/spec/realm/world-creator-economy.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/world-creator-economy.md)
- [`.nimi/spec/realm/creator-revenue-policy.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/creator-revenue-policy.md)
