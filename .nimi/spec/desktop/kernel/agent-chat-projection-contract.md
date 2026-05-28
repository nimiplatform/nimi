# Agent Chat Projection Contract

> Authority: Desktop Kernel

## Scope

Desktop Agent Chat is now a presentation and interaction projection surface only.

Runtime owns Agent Chat orchestration, prompt/context assembly, turn planning,
model-facing output validation, Runtime Agent execution, voice workflow
execution, media execution, memory policy, runtime-owned conversation anchors,
and execution evidence.

Desktop owns only:

- shell placement and visible UI affordances for Agent Chat
- user input capture and explicit user actions before they are submitted to the
  admitted SDK / Runtime Agent surface
- rendering of Runtime / SDK Agent Chat projections, events, candidates,
  presentation timelines, and failure states
- renderer-local ephemeral UI state such as focus, scroll, draft text,
  popovers, transient composer state, and visible panel state
- Avatar / Live2D / VRM presentation handoff as defined by
  `agent-avatar-surface-contract.md`, without owning Agent Chat execution truth

Desktop must not own:

- Agent Chat orchestration or local conversation provider execution
- prompt assembly, context packing, continuity digest injection, or turn plan
  resolution
- model-facing APML / message-action / JSON output wire truth
- resolved assistant message/action existence truth
- direct `runtime.ai.executeScenario`, Runtime media output generation, or
  Runtime voice workflow execution paths from Desktop Agent Chat
- voice executor, richer voice workflow, voice session, transcript/caption
  product semantics, or voice identity truth
- `AISnapshot` execution truth or capability materialization truth
- canonical agent identity, memory, autonomy, lifecycle, transcript/history, or
  conversation-anchor truth

## D-LLM-022 — Desktop Agent Chat Projection Authority

Desktop Agent Chat's canonical Desktop owner is this projection contract.

Fixed rules:

- Desktop must submit Agent Chat user intent through admitted SDK / Runtime
  Agent APIs.
- Desktop must consume Runtime-owned `runtime.agent.*`,
  `runtime.agent.turn.*`, `runtime.agent.presentation.*`, and related SDK
  projections as read/projection truth.
- Desktop may render local fallback UI for unavailable Runtime projections, but
  those states must remain explicit failure / unavailable states.
- Desktop must not synthesize successful assistant turns, actions, voice
  playback, workflow completion, or memory writes when Runtime has not produced
  the corresponding projection.

## D-LLM-023 — No Desktop Orchestration Owner

Desktop must not keep a renderer-local Agent Chat orchestration stack.

Forbidden Desktop-owned surfaces include:

- `chat-agent-orchestration*`
- `chat-agent-turn-plan`
- `chat-nimi-execution-engine*`
- Desktop Agent Chat `executeScenario` wrappers
- Desktop Agent Chat direct Runtime media output / workflow invocation helpers
- renderer-local voice workflow executors
- renderer-local AI message/action planners

If a future UI helper needs to transform projection data for display, it must be
named and structured as a projection/view-model helper and must not call Runtime
execution APIs directly.

## D-LLM-024 — Message, Action, And Voice Projection Boundary

Agent Chat message/action/voice semantics are Runtime-owned.

Desktop may:

- display Runtime-projected assistant messages and action states
- display Runtime-projected media / voice / workflow progress
- expose user controls that submit typed user intent
- invoke admitted Runtime SDK speech-to-text projection only for explicit user
  voice input capture before submitting text intent to Runtime Agent Chat
- map Runtime failure reason codes to user-facing copy

Desktop may not:

- decide whether an assistant action exists
- invent model-generated prompt payloads
- choose between text, image, voice, or voice workflow execution paths
- turn capability readiness into action admission
- turn runtime job acceptance into product success
- derive transcript reveal, caption, or voice-session semantics from local
  capture / playback helper state

## D-LLM-025 — Presentation Failure Semantics

When Runtime Agent Chat projection is missing, disabled, invalid, or rejected,
Desktop must fail closed as a presentation surface.

Required behavior:

- show unavailable / failed / pending states from Runtime reason codes
- keep user-submitted drafts recoverable locally when appropriate
- avoid pseudo-success assistant messages, pseudo audio playback, pseudo
  workflow completion, pseudo memory writes, and silent fallback model routes
