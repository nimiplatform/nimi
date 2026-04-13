# Explore Domain Spec

> Normative Imports: `.nimi/spec/desktop/kernel/*`

## Scope

发现功能域 — Explore feed、Agent 详情、World 详情、社交 feed。

## Module Map

- `features/explore/` — 发现面板
- `runtime/data-sync/flows/explore-flow.ts` — 探索数据流

## Kernel References

### UI Shell (D-SHELL-019, D-SHELL-022)

`explore` 是 desktop baseline anchor 之一。root shell、hero/banner 容器、shared action 与试点 dialog family 的 baseline design 收敛由 `D-SHELL-019` 与 `D-SHELL-022` 定义。

### DataSync (D-DSYNC-008)

探索数据流（方法清单见 `D-DSYNC-008`）。

### 跨域数据流委托

Explore 只作为导航入口触发其他 domain 已定义的数据流，不在本域补充额外委托语义。跨域读取仍直接回指各自的 authoritative DataSync 规则：World 读取遵循 `D-DSYNC-005`，Feed 读取遵循 `D-DSYNC-007`。

### State (D-STATE-004)

- `activeTab = 'explore'` 时渲染 ExplorePanel。
- `navigateToProfile(id, 'agent-detail')` 导航到 Agent 详情。
- `navigateToWorld(worldId)` 导航到 World 详情。

## CI 门禁引用

本域涉及的 CI 门禁：`pnpm exec nimicoding validate-spec-governance --profile nimi --scope desktop-consistency`。
