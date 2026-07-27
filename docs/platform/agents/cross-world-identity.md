# Cross-World Identity

Cross-world identity belongs to Realm Character truth.

A Character may participate in more than one World according to Realm-owned
identity, relationship, membership, and access rules. World-specific context
does not create a second Character, and a World Source alone cannot establish a
LocalAgent identity.

Runtime materializes a LocalAgent only from a Realm-issued Character Source. It
may combine admitted World Source context for execution, Memory, and Knowledge,
but the resulting LocalAgent remains a Runtime-owned local execution entity.

Multiple LocalAgents may be materialized from the same Character Source. They
have independent operational Memory, Knowledge, Conversation, state, budget,
and lifecycle unless an explicit owner contract says otherwise. Shared source
does not imply shared mutable local state.

Apps see only authorized references and projections. They cannot merge
LocalAgents by Character reference or promote a local cache into cross-world
identity truth.

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
- [`.nimi/spec/runtime/memory-world.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/memory-world.authority.yaml)
