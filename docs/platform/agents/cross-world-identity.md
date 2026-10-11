# Cross-World Identity Continuity

A character remains itself in every digital world. That identity continuity is grounded in Realm's Character identity layer rather than within any single world boundary.

A Character participates in multiple worlds under Realm's governance regarding identity, relationships, world memberships, and access controls. Entering a new world never duplicates the character or creates a secondary persona. Furthermore, a world's local configuration cannot autonomously establish a globally recognized LocalAgent identity.

Runtime instantiates a LocalAgent solely from a Character Source issued authoritatively by Realm. During execution, it can incorporate authorized world context and optional Cognition memory recall; this does not activate unmanaged knowledge pathways.

Multiple LocalAgents may be instantiated from the same base Character Source across different contexts. Each instance maintains its own dialogue stream, execution state machine, token budget, process lifecycle, and agent-private Cognition memory. Sharing a common character definition does not equate to sharing active runtime memory.

Applications receive only authorized references and structured views. They cannot conflate distinct LocalAgents by shared character reference, nor can they use local client caches to forge cross-world identity.

> [!NOTE]
> Long-term memory is managed by Cognition and isolated per agent; Runtime mediates authorized recall and updates. Knowledge V1 currently has no active public client interface.

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
- [`.nimi/spec/runtime/memory-world.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/memory-world.authority.yaml)
