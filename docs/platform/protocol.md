# Platform Protocol

The platform protocol gives Nimi digital worlds and client surfaces a shared interaction grammar. It does not restrict how creators design internal narratives or gameplay; instead, it defines standardized contract structures so that identities, social ties, context, and cross-world movement carry consistent meaning across the platform.

This document provides an architectural overview. Authoritative protocol specifications live in the platform kernel under the `P-PROTO-*` rule family.

## The Six Primitives

Each primitive defines a bounded contract surface. A world can implement its own internal rules, while cross-world state or events are expressed through six core primitives:

| Primitive | Architectural Coverage |
| --- | --- |
| **Timeflow** | Temporal progression, event lifecycle timing, and time-scale coordination across worlds |
| **Social** | Shared relationship graphs, friendship recognition, and interpersonal interaction contracts |
| **Economy** | Economic rules, revenue split previews, and value-exchange contracts |
| **Transit** | Contract semantics for routing and travel between worlds or spatial contexts |
| **Context** | Shared environmental framing, local scene rules, and situational context |
| **Presence** | Entity presence, spatial admission, and visibility conditions |

These primitives are intentionally abstract. `Timeflow`, for example, does not force every world to run at real-time speed; it specifies how a world's temporal progression is represented when interpreted by another surface.

## Why Protocol Precedes Features

Without a shared protocol, product surfaces drift apart: a world defines state one way, a desktop client interprets it another way, and an agent acts on a third assumption. Anchoring shared semantics in protocol contracts prevents isolated features from inventing incompatible local truths.

In practice, any capability that crosses world boundaries must align with the platform protocol rather than maintaining an unmanaged private graph. At the same time, shared protocol interfaces only standardize representation and access—they never authorize an application or world to bypass the entity owner.

## Scenario: Cross-World Recognition of Friendship

Suppose Alice and Bob become friends while in World A, and Bob later visits World B. Under the `Social` primitive and Realm authority:

1. **Single shared truth in Realm**: The friendship is recorded in Realm as the shared authoritative social graph—not stored as separate, unrelated friendship ledgers inside World A and World B.
2. **Local world policies**: Each world can apply its own scene admission and gameplay rules to that friendship. World B might allow friends to open direct chat, while World A might let friends enter a cooperative instance.
3. **Strict mutation boundaries**: Visiting World B or running local world logic cannot privately alter the global friendship status in Realm. Any change to the friendship itself must go through Realm's authoritative flow with proper owner authorization.

The `Social` primitive lets worlds build distinct local experiences on top of a single, verifiable relationship fact.

## Protocol and Realm Boundary

The platform protocol and Realm serve distinct roles:

- **Protocol**: Defines the contract grammar and schemas (`Timeflow`, `Social`, `Economy`, `Transit`, `Context`, `Presence`, along with `WorldState` and `WorldHistory` specifications).
- **Realm**: Persists authoritative global entities and state—such as account identities, the social graph, `WorldCore`, and character settings.

Note on current implementation boundaries: while Realm actively governs global identity, social relationships, `WorldCore`, and character settings today, `WorldState` and `WorldHistory` remain planned contracts rather than an executable full world-state ledger in current Home. Likewise, `Economy` revenue split previews do not equal live settlement, and creator payouts are not yet connected.

## Contract Scenario: A Workflow Spanning Multiple Primitives

To see how the six primitives fit together as protocol contracts, consider a design scenario for a weekend festival hosted in a digital world:

- **Timeflow** expresses the event lifecycle from scheduled to active to concluded.
- **Presence** describes which human users and agents are admitted and visible in the venue.
- **Social** references existing friendships from Realm and standardizes how new social requests are initiated.
- **Economy** structures item exchange contracts and revenue split rules.
- **Transit** defines the target routing contract for participants entering or returning from the world.
- **Context** broadcasts the festival's active rules and situational framing so participating agents can adapt their behavior.

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`config/platform-protocol-primitives.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/platform-protocol-primitives.yaml)
- [`config/platform-protocol-error-codes.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/platform-protocol-error-codes.yaml)
