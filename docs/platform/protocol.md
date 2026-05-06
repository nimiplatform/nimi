# Platform Protocol

The platform protocol gives Nimi worlds a shared language. It doesn't
remove creative freedom from world creators; it gives worlds enough common
structure for identity, agents, social state, and movement to remain
meaningful across surfaces.

This page is a reader-facing summary. The authoritative protocol rules
live in the platform kernel under the `P-PROTO-*` rule family.

## The Six Primitives

Each primitive is a small, fixed contract surface. A world is free to
define its own internal rules, but anything that crosses worlds has to
fit one of these primitives.

| Primitive | What it covers |
| --- | --- |
| **Timeflow** | Progression, timing, and temporal meaning across worlds |
| **Social** | Relationships and social graph semantics |
| **Economy** | Value, exchange, and economic state |
| **Transit** | Movement between worlds or contexts |
| **Context** | Shared situational meaning |
| **Presence** | Who or what is present, and under what conditions |

The primitives are deliberately abstract. Timeflow does not say "an hour
is sixty minutes." It says how progression is represented when one
world's clock has to be interpreted by another world or surface.

## Why Protocol Comes Before Features

Without protocol, every feature becomes local. A world says one thing,
a Desktop surface implies another, and an agent acts on a third. The
platform protocol prevents that drift by giving shared semantics a home
that no single feature can quietly redefine.

That principle has a practical consequence. New product features that
touch cross-world meaning must go through the protocol, not around it.
A feature that invented its own social graph would not be a feature
extension; it would be a parallel authority.

## Reader Scenario: Two Worlds Recognizing The Same Friendship

Suppose Alice and Bob are friends in World A. Bob also visits World B.
The Social primitive describes how that friendship is represented when
it crosses worlds:

1. The friendship has a representation that both worlds can read.
2. World B is allowed to apply its own local social rules. Maybe in
   World B "friend" only grants chat access; maybe World A's friendship
   carries economic privileges.
3. World A's truth about the friendship does not retroactively change
   when Bob visits World B; if anything changes, it has to be recorded
   under each world's authority.

The Social primitive does not force every world to model friendship the
same way. It forces worlds to express friendship in a contract surface
that other worlds can understand without misreading the meaning.

## Where Protocol Sits Relative To Realm

The protocol is a contract surface for cross-world meaning. Realm is
where world truth actually lives. The two are related but distinct:

- Protocol is the language.
- Realm is the persistent meaning expressed in that language.

When a world advances state, the change is anchored in Realm. When that
change has to be visible to another surface, the protocol primitives
are how it is expressed.

## Reader Scenario: A Workflow That Touches Multiple Primitives

Suppose a world hosts a small marketplace event. During the event:

- **Timeflow** advances the event's state from "scheduled" to "running"
  to "ended."
- **Presence** says which agents and users are currently in the event
  space.
- **Social** records that two participants formed a connection during
  the event.
- **Economy** records that one participant bought an item.
- **Transit** governs how a participant leaves the event for another
  world afterward.
- **Context** lets surfaces share the situational meaning of the event
  while it is running, so an agent participant knows what is happening
  without re-reading every other primitive.

Six primitives sound abstract on their own. In a normal world flow,
they show up together.

## Source Basis

- [`.nimi/spec/platform/protocol.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/protocol.md)
- [`.nimi/spec/platform/kernel/protocol-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/protocol-contract.md)
- [`.nimi/spec/platform/kernel/tables/protocol-primitives.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/tables/protocol-primitives.yaml)
- [`.nimi/spec/platform/kernel/tables/protocol-error-codes.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/tables/protocol-error-codes.yaml)
