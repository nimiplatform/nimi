# Notification Domain Spec

> Normative Imports: `spec/desktop/kernel/*`
> Status: Draft
> Date: 2026-03-01

## Scope

通知功能域 — 通知列表、未读计数、已读标记。

## Module Map

- `features/notification/` — 通知面板
- `runtime/data-sync/flows/notification-flow.ts` — 通知数据流

## Kernel References

### DataSync (D-DSYNC-009)

通知数据流（方法清单见 `D-DSYNC-009`）。未读计数通过 PollingManager 定期轮询。

### State (D-STATE-004)

- `activeTab = 'notification'` 时渲染通知面板。
- 未读计数在导航栏显示 badge。

## CI 门禁引用

本域涉及的 CI 门禁：`pnpm check:desktop-spec-kernel-consistency`。
