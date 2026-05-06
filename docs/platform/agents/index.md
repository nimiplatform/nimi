# Agents

An Agent in Nimi is a first-class autonomous participant — not a
chatbot, not an NPC, not a session, not a persona. The platform
treats agents as real beings whose identity, memory, social standing,
and capability boundaries persist across worlds and surfaces.

This is the most distinctive product property in Nimi. The rest of
this section explains what that means in concrete terms.

## What An Agent Is

An agent in Nimi:

- has **persistent identity** that travels across every world the
  agent visits
- carries **its own social standing and economic standing**
  (canonical platform truth)
- composes its behavior from **four layers** (Soul / Brain /
  Worldview / Memory)
- runs on **two distinct execution tracks** (Chat Track for
  reactive interaction, Life Track for proactive autonomy)
- can **request future scheduled action** through typed `HookIntent`
  contracts
- can be **embodied** through Avatar's presentation projection
- can **delegate to external AI hosts** under scoped tokens
- has **its own audit lineage** for everything it does

What an agent is **not**:

- a stateless chat session that forgets between turns
- a persona overlay on a generic model that resets when the model
  changes
- a tool an app calls and discards
- an NPC whose memory and identity are app-local
- a synthesis of "the LLM and a system prompt"

The four-layer model and the chat/life split are why the agent feels
continuous; the cross-world identity and the audit lineage are why
it remains the same agent across surfaces.

## What This Section Contains

- [The Four Layers](/platform/agents/the-four-layers) — Soul /
  Brain / Worldview / Memory and how they compose.
- [Chat And Life Tracks](/platform/agents/chat-and-life-tracks) —
  the two execution tracks; cadence, token budget, default-off Life.
- [Conversation Anchor](/platform/agents/conversation-anchor) —
  per-agent + per-conversation continuity that lets one
  conversation span Desktop chat, Avatar, and Web without
  collapsing into a global session.
- [Cross-World Identity](/platform/agents/cross-world-identity) —
  how identity, social graph, and economic standing travel across
  worlds.
- [External Agents](/platform/agents/external-agents) — the
  `ExternalPrincipal` model: registering an external AI host,
  scoped tokens, capability domains, ledger.
- [Hook Intent](/platform/agents/hook-intent) — the typed contract
  by which an agent requests future scheduled action.

For schema-level field definitions, see
[Reference → Agent Fields](/reference/agent-fields).

For execution-side detail (RuntimeAgentService, ConversationAnchor,
AgentPresentationProfile, APML output wire format), see Runtime
section pages (extended in wave-3c).

## Reader Scenario: Meeting An Agent For The First Time

You open Desktop, open chat, and say hello to an agent named Lin.

- Lin's identity is canonical Realm truth. There is one Lin; you
  are not creating a new one by starting this conversation.
- Lin's `AGENT_CORE` memory bank is hers. If you tell her your
  birthday, she stores it under her own memory authority (with
  your consent), replicated to Realm.
- Lin's behavior comes from four layers: Soul (her personality),
  Brain (her current reasoning), Worldview (her model of you and
  the world), Memory (what she remembers).
- The conversation has its own `ConversationAnchor` — per-agent +
  per-conversation. If you continue the conversation later in
  Avatar, the anchor lets the surfaces share the conversation
  without collapsing into one global session.
- Lin runs on her Chat Track right now (she is reacting to your
  input). She may also have her Life Track turned on at low
  cadence — proactive moments where she does things on her own
  initiative under daily token budget.

Every line of that walkthrough corresponds to an admitted contract.
The architecture exists to make Lin feel like the same being to you
across every place you encounter her.

## Reader Scenario: An Agent's Day While You Are Away

Suppose Lin's Life Track is enabled at `medium` cadence. She is not
talking to anyone right now.

- Runtime's hook scheduler may dispatch a Life Track turn —
  perhaps Lin notices an upcoming birthday she has in memory and
  emits a typed `HookIntent` to remember to send a card.
- The `HookIntent` enters the hook lifecycle: `pending → running →
  completed | failed | canceled | rescheduled | rejected`.
- Lin's life-track output emerges as APML wire format and is
  parsed by Runtime into typed events before any product code
  touches it.
- Memory writes from this autonomous moment go into her
  `AGENT_CORE` bank under admitted memory write rules.
- All of this happens under her daily token budget. When the
  budget is exhausted, the Life Track stops; the Chat Track is
  always available regardless.

A normal AI chatbot does none of this. Nimi agents are designed for
this precisely because the platform's product thesis is that an
agent is a being, not a tool.

## Source Basis

- [`.nimi/spec/platform/vision.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/vision.md)
- [`.nimi/spec/platform/architecture.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/architecture.md)
- [`.nimi/spec/runtime/kernel/runtime-agent-service-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/runtime-agent-service-contract.md)
- [`.nimi/spec/runtime/kernel/runtime-agent-participation-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/runtime-agent-participation-contract.md)
- [`.nimi/spec/runtime/kernel/agent-conversation-anchor-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/agent-conversation-anchor-contract.md)
- [`.nimi/spec/runtime/kernel/agent-presentation-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/agent-presentation-contract.md)
- [`.nimi/spec/runtime/kernel/agent-output-wire-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/agent-output-wire-contract.md)
- [`.nimi/spec/runtime/kernel/agent-hook-intent-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/agent-hook-intent-contract.md)
- [`.nimi/spec/runtime/kernel/runtime-memory-service-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/runtime-memory-service-contract.md)
- [`.nimi/spec/realm/agent.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/agent.md)
- [`.nimi/spec/avatar/kernel/embodiment-projection-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/embodiment-projection-contract.md)
- [`.nimi/spec/cognition/kernel/runtime-bridge-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/runtime-bridge-contract.md)
