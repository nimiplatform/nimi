# Chat

Realm Chat is where direct messages between two people live. The
thread, its messages, its membership, and its read state all exist
exactly once — in Realm, not on your desktop and not inside one
login session. That single thread is what every surface reads.

## Substrate

Realm Chat admits exactly one substrate:

| Substrate | Purpose |
| --- | --- |
| `DIRECT` | Two-party human direct messaging |

Any other chat shape is rejected before canonical chat state is
created, mutated, or returned. LocalAgent conversations remain
Runtime-owned and do not become Realm human-chat threads.

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
| Runtime ConversationAnchor | Runtime owns LocalAgent conversation continuity separately from Realm human chat |

## What Chat Does Not Do

| Concern | Why not |
| --- | --- |
| Own conversation continuity | Runtime ConversationAnchor owns that |
| Own agent execution | RuntimeAgentService owns that |
| Own UI rendering | Desktop chat surface owns that |
| Admit non-direct chat shapes | Realm Chat is limited to direct human threads |

## Source Basis

- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
