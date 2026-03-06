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
