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

- `runtime.agent.turn.started`
- `runtime.agent.turn.text_delta`
- `runtime.agent.turn.message_committed`
- `runtime.agent.turn.completed`
- `runtime.agent.turn.failed`
- `runtime.agent.turn.interrupted`
- `runtime.agent.presentation.activity_requested`
- `runtime.agent.presentation.motion_requested`
- `runtime.agent.presentation.expression_requested`
- `runtime.agent.presentation.pose_requested`
- `runtime.agent.presentation.pose_cleared`
- `runtime.agent.presentation.lookat_requested`
- `runtime.agent.state.emotion_changed`

Every event in these families must carry:

- `agent_id`
- `conversation_anchor_id`
- `turn_id`
- `stream_id`

`runtime.agent.turn.message_committed` must additionally carry `message_id`.

Fixed rules:

- `runtime.agent.turn.*` is conversation-anchor-scoped transient projection
- `runtime.agent.presentation.*` is stream-scoped transient presentation
  projection derived from committed runtime interpretation
- `runtime.agent.state.*` remains agent-scoped state projection even when a
  particular update originated from one anchor/turn
- apps must consume these admitted runtime projection families rather than raw
  `apml.*` parser events as their durable product path

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
- `.nimi/local/report/proposal/2026-04-20-desktop-agent-live2d-companion-substrate/state-event-bus.md`
- `.nimi/local/report/proposal/2026-04-20-desktop-agent-live2d-companion-substrate/presentation-timeline.md`
