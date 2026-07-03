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

## Z-AUTH-003 Registry Scope Interpretation

`account.session.read`, `agent.identity.project`, `text.generate`,
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
