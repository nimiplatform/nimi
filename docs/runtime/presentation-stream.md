# Agent Presentation Stream

> Status: Running today. The transient presentation seam (turn
> projection + presentation events + state events) is shipped;
> APML model-facing wire is admitted.

The agent presentation stream is the **transient projection seam**
between runtime and any app that wants to render an agent's behavior
in real time — Desktop chat showing message text streaming in, Avatar
rendering an emotion change, a kit consumer reading turn lifecycle.

It is distinct from the **persistent** `AgentPresentationProfile`
(slow-changing default voice / asset / expression preset binding) and
distinct from the **model-facing** APML wire format. Apps consume
the typed projection, not raw APML and not the persistent profile.

## Authority Boundary

| Layer | Owner | What it owns |
| --- | --- | --- |
| Persistent presentation profile | Runtime (`agent-presentation-contract.md`) | Default voice + asset + expression preset binding |
| Model-facing APML wire | Runtime (`agent-output-wire-contract.md`) | Public APML tag admission, parser validation, mapping into typed projection |
| Transient presentation stream | Runtime (`agent-presentation-stream-contract.md`) | Anchor-scoped turn lifecycle + transient presentation requests + current emotion projection |
| Renderer-local interpolation / physics | Per-app (Avatar, Desktop, kit) | Visual / audio rendering |

The stream is **runtime-owned committed truth**. Renderer-local
interpolation, motion handles, Live2D parameter writes, and shell
choreography are app-local concerns.

## Admitted Projection Families

The runtime-owned stable projection families:

### Turn lifecycle (`runtime.agent.turn.*`)

Anchor-scoped, stream-scoped events covering one turn from accept to
completion.

| Family | Purpose |
| --- | --- |
| `runtime.agent.turn.accepted` | Turn admitted into the runtime |
| `runtime.agent.turn.started` | Turn execution began |
| `runtime.agent.turn.reasoning_delta` | Reasoning text chunk |
| `runtime.agent.turn.text_delta` | User-visible text chunk |
| `runtime.agent.turn.structured` | Structured output payload |
| `runtime.agent.turn.message_committed` | Message committed (carries `message_id`) |
| `runtime.agent.turn.post_turn` | Post-turn admitted activity (e.g., sidecars) |
| `runtime.agent.turn.completed` | Successful terminal |
| `runtime.agent.turn.failed` | Failed terminal |
| `runtime.agent.turn.interrupted` | User-initiated interrupt |
| `runtime.agent.turn.interrupt_ack` | Runtime acknowledges the interrupt |

Required envelope: `agent_id`, `conversation_anchor_id`, `turn_id`,
`stream_id`. `message_committed` additionally carries `message_id`.

### Presentation requests (`runtime.agent.presentation.*`)

Stream-scoped transient presentation projection — what the agent
wants the embodiment / chat surface to do during this turn.

| Family | Purpose |
| --- | --- |
| `runtime.agent.presentation.activity_requested` | Activity intent (admitted activity ontology id) |
| `runtime.agent.presentation.motion_requested` | Motion intent |
| `runtime.agent.presentation.expression_requested` | Expression intent |
| `runtime.agent.presentation.pose_requested` | Pose intent |
| `runtime.agent.presentation.pose_cleared` | Clear pose |
| `runtime.agent.presentation.lookat_requested` | Gaze intent |

Required envelope: `agent_id`, `conversation_anchor_id`, `turn_id`,
`stream_id`.

### Agent state (`runtime.agent.state.*`)

Agent-scoped projection that may originate from one anchor / turn but
remains agent-wide.

| Family | Purpose |
| --- | --- |
| `runtime.agent.state.status_text_changed` | Free-text status update |
| `runtime.agent.state.execution_state_changed` | Execution lifecycle state |
| `runtime.agent.state.emotion_changed` | Current emotion projection |
| `runtime.agent.state.posture_changed` | Posture projection |

Required envelope: `agent_id`. Origin linkage to anchor / turn /
stream is optional and only present when the state projection is
traceable to a specific continuity branch.

### Hook (`runtime.agent.hook.*`)

Same envelope shape as state — agent-scoped, anchor-linkage optional.
See [Platform → Agents → Hook Intent](/platform/agents/hook-intent)
for the hook-side framing.

## APML: Model-Facing Wire, Not App Consumption

For the Live2D companion substrate continuation line, the admitted
model-facing wire format is **APML** inline markup. The model emits
APML; runtime parses + validates; runtime emits typed projection;
**apps consume the typed projection, never raw APML parser events**.

