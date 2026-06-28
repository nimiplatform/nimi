# OASIS

OASIS is the unique system main world in Nimi. It is part of
canonical truth, formally specified, and cannot be replaced by any
app convention.

## What OASIS Is

| Property | Value |
| --- | --- |
| Status | The unique system main world |
| Authority | Part of canonical Realm truth |
| Ownership | Cannot be owned by any creator |
| Replaceability | Cannot be replaced by an app convention |
| Role | Default return point and sole transit hub between worlds |
| Read surface | `GET /api/world/oasis` is a formal truth read |

OASIS is not a brand. It isn't a "demo world." It isn't a tutorial
zone that creators can clone or supersede. It is part of the
platform's canonical model.

## Why OASIS Exists

Most cross-world platforms either skip the hub problem or solve it
informally — there is some "main lobby" by app convention, and
worlds peer-link as they please. Nimi takes the opposite approach.

Two design properties depend on OASIS:

- **Single-hop continuity protocol.** Creator worlds cannot directly
  peer-transit to other creator worlds. Transit goes through OASIS:
  World A → OASIS → World B. This is what makes identity continuity
  across world-context change a real guarantee, not an
  implementation accident.
- **Default return point.** When a participant leaves a creator
  world, OASIS is where they return. This means there is always a
  canonical place that the platform can route someone to without
  depending on any single creator's world being available.

Together, these mean OASIS is the platform's continuity backbone —
the thing that lets identity, social graph, and economic standing
keep their meaning across creator worlds.

## OASIS Compared To Other Metaverse Hubs

OASIS in Ready Player One is a single shared physical-world simulation.
Nimi's OASIS borrows the idea of a hub of meaning, but it is a
**social and semantic engine** rather than a physical engine.

| Property | OASIS-style metaverse hub | Nimi OASIS |
| --- | --- | --- |
| Substrate | Physics simulation | Semantic + social truth |
| Rules | Inherited by all worlds | Each world authors its own internal rules |
| Cross-world identity | Often inherited | First-class platform truth |
| Hub authority | Often a single company | Platform-level canonical model |
| Brand-replaceable | Sometimes yes | No — OASIS is part of canonical truth |

Nimi's OASIS is a transit hub and continuity anchor, not a
shared physics arena. World-internal rules are created by world
creators; what crosses worlds uses the six protocol primitives.

## Reader Scenario: A Participant Moves Between Two Worlds

A user in World A wants to visit World B.

1. The user initiates transit. The Transit primitive contract
   governs this move.
2. The system routes the move through OASIS: World A → OASIS →
   World B. There is no direct creator-world-to-creator-world
   transit.
3. While transiting, the participant's identity stays canonical;
   no world is allowed to silently invent a new identity for them.
4. World B admits the participant under its own local rules. The
   user is the same person, with the same friendships and wallet
   they had in World A.

Why through OASIS? Because OASIS is part of canonical truth. A
direct world-to-world transit would create N×N peer-link policies;
the OASIS hub design replaces that with N policies (each world's
contract with OASIS).

## Reader Scenario: A Default Return When A World Goes Down

Suppose a world the user is in is taken offline by its creator.

- Without a hub: the participant is stranded; the platform has no
  canonical place to route them.
- With OASIS: the participant returns to OASIS automatically.
  Their identity and standing are unaffected. They can choose
  another world to enter.

The hub is not just a launch point — it is what makes a multi-world
platform robust against any single world's availability.

## Reader Scenario: A Creator Cannot Replace OASIS

Suppose a creator wants to ship a "main world" of their own and
have all their content's transit route through it.

- They can absolutely build a popular world. Creator worlds are
  first-class.
- They cannot replace OASIS. The platform's transit protocol routes
  through OASIS by design; a creator world cannot serve that role.
- They cannot make OASIS optional. Direct creator-to-creator
  transit is not admitted in the platform protocol.

The non-replaceability is the point. If OASIS were brand-replaceable,
the continuity guarantees would be too.

## Source Basis

- [`.nimi/spec/realm/README.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/README.md)
- [`.nimi/spec/realm/external-realm.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/external-realm.md)
- [`.nimi/spec/sdks/kernel/realm-api-consumer-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/realm-api-consumer-contract.md)
- [`.nimi/spec/sdks/kernel/realm-core-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/realm-core-contract.md)
- [`.nimi/spec/sdks/kernel/realm-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/realm-contract.md)
- [`.nimi/spec/platform/vision.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/vision.md)
- [`.nimi/spec/platform/protocol.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/protocol.md)
- [`.nimi/spec/platform/kernel/protocol-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/protocol-contract.md)
