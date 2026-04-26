# Agent Presentation Stream Contract

> Owner Domain: `K-AGCORE-*`

## K-AGCORE-036 Transient Presentation And Turn Authority Home

`RuntimeAgentService` owns transient multi-surface agent presentation and
reactive turn projection as runtime-owned committed stream truth.

This transient seam is distinct from persistent `AgentPresentationProfile`
defined in `agent-presentation-contract.md`.

It owns:

- anchor-scoped turn lifecycle and text projection
- anchor-scoped transient presentation requests
- runtime-owned current emotion projection
- stream-level commit / interrupt / failure semantics

It does not own:

- renderer-local interpolation or physics
- backend-specific motion handles or Live2D parameter writes
- app-local avatar placement and shell choreography

## K-AGCORE-037 Admitted Projection Families

The admitted runtime-owned stable projection families are:

- `runtime.agent.turn.accepted`
- `runtime.agent.turn.started`
- `runtime.agent.turn.reasoning_delta`
- `runtime.agent.turn.text_delta`
- `runtime.agent.turn.structured`
- `runtime.agent.turn.message_committed`
- `runtime.agent.turn.post_turn`
- `runtime.agent.turn.completed`
- `runtime.agent.turn.failed`
- `runtime.agent.turn.interrupted`
- `runtime.agent.turn.interrupt_ack`
- `runtime.agent.session.snapshot`
- `runtime.agent.presentation.activity_requested`
- `runtime.agent.presentation.motion_requested`
- `runtime.agent.presentation.expression_requested`
- `runtime.agent.presentation.pose_requested`
- `runtime.agent.presentation.pose_cleared`
- `runtime.agent.presentation.lookat_requested`
- `runtime.agent.state.status_text_changed`
- `runtime.agent.state.execution_state_changed`
- `runtime.agent.state.emotion_changed`
- `runtime.agent.state.posture_changed`

Family-specific envelope requirements are pinned in
`tables/runtime-agent-event-projection.yaml`:

- `runtime.agent.turn.*` requires `agent_id`, `conversation_anchor_id`,
  `turn_id`, and `stream_id`
- `runtime.agent.presentation.*` requires `agent_id`,
  `conversation_anchor_id`, `turn_id`, and `stream_id`
- `runtime.agent.session.*` requires `agent_id` and `conversation_anchor_id`
- `runtime.agent.state.*` requires `agent_id`; origin linkage back to
  `conversation_anchor_id` / `originating_turn_id` / `originating_stream_id`
  remains optional and is present only when the state projection is traceable to
  a specific continuity branch
- `runtime.agent.hook.*` requires `agent_id`; origin linkage back to
  `conversation_anchor_id` / `originating_turn_id` / `originating_stream_id`
  remains optional and is present only when the hook projection is traceable to
  a specific continuity branch

`runtime.agent.turn.message_committed` must additionally carry `message_id`.

Fixed rules:

- `runtime.agent.turn.*` is conversation-anchor-scoped transient projection
- `runtime.agent.session.*` is anchor-scoped recovery projection owned by
  runtime continuity truth
- `runtime.agent.presentation.*` is stream-scoped transient presentation
  projection derived from committed runtime interpretation
- `runtime.agent.state.*` remains agent-scoped state projection even when a
  particular update originated from one anchor/turn
- apps must consume these admitted runtime projection families rather than raw
  `apml.*` parser events as their durable product path
- APML is admitted only as the model-facing output wire syntax defined by
  `agent-output-wire-contract.md`; runtime must project APML into these typed
  families before first-party consumers treat it as durable product truth
- family-specific envelopes and detail payloads for these admitted projection
  families are pinned in
  `tables/runtime-agent-event-projection.yaml`
- `PostureProjection` is the canonical schema alias for
  `runtime.agent.state.posture_changed.detail.current_posture`
- `runtime.agent.turn.post_turn.detail.hook_intent` is only a turn-close
  indication; the canonical hook lifecycle seam remains `runtime.agent.hook.*`
- `tables/runtime-agent-event-projection.yaml` is the stable projection payload
  schema SSOT; breaking changes must pass runtime consistency and runtime
  derived-doc checks before admission

## K-AGCORE-038 Current Emotion Projection

Runtime owns current emotion as transient agent state projection, not as
persistent `AgentPresentationProfile` truth and not as renderer-local truth.

Fixed rules:

- current emotion must project through `AgentStateProjection.current_emotion`
- public change notification must use `runtime.agent.state.emotion_changed`
- emotion is durable-until-replace runtime state and must not be collapsed into
  posture or persistent presentation profile fields
- renderer-specific expression or motion hints may derive from emotion, but they
  must not rewrite `current_emotion`
- read-only app-facing state projection may additionally expose
  `status_text_changed`, `execution_state_changed`, and `posture_changed`, but
  those projections must not leak deeper runtime-private posture machine truth

## K-AGCORE-039 Commit And Failure Semantics For Turn Streams

Turn/presentation stream truth uses channel-scoped partial commit with explicit
commit points.

Fixed rules:

- `runtime.agent.turn.text_delta` is provisional until
  `runtime.agent.turn.message_committed`
- if a hard turn failure occurs before `message_committed`, consumers must
  discard provisional text from that stream
- sidecar runtime-owned state units such as posture, emotion, memory
  candidates, and hook intent proposals validate and commit independently
- sidecar rejection must emit an explicit rejected or failed runtime event and
  must not retroactively roll back an already committed message
