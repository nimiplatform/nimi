# SDK Boundary Contract

> Owner Domain: `S-BOUNDARY-*`

## S-BOUNDARY-001 子路径导入边界

各 SDK 子路径禁止跨域私有实现导入，所有跨域依赖必须通过公开导出面完成。
`S-BOUNDARY-001` 是所有 surface 的基线规则，可与特化规则叠加绑定。

## S-BOUNDARY-002 Runtime/Realm 边界

SDK 内部禁止将 runtime transport 与 realm REST client 混合为单一私有入口；必须维持显式边界。

## S-BOUNDARY-004 SDK Root Entry Contract

SDK 根入口必须固定为 owner-approved vNext composition surface：

- `createNimiClient`
- `NimiClient`
- `NimiClientConfig`

禁止出现 retired platform-client / singleton 入口：

- 全局 `OpenAPI.BASE` / `OpenAPI.TOKEN` 赋值
- `createPlatformClient`
- `createLocalFirstPartyRuntimePlatformClient`
- `getPlatformClient`
- `clearPlatformClient`

执行命令：

- `pnpm check:sdk-root-entry-contract`
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

## S-BOUNDARY-007 Agent Lifecycle Chat vs App AI Session Loop

Boundary reviews must distinguish Runtime Agent lifecycle chat from ordinary app
AI session loops.

Runtime Agent lifecycle chat is not a generic SDK client loop. It belongs to
Runtime when the behavior depends on any of:

- agent lifecycle, identity, state, autonomy, hooks, or presentation posture
- Runtime-owned `ConversationAnchor`
- Runtime Agent memory policy or canonical memory admission
- Runtime Agent turn planning, action existence, APML / message-action
  validation, voice/media workflow execution, or agent event emission
- `runtime.agent` app-message seam or `RuntimeAgentService` projection truth

Ordinary app AI session loops are not Runtime-owned merely because they use an
LLM, stream tokens, keep conversation history, call tools, or expose a chat UI.
They may use SDK DX primitives under `S-SURFACE-020` and Runtime AI consume
surfaces, while the durable product session truth remains with the app or Realm
unless a separate Runtime / Cognition / Platform authority rule admits it.

SDK helpers must therefore be rejected only when they become a hidden authority,
not when they coordinate an ephemeral AI turn. Conversely, Runtime placement
must be rejected for ordinary product chat history unless the session is tied to
Runtime Agent lifecycle or another explicit Runtime authority domain.

Runtime Agent lifecycle chat may still have SDK developer-experience helpers
over public Runtime Agent surfaces. Under `S-SURFACE-021`, SDK can own
request-id correlation, public consume-event stream assembly, abort-to-interrupt
wiring, and terminal snapshot recovery as non-authoritative client
orchestration. Those helpers are allowed only because Runtime remains the
authority for agent execution, memory policy, turn planning, terminal evidence,
and app-message projection truth.

Runtime scenario jobs may also have SDK developer-experience helpers over public
Runtime job surfaces. Under `S-SURFACE-022`, SDK can own
submit/subscribe/get/getArtifacts consumer orchestration for `runtime.media`
jobs, low-level submit/get/cancel/artifact consumer orchestration for
`runtime.ai` scenario jobs used by SDK provider/framework adapters, fallback
polling when a public job stream ends before terminal evidence, abort-to-cancel
wiring, and typed fixture transports. Those helpers are allowed only because
Runtime remains the authority for scenario job lifecycle, provider/model
routing, execution, readiness, artifacts, reason codes, audit, and fail-closed
enforcement. SDK must fail closed unless Runtime reports `COMPLETED` before
artifacts are treated as a successful scenario result.
