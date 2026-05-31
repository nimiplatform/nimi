# SDK Boundary Contract

> Owner Domain: `S-BOUNDARY-*`

## S-BOUNDARY-001 子路径导入边界

各 SDK 子路径禁止跨域私有实现导入，所有跨域依赖必须通过公开导出面完成。
`S-BOUNDARY-001` 是所有 surface 的基线规则，可与特化规则叠加绑定。

## S-BOUNDARY-002 Runtime/Realm 边界

SDK 内部禁止将 runtime transport 与 realm REST client 混合为单一私有入口；必须维持显式边界。

## S-BOUNDARY-004 禁止旧入口

禁止出现：

- `createNimiClient`
- 全局 `OpenAPI.BASE` / `OpenAPI.TOKEN` 赋值

执行命令：

- `pnpm check:no-create-nimi-client`
- `pnpm check:no-global-openapi-config`

## S-BOUNDARY-005 Developer Ergonomics Is Not Truth Ownership

SDK boundary reviews must distinguish developer ergonomics from authority
ownership.

`MUST`：SDK may add helper APIs when the helper is a typed projection,
composition layer, adapter, parser, builder, stream assembler, or explicit
test/development harness over admitted public surfaces.

`MUST NOT`：SDK helper placement must not be rejected solely because the helper
performs client-side coordination. It must be rejected when it owns or infers
canonical Runtime / Realm / Cognition / Platform truth, bypasses admitted
transport, hides fail-closed states, or creates a second provider/model,
session, memory, event, or permission authority.

## S-BOUNDARY-006 Client Orchestration Promotion Rule

Client orchestration that outgrows ephemeral consumer coordination must be
promoted to the owning authority before it becomes product truth.

Promotion is required when a helper:

- persists data across process or app-session boundaries
- controls provider/model routing or fallback policy
- writes or mutates canonical memory, knowledge, agent state, app lifecycle, or
  Realm domain records
- emits events that consumers treat as Runtime / Realm / Cognition audit or
  lifecycle truth
- requires cross-app, cross-device, permissioned, or account-scoped
  enforcement

Until promoted, the helper must remain documented as non-authoritative,
ephemeral, and caller-owned. If a product needs the helper's result as durable
truth, the SDK must submit that result through an admitted typed Runtime /
Realm / Cognition operation instead of persisting it locally.
