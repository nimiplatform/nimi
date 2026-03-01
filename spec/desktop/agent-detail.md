# Agent Detail Domain Spec

> Normative Imports: `spec/desktop/kernel/*`
> Status: Draft
> Date: 2026-03-01

## Scope

Agent 详情功能域 — Agent 详情页、Agent 列表、记忆管理、聊天路由。

## Module Map

- `features/agent-detail/` — Agent 详情面板
- `runtime/data-sync/flows/agent-flow.ts` — Agent 数据流

## Kernel References

### DataSync (D-DSYNC-011)

Agent 数据流（方法清单见 `D-DSYNC-011`）。

### State (D-STATE-004)

- `activeTab = 'agent-detail'` 时渲染 Agent 详情面板。
- 从 Explore 或 Chat 导航到 Agent 详情：`navigateToProfile(id, 'agent-detail')`。

### DataSync (D-DSYNC-008)

探索页的 `loadAgentDetails` 获取 Agent 公开详情，用于 Agent 详情预览。
