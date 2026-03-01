# World Detail Domain Spec

> Normative Imports: `spec/desktop/kernel/*`
> Status: Draft
> Date: 2026-03-01

## Scope

World 详情功能域 — World 详情页、语义数据、穿越管理、关卡审计。

## Module Map

- `features/world-detail/` — World 详情面板
- `runtime/data-sync/flows/world-flow.ts` — World 数据流
- `runtime/data-sync/flows/transit-flow.ts` — Transit 数据流

## Kernel References

### DataSync (D-DSYNC-005)

世界数据流（方法清单见 `D-DSYNC-005`）。

### DataSync (D-DSYNC-012)

穿越数据流（方法清单见 `D-DSYNC-012`）。

### State (D-STATE-004)

- `activeTab = 'world-detail'` 时渲染 World 详情面板。
- 从 Explore 导航到 World 详情：`navigateToWorld(worldId)`。

## CI 门禁引用

本域涉及的 CI 门禁：`pnpm check:desktop-spec-kernel-consistency`。
