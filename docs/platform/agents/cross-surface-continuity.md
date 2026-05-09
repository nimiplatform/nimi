# Cross-Surface Continuity

> Status: Running today. ConversationAnchor is the runtime-owned
> continuity primitive; the cross-surface attach + late-join +
> recovery seam is shipped.

A Nimi agent does not live inside one app. The same conversation can
move from Desktop chat to Avatar to Web and back — and the agent
treats it as one ongoing thread. **Cross-surface continuity** is the
runtime contract that makes this possible without the conversation
collapsing into a single global session for the user.

## The Problem Continuity Solves

Two naive designs fail in opposite ways:

- **Global session per agent.** All surfaces talking to the same
  agent share one stream. Result: the user can never have two
  parallel conversations with the same agent.
- **Per-surface session.** Each app has its own thread. Result: a
  conversation that starts in Desktop chat is *gone* when the user
  opens Avatar later.

The runtime answer is `ConversationAnchor`: keyed per-agent +
per-conversation, owned by runtime, attachable from any surface.

## Anchor Properties

| Property | Value |
| --- | --- |
| Scope | Per-agent + per-conversation |
| Owner | Runtime (`RuntimeAgentService`) |
| Identity scope | `agent_id` is identity, `conversation_anchor_id` is continuity |
| Multiplicity | One agent can host multiple anchors (multiple parallel conversations) |
| Persistence | Anchor truth is reconstructable through committed runtime truth |
| Required identity | `agent_id` + `subject_user_id` + `conversation_anchor_id` + status + last committed turn / message identity |

`agent_id` is **agent identity**. It is not conversation continuity.
Two surfaces talking to the same agent are not automatically in the
same conversation; they must explicitly attach to (or open) a shared
anchor.

## Attach vs Open

Surfaces may either:

- **Open** a new anchor: `OpenConversationAnchor` requires explicit
  `agent_id` + `subject_user_id` and returns a committed
  `ConversationAnchorSnapshot`.
- **Attach** to an existing anchor: `GetConversationAnchorSnapshot`
  recovers committed continuity through explicit
  `agent_id` + `conversation_anchor_id`.

Surfaces **must not** infer "same agent means same conversation" by
default. Late-join surfaces must reconstruct anchor truth through
runtime-owned snapshot, not by replaying parser internals or guessing
from app-local history.

## What Same-Anchor Surfaces Share

| Shared across same-anchor surfaces | Shape |
| --- | --- |
| Turn projection | `runtime.agent.turn.*` events |
| Presentation projection | `runtime.agent.presentation.*` events |
| Turn-interrupt semantics | Anchor-scoped; interrupts propagate to all attached surfaces |
| Continuity identity | `conversation_anchor_id` |
| Turn / message id scope | Unique within one anchor |
| Stream id scope | Stream is one owned presentation/turn stream, anchor-scoped |

## What Different-Anchor Surfaces Do Not Share

Two anchors under the **same** `agent_id` do **not** share `turn_id`,
`message_id`, or interrupt propagation by implication. They may both
observe agent-scoped projections (`runtime.agent.state.*`,
`runtime.agent.memory.*`, `runtime.agent.hook.*`), but consumers must
not interpret those agent-scoped projections as one conversation
stream.

## Reader Scenario: One Conversation, Three Surfaces, One Day

A user starts chatting with their agent on Desktop in the morning. At
lunch, they open Avatar — the agent appears as embodiment on the
screen. In the evening, on a phone, they open the Web app.

1. **Desktop opens the conversation.** `OpenConversationAnchor`
   commits a new anchor for `(agent_id, conversation_anchor_id)`.
   Subsequent turns are anchored.
2. **Avatar resolves.** Avatar attaches via
   `GetConversationAnchorSnapshot` with the same
   `conversation_anchor_id`. The agent's voice + embodiment in
   Avatar reflects the ongoing turn state. A turn that started
   streaming in Desktop can finish in Avatar.
3. **Web attaches.** Web does the same anchor resolution. The user
   can scroll back through the morning's messages because they live
   in Realm chat under the same thread keyed by the anchor.

Throughout the day, the agent is the same being saying the same
things across three surfaces. The runtime owns the anchor; Realm owns
the chat thread; Avatar owns the embodiment.

## Reader Scenario: Two Parallel Conversations With One Agent

A user has one agent who is a project assistant. Today they have two
separate things to discuss — a coding project and a shopping list.

1. **Conversation A starts.** `OpenConversationAnchor` returns a new
   anchor for the coding conversation.
2. **Conversation B starts.** A separate
   `OpenConversationAnchor` call returns a different anchor for the
   shopping conversation.
3. **No merge.** Memory writes scoped to A do not pollute B's
   context. Memory writes scoped to B stay in B.
4. **The user switches at will.** Each anchor keeps its own
   continuity. The user never has to manage "which session am I in"
   manually.

Without per-conversation anchors, a user with one agent would
effectively have one big conversation forever.

## Reader Scenario: Surface Crash, Conversation Continues

The user is in a conversation in Avatar. Avatar crashes mid-turn.

1. **Anchor lives in runtime, not Avatar.** The runtime still has
   the anchor and the in-flight turn state.
2. **User reopens Avatar.** Avatar reconnects to runtime, calls
   `GetConversationAnchorSnapshot`, recovers the anchor.
3. **Streams resume.** Turn projection picks up from the runtime's
   committed truth.
4. **Realm chat retains messages.** No message loss; the chat thread
   is owned by Realm.

The anchor's runtime ownership is exactly what makes surface failure
survivable.

## Reader Scenario: Late-Join During An Active Turn

A user is on Desktop watching their agent's response stream. They
remember they wanted to see this on Avatar. They open Avatar.

1. **Avatar attaches mid-turn.** Late-join is admitted; it
   reconstructs through the runtime-owned anchor / session snapshot.
2. **Avatar joins the ongoing stream.** It does not replay parser
   internals or guess from Desktop's UI state. The runtime gives
   Avatar the committed snapshot.
3. **Both surfaces stay live until completion.** They share
   interrupt semantics: if the user clicks stop on Avatar, Desktop's
   stream interrupts too.

## What Cross-Surface Continuity Does Not Do

- It does **not** make `ConversationAnchor` a global session. Two
  anchors with the same `agent_id` are independent conversations.
- It does **not** own desktop window lifecycle.
- It does **not** own avatar placement or renderer-local interaction
  state.
- It does **not** own provider-native transcript truth.
- It does **not** allow surfaces to construct shadow anchors
  client-side. `runtime.agent.turn.request` may reference only an
  existing committed `conversation_anchor_id`.

## Boundary Summary

| Concern | Owner |
| --- | --- |
| Conversation continuity identity | Runtime (`RuntimeAgentService`) |
| Cross-surface attach + late-join + recovery | Runtime (anchor snapshot truth) |
| Chat thread content | Realm chat |
| Per-surface UI state | The surface itself |
| Memory writes scoped to a conversation | Cognition memory + Runtime memory bank |
| Presentation stream for embodied surfaces | Runtime presentation stream |

## Source Basis

- [`.nimi/spec/runtime/kernel/agent-conversation-anchor-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/agent-conversation-anchor-contract.md)
- [`.nimi/spec/runtime/kernel/runtime-agent-service-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/runtime-agent-service-contract.md)
- [`.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md)
- [`.nimi/spec/runtime/kernel/runtime-agent-participation-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/runtime-agent-participation-contract.md)
