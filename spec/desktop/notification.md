# Notification Domain Spec

> Normative Imports: `spec/desktop/kernel/*`

## Scope

通知功能域 — 通知列表、未读计数、已读标记。

## Module Map

- `features/notification/` — 通知面板
- `runtime/data-sync/flows/notification-flow.ts` — 通知数据流

## Kernel References

### UI Shell (D-SHELL-015, D-SHELL-018, D-SHELL-022)

`notification` 目前属于 desktop design secondary consumer。root shell、filter/action controls 与 reject-gift dialog 应通过 shared surface/action/overlay primitives 收敛；在升级为 baseline anchor 之前，仍受 secondary adoption 跟踪。已纳入治理的 overlay consumer 必须显式登记在 `tables/renderer-design-overlays.yaml`。

### DataSync (D-DSYNC-009)

通知数据流（方法清单见 `D-DSYNC-009`）。未读计数通过 PollingManager 定期轮询。

### State (D-STATE-004)

- `activeTab = 'notification'` 时渲染通知面板。
- 未读计数在导航栏显示 badge。

## CI 门禁引用

本域涉及的 CI 门禁：`pnpm check:desktop-spec-kernel-consistency`。