- envelope-level hard violations must fail the whole turn and suppress
  `message_committed`

## K-AGCORE-049 Agent Activity Ontology Projection Boundary

Runtime owns the app-facing `runtime.agent.presentation.activity_requested`
activity ontology for first-party projection. The active value space is pinned
in `tables/agent-activity-ontology.yaml`.

Fixed rules:

- activity category is exactly one of `emotion`, `interaction`, or `state`
- core and extended activity ids are admitted only through
  `tables/agent-activity-ontology.yaml`
- public runtime chat output that proposes an unknown activity id must fail
  closed before durable turn commit rather than being projected as a free-form
  renderer cue
- `detail.source` records provenance such as `apml_output` or `direct_api`; it
  must not be used as a substitute category like `chat` or `status`
- `detail.intensity` may be absent or one of `weak`, `moderate`, `strong`;
  public chat APML does not currently admit activity intensity attributes, so
  APML-sourced public activity projections normally omit intensity
- renderer/app mappings may provide backend fallback behavior for admitted ids,
  but they must not re-own runtime activity category or intensity truth
- closed-topic activity ontology documents are evidence only; the active
  runtime SSOT is this rule plus `tables/agent-activity-ontology.yaml`

## K-AGCORE-050 Agent Event Owner Map And Broad Bus Deferral

The active event owner map for the Live2D companion continuation is narrower
than the closed-topic platform event design.

Active owner map:

- Runtime owns the admitted Layer A public projection families listed in
  K-AGCORE-037, K-AGCORE-042, and `tables/runtime-agent-event-projection.yaml`
- APML parser events remain runtime-internal diagnostics and must not be exposed
  as durable app-facing `apml.*` product events
- Desktop owns only chat shell bridge / handoff semantics under
  `.nimi/spec/desktop/kernel/agent-avatar-surface-contract.md`
- Avatar owns app-local `avatar.*` event naming and consume semantics under
  `apps/avatar/spec/kernel/avatar-event-contract.md`
- SDK may consume admitted runtime agent projections but does not own platform
  event ontology

Deferred or not admitted in this wave:

- a general cross-app event broker for `desktop.*`, `avatar.*`, `system.*`, or
  third-party app namespaces
- broad wildcard subscription semantics beyond the current
  `runtime.agent.turns.subscribe` consume path
- cancellable before-events as a public runtime/SDK broker feature
- SDK app-event emission as a general platform API

Fixed rules:

- no implementation may cite the closed event-hook design as active authority
  for broad bus or wildcard behavior
- first-party apps may document app-local event conventions, but those app-local
  specs must not redefine runtime-owned `runtime.agent.*` payloads
- any future widening into a general event bus requires a new admitted runtime
  and SDK authority packet plus implementation tests

## K-AGCORE-051 Presentation Timeline Voice/Lipsync Admission Boundary

Runtime is the canonical owner of PresentationTimeline truth for the admitted
Live2D companion voice/lipsync branch.

This rule admits the branch that was previously candidate-only in the closed
2026-04-20 design. It does not make closed `PresentationStream`,
`TimelineMarker`, or `voice.level` shapes active API truth by name; the exact
voice/lipsync projection schema lives only in
`tables/runtime-agent-event-projection.yaml` before runtime implementation can
claim support.

Fixed rules:

- runtime owns stream identity, timebase identity, offset/duration/deadline
  semantics, and interrupt propagation for text / activity / voice / lipsync
  coordination
- apps may schedule rendering locally, but they must consume runtime-owned
  timeline metadata and must not invent canonical offsets or stream identity
- the admitted timebase must include a monotonic offset basis for scheduling and
  a wall-clock anchor for trace/debug evidence
- voice timing and lipsync frames must remain downstream of the same
  `agent_id`, `conversation_anchor_id`, `turn_id`, and `stream_id` used by the
  admitted turn/presentation projection families
- malformed, missing, negative, or non-monotonic timing metadata in an admitted
  timeline-bearing event must fail closed before durable projection
- interrupt/cancel must project a single stream-level cancellation truth that
  consumers can apply to text continuation, voice playback, lipsync frames, and
  avatar motion scheduling
- runtime must not expose a broad app event bus or wildcard event API as the
  mechanism for this branch; the branch must stay within admitted
  `runtime.agent.*` projection families unless a later authority widens it
- voice provider selection remains outside this rule; runtime may carry
  provider-produced timing/audio-level evidence, but it must not hardcode a
  provider or model as timeline authority

Implementation waves must not report this rule as product-complete until
runtime, SDK/Desktop, Avatar, and cross-surface acceptance evidence all exist.

## Fact Sources

- `.nimi/spec/runtime/kernel/runtime-agent-service-contract.md`
- `.nimi/spec/runtime/kernel/agent-output-wire-contract.md`
- `.nimi/spec/runtime/kernel/agent-presentation-contract.md`
- `.nimi/spec/runtime/kernel/tables/runtime-agent-event-projection.yaml`
- `.nimi/spec/runtime/kernel/tables/agent-activity-ontology.yaml`
- `.nimi/spec/desktop/kernel/agent-avatar-surface-contract.md`
- `apps/avatar/spec/kernel/avatar-event-contract.md`
- `apps/avatar/spec/kernel/tables/activity-mapping.yaml`
- `docs/architecture/agent-companion-core-protocol.md` — reader guide and core projection correspondence
- `docs/architecture/live2d-companion.md` — reader guide and runtime projection correspondence
