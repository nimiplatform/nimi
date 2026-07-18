# Zhiyu Authority Boundary Contract

## Z-AUTH-001 Upstream Consumption

Zhiyu consumes admitted upstream public surfaces from Platform, Runtime, SDK,
Kit, Desktop, Realm, Cognition, and Avatar. It must not create parallel truth
for upstream-owned concepts.

## Z-AUTH-002 Incubated First-Party Consumer

Zhiyu is an incubated first-party product consumer for Runtime Agent turn
surfaces. Those operations are first-party product/service authority, not public
App permissions and not manifest-declared scopes. A positive carrier must bind
an attested first-party Zhiyu principal to the exact Runtime Agent product
operation set through Runtime/SDK authority.

The current `local_development` provenance does not prove first-party identity:
another mutable project can declare the same display `app_id`. Therefore the
current source-development build MUST fail closed for Runtime Agent turn, voice,
artifact, memory, and AI-config operations until Runtime/Desktop admit an
attested first-party development carrier. Project approval, account session,
subject user id, manifest text, or Zhiyu-local spec clauses cannot substitute
for that carrier or for `K-AGCORE-052`.

## Z-AUTH-003 Permission And Entitlement Classification

Zhiyu's manifest permission list is empty. Account session posture,
app-private storage, mandatory AI metering, and Runtime-selected AI route
consumption are base entitlements or execution policy, not permissions.
Zhiyu-owned SQLite, media, settings, routes, cache, and exact native commands are
app-owned authority. Runtime Agent, Realm, Cognition, notification, external
file, and cross-app resources remain protected owner resources and fail closed
unless an exact first-party product carrier or an admitted public permission is
present. The complete classification is executable in
`tables/permission-posture.yaml`.

## Z-AUTH-004 Forbidden Local Ownership

Zhiyu must not own:

- partner/persona creation or profile truth
- Runtime Agent lifecycle, turns, prompt assembly, tools, queue, or session truth
- Runtime AI config truth, provider execution, routing, API key custody, or spend truth
- memory truth or direct memory writes
- Avatar resource/config truth, carrier lifecycle, or rendering truth
- voice route, audio artifact truth, playback/lipsync truth
- image generation route, provider/model truth, retry semantics, or artifact truth
- LocalAgent source snapshot/context composition, raw source/world data,
  prompt/lane/transcript text, private memory, packet/proof, provider payload,
  tool payload, or a `realmProfileContext`/profile-metadata prompt path

- AUTHORITY-RELATION subject=zhiyu action=assemble object=localagent-prompts value=denied polarity=forbid

## Z-AUTH-005 App Adapter Boundary

App-local code may adapt upstream projections to Zhiyu copy, layout, failure
mapping, and diagnostics entries. It must not become a second Runtime Agent
turn module, stream reducer, snapshot replay engine, memory writer, config
store, provider router, or Avatar resource owner.

A thin Zhiyu adapter is limited to app id, product copy, bounded product
selection,
layout placement, fail-closed reason projection, and diagnostics presentation.
`apps/zhiyu/src/shell/agent-chat/**` is admitted only as a temporary hardcut
presentation boundary for Desktop Agent Chat parity. It remains subject to
post-acceptance SDK/Kit upstream or deletion review and must not become a
parallel Runtime/SDK/Kit authority surface.

The adapter may consume only the closed, read-only Runtime/SDK
`LocalAgentSourceContextStatus` and `AgentTurnContextSummary` projections. It
may map ready/blocked/truncated/failed states and typed reasons to product copy,
but unknown/partial schema, enum, state, lane, or reason fails closed and never
becomes `partner_ready`. It must not expose raw diagnostics or reconstruct
source/context from hashes, refs, counts, or profile metadata.

- AUTHORITY-RELATION subject=zhiyu action=consume-status object=localagent-source value=bounded-only polarity=require
- AUTHORITY-RELATION subject=zhiyu action=consume-status object=localagent-context value=bounded-only polarity=require

## Z-AUTH-006 Runtime AI Consumption Projection Posture

Zhiyu agent chat is a projection and edit surface of Runtime's own AI
consumption, not another app that consumes AI through Runtime. The
distinction is normative:

- Runtime executes agent turns and decides model routing against its
  committed Runtime Agent AI Config (K-AGCORE-144~150). Once the exact
  first-party carrier is admitted, Zhiyu may display turn event projections,
  edit the AI config through the closed Runtime product operation set, and
  project readiness tri-state
  (`ready` / `not_configured` / `unavailable`) with typed reason copy.
- Zhiyu must not probe, warm, cache, merge, or re-derive execution bindings,
  route readiness, or capability availability from `AIConfig` overlays,
  route projections, or app-local state. Readiness truth arrives only as the
  Runtime Agent AI Config readiness projection.
- Zhiyu must not carry execution bindings on turn requests (K-AGCORE-147).
- Zhiyu must not attach source/world/profile/prompt/context, system/developer
  roles, lane order/text, memory, tool schema, or a forged context manifest to
  turn requests. Runtime composes every LocalAgent turn.
- Source/context readiness UI consumes only `LocalAgentSourceContextStatus` and
  `AgentTurnContextSummary`; hashes/counts are display/correlation fields, not
  prompt or execution inputs.
- Zhiyu product shell must not persist app-scope AIConfig, register Electron
  AIConfig stores, call direct Runtime AI consume helpers, or keep Capability
  Studio as a product runtime path. Developer harnesses, if reintroduced, must
  live outside the product shell and outside product app-level persisted
  AIConfig.

## Z-AUTH-007 Runtime Shared Auth Broker Consumption

Zhiyu consumes local account projection and Realm data through
RuntimeAccountService. Realm data calls use SDK Runtime-mediated transport and
`InvokeRealmUnary`; Zhiyu must not call `GetAccessToken`, public
`RefreshAccountSession`, login completion, logout, switch, direct Realm auth,
or `auth_session_*` shell/storage surfaces. Missing account, missing broker
grant, denied operation, or Runtime unavailable is a typed product state and
must not fall back to direct REST, local session persistence, or mock success.

Live acceptance must prove real Runtime/account/SDK connectivity, admitted
broker success, login-required and denied-grant states, no renderer-visible
credential material, no console/page errors, desktop/narrow layout, Chinese
readability, accessibility, and usable controls.
