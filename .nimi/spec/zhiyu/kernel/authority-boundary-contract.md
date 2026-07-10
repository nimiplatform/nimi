# Zhiyu Authority Boundary Contract

## Z-AUTH-001 Upstream Consumption

Zhiyu consumes admitted upstream public surfaces from Platform, Runtime, SDK,
Kit, Desktop, Realm, Cognition, and Avatar. It must not create parallel truth
for upstream-owned concepts.

## Z-AUTH-002 Binding-Only First-Party Consumer

Zhiyu is a binding-only first-party consumer for Runtime Agent turn surfaces.
Runtime Agent turn read/write authority comes from Runtime-issued scoped
binding, including `runtime.agent.turn.read` and `runtime.agent.turn.write`, not
from Platform registry permission scopes.

If a Runtime/SDK-authority-admitted first-party Electron host equivalence is
later used for Zhiyu Runtime Agent consumption, this consumer-mode classification
must be updated in this file and backed by Runtime/SDK authority evidence. Zhiyu
must not use a Zhiyu-local spec clause, account session, subject user id, or
Platform registry scope as a substitute for `K-AGCORE-052`.

## Z-AUTH-003 Registry Scope Interpretation

`account.session.read`, `data.scope.read#realm.worlds.read-probe`,
`agent.identity.project`, `text.generate`,
`ai_profile.selection.consume`, `ai.spend.meter`, `memory.*`,
`notification.subscribe`, and `audit.read.scoped` must be interpreted through
`tables/registry-scope-posture.yaml`. None of these scopes grants Zhiyu turn
execution, provider routing, memory truth, or local agent identity truth.

## Z-AUTH-004 Forbidden Local Ownership

Zhiyu must not own:

- partner/persona creation or profile truth
- Runtime Agent lifecycle, turns, prompt assembly, tools, queue, or session truth
- Runtime AI config truth, provider execution, routing, API key custody, or spend truth
- memory truth or direct memory writes
- Avatar resource/config truth, carrier lifecycle, or rendering truth
- voice route, audio artifact truth, playback/lipsync truth
- image generation route, provider/model truth, retry semantics, or artifact truth

## Z-AUTH-005 App Adapter Boundary

App-local code may adapt upstream projections to Zhiyu copy, layout, failure
mapping, and diagnostics entries. It must not become a second Runtime Agent
turn module, stream reducer, snapshot replay engine, memory writer, config
store, provider router, or Avatar resource owner.

A thin Zhiyu adapter is limited to app id, product copy, scope selection,
layout placement, fail-closed reason projection, and diagnostics presentation.
`apps/zhiyu/src/shell/agent-chat/**` is admitted only as a temporary hardcut
presentation boundary for Desktop Agent Chat parity. It remains subject to
post-acceptance SDK/Kit upstream or deletion review and must not become a
parallel Runtime/SDK/Kit authority surface.

## Z-AUTH-006 Runtime AI Consumption Projection Posture

Zhiyu agent chat is a projection and edit surface of Runtime's own AI
consumption, not another app that consumes AI through Runtime. The
distinction is normative:

- Runtime executes agent turns and decides model routing against its
  committed Runtime Agent AI Config (K-AGCORE-144~150). Zhiyu displays turn
  event projections, edits the AI config through
  `runtime.agent.ai_config.*` with the scopes admitted in
  `tables/registry-scope-posture.yaml`, and projects readiness tri-state
  (`ready` / `not_configured` / `unavailable`) with typed reason copy.
- Zhiyu must not probe, warm, cache, merge, or re-derive execution bindings,
  route readiness, or capability availability from `AIConfig` overlays,
  route projections, or app-local state. Readiness truth arrives only as the
  Runtime Agent AI Config readiness projection.
- Zhiyu must not carry execution bindings on turn requests (K-AGCORE-147).
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
