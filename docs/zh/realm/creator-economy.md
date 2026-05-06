# 创作者经济

创作者经济是 Realm 经济里专管世界创作者货币化的那一片：来自礼物与购买的收入事件、分账方案、结算、提现。世界创作者经济与创作者收入策略把外部 open-spec 锚桥到本地经济合同上。

## 创作者经济住在哪

| 面 | 权威 |
| --- | --- |
| Realm 经济 | `R-ECON-*` — 仅追加经济事件流 |
| 世界创作者经济 | 平台经济与创作者侧概念之间的桥 |
| 创作者收入策略 | 映射分账方案、结算规则 |
| 桌面端钱包 | 投到创作者的 UI 上 |

创作者经济在 Realm 层规范化；创作者侧概念面是分账方案与收入策略附着的地方。

## 仅追加收入事件

每次收入事件都是类型化追加。

| 事件种类 | 用途 |
| --- | --- |
| 礼物 | 发送方礼物给内容 / 参与 |
| 购买 | 买方购买准入可拥有 asset |
| 结算 | 按分账方案的周期结算 |
| 提现 | 创作者提现已结算资金 |
| 修正 | 在准入修正流下替代之前事件 |

仅追加是审计基础。每次收入事件有出处、时间戳、类型化形状。结算事件引用它结算的礼物 / 购买事件。

## 分账方案

分账方案声明收入怎么在创作者与贡献者之间分。

| 性质 | 值 |
| --- | --- |
| 方案 id | 稳定身份 |
| 拥有者 | 写方案的创作者 |
| 分账 | 类型化分账分配 |
| 生效日期 | 这个方案什么时候适用 |
| 版本化 | 新分账方案替代旧的（**没**静默覆盖） |

想改分账方案的创作者发新方案；旧方案被替代但不被删。

## 桥映射

`world-creator-economy.md` 与 `creator-revenue-policy.md` 是**桥**文件。它们把外部 open-spec 锚（更广义的「创作者经济」或「收入策略」概念）映到本地 Realm 经济合同上。

| 桥 | 用途 |
| --- | --- |
| 世界创作者经济 | 创作者经济概念的域桥 |
| 创作者收入策略 | 收入策略的域桥 |

桥文件让外部心智模型可达；规范化权威留在 kernel `R-ECON-*` 规则。

## 阅读场景：创作者收到礼物收入

某用户在创作者世界里给内容送礼物；收入结算给创作者。

1. **礼物事件。** 发送方的礼物 commit 到经济事件流。发送方钱包减少。
2. **结算事件触发。** 按当前活跃分账方案，结算被调度或算出。
3. **结算事件 commit。** 分账被记下；每个创作者的钱包读视图更新。
4. **审计 lineage。** 发送方 → 礼物事件 → 结算事件 → 每个创作者的结算记录。
5. **创作者查看。** 通过桌面端钱包，创作者看到「在分账方案 Z 下，从礼物事件 Y 收到 X 的结算」。

完整链可重建。想知道「为啥我收到这么多」的创作者能沿着事件回溯。

## 阅读场景：提现

某创作者想提现已结算资金。

1. **提现请求。** 创作者在准入提现流下提交提现。
2. **Realm 校验。** 余额充足、提现目的地准入等。
3. **提现事件。** 类型化事件 commit；余额按提现额减少。
4. **外部结算。** Realm 之外，资金在准入提现机制下到创作者的外部账号。

提现事件是规范化 Realm 真相。把资金往外搬的机制是被准入的，但跟 Realm 核心真相分开。

## 阅读场景：分账方案更新

某创作者更新分账方案以加新贡献者。

1. **写新方案。** 创作者写带额外贡献者的新分账方案。
2. **发布。** Realm 准入新方案；旧方案按生效日期语义被替代。
3. **未来结算用新方案。** 从新方案生效日期起，结算按新方案分。
4. **过去结算不变。** 已结算事件用各自原分账方案；它们**不**被回头改写。
5. **审计 lineage。** 旧方案 + 新方案 + 替代事件全在规范化记录里。

分账方案是规范化的；更新它保留历史。

## 创作者经济**不**做什么

| 关注 | 为什么不 |
| --- | --- |
| AI 算力成本核算 | 独立 runtime 关注，不是 Realm 核心真相 |
| 世界内部货币 | 世界创作者可能跑自己的内部货币；那不是平台规范化 |
| 订阅处理器内部 | 住在准入订阅面，不直接在创作者经济 |

## 来源

- [`.nimi/spec/realm/world-creator-economy.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/world-creator-economy.md)
- [`.nimi/spec/realm/creator-revenue-policy.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/creator-revenue-policy.md)
- [`.nimi/spec/realm/economy.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/economy.md)
- [`.nimi/spec/realm/kernel/economy-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/economy-contract.md)
- [`.nimi/spec/realm/kernel/tables/economy-contract.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/tables/economy-contract.yaml)
