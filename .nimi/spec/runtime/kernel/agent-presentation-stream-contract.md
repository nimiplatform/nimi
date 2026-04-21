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

## Fact Sources

- `.nimi/spec/runtime/kernel/runtime-agent-service-contract.md`
- `.nimi/spec/runtime/kernel/agent-presentation-contract.md`
- `.nimi/spec/runtime/kernel/tables/runtime-agent-event-projection.yaml`
- `.nimi/local/report/proposal/2026-04-20-desktop-agent-live2d-companion-substrate/state-event-bus.md`
- `.nimi/local/report/proposal/2026-04-20-desktop-agent-live2d-companion-substrate/presentation-timeline.md`
