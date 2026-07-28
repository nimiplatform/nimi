# Chat

Realm Chat owns the canonical thread / message / read-state /
membership / group-lifecycle / agent-slot surface for chat that
participates in world meaning. It is **canonical** — not Desktop-
local, not session-local. The chat thread is platform truth.

## Substrates

Realm Chat v1 admits two substrates:

| Substrate | Purpose |
| --- | --- |
| `DIRECT` | Two-party direct messaging |
| `GROUP` | Multi-party threads with humans + agent slots |

A `CHANNEL` substrate is **fail-closed** — not admitted in v1.
This is a deliberate limitation; channel-style streams require
their own admitted contracts and are not part of v1 chat.

## Group Threads And Agent Slots

`GROUP` threads can have humans + agent slots / authors. An agent
slot is a typed admission for an agent to participate as an author
in the group.

| Property | Value |
| --- | --- |
| Members | Humans + agent slots |
| Agent posts | Validate thread / slot binding before commit (anti-spoof) |
| Slot lifecycle | Admitted; agents enter / leave slots under typed events |

The anti-spoof check is at the protocol level. A malicious actor
who tried to author messages "from" the agent without slot
binding fails closed.

## Anti-Spoof Validation

When an agent post arrives, Realm validates:

| Check | What it does |
| --- | --- |
| Slot binding | Is this agent admitted in this thread's slot? |
| Author identity | Does the post's author match the slot binding? |
| Thread membership | Is this thread admitting agent posts at all? |
| Timing | Is this post within an admitted authorship window? |

Any failure fails closed. The thread does not silently accept a
post that fails any check.

This is what makes "an agent in a group chat" a real product
feature. Without protocol-level anti-spoof, "an agent says X"
would be a forgeable claim.

## Reader Scenario: A Direct Conversation

You direct-message another user.

1. **Direct substrate.** Realm admits a `DIRECT` thread between
   you and the other user.
2. **Send.** Your message is committed to the thread.
3. **Realtime delivery.** Other user sees the message via
   Socket.IO realtime delivery.
4. **Read state.** Read state is canonical — your client's
   "read" is recorded in the thread.

The thread is canonical Realm truth. Switching devices does not
require re-syncing; the canonical thread is the source.

## Reader Scenario: A Group Chat With An Agent Slot

You are in a group chat with friends and an agent slot.

1. **Group substrate.** `GROUP` thread admitted; members include
   humans and one agent slot.
2. **Agent posts.** When the agent's runtime emits a turn for
   this thread, the post arrives at Realm with the agent's
   identity.
3. **Anti-spoof check.** Realm validates slot binding, author
   identity, thread membership, timing.
4. **If valid, commit.** Post is admitted; group sees it.
5. **If invalid, reject.** Fail-closed; group does not see it.

The slot is the typed channel for agent participation. An agent
without slot binding cannot author into the group.

## Reader Scenario: Read State Across Devices

You read a message on Desktop. You open the same conversation on
Avatar.

1. **Read on Desktop.** Read state is committed to Realm.
2. **Open on Avatar.** Avatar reads the canonical thread,
   including read state.
3. **Avatar sees you've read it.** No silent re-display of read
   messages.

Read state is platform truth, not per-surface state. This is what
makes multi-surface chat coherent.

## How Chat Relates To Other Realm Surfaces

| Surface | Relation |
| --- | --- |
| Social (`R-SOC-*`) | Friendship gates direct chat preconditions; social does not own the thread itself |
| Truth (`R-TRUTH-*`) | Chat that affects world meaning may participate in truth |
| World History (`R-WHIST-*`) | Chat events that contribute to canonical history append there |
| Runtime ConversationAnchor | Runtime owns conversation continuity; Realm owns the canonical thread |

## What Chat Does Not Do

| Concern | Why not |
| --- | --- |
| Own conversation continuity | Runtime ConversationAnchor owns that |
| Own agent execution | RuntimeAgentService owns that |
| Own UI rendering | Desktop chat surface owns that |
| Admit `CHANNEL` substrate | Not in v1; fail-closed |

## Source Basis

- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
