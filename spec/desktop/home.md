# Home Domain Spec

> Normative Imports: `spec/desktop/kernel/*`
> Status: Draft
> Date: 2026-03-01

## Scope

首页/时间线功能域 — Home tab 展示社交 feed、快捷入口、推荐内容。

## Module Map

- `features/home/` — 首页面板
- `runtime/data-sync/flows/feed-flow.ts` — Feed 数据流

## Kernel References

### DataSync (D-DSYNC-007)

Feed 数据流（方法清单见 `D-DSYNC-007`）。

### State (D-STATE-004)

- `activeTab = 'home'` 时渲染 Home 面板。

Feed 数据独立于 bootstrap 初始数据加载，在 Home 面板挂载后按需请求。
