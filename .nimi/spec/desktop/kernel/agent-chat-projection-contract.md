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
- renderer-local ephemeral UI state such as focus, scroll, transient composer
  text, popovers, pending attachments, and visible panel state
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
- keep user-entered composer text in memory while the current renderer session is
  active, without promising restart recovery
- avoid pseudo-success assistant messages, pseudo audio playback, pseudo
  workflow completion, pseudo memory writes, and silent fallback model routes
- keep renderer-local telemetry and diagnostics below product truth

## D-LLM-025a — Local Persistence Remediation Boundary

Desktop Agent Chat local persistence, when present during the D3 migration, is
limited to renderer UI state and a disposable projection cache.

Fixed rules:

- Desktop local persistence must not become canonical Agent Chat transcript,
  message, action, turn, beat, conversation-anchor, lifecycle, or history truth.
- Desktop local persistence must not author assistant greetings, successful
  assistant turns, message/action existence, prompt traces, turn traces, or
  projection rebuild output as product truth.
- Desktop local persistence must not provide offline Agent Chat transcript
  recovery. When Runtime is unavailable, Desktop may preserve in-memory display
  state for the current renderer session, but it must not reconstruct Agent Chat
  history from Desktop storage after restart.
- Desktop must not persist Agent Chat drafts. Composer text is transient
  renderer state only and is allowed to be lost on reload or restart.
- Desktop must not admit Agent Chat rename or archive conversation semantics.
  Agent Chat exposes a single active Runtime conversation per AgentFriend; any
  display title is derived projection text, not user-authored conversation
  metadata.
- Runtime-owned session snapshots and `runtime.agent.turn.*` /
  `runtime.agent.presentation.*` projections are the replay source for Agent
  Chat transcript and presentation state.
- No steady-state Desktop `chat_agent_*` store, bridge client, or Tauri command
  family is admitted after cutover. Historical Desktop projection rows are not
  a product recovery source; restart recovery must come from Runtime / SDK
  session projection.
- The only steady-state Desktop persistence admitted here is non-transcript UI
  state such as focus, scroll, popover, and transient panel state.

## D-LLM-107 — Agent Chat Store Cutover Closeout

The Desktop `chat_agent_*` projection-cache store is retired. Desktop must not
register `chat_agent_*` Tauri commands, expose a `chatAgentStoreClient`, or own
SQLite schema for Agent Chat transcript/message/turn recovery.

Cutover closeout requirements:

- Runtime / SDK can list the calling app's Agent Chat conversation summaries
  without reading Desktop SQLite.
- Runtime / SDK can recover a selected conversation through
  `ConversationAnchor` plus `GetPublicChatSessionSnapshot`, including
  Runtime-owned transcript replay envelope fields for stable message identity,
  timestamps, status, and kind.
- Runtime / SDK must own any future close / delete / clear policy for
  user-visible conversation history. Desktop must not implement this as a
  local-only delete once Runtime-owned transcript replay is active.
- Runtime / SDK must own any future message-level delete / redact policy for
  Agent Chat messages before Desktop exposes those actions.
- Agent Chat draft persistence is not a product requirement. Runtime / SDK must
  not add an Agent Chat draft surface to replace the retired Desktop draft
  behavior.
- Agent Chat rename, archive, and multi-conversation session management are not
  product requirements. Runtime / SDK should expose one active conversation per
  AgentFriend unless a later product decision admits multiple conversations.
- Desktop submit paths use in-memory optimistic projection only; committed user
  and assistant transcript state replays from Runtime session snapshots or
  `runtime.agent.turn.*` / `runtime.agent.presentation.*` projections.

No offline Agent Chat transcript product is admitted. If Runtime is unavailable,
Desktop may preserve only the current renderer-session in-memory display state;
after reload or restart, it must fail closed until Runtime / SDK projection is
available.

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
