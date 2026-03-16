# World Detail Domain Spec

> Normative Imports: `spec/desktop/kernel/*`

## Scope

World 详情功能域 — World 详情页、语义数据、穿越管理、关卡审计。

## Module Map

- `features/world/` — World 详情面板与世界列表 surface
- `runtime/data-sync/flows/world-flow.ts` — World 数据流
- `runtime/data-sync/flows/transit-flow.ts` — Transit 数据流

## Kernel References

### UI Shell (`D-SHELL-011` ~ `D-SHELL-014`)

- World Detail surface 顺序、分区式确定性布局、视觉卡映射与 motion/testability 规则由 `D-SHELL-011` ~ `D-SHELL-014` 定义。

### DataSync (D-DSYNC-005)

世界数据流（方法清单见 `D-DSYNC-005`）。

## Data Responsibility

- `world.rules` 只承载基础规则卡片，字段固定为 `key / title / value`，用于 `世界如何运转` 区块。
- `world.lorebooks` 承载扩展知识、背景、细节、派生机制与补充说明，不与 `world.rules` 混用。
- `world mutations` 在技术层仍保留 `mutationType / targetPath / reason`，但 `world detail` 默认只消费 `title / summary / createdAt`。
- `desktop` 不负责把 world 内容字段翻译成人话；规则标题、维护标题与维护摘要都以 realm 返回内容为准。

### DataSync (D-DSYNC-012) — Transit 数据流

穿越数据流（方法清单见 `D-DSYNC-012`，共 8 个方法）。Transit 是 World Detail 的子域，负责穿越（传送门）相关的数据同步、查询、创建与管理。Transit 无独立 domain spec 文件，完整规则由 kernel D-DSYNC-012 定义，本节为其 domain-level 锚点。

### State (D-STATE-004)

- `activeTab = 'world-detail'` 时渲染 World 详情面板。
- 从 Explore 导航到 World 详情：`navigateToWorld(worldId)`。

## CI 门禁引用

本域涉及的 CI 门禁：`pnpm check:desktop-spec-kernel-consistency`。
