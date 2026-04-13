# Home Domain Spec

> Normative Imports: `.nimi/spec/desktop/kernel/*`

## Scope

首页/时间线功能域 — Home tab 展示社交 feed、快捷入口、推荐内容。

## Module Map

- `features/home/` — 首页面板
- `runtime/data-sync/flows/feed-flow.ts` — Feed 数据流

## Kernel References

### UI Shell (D-SHELL-015, D-SHELL-022)

`home` 目前属于 desktop design secondary consumer。root shell、compose entry 与浮动 primary action 应优先复用 renderer-level surface/action primitives，不得继续在 feature 内复制 shared button/shell 常量；任何纳入治理的 `home` surface 必须显式登记在 `tables/renderer-design-surfaces.yaml`。

### DataSync (D-DSYNC-007)

Feed 数据流（方法清单见 `D-DSYNC-007`）。

### State (D-STATE-004)

- `activeTab = 'home'` 时渲染 Home 面板。

Feed 数据独立于 bootstrap 初始数据加载，在 Home 面板挂载后按需请求。

## CI 门禁引用

本域涉及的 CI 门禁：`pnpm check:desktop-spec-kernel-consistency`。
