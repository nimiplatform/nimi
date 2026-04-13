# Economy Domain Spec

> Normative Imports: `.nimi/spec/desktop/kernel/*`

## Scope

经济系统功能域 — 货币余额、交易历史、充值、订阅状态、提现、礼物系统。

## Module Map

- `features/economy/` — 经济系统 UI（礼物发送弹窗等）
- `features/settings/panels/advanced-panel.tsx` — Wallet 页面（余额、充值、提现、流水）
- `runtime/data-sync/flows/economy-notification-flow.ts` — 经济数据流

## Kernel References

### DataSync (D-DSYNC-006)

经济数据流与方法清单以 `D-DSYNC-006` 为准；domain 层不再内联余额、充值、提现与礼物流的过程性 contract。

### Security (D-SEC-002)

经济操作属于敏感域，所有请求需有效 Bearer Token。

### Economy Truth (R-ECON-003)

礼物、结算与收入分配的规范语义以 Realm `R-ECON-003` 为权威；Desktop 只消费其 UI 投影。

## CI 门禁引用

本域涉及的 CI 门禁：`pnpm check:desktop-spec-kernel-consistency`。
