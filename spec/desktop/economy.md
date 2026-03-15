# Economy Domain Spec

> Normative Imports: `spec/desktop/kernel/*`

## Scope

经济系统功能域 — 货币余额、交易历史、充值、订阅状态、提现、礼物系统。

## Module Map

- `features/economy/` — 经济系统 UI（礼物发送弹窗等）
- `features/settings/panels/advanced-panel.tsx` — Wallet 页面（余额、充值、提现、流水）
- `runtime/data-sync/flows/economy-notification-flow.ts` — 经济数据流

## UI 交互

### 余额与交易

- 货币余额展示：Spark（消费币）和 Gem（创作者收益币）双币种。
- 交易历史：分币种查看（`loadSparkTransactionHistory` / `loadGemTransactionHistory`），支持分页加载。

### 订阅

- 订阅状态查询：`loadSubscriptionStatus` 获取当前订阅计划与到期时间。

### 充值

- 套餐查询：`loadSparkPackages` 获取 Spark 充值套餐。
- 发起充值：`createSparkCheckout` 创建 Spark Checkout 会话并跳转收银台。
- 回跳处理：Wallet 页面消费 `wallet_checkout` 回跳参数并刷新余额/流水。

### 提现

- 提现资格检查：`loadWithdrawalEligibility` 判断是否满足提现条件。
- 提现历史：`loadWithdrawalHistory` 查看历史提现记录。
- 发起提现：`createWithdrawal` 创建提现请求。

### 礼物

- 礼物目录：`loadGiftCatalog` 加载可用礼物列表。
- 礼物收件箱：`loadReceivedGifts` 加载收到的礼物交易列表，并进入 gift inbox/detail 路由查看详情。
- 非规范语义摘要：发送方按礼物目录 `sparkCost` 支付 Spark，接收方在 `acceptGift` 后获得 Gem；权威规则见 `spec/realm/kernel/economy-contract.md` `R-ECON-011`。
- 发送礼物：`sendGift` 通过 `send-gift-modal.tsx` 弹窗完成。
- 接收礼物：`acceptGift` 接受并入账 / `rejectGift` 拒绝并退款。
- 已接受礼物：在 gift inbox 详情中跳转到 Wallet，继续使用 `createWithdrawal` 发起 Gem 提现。
- 礼物评价：`createGiftReview` 对已收礼物进行评价。

## Kernel References

### DataSync (D-DSYNC-006)

经济数据流（方法清单见 `D-DSYNC-006`）。

### Security (D-SEC-002)

经济操作属于敏感域，所有请求需有效 Bearer Token。

## CI 门禁引用

本域涉及的 CI 门禁：`pnpm check:desktop-spec-kernel-consistency`。
