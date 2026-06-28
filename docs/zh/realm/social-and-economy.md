# 社交与经济

社交和经济是 Realm 里两条规范表面：一条记"谁和谁有关系"，一条记"价值怎么流动"。两者在权威层都是 append-only 的，都是平台真相。

## 社交

朋友关系是规范的准入图。一对有序对的唯一性：Alice 和 Bob 之间只有一条朋友关系，规范化记录。

| 属性 | 值 |
| --- | --- |
| 存储 | Realm `R-SOC-*` |
| 形状 | 有序对唯一性图 |
| 跨世界可见 | 是；同一条关系出现在所有世界 |
| 跨应用可见 | 是；同一条关系出现在所有 Nimi 应用 |
| 变更 | 通过准入的 Realm 契约 |

### 社交做什么

- 记录朋友关系和准入图。
- 把人类聊天的前置条件交给社交：私聊可能要求双方处于已准入的社交状态。
- **不**持有 thread 本身；thread 归 Realm Chat。

### 朋友关系为什么是规范层

如果朋友关系是按应用或按世界存储的，两个应用之间会对"这两个人是不是朋友"产生分歧。然后就要做同步、同步会冲突、用户体验会撕裂。

规范化的朋友关系给整个平台一个真相。应用读，Realm 是权威。

## 经济

平台规范经济是 **append-only** 的：每一份礼物、每一次分成、每一条结算都是带显式类型的强类型事件。

| 属性 | 值 |
| --- | --- |
| 存储 | Realm `R-ECON-*` |
| 形状 | append-only 事件流 |
| 事件类型 | 显式声明；在 kernel 层准入 |
| 结算 | 强类型事件 |
| AI 算力成本 | 不归 Realm 核心真相（另外的关注点） |

### 经济持有

- 参与者之间的 gift。
- 创作者内容的收入分成。
- 结算事件。
- 钱包余额的派生视图。

### 经济不持有

- AI 算力成本（runtime 侧的关注点）。
- 世界内部货币（一个世界可以有自己的票据；那不是平台规范经济）。
- 订阅 / 支付处理器的内部细节（在它们各自的准入面上）。

### Append-only 姿态

经济流在权威层是 append-only 的。一条错误的结算事件不会被删除，而是由一条 correction 事件取代。整条链都可以重建。

经济正确性因此可审计。一个想知道收入到底怎么结算的创作者，可以从头到尾读这条事件流，没有歧义。

## 场景：跨世界的朋友关系

Alice 和 Bob 都在世界 A 里游玩，在那里成了朋友。

1. **好友请求**。Alice 发送请求；Realm 准入。
2. **Bob 接受**。Realm 准入；`R-SOC-*` 里写入一条有序对记录。
3. **处处可见**。Alice 进入世界 B 时，朋友关系仍然可见。世界 B 自己的本地社交规则可以叠加（比如"朋友"在世界 B 享有不同特权），但底层的规范朋友关系是同一条记录。
4. **跨应用**。任何读取社交状态的 Nimi 应用看到的是同一条朋友关系。

新启动的应用不需要重新准入这条朋友关系。

## 场景：礼物结算

某用户向某创作者的内容送礼；收入结算给创作者。

1. **Gift 事件**。发送方送礼；强类型事件入账到经济流。
2. **结算事件**。按 `R-ECON-*` 的分成方案，结算事件入账。
3. **钱包余额更新**。发送方余额减少，创作者余额增加。两侧派生视图都源自规范事件流。
4. **审计链路**。发送方、收件方、gift 事件 id、结算事件 id、分成方案 id 全部串联。
5. **提现**。创作者按准入的提现流程取出资金。

整条 gift 链可以端到端重建，没有任何环节是无声发生的。

## 场景：带内部货币的世界

某创作者的世界用票据做内部交易。

1. **世界内部票据**。这个世界的规则定义了票据的语义，是本地经济、本地规则。
2. **不属于 Realm 规范层**。票据是世界本地数据，不出现在 `R-ECON-*` 事件流里。
3. **若准入兑换则可入账**。如果该世界准入了票据与平台货币之间的兑换事件，那条兑换会作为强类型规范经济事件入账。
4. **跨世界标准不变**。世界 A 里的票据不会影响 Bob 在规范层的钱包余额，除非有一条准入的兑换事件。

这条划分是有意为之。世界拥有自己的内部经济创造空间；平台规范经济保持为一份可审计真相。

## 社交与经济的连接

有些事件同时触发两侧：

| 事件 | 触及范围 |
| --- | --- |
| 送礼 | 经济事件 + 可能加深社交关系 |
| 成为朋友 | 社交事件；可能解锁需要社交前置的经济能力 |
| 群组活动 | 可能既改变社交状态也产生经济事件 |

当事件同时触及两侧时，平台不会把它们合并成一条记录。每一侧拿到自己的强类型事件；整条链通过审计连接。

## 来源依据

- [`.nimi/spec/realm/README.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/README.md)
- [`.nimi/spec/realm/external-realm.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/external-realm.md)
- [`.nimi/spec/sdks/kernel/realm-api-consumer-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/realm-api-consumer-contract.md)
- [`.nimi/spec/sdks/kernel/realm-core-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/realm-core-contract.md)
- [`.nimi/spec/sdks/kernel/realm-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/realm-contract.md)
