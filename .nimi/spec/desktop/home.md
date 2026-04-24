# Home Domain Spec

> Normative Imports: `.nimi/spec/desktop/kernel/*`

## Scope

首页/时间线功能域 — Home tab 展示社交 feed、快捷入口、推荐内容。
Home 可以展示 post card 上的跨域入口，但不得在 card projection 内直接拥有
Contacts、Chat、Economy、Profile 或 Governance mutation。Home post card 必须消费
显式 action adapter / callback surface；具体读写仍由对应 DataSync flow 或 feature
owner 承担。

## Module Map

- `features/home/` — 首页面板
- `runtime/data-sync/flows/post-attachment-flow.ts` — Feed / Post 数据流

## Kernel References

### UI Shell (D-SHELL-015, D-SHELL-022)

`home` 目前属于 desktop design secondary consumer。root shell、compose entry 与浮动 primary action 应优先复用 renderer-level surface/action primitives，不得继续在 feature 内复制 shared button/shell 常量；任何纳入治理的 `home` surface 必须显式登记在 `tables/renderer-design-surfaces.yaml`。

### DataSync (D-DSYNC-007)

Feed 数据流（方法清单见 `D-DSYNC-007`）。

Home feed 读取和 post-local interaction 走 D-DSYNC-007。联系人请求、聊天开启、送礼、
资料详情弹层等跨域入口只能通过显式 owner callback/surface 注入到 Home projection，
不得在 `PostCard` projection 中直接 import DataSync facade 或跨域 modal。

### State (D-STATE-004)

- `activeTab = 'home'` 时渲染 Home 面板。

Feed 数据独立于 bootstrap 初始数据加载，在 Home 面板挂载后按需请求。

## CI 门禁引用

本域涉及的 CI 门禁：`pnpm exec nimicoding validate-spec-governance --profile nimi --scope desktop-consistency`。
