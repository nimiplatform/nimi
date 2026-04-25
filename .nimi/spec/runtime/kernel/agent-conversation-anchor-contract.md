# Agent Conversation Anchor Contract

> Owner Domain: `K-AGCORE-*`

## K-AGCORE-033 Conversation Anchor Authority Home

`RuntimeAgentService` owns conversation continuity for live agent surfaces
through runtime-owned `ConversationAnchor` truth.

`RuntimeAgentService` remains multi-agent by default. `ConversationAnchor`
closes per-agent continuity only; it is not a system-wide singleton session.

It owns:

- cross-surface conversation continuity identity
- anchor-scoped turn and message id scope
- anchor-scoped interrupt propagation
- attach / late-join / recovery boundary for host surfaces

It does not own:

- desktop-only window lifecycle
- avatar-only placement or renderer-local interaction state
- provider-native transcript truth

## K-AGCORE-034 ConversationAnchor Boundary

`ConversationAnchor` is the runtime-owned continuity anchor that allows multiple
surfaces to participate in one conversation without collapsing all surfaces into
one implicit global session.

The admitted anchor shape must remain reconstructable through committed runtime
truth and include at least:

- `conversation_anchor_id`
- `agent_id`
- `subject_user_id`
- anchor status / lifecycle metadata
- last committed turn/message identity

Fixed rules:

- runtime owns no platform-level default/current agent; any app-local
  current/default/pinned agent choice must resolve to explicit `agent_id`
  before crossing into runtime-owned truth
- `agent_id` is agent identity scope, not conversation continuity scope
- `conversation_anchor_id` is the only admitted cross-surface conversation
  continuity scope
- `turn_id` and `message_id` must be unique within one
  `conversation_anchor_id`
- `stream_id` must identify one owned presentation/turn stream and remain
  anchor-scoped
- host surfaces may attach to an existing anchor or open a new one explicitly;
  they must not infer "same agent means same conversation" by default
- `OpenConversationAnchor` must require explicit `agent_id` plus
  `subject_user_id` and return a committed `ConversationAnchorSnapshot`
- `GetConversationAnchorSnapshot` must recover committed continuity through
  explicit `agent_id` + `conversation_anchor_id`; late-join surfaces must not
  reconstruct canonical anchor truth from app-local history

## K-AGCORE-035 Sharing, Isolation, And Recovery Rules

Surfaces attached to the same `ConversationAnchor` share one conversation
continuity. Surfaces attached to different anchors do not.

Fixed rules:

- same-anchor surfaces share `runtime.agent.turn.*`,
  `runtime.agent.presentation.*`, and turn-interrupt semantics
- different anchors under the same `agent_id` must not share `turn_id`,
  `message_id`, or interrupt propagation by implication
- agent-scoped `runtime.agent.state.*`, `runtime.agent.memory.*`, and
  `runtime.agent.hook.*` may still be observed across anchors, but consumers
  must not reinterpret those agent-scoped projections as one conversation stream
- late-join surfaces must recover current continuity through runtime-owned
  anchor/session snapshot truth, not by replaying parser internals or guessing
  from UI-local history
- `runtime.agent.turn.request` may reference only an existing committed
  `conversation_anchor_id`; client-side shadow anchor creation is not admitted

## Fact Sources

- `.nimi/spec/runtime/kernel/runtime-agent-service-contract.md`
- `.nimi/spec/desktop/kernel/agent-chat-voice-session-contract.md`
- `.nimi/topics/closed/2026-04-20-desktop-agent-live2d-companion-substrate/dual-entry-session.md`
