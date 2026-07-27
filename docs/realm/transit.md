# Transit

Transit is the **single-hop continuity protocol** that lets
participants move between worlds. Creator worlds cannot
peer-transit directly — every transit goes through OASIS. This is
not a logistics quirk; it is a continuity guarantee.

## Single-Hop Through OASIS

| Property | Value |
| --- | --- |
| Topology | Hub-and-spoke; OASIS is the hub |
| Direct creator-to-creator transit | Forbidden |
| Transit path | Source world → OASIS → target world |
| Identity | Preserved through transit |
| Truth mutation | None during transit |
| Audit | Each transit hop recorded |

Why hub-and-spoke instead of peer-to-peer transit? Two design
properties depend on it:

| Property | Why hub-and-spoke serves it |
| --- | --- |
| Cross-world identity continuity | OASIS is the canonical anchor; identity stays anchored across the hop |
| Default return point | If a target world is unavailable, the participant returns to OASIS |
| Replaceability resistance | OASIS is part of canonical truth; no creator world can replace it |
| Bounded peer policy | N transit policies (each world ↔ OASIS) instead of N×N |

## Identity Preservation

A transit does not mutate the participant's canonical identity.
What changes is **context** — which world they are in. What stays
is **identity** — who they are.

| Stays through transit | Changes through transit |
| --- | --- |
| Identity (canonical) | Current world context |
| Social standing | World-internal local social rules |
| Economic standing | World-internal economy meaning |
| Memory (per memory bank scope) | World-shared memory scope |
| Avatar presentation profile | World-specific carrier acceptance |

`AGENT_CORE` and `AGENT_DYADIC` memory travels everywhere;
`WORLD_SHARED` memory stays with its world.

## Reader Scenario: A Move Between Two Worlds

A user wants to move their character from World A to World B.

1. **Initiate transit.** The user starts the move; admitted
   transit primitive applies.
2. **Hub-and-spoke routing.** Realm routes the transit through
   OASIS: World A → OASIS → World B.
3. **In OASIS.** Identity is anchored to canonical truth; the
   participant is at the hub.
4. **Transit to World B.** Realm admits the transit to World B
   under World B's admitted policy.
5. **In World B.** The participant is now in World B with the
   same canonical identity, social graph, wallet.

Through the entire move, **identity stayed**. The participant is
not a "new entity" in World B; they are the same canonical entity.

## Reader Scenario: A Target World Is Unavailable

A user transits, but the target world is offline.

1. **Initiate.** User starts transit toward target world.
2. **Realm checks.** Target world is `unavailable` (the
   creator has taken it offline, or it is in maintenance).
3. **Default return.** The participant returns to OASIS by
   default. They are not stranded.
4. **User chooses.** From OASIS, the user can pick a different
   world to enter, or wait for the target world to come back.

Without OASIS as default return, "world goes down mid-transit"
would be an error to handle. With OASIS, it is a graceful fallback.

## Reader Scenario: A Forbidden Direct Transit

A creator app tries to send a participant directly from World A
to World B without going through OASIS.

1. **Submit transit.** App attempts direct transit.
2. **Realm validates.** Direct creator-to-creator transit is not
   admitted.
3. **Reject.** Fail-closed; typed error.
4. **Workaround unavailable.** The app cannot construct a
   "shortcut" — the protocol requires OASIS routing.

This is what makes the continuity guarantee real. A creator
cannot opt out of the hub.

## Cross-Domain Touchpoints

Transit interacts with multiple primitives simultaneously. A
transit must satisfy:

| Primitive | What it requires |
| --- | --- |
| Transit | Movement is admitted |
| Social | Participant's social standing admitted in target |
| Economy | Economic standing transferable / acceptable |
| Context | Situational meaning preserved across worlds |
| Presence | New presence record in target world |

The six platform primitives are mutually constraining. Transit is
the canonical example of "primitive constraints meet at a single
operation."

## Per-World Transit Policies

Each world declares its admitted transit policies — who can
transit in, what social / economic / context preconditions apply,
what happens to local state on departure.

| Element | Owner |
| --- | --- |
| Source world's transit policy | The creator of source world |
| OASIS hub policy | Platform |
| Target world's admission policy | The creator of target world |

A transit must satisfy all three policies. Failure at any layer
fails closed.

## What Transit Does Not Do

| Concern | Why not |
| --- | --- |
| Mutate canonical identity | Identity is canonical Realm truth |
| Mutate canonical economy | Economic standing is canonical |
| Skip OASIS | Hub-and-spoke is the topology; no shortcut |
| Allow N×N peer transit | Forbidden by design |

## Source Basis

- [`docs/spec/realm-readme.md`](https://github.com/nimiplatform/nimi/blob/main/docs/spec/realm-readme.md)
- [`docs/spec/realm-external-anchor.md`](https://github.com/nimiplatform/nimi/blob/main/docs/spec/realm-external-anchor.md)
- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`config/platform-protocol-primitives.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/platform-protocol-primitives.yaml)
