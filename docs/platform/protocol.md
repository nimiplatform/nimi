# Platform Protocol

The platform protocol provides Nimi digital worlds with a shared interaction language. It does not constrain the creative narrative freedom of world creators; instead, it establishes standardized contract structures so that character identity, agent execution, social relationships, and spatial transit remain meaningful across surfaces.

This document serves as an architectural overview. Authoritative protocol rules live in the platform kernel under the `P-PROTO-*` specification family.

## The Six Primitives

Each primitive represents a bounded contract surface. A world is free to define its own internal gameplay and narrative rules, but any state or event that crosses world boundaries conforms to one of these six primitives:

| Primitive | Architectural Coverage |
| --- | --- |
| **Timeflow** | Temporal progression, event timing, and time-scale coordination across worlds |
| **Social** | Relationship graphs, social ties, and interpersonal interaction semantics |
| **Economy** | Virtual asset values, credential transfers, and economic state |
| **Transit** | Traversal and travel between worlds or distinct spatial contexts |
| **Context** | Shared environmental framing, local rules, and situational context |
| **Presence** | Entity presence, spatial admission, and visibility conditions |

These primitives are deliberately abstract. Timeflow does not mandate "an hour is sixty minutes." Rather, it establishes how temporal progression is formally expressed when one world's timeline must be interpreted by another world or client surface.

## Why Protocol Precedes Features

Without a shared protocol, features become fragmented and local: a world defines state one way, a desktop shell interprets it differently, and an autonomous agent acts on a third assumption. The platform protocol anchors shared semantics within an authoritative contract that no single product surface can quietly redefine, eliminating state drift.

This principle enforces a practical design invariant: any new capability affecting cross-world semantics must align with the platform protocol. A feature that invents an ad-hoc private social graph does not extend the system—it introduces unmanaged parallel truth.

## Scenario: Cross-World Recognition of Friendship

Suppose Alice and Bob become friends in World A. When Bob visits World B, the Social primitive governs how that relationship is represented:

1. The friendship adheres to a standardized structure readable by both worlds.
2. World B applies its own local policies. In World B, "friendship" may grant direct messaging permissions; in World A, it might also convey shared economic privileges.
3. Bob's visit to World B never retroactively modifies World A's authoritative friendship record; any updates must be recorded through each world's respective authority.

The Social primitive does not force worlds into identical relationship models; it guarantees that relationships are expressed in an unambiguous contract that other surfaces can reliably interpret.

## Protocol and Realm Boundary

The platform protocol defines the contract grammar for cross-world meaning; Realm is where authoritative world state and history are persistently stored:

- **Protocol**: The interaction grammar and message schemas.
- **Realm**: The persistent state and narrative facts expressed in that grammar.

When a world advances its internal state, the change is anchored in Realm. When that update needs to be projected onto another client or world, it is serialized through the protocol primitives.

## Scenario: A Workflow Spanning Multiple Primitives

Consider a weekend festival hosted within a digital world:

- **Timeflow** advances the event lifecycle from "scheduled" to "active" to "concluded."
- **Presence** identifies all agents and human participants present in the festival grounds.
- **Social** logs new mutual acquaintances formed during the gathering.
- **Economy** validates item purchases and token exchanges.
- **Transit** coordinates participant travel back to their home worlds upon conclusion.
- **Context** broadcasts the festival's active rules and ambient theme, allowing participating agents to adapt their behavior without querying underlying databases.

Together, these primitives compose cohesive, multi-world interactive experiences.

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`config/platform-protocol-primitives.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/platform-protocol-primitives.yaml)
- [`config/platform-protocol-error-codes.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/platform-protocol-error-codes.yaml)
