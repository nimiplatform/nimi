# Economy Domain Spec

> Normative Imports: `spec/desktop/kernel/*`
> Status: Draft
> Date: 2026-03-01

## Scope

经济系统功能域 — 货币余额、交易历史、订阅状态、提现、礼物系统。

## Module Map

- `features/economy/` — 经济系统 UI（礼物发送弹窗等）
- `runtime/data-sync/flows/economy-flow.ts` — 经济数据流

## UI 交互

### 余额与交易

- 货币余额展示：Spark（消费币）和 Gem（创作者收益币）双币种。
- 交易历史：分币种查看（`loadSparkTransactionHistory` / `loadGemTransactionHistory`），支持分页加载。

### 订阅

- 订阅状态查询：`loadSubscriptionStatus` 获取当前订阅计划与到期时间。

### 提现

- 提现资格检查：`loadWithdrawalEligibility` 判断是否满足提现条件。
- 提现历史：`loadWithdrawalHistory` 查看历史提现记录。
- 发起提现：`createWithdrawal` 创建提现请求。

### 礼物

- 礼物目录：`loadGiftCatalog` 加载可用礼物列表。
- 发送礼物：`sendGift` 通过 `send-gift-modal.tsx` 弹窗完成。
- 接收礼物：`claimGift` 领取 / `rejectGift` 拒绝。
- 礼物评价：`createGiftReview` 对已收礼物进行评价。

## Kernel References

### DataSync (D-DSYNC-006)

经济数据流（方法清单见 `D-DSYNC-006`）。

### Security (D-SEC-002)

经济操作属于敏感域，所有请求需有效 Bearer Token。

## CI 门禁引用

本域涉及的 CI 门禁：`pnpm check:desktop-spec-kernel-consistency`。
