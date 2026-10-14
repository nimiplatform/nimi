# 创作者经济与价值流转

Realm Economy 为在 Nimi 中创作角色与体验的创作者提供可审计的经济底座。它与叙事状态及 AI 算力计费相互独立，专门承载订阅、账号币种交易（`CurrencyTransaction`）以及收益归因与分成的核心语义。

关于结算与提现阶段的详细说明，请参阅[创作者收益与结算流水](/zh/realm/creator-payouts)。

## 从来源归因到提现的价值流转

为了保证账目清晰可审计，Realm 将“收益测算”与“实际入账”严格解耦。创作者价值的流转分为四个阶段，涵盖当前已落地的服务能力与未来的平台演进方向：

### 1. 来源归因（当前可用）

在分配收益之前，系统需要先确认价值来源。通过经鉴权的查询，`RevenueShareService` 会解析强类型的 `CharacterSourceRefV3` 来源引用，明确角色或作品背后的上游创作者与原始资产归属。

### 2. 确定性分成预览（当前可用）

完成归因解析后，`RevenueShareService` 支持生成确定性的收益分成预览，展示各方预计可获得的份额。预览仅作只读测算，不执行任何写入操作，也不会改变任何账号的实际余额。

### 3. 正式账本结算（账本核心）

测算出的分成比例或预览结果并不等同于资金已到账。只有经过另行准入、幂等且原子的账本事务，账本余额才会发生相应变动。结算事务提交后，Realm 会通过仅追加（append-only）的 `CurrencyTransaction` 账号币种事件记录资金变动（具体字段与事件枚举以当前 OpenAPI 与 Prisma 定义为准）。

### 4. 创作者提现与桌面工作台（平台方向）

将已结算余额提现至外部账户，以及在桌面端提供专门的创作者收益工作台，属于平台的后续演进方向，目前并非已上线的 Desktop 功能或公开 App API。自动周期结算、资金托管冻结、外部支付网关打款及自助退款冲正等能力暂不包含在当前接口中。

## 应用访问与权限边界

普通 Nimi App 仅能通过受保护且显式准入的 `client.realm` 操作访问 Realm；凭据由 Runtime 统一保管，资源权限由 Realm 校验，拥有 `realm.data` 并不代表获得经济或社交接口的全量授权。

## 相关文档

- [创作者收益与结算流水](/zh/realm/creator-payouts)
- [资产挂载与绑定规范](/zh/realm/asset-and-binding)

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
