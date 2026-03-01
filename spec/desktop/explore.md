# Explore Domain Spec

> Normative Imports: `spec/desktop/kernel/*`
> Status: Draft
> Date: 2026-03-01

## Scope

发现功能域 — Explore feed、Agent 详情、World 详情、社交 feed。

## Module Map

- `features/explore/` — 发现面板
- `runtime/data-sync/flows/explore-flow.ts` — 探索数据流

## Kernel References

### DataSync (D-DSYNC-008)

探索数据流（方法清单见 `D-DSYNC-008`）。

### 跨域数据流委托

Explore 作为导航入口触发以下数据流，数据流所有权归各自 domain：
- World 数据流（`D-DSYNC-005`）— 所有权归 `world-detail`。
- Feed 数据流（`D-DSYNC-007`）— 所有权归 `home`。

### State (D-STATE-004)

- `activeTab = 'explore'` 时渲染 ExplorePanel。
- `navigateToProfile(id, 'agent-detail')` 导航到 Agent 详情。
- `navigateToWorld(worldId)` 导航到 World 详情。

## CI 门禁引用

本域涉及的 CI 门禁：`pnpm check:desktop-spec-kernel-consistency`。
