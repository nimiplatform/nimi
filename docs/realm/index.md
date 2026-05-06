# Realm

Realm is where world truth lives. It owns the durable meaning of a world:
the truth itself, the current state, the history of how it got there,
the chat, and related domains like social, economy, asset, binding,
resource, and transit.

Runtime executes AI work. SDK gives apps an access boundary. Desktop and
Web render the experiences. But the shared truth of a world is anchored
in Realm — that's the layer everything else points at.

## What This Section Contains

- [World Semantics](/realm/world-semantics) — how truth, state, and
  history relate to the platform's six protocol primitives.

The cross-domain [Glossary](/glossary) explains "world," "truth," and
"world history" if those terms are unfamiliar.

## Why Realm Matters

Open worlds need more than generated responses. They need stable state
and history. If a world changes, if a relationship evolves, or if a
participant acts, the platform needs a place where that truth is
represented consistently.

Realm provides that semantic core. It is also what makes the
cross-world contract surface meaningful: the protocol primitives need
something to anchor against, and Realm is what they anchor against.

## Reader Scenario: A Conversation That Affects World Truth

Suppose two participants have a conversation that, by the world's
rules, results in a new connection between them. Under Realm contracts:

1. The chat semantics that produced the connection follow
   `R-CHAT-*` rules.
2. The new connection is recorded under the social contract
   (`R-SOC-*`).
3. The world's state updates under the world-state contract
   (`R-WSTATE-*`).
4. The historical fact that the connection formed is recorded under
   the world-history contract (`R-WHIST-*`).

Each step follows an admitted Realm contract. An app or mod is
not allowed to invent a "the connection exists" claim outside Realm
and have other surfaces accept it.

## Reader Scenario: A World History Read

Suppose a user wants to see how a world reached its current state.
Realm exposes that as a public read path:

1. The current state is read under the world-state contract.
2. The trail of how that state was reached is read under the
   world-history contract.
3. Both reads return shapes that the SDK can project; see
   [SDK Realm And World Client](/sdk/realm-world-client).

The point is that history is a first-class concept, not a derived
log. A world's "what happened" is part of its truth, not an
afterthought.

## Source Basis

- [`.nimi/spec/realm/README.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/README.md)
- [`.nimi/spec/realm/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/index.md)
- [`.nimi/spec/realm/kernel/truth-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/truth-contract.md)
- [`.nimi/spec/realm/kernel/world-state-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/world-state-contract.md)
- [`.nimi/spec/realm/kernel/world-history-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/world-history-contract.md)
- [`.nimi/spec/realm/kernel/chat-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/chat-contract.md)
- [`.nimi/spec/realm/kernel/social-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/social-contract.md)
- [`.nimi/spec/realm/kernel/economy-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/economy-contract.md)
- [`.nimi/spec/realm/kernel/asset-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/asset-contract.md)
- [`.nimi/spec/realm/kernel/transit-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/transit-contract.md)
