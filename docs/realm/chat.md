# Realm Realtime Messaging and Chat Architecture

Realm Chat provides human-to-human realtime messaging infrastructure across the Nimi platform. Direct conversation threads, message histories, memberships, and read receipt statuses are authoritatively persisted by Realm. Authorized clients read the same Realm thread history. This service contract does not imply that the public website or a mobile client currently offers a chat interface.

## Conversation Carriers and Communication Modes

Realm Chat is dedicated to direct communication between human participants:

| Carrier | Primary Purpose | Delivery Mechanics |
| --- | --- | --- |
| `DIRECT` | Point-to-point private messaging between two verified users | Real-time bi-directional transport via WebSocket / Socket.IO |

> **Distinction from Agent Dialogues**: Interacting with an autonomous AI companion involves dynamic context synthesis and inference steps; these are managed independently by local Runtime via `ConversationAnchor` and do not create standard Realm human chat threads.

## Common Workflows

### 1. Direct Messaging and State Synchronization
1. **Thread Creation**: When a user initiates a conversation, Realm verifies their friendship status in the social graph and establishes a unique `DIRECT` thread.
2. **Realtime Delivery**: Dispatched messages commit atomically to the thread ledger and push immediately to active recipient sockets.
3. **Cross-Device Read Status**: Reading messages on one client (such as Desktop) syncs the read status to Realm. When the user later opens the conversation on another client, messages already reflect their read state.

## Subsystem Interactions

| Subsystem | Coordination Boundary |
| --- | --- |
| **Social Graph (`R-SOC-*`)** | Friendship status serves as a precondition for direct messaging; Social manages relations without storing message payloads |
| **World Semantics (`R-TRUTH-*`)** | Public scene dialogues can optionally archive into world history upon authorized events |
| **Runtime ConversationAnchor** | Agent turn continuity remains managed within Runtime, keeping human messaging and AI dialogue pipelines clearly separated |

## Related Documentation

- [Desktop Chat Interface Guide](/desktop/chat)

## Source Basis

- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