- keep renderer-local telemetry and diagnostics below product truth

## D-LLM-025a — Local Persistence Remediation Boundary

Desktop Agent Chat local persistence, when present during the D3 migration, is
limited to user drafts, renderer UI state, and a disposable projection cache.

Fixed rules:

- Desktop local persistence must not become canonical Agent Chat transcript,
  message, action, turn, beat, conversation-anchor, lifecycle, or history truth.
- Desktop local persistence must not author assistant greetings, successful
  assistant turns, message/action existence, prompt traces, turn traces, or
  projection rebuild output as product truth.
- Runtime-owned session snapshots and `runtime.agent.turn.*` /
  `runtime.agent.presentation.*` projections are the replay source for Agent
  Chat transcript and presentation state.
- If a Desktop `chat_agent_*` store exists before cutover, it is remediation
  scoped projection-cache infrastructure. It must remain replaceable by Runtime
  / SDK session projection without changing product semantics.
- The only steady-state Desktop persistence admitted here is explicit draft and
  UI state such as focus, scroll, popover, composer text, and transient panel
  state.

## D-LLM-107 — Agent Chat Store Cutover Prerequisites

Desktop must not hard-delete the `chat_agent_*` projection-cache store until a
Runtime / SDK replacement can serve the same product journeys without promoting
Desktop-local transcript truth.

Required replacement coverage before deletion:

- Runtime / SDK can list the calling app's Agent Chat conversation summaries
  without reading Desktop SQLite.
- Runtime / SDK can recover a selected conversation through
  `ConversationAnchor` plus `GetPublicChatSessionSnapshot`.
- Runtime / SDK has an admitted close / delete / clear policy for user-visible
  conversation history, or the Desktop product explicitly removes those actions.
- Draft persistence is owned by an admitted draft-only surface, such as
  RuntimeApp `app-local-drafts`, and is not mixed with transcript truth.
- Desktop submit paths use in-memory optimistic projection only; committed user
  and assistant transcript state replays from Runtime session snapshots or
  `runtime.agent.turn.*` / `runtime.agent.presentation.*` projections.

Until those prerequisites are met, `chat_agent_*` commands remain remediation
scoped and must not be treated as steady-state Desktop truth.

## D-LLM-026 — Adjacent Authority Boundaries

Adjacent owner boundaries are fixed:

- `.nimi/spec/runtime/kernel/runtime-agent-service-contract.md` owns live
  Runtime Agent execution, agent lifecycle, memory policy, conversation
  continuity, transient turn / presentation projection, and agent events.
- `.nimi/spec/runtime/kernel/runtime-agent-participation-contract.md` owns
  participation profiles, prompt assembly policy, execution owner axes, output
  candidates, and canonical Agent Chat reference posture.
- `.nimi/spec/runtime/kernel/agent-output-wire-contract.md` owns model-facing
  Agent output wire validation and APML projection.
- `.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md` owns Runtime
  Agent presentation stream families and projection envelopes.
- `.nimi/spec/runtime/kernel/voice-contract.md` owns runtime voice workflow,
  `VoiceReference`, `VoiceAsset`, and scenario job truth.
- `.nimi/spec/desktop/kernel/agent-avatar-surface-contract.md` owns only
  Desktop-to-Avatar presentation handoff and transient visual surface cues.
- `.nimi/spec/desktop/kernel/streaming-consumption-contract.md` owns only
  Desktop stream consumption mechanics, cancellation display, and retry UX.
- `.nimi/spec/desktop/kernel/state-contract.md` owns only Desktop UI state
  persistence mechanics, not Agent Chat execution truth.

## Fact Sources

- `.nimi/spec/runtime/kernel/runtime-agent-service-contract.md`
- `.nimi/spec/runtime/kernel/runtime-agent-participation-contract.md`
- `.nimi/spec/runtime/kernel/agent-output-wire-contract.md`
- `.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md`
- `.nimi/spec/runtime/kernel/voice-contract.md`
- `.nimi/spec/desktop/kernel/agent-avatar-surface-contract.md`
- `.nimi/spec/desktop/kernel/streaming-consumption-contract.md`
