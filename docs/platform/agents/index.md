# Character and LocalAgent

A **Character** is a persistent participant in the Nimi ecosystem. Across every digital world and conversation, a character keeps the same identity, relationships, and core definition, all maintained by Realm.

A **LocalAgent** is how Runtime runs that character on the user's device. When an interactive session starts, Runtime reads the character's Realm-issued specification—the **Character Source**—and launches an active agent locally. The LocalAgent manages live conversation turns and execution state for that run, while the character's permanent identity stays anchored in Realm.

Core concepts:
- **Character**: The persistent entity maintained by Realm, including identity, relationship graphs, and world affiliations. `PersonaCharacter` and `WorldCharacter` are domain-specific forms of Character, not separate local agent types.
- **Character Source**: The declarative contract issued by Realm that Runtime uses to instantiate a character.
- **LocalAgent**: The on-device instance running for the current user. Runtime manages its lifecycle, active conversations, memory routing, model selection, readiness status, and token budgets.

There is no intermediate identity layer (such as `Agent`, `AgentFamily`, or `AgentPersona`) between Character and LocalAgent.

## Authority & Subsystem Boundaries

Realm is the single source of truth for character identity: who a character is, its social ties, world memberships, and canonical descriptions. Runtime instantiates a LocalAgent from the Character Source without taking over or mutating Realm's records.

Long-term memory is isolated per agent in Cognition, with Runtime mediating authorized recall and updates (`Knowledge V1` currently has no active public client interface).

Applications, Nimi Home (hosted by Desktop), and Avatar only access resources authorized for the active protected session. They cannot mint LocalAgent identities or rebuild Runtime state from local chat logs, and they never receive Realm master tokens, AI provider API keys, internal Runtime proofs, or account-wide agent rosters.

Avatar renders structured visual and motion streams from Runtime and manages local rendering state (such as gaze and mesh kinematics) without driving the LocalAgent's reasoning loop.

## Section Topics

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
