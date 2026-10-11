# Conversation Anchor

A Conversation Anchor uniquely designates a specific dialogue session with a LocalAgent. Issued authoritatively by Runtime, it is the only valid handle for referencing or resuming that conversation across surfaces.

A Conversation Anchor is distinct from the LocalAgent's identity ID. It can never be deduced or forged from UI routing parameters, Avatar embodiment instances, local message caches, or whatever agent happened to be active previously.

Runtime orchestrates conversation lifecycle events—opening, committing dialogue turns, snapshotting state, resuming after interruptions, and providing typed projections. Each LocalAgent maintains one primary active Conversation: the initial open establishes it, and subsequent authorized callers attach to the same committed continuity. Applications must retain the Runtime-issued anchor returned by the SDK as a verified continuity token; anchors do not isolate separate application branches or window-private histories.

## Opening and State Recovery

Callers pass a typed intent along with the session-scoped `agentHandle` via the SDK. Before creating or resuming a conversation, Runtime verifies the user account, application identity, granted permissions, and agent access policies against the active secure session.

State recovery relies strictly on anchors and memory snapshots held by Runtime. Local client message history serves purely as a rendering cache: it cannot prove continuity, nor can it reconstruct active conversation context, long-term memory, or knowledge graphs.

## Projection Boundary

Authorized consumers receive committed conversation turns and structured execution statuses. Raw AI provider token streams, parser debug payloads, cryptographic credentials, internal system prompts, and Runtime-internal proofs remain strictly encapsulated.

Avatar can attach a visual 2D/3D character model to an authorized conversation anchor for presentation. The Avatar instance ID and rendering pipeline state neither initiate nor validate the underlying dialogue session.

## Source Basis

- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`.nimi/spec/runtime/protected-session.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/protected-session.authority.yaml)
- [`.nimi/spec/runtime/memory-world.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/memory-world.authority.yaml)
