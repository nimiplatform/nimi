# Conversation Anchor

A Conversation Anchor is a Runtime-issued continuity token for a LocalAgent’s durable Conversation. It helps authorized surfaces refer to the same conversation; it is not an authorization credential or a replacement for the current session’s `agentHandle`.

A Conversation Anchor is distinct from a LocalAgent's identity ID. It cannot be deduced or forged from UI routing parameters, Avatar embodiment instances, local message caches, or whichever agent was previously active.

Runtime coordinates conversation lifecycle events: opening, committing dialogue turns, snapshotting state, resuming after interruptions, and providing typed projections. Each LocalAgent maintains one primary active conversation: the initial open establishes it, and subsequent authorized callers attach to the same committed continuity. Applications must retain the Runtime-issued anchor returned by the SDK as a verified continuity token; anchors do not isolate separate application branches or window-private histories.

## Opening and State Recovery

Callers submit a typed intent alongside the session-scoped `agentHandle` via the SDK. Before creating or resuming a conversation, Runtime verifies the user account, application identity, granted capability scopes, and agent access policies against the active secure session.

State recovery relies strictly on anchors and runtime state snapshots held by Runtime. Local client message history functions purely as a rendering cache: it cannot prove continuity, nor can it reconstruct active conversation context, long-term memory, or knowledge graphs.

## Projection Boundary

Authorized consumers receive committed conversation turns and structured execution statuses. Raw AI provider token streams, parser debug payloads, cryptographic credentials, internal system prompts, and Runtime-internal proofs remain strictly encapsulated.

An Avatar embodiment can attach a visual 2D/3D character model to an authorized conversation anchor for presentation. The Avatar instance ID and rendering pipeline state neither initiate nor validate the underlying dialogue session.

## Source Basis

- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`.nimi/spec/runtime/protected-session.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/protected-session.authority.yaml)
- [`.nimi/spec/runtime/memory-world.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/memory-world.authority.yaml)
