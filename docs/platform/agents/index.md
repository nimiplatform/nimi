# Character and LocalAgent

Characters are the durable participants in Nimi. A character has a persistent
identity: it is the same individual in every world and every conversation, and
it stays that way over time. Realm keeps that identity.

A LocalAgent is how Runtime brings a character to life locally. When you start
an experience, Runtime reads the character's Realm-issued description — the
Character Source — and runs it on your machine. The LocalAgent holds the live
conversation, working memory, and knowledge for that run. The character's
identity itself stays in Realm.

- A **Character** is identity, relationships, and world membership kept by
  Realm. PersonaCharacter and WorldCharacter are forms of Character, not
  separate local agent types.
- A **Character Source** is the description Realm issues for Runtime to run a
  character from.
- A **LocalAgent** is the running instance Runtime creates for you. Runtime
  manages its lifecycle, Conversation, operational Memory and Knowledge, model
  routing, readiness, budget, and state.

There is no extra platform-wide `Agent`, `AgentFamily`, or `AgentPersona`
identity layer between Character and LocalAgent.

## Owner boundaries

Realm is the home of character identity: who a character is, its
relationships, its world memberships, and the character and world descriptions
everything else builds from. Runtime takes the Character Source Realm issues
and runs a LocalAgent from it, without taking over anything Realm keeps.

Apps, Nimi Home, Desktop, and Avatar only see what the current session
authorizes them to see. They cannot create LocalAgent identities or rebuild
Runtime state from local history, and they never receive Realm credentials,
provider keys, Runtime-internal proofs, or an account-wide list of
LocalAgents.

Avatar renders the typed presentation Runtime sends it and keeps its own
renderer-local state. It does not run the LocalAgent and does not drive the AI
directly.

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
