# 创作者收益与结算架构（Creator Payouts）

在 Nimi 的 Realm Economy 中，创作者收益体系将“来源归因、分成预览、正式账本结算、提现划拨”划分为边界清晰的阶段。订阅、币种交易与收益归因属于可审计的经济语义，与世界观内的剧情交易以及 AI 算力消耗严格分离。

> 状态说明：平台演进方向。底层追加式币种账本记录（`CurrencyTransaction`）与确定性分成预览（`RevenueShareService`）已具备基础语义；创作者提现与桌面端收益工作台属于平台方向，并非当前 Desktop 功能或公开 App API；具体结算周期与支付对接流程尚未由这一模型确定。

## 从来源归因到提现的四个阶段

理解创作者收益流转，需要区分只读计算与真实入账之间的界限：

1. **来源归因（Source Attribution）**：`RevenueShareService` 支持经鉴权的强类型 `CharacterSourceRefV3` 来源查询，明确收益对应的作品与创作者归属。
2. **确定性分成预览（Split Preview）**：在发生任何余额变动前，`RevenueShareService` 根据归因关系生成确定性的分成预览。预览仅用于计算应得比例，不会修改账号余额，也不会触发实际的收益划拨。
3. **正式账本结算（Ledger Settlement）**：预览结果不代表资金已到账。真正的余额划转必须通过另行准入、幂等且原子的账本事务完成。账号层面的币种变动以仅追加（Append-Only）的 `CurrencyTransaction` 记录入账，具体字段与事件枚举以当前 OpenAPI 与 Prisma 定义为准。
4. **提现与收益工作台（规划方向）**：创作者提现与专门的收益工作台属于平台方向；当前模型并未提供可调用的结算排期、退款流程或外部支付网关。

## 记账边界与访问权限

- **与叙事及算力费用解耦**：角色之间的虚拟物品买卖属于剧情事件，模型调用消耗属于算力计费，二者均不混入创作者收益核算。
- **追加式账本历史**：`CurrencyTransaction` 采用追加式记录，后续账务调整通过新增受控账本事务体现，而非直接篡改历史流水。
- **受控的 App 访问边界**：普通 Nimi App 仅能调用 `client.realm` 下显式准入的受保护操作，拥有 `realm.data` 并不等同于获得经济或结算接口的全量授权；凭据由 Runtime 保管，资源权限由 Realm 校验。

## 相关文档

- [创作者经济与价值流转体系](/zh/realm/creator-economy)
- [资产挂载与绑定规范](/zh/realm/asset-and-binding)

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
