# Conversation Anchor

> Status: Running today. The anchor primitive + cross-surface
> attach + late-join + recovery seam is shipped under runtime.

A `ConversationAnchor` is the runtime-owned continuity identity that
lets one conversation span multiple surfaces — Desktop chat, Avatar,
Web — without collapsing into a single global session.

For the runtime contract depth (envelope fields, attach vs open,
late-join recovery), see
[Runtime → Cross-Surface Continuity](/platform/agents/cross-surface-continuity.md).

## What It Solves

A naive design would treat "the conversation" as a single thread
keyed by something like agent_id. That breaks two ways:

- If the conversation is global, then talking to the same agent
  from Desktop and from Avatar at the same time merges the two —
  the user cannot have two parallel conversations with one agent.
- If the conversation is per-surface, then a conversation that
  starts in Desktop chat and continues in Avatar later loses its
  thread — Avatar treats it as a new conversation.

The conversation anchor splits the difference. It is keyed
**per-agent + per-conversation**, not per-agent globally.

| Property | Value |
| --- | --- |
| Scope | Per-agent + per-conversation |
| Owner | Runtime |
| Persistence | Survives surface switch |
| Multiplicity | One agent can have multiple anchors (multiple parallel conversations) |
| Discovery | Surfaces resolve the anchor when the user picks a conversation to continue |

## How It Works In Practice

A user starts a conversation with an agent in Desktop chat. Runtime
creates a `ConversationAnchor` keyed by `(agent_id, conversation_id)`.
Subsequent turns in Desktop are anchored.

The user then opens Avatar. Avatar resolves the user's intent:
"continue the conversation I was having." Avatar looks up the
conversation by id and reuses the same anchor. The agent's response
in Avatar continues the same thread; memory writes from Avatar land
under the same conversation lineage.

Later, on Web, the user picks the same conversation. Web does the
same anchor resolution. The agent's responses in Web continue the
same thread.

At no point did the conversation collapse into "the global session
with this agent." If the user starts a separate conversation with
the same agent, it gets its own anchor — the two conversations do
not merge.

## What The Anchor Carries

The anchor is the continuity identity, not the conversation content.
Content lives in Realm chat. The anchor lets multiple surfaces
participate in one conversation under one runtime-owned thread.

| Anchor responsibility | Owner |
| --- | --- |
| Identity of "this conversation" | Runtime (anchor) |
| Thread of messages | Realm chat |
| Memory writes scoped to the conversation | Cognition memory + Runtime memory bank |
| Presentation stream for embodied surfaces | Runtime presentation stream |

The anchor is intentionally narrow. It is the thing that lets the
surfaces agree on which conversation they are in; it is not the
chat thread itself, not the memory, not the presentation.

## Reader Scenario: One Conversation, Three Surfaces

A user starts chatting with their agent on Desktop in the morning.
At lunch, they open Avatar — the agent is now visually present on
the screen. In the evening, on a phone, they open the Web app.

Throughout the day, all three surfaces share **one** conversation
with the agent.

- Desktop chat opens the conversation; the anchor is created.
- Avatar resolves the same `(agent_id, conversation_id)` and reuses
  the anchor. The agent's voice and embodiment in Avatar reflect
  the ongoing turn state. A turn that started in Desktop can
  finish streaming into Avatar.
- Web opens the conversation by id. Same anchor. The user can
  scroll back through the morning's messages because they live in
  Realm chat under the same thread.

The agent, from the user's perspective, is the same being saying
the same things across the three surfaces. From the platform's
perspective, the runtime owns the anchor; Realm owns the chat
thread; Avatar owns the embodiment; everything stays in its lane.

## Reader Scenario: Two Parallel Conversations With The Same Agent

A user has an agent who is a project assistant. Today they have two
separate things they want help with — a coding project and a
shopping list. They want to keep these conversations separate.

- The user starts conversation A about coding. Runtime creates an
  anchor for `(agent_id, conversation_A_id)`.
- The user starts conversation B about shopping. Runtime creates a
  separate anchor for `(agent_id, conversation_B_id)`.
- The two conversations do not merge. Memory writes scoped to
  conversation A do not pollute conversation B's context. Memory
  writes scoped to conversation B stay in B.
- The user can switch between A and B at will; each anchor keeps
  its own continuity.

Without per-conversation anchors, a user with one agent would
effectively have one big conversation. The anchor model is what
makes "multiple conversations with one agent" a real feature.

## Reader Scenario: Surface Drops Out, Conversation Continues

The user is in a conversation in Avatar. The Avatar app crashes.
The conversation should not be lost.

- The anchor lives in Runtime, not Avatar. The agent's
  conversation lineage is still in Runtime.
- The user reopens Avatar. Avatar reconnects to the runtime,
  resolves the same anchor, and the conversation resumes where it
  left off.
- Realm chat thread retains the messages.
- Memory writes that were in flight at the time of the crash are
  governed by replication state (`pending → synced | conflict |
  invalidated`).

The anchor's runtime ownership is what makes surface failure
survivable.

## Source Basis

- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
- [`docs/spec/realm-readme.md`](https://github.com/nimiplatform/nimi/blob/main/docs/spec/realm-readme.md)
- [`docs/spec/realm-external-anchor.md`](https://github.com/nimiplatform/nimi/blob/main/docs/spec/realm-external-anchor.md)
- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
- [`docs/spec/avatar-domain-index.md`](https://github.com/nimiplatform/nimi/blob/main/docs/spec/avatar-domain-index.md)
