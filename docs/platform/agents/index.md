# Character and LocalAgent

Nimi separates persistent identity from local AI execution.

- A **Character** is Realm-owned identity and social/world truth. PersonaCharacter
  and WorldCharacter are Character forms, not separate local agent types.
- A **Character Source** is the Realm-issued source used when Runtime
  materializes a LocalAgent.
- A **LocalAgent** is an owner-scoped Runtime materialization. Runtime owns its
  lifecycle, Conversation, operational Memory and Knowledge, AI routing,
  readiness, budget, and state.

There is no additional platform-wide `Agent`, `AgentFamily`, or `AgentPersona`
identity layer between Character and LocalAgent.

## Owner boundaries

Realm owns Character identity, social relationships, World membership, and
canonical Character and World source truth. Runtime consumes an admitted
Character Source and materializes a LocalAgent without taking over Realm truth.

Apps, Nimi Home, Desktop, and Avatar receive only the projections authorized for
their active session. They do not mint LocalAgent identity, reconstruct Runtime
state from local history, or receive Realm JWTs, provider credentials, Runtime
proofs, or account-wide LocalAgent inventory.

Avatar renders typed Runtime presentation input and keeps renderer-local state.
It does not become a LocalAgent owner or a direct AI driver.

## Continue reading

- [Conversation Anchor](./conversation-anchor)
- [Cross-Surface Continuity](./cross-surface-continuity)
- [LocalAgent Access and App Authorization](./participation-authority)
- [Cross-World Identity](./cross-world-identity)
- [External Participation](./external-agents)

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`.nimi/spec/runtime/memory-world.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/memory-world.authority.yaml)
