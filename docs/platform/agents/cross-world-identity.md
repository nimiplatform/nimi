# Cross-World Identity

A character stays itself in every world. That continuity lives in Realm's
Character identity, not in any single world.

A Character can take part in more than one world under Realm's identity,
relationship, membership, and access rules. Entering a new world never creates
a second character, and a world's own source alone cannot establish a
LocalAgent identity.

Runtime runs a LocalAgent only from a Character Source issued by Realm. It can
blend in the world context a world has shared — for execution, memory, and
knowledge — but the result is still a local execution entity run by Runtime.

More than one LocalAgent can run from the same Character Source. Each keeps
its own operational Memory, Knowledge, Conversation, state, budget, and
lifecycle unless an explicit agreement says otherwise. Sharing a source does
not mean sharing live local state.

Apps only see the references and views they are authorized for. They cannot
merge LocalAgents by character reference, or treat a local cache as
cross-world identity.

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
- [`.nimi/spec/runtime/memory-world.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/memory-world.authority.yaml)
