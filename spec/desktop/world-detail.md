# World Detail Domain Spec

> Normative Imports: `spec/desktop/kernel/*`

## Scope

World 详情功能域 — World 详情页、语义数据、穿越管理、关卡审计。

## Module Map

- `features/world-detail/` — World 详情面板
- `runtime/data-sync/flows/world-flow.ts` — World 数据流
- `runtime/data-sync/flows/transit-flow.ts` — Transit 数据流

## Kernel References

### DataSync (D-DSYNC-005)

世界数据流（方法清单见 `D-DSYNC-005`）。

### DataSync (D-DSYNC-012) — Transit 数据流

穿越数据流（方法清单见 `D-DSYNC-012`，共 8 个方法）。Transit 是 World Detail 的子域，负责穿越（传送门）相关的数据同步、查询、创建与管理。Transit 无独立 domain spec 文件，完整规则由 kernel D-DSYNC-012 定义，本节为其 domain-level 锚点。

### State (D-STATE-004)

- `activeTab = 'world-detail'` 时渲染 World 详情面板。
- 从 Explore 导航到 World 详情：`navigateToWorld(worldId)`。

## CI 门禁引用

本域涉及的 CI 门禁：`pnpm check:desktop-spec-kernel-consistency`。
