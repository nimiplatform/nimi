# Cross-World Identity

A character stays itself in every world. That continuity lives in Realm's
Character identity, not in any single world.

A Character can take part in more than one world under Realm's identity,
relationship, membership, and access rules. Entering a new world never creates
a second character, and a world's own source alone cannot establish a
LocalAgent identity.

Runtime runs a LocalAgent only from a Character Source issued by Realm. It can
use admitted world context for execution and optional Cognition source recall; this does not create an active Knowledge path.

More than one LocalAgent can run from the same Character Source. Each keeps
its own Conversation, state, budget, lifecycle, and Agent-private Cognition Memory. Sharing a source does
not mean sharing live local state.

Apps only see the references and views they are authorized for. They cannot
merge LocalAgents by character reference, or treat a local cache as
cross-world identity.

Cognition owns Agent-private long-term Memory; Runtime mediates authorized delivery, recall, and management. Knowledge V1 has no active read, write, or public client path.

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
- [`.nimi/spec/runtime/memory-world.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/memory-world.authority.yaml)
