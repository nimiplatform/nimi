# Companion Participation Consumer Contract

> App: `@nimiplatform/avatar`
> Owner Domain: Avatar consumer projection, downstream of Runtime `K-AGCORE-*`

This contract defines how Avatar companion/persona and Avatar debug/probe
surfaces consume Runtime Agent Participation projection. It does not create a
Runtime Participation profile and does not grant execution authority to any app
surface.

## Authority Boundary

Runtime owns participation execution semantics:

- profile validation
- prompt assembly
- provider/model routing
- memory/capability verdicts
- concurrency, budget, cancellation, and audit lineage
- output candidates and promotion posture

Avatar-owned surfaces may only:

- display typed participation projection
- display typed presentation timeline state
- expose bounded controls that call Runtime/SDK typed methods
- emit Avatar-local UI/render/debug evidence
- render refusal, blocked, pending, running, candidate, committed, or failed
  states from typed projection

Avatar-owned surfaces must not:

- assemble prompts
- call providers or models directly
- read or write memory/cognition/domain/canonical truth
- consume raw APML/debug/MCP/A2A payloads as product truth
- create private queues, schedulers, fairness budgets, cancellation budgets, or
  Runtime queue status namespaces
- commit Realm/Scenario/OASIS/domain transcripts

## Surface Kinds

Closed surface kinds are defined in
[`tables/companion-participation-surface-kinds.yaml`](tables/companion-participation-surface-kinds.yaml).

The initial admitted kinds are:

- `avatar_companion`
- `desktop_companion_panel`
- `avatar_debug_workbench`

Avatar package/persona choices, such as assistant, character, virtual singer,
or other stylized persona, are configuration and content choices inside the
Avatar product. They are not separate participation surface kinds and do not
create independent execution owners.

## Projection Model

The Avatar consumer reads `runtime.companionParticipation` through the Runtime
SDK typed module. Avatar product code must not call `runtime.agent.turns`
directly for companion participation requests or cancellation. The projection
must include:

- `projection_id`
- `agent_id`
- `surface_kind`
- `profile_ref`
- `room_orchestration_ref` when more than one participant or domain context is
  involved
- `trigger_source`
- `status`
- `candidate_ref` when Runtime has produced an output candidate
- `refusal_reason` when Runtime or room orchestration refuses admission
- `presentation_ref` when the projection is visual/presentation-only
- `audit_ref`

Avatar may cache the projection only as transient UI state. It may not promote
projection content into durable product truth.

## Avatar Implementation Binding

The Avatar shell bootstrap owns the first-party Runtime binding and exposes
only Avatar-local handle methods backed by SDK companion participation:

- text submit routes to `runtime.companionParticipation.request`
- foreground voice transcript submit routes to the same request method
- interrupt/cancel routes to `runtime.companionParticipation.cancel`

The companion surface renders Runtime/SDK projection status as UI state. It
must treat `blocked`, `failed`, and `canceled` as non-success states and must
not fall back to local text-turn execution.

## Status Semantics

Allowed status values:

- `idle`
- `admission_pending`
- `blocked`
- `running`
- `candidate_ready`
- `committed_by_owner`
- `failed`
- `canceled`

`candidate_ready` means Runtime has produced a candidate. It does not mean the
candidate has been committed to domain truth.

`committed_by_owner` may be displayed only when the domain owner or canonical
chat owner returns a typed commit projection. Avatar must not infer commit from
candidate content.

## Trigger Policy

Trigger policy is defined in
[`tables/companion-participation-trigger-policy.yaml`](tables/companion-participation-trigger-policy.yaml).

Allowed trigger sources:

- `none`
- `user_explicit`
- `scheduled_proactive`
- `domain_event`

Every non-`none` trigger must route through Runtime participation admission and,
where applicable, room/session orchestration. A trigger source never grants
prompt, provider/model, memory, cognition, queue, or commit authority.

## Domain Consumption

For Group, Scenario, OASIS/world, and external-entry contexts:

- the domain-specific profile/overlay remains the owner of domain context and
  commit handoff
- Avatar companion/persona surfaces display typed projection only
- missing domain evidence fails closed before Runtime candidate handoff
- raw domain payloads must not be passed to Avatar as prompt material

## Debug / Probe Consumption

Avatar debug/probe surfaces may show typed Runtime or Avatar evidence:

- Runtime probe ids and replay refs
- Avatar backend evidence
- refusal and remediation states
- visual carrier evidence

They must not consume raw backend bus payloads, raw APML diagnostics, delegated
provider output, app auth material, or private Runtime internals.

## Fail-Closed Rules

The surface must show a blocked/failed state when:

- projection is missing required ids
- trigger source is unknown
- surface kind is unknown
- profile ref is missing for an execution request
- room orchestration ref is missing for multi-participant/domain contexts
- Runtime refusal reason is present
- candidate ref is missing for `candidate_ready`
- commit projection is missing for `committed_by_owner`

No UI may convert these failures into a successful reply, synthetic candidate,
or local fallback execution.
