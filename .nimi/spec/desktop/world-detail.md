# World Detail Domain Spec

> Normative Imports: `.nimi/spec/desktop/kernel/*`

## Scope

World 详情功能域 — World 详情页、语义数据、穿越管理、关卡审计。

## Module Map

- `features/world/` — World 详情面板与世界列表 surface
- `runtime/data-sync/flows/world-flow.ts` — World 数据流
- `runtime/data-sync/flows/transit-flow.ts` — Transit 数据流

## Kernel References

### UI Shell (`D-SHELL-011` ~ `D-SHELL-014`, `D-SHELL-020`)

- World Detail surface 顺序、分区式确定性布局、视觉卡映射与 motion/testability 规则由 `D-SHELL-011` ~ `D-SHELL-014` 定义。
- `D-SHELL-020` 将 `world-detail` 声明为受控 art-directed exception，要求例外路径显式登记，且不得把 exception 视觉泄漏到 baseline surface。

### DataSync (D-DSYNC-005)

世界数据流（方法清单见 `D-DSYNC-005`）。

## Data Projection Boundary

World Detail 只消费 `D-DSYNC-005` 暴露的 world projection，不在本域重新定义 Realm 字段语义。字段分层与可读投影边界以 Realm truth / worldview contract 为准：`world.rules` 保持规则卡片投影，`world.lorebooks` 保持扩展知识投影，mutation 审计在 UI 上只消费列表所需的展示字段，Desktop 不把 Realm 返回内容改写成另一套本地语义。

当前 Desktop 实现已经收口到一个 bounded `WorldDisplayDetail` seam：页面不再把 `loadWorldDetailWithAgents`、`loadWorldSemanticBundle`、`loadWorldHistory`、`loadWorldLevelAudits`、`loadWorldLorebooks` 等 raw read 当作多个并列主语义来源，而是由下游 display seam 统一承接主展示 authority。

### DataSync (D-DSYNC-012) — Transit 数据流

穿越数据流（方法清单见 `D-DSYNC-012`，共 8 个方法）。Transit 是 World Detail 的子域，负责穿越（传送门）相关的数据同步、查询、创建与管理。Transit 无独立 domain spec 文件，完整规则由 kernel D-DSYNC-012 定义，本节为其 domain-level 锚点。

### State (D-STATE-004)

- `activeTab = 'world-detail'` 时渲染 World 详情面板。
- 从 Explore 导航到 World 详情：`navigateToWorld(worldId)`。

## CI 门禁引用

本域涉及的 CI 门禁：`pnpm exec nimicoding validate-spec-governance --profile nimi --scope desktop-consistency`。
