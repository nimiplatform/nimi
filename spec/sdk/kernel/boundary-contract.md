# SDK Boundary Contract

> Owner Domain: `S-BOUNDARY-*`

## S-BOUNDARY-001 子路径导入边界

各 SDK 子路径禁止跨域私有实现导入，所有跨域依赖必须通过公开导出面完成。
`S-BOUNDARY-001` 是所有 surface 的基线规则，可与特化规则叠加绑定。

## S-BOUNDARY-002 Runtime/Realm 边界

SDK 内部禁止将 runtime transport 与 realm REST client 混合为单一私有入口；必须维持显式边界。

## S-BOUNDARY-003 Mod 边界

Mod SDK 不得绕过 host 注入直接访问 runtime/realm 私有客户端。

## S-BOUNDARY-004 禁止旧入口

禁止出现：

- `createNimiClient`
- 全局 `OpenAPI.BASE` / `OpenAPI.TOKEN` 赋值

执行命令：

- `pnpm check:no-create-nimi-client`
- `pnpm check:no-global-openapi-config`

## S-BOUNDARY-005 Renderer-Agnostic Mod Boundary

公开的 mod-facing shell 生命周期与导航能力必须保持 container-agnostic。

允许成为稳定公开 contract 的仅限：

- 声明式注册（例如 `ui.register(...)`）
- host 注入的 runtime / hook / logging / i18n / settings facade
- host 注入的 `mod/shell` facade
- host 注入的 `tabId`-scoped route lifecycle facade

不得成为稳定公开 contract 的包括：

- shared React tree 注入能力
- shared host store selector 能力
- shared host context 直读能力
- shared DOM / document / CSS cascade 假设

这些能力如在当前 host 实现中存在，只能视为 internal implementation detail，不得承诺给第三方 mod。

## S-BOUNDARY-006 Route Lifecycle Scope

公开的 mod lifecycle 语义固定为 route runtime lifecycle：

- 作用域是 `tabId`
- 状态集合是 `active | background-throttled | frozen | discarded`
- 语义独立于 mod package lifecycle

任何以 `modId` 聚合 route lifecycle 的实现都不得直接发布为稳定公开 surface。