| Public APML tag | Where admitted |
| --- | --- |
| `<message>` (top-level) | User-visible turn text body |
| `<emotion>` (inside message) | Projects to runtime current emotion state |
| `<activity>` (inside message) | Projects to runtime activity ontology |
| `<action kind="image\|voice">` (sibling) | Image / voice action with `<prompt-payload>` + `<prompt-text>` |
| `<time-hook>` (top-level) | Time-based hook intent |
| `<event-hook>` (top-level) | Narrow event hook (`event-user-idle` / `event-chat-ended`) with `<effect kind="follow-up-turn">` |

What public APML does **not** admit:

- direct `<motion>`, `<expression>`, `<lookat>`, `<pose>`,
  `<clear-pose>` (those are downstream Avatar projection routes — see
  [Generated Motion Provider](/avatar/generated-motion-provider.md))
- speech prosody, surface routing, notification, tool invocation,
  chain-of-thought, memory write, posture/status, hook cancellation,
  namespace extension, parser-event syntax
- video actions
- raw `apml.*` events

Malformed APML fails closed with observable turn failure. There is no
"best-effort recovery" or "fenced JSON fallback" — the model emits
admitted APML or the turn fails.

## Stream Commit, Interrupt, and Failure

| Event | Semantics |
| --- | --- |
| `turn.message_committed` | Message text durably committed under `message_id`; downstream consumers (Realm chat) anchor on this event |
| `turn.interrupted` | User interrupted mid-turn; partial content is preserved per stream policy |
| `turn.interrupt_ack` | Runtime acknowledges interrupt; downstream surfaces stop streaming |
| `turn.failed` | Terminal failure; turn does not leave an uncommitted pending state |
| `turn.completed` | Terminal success |

Interrupts are **anchor-scoped**: same-anchor surfaces share
interrupt propagation; different-anchor surfaces under the same agent
do not.

## Reader Scenario: Desktop Chat Renders A Streaming Reply

The user submits a turn in Desktop chat.

1. **Submit.** Desktop calls runtime to start the turn.
2. **Accepted + started.** `turn.accepted` then `turn.started`
   propagate to all surfaces attached to the anchor.
3. **Text deltas stream.** `turn.text_delta` events arrive in order;
   Desktop chat renders incrementally.
4. **Presentation requests fire.** Mid-turn,
   `presentation.expression_requested` fires; Avatar (also attached)
   updates expression even though the text is still streaming.
5. **Message commits.** `turn.message_committed` carries the
   `message_id`; Realm chat anchors the message under the conversation
   thread.
6. **Turn completes.** `turn.completed` terminal event.

Three surfaces, one stream of typed events, no app inventing turn
semantics.

## Reader Scenario: APML Drives Both Text And Embodiment

A model emits an APML response with a message containing an emotion
cue and an activity cue.

1. **Model emits.** `<message><emotion name="happy" /><activity name="wave" />
   Hi! It's good to see you.</message>`.
2. **Runtime parses.** APML parser validates; admits the projection.
3. **Typed events fire.** `turn.text_delta` carries the user-visible
   text; `state.emotion_changed` projects "happy";
   `presentation.activity_requested` projects "wave" with the
   admitted activity ontology id.
4. **Apps consume.** Desktop chat renders text; Avatar's projection
   layer routes the activity through the active backend; Avatar
   event bus fires `avatar.expression.changed`.

The model wrote APML; apps consumed typed events. APML never reaches
the apps as raw parser output.

## Reader Scenario: User Interrupts Mid-Stream

The user clicks stop while a turn is streaming.

1. **Interrupt request.** App calls runtime interrupt API for the
   current turn.
2. **`turn.interrupted` fires.** All same-anchor surfaces stop
   streaming.
3. **`turn.interrupt_ack` fires.** Runtime confirms interrupt
   semantics; partial text is preserved.
4. **Next turn starts cleanly.** No leftover pending state.

The interrupt protocol is admitted; apps do not invent their own
"cancel" semantics on top.

## What The Stream Does Not Do

- It does not own renderer-local interpolation or physics.
- It does not own backend-specific motion handles or Live2D parameter
  writes (those are Avatar backend execution).
- It does not own avatar placement or shell choreography.
- It does not admit JSON message-action wire formats; APML is the
  admitted public model wire for this continuation line.
- It does not admit best-effort APML repair; malformed APML fails the
  turn closed.

## Boundary Summary

| Concern | Owner |
| --- | --- |
| Persistent presentation profile (default voice / preset / asset) | Runtime (`agent-presentation-contract.md`) |
| Model-facing APML wire | Runtime (`agent-output-wire-contract.md`) |
| Transient stream (turn + presentation + state events) | Runtime (`agent-presentation-stream-contract.md`) |
| Renderer-local execution | Per-app (Avatar / Desktop / kit consumer) |
| Conversation continuity | Runtime (`agent-conversation-anchor-contract.md`) |

## Source Basis

- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
