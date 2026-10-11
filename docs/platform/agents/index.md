# Character and LocalAgent

Characters represent durable, persistent participants within the Nimi ecosystem. A character possesses an invariant identity: it remains the same entity across every digital world and conversation, persistently maintained over time by Realm.

A LocalAgent is how Runtime materializes that character definition locally on-device. When initiating an interactive session, Runtime interprets the character's Realm-issued specification—the Character Source—and executes it as an active agent on the user's machine. The LocalAgent maintains the live conversation history and operational execution state for that run, while canonical character identity remains securely anchored in Realm.

Key architectural concepts:
- **Character**: Persistent identity, relationship graphs, and world affiliations maintained by Realm. `PersonaCharacter` and `WorldCharacter` represent domain-specific forms of Character, not separate local agent archetypes.
- **Character Source**: The declarative contract issued by Realm enabling Runtime to instantiate a character.
- **LocalAgent**: The running on-device instance created for the current user. Runtime governs its lifecycle, active conversations, memory routing, inference model selection, readiness status, and token budgets.

No extraneous identity layer (such as `AgentFamily` or `AgentPersona`) exists between Character and LocalAgent.

## Authority & Subsystem Boundaries

Realm serves as the Single Source of Truth for character identity: who a character is, its social ties, world memberships, and canonical descriptions. Runtime executes a LocalAgent based on the Character Source without usurping Realm's authoritative records.

Applications, Nimi Home, Desktop shell, and Avatar only access resources authorized for the active authenticated session. They cannot synthesize LocalAgent identities or reconstruct Runtime state from local chat logs, and they never receive Realm master tokens, AI provider API keys, internal Runtime proofs, or account-wide agent rosters.

Avatar renders structured visual and motion streams dispatched by Runtime, managing local rendering parameters (e.g., gaze, mesh kinematics) independently without controlling the LocalAgent's reasoning loop.

## Section Topics

- [Conversation Anchor](./conversation-anchor)
- [Cross-Surface Continuity](./cross-surface-continuity)
- [LocalAgent Access and App Authorization](./participation-authority)
- [Cross-World Identity](./cross-world-identity)
- [External Participation](./external-agents)

> [!NOTE]
> Long-term memory is managed by Cognition and isolated per agent; Runtime mediates authorized recall and updates. Knowledge V1 currently has no active public client interface.

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`.nimi/spec/runtime/memory-world.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/memory-world.authority.yaml)
