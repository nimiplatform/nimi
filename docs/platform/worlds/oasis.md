# OASIS

OASIS is the central world every Nimi user traverses: the system main world. Built directly into the platform core protocol, it is globally unique, belongs to no single creator, and cannot be replaced by any app-local convention.

## What OASIS Is

| Property | Value |
| --- | --- |
| Status | The unique system main world |
| Authority | Core component of canonical Realm authority |
| Ownership | Public platform asset; cannot be owned by any creator |
| Replaceability | Cannot be superseded or replaced by app conventions |
| Role | Default return point and sole authoritative transit hub between worlds |
| Read surface | `GET /api/realm/core/oasis` provides canonical state queries |

OASIS is not a brand, not a temporary demo world, and not a tutorial zone that creators can clone or bypass. It is an integral architectural foundation of the platform's multi-world continuity model.

## Why OASIS Exists

Most cross-world platforms either avoid the hub problem entirely or solve it through informal conventions—designating an ad-hoc "main lobby" while allowing arbitrary peer-to-peer (P2P) connections between worlds. This quickly fractures user identity and state continuity. Nimi takes a structured, verifiable approach.

Key architectural properties depend on OASIS:

- **Single-hop continuity protocol**: Creator worlds cannot directly peer-transit to other creator worlds. All transits are routed through OASIS: World A → OASIS → World B. This turns identity and state continuity across world-context changes into an enforced protocol guarantee rather than an implementation accident.
- **Default safe return point**: When a participant leaves a creator world or when a world becomes unreachable, they return safely to OASIS. The platform always maintains a well-defined fallback destination without depending on the uptime or availability of any individual creator world.

Together, OASIS forms the backbone of platform continuity—ensuring identity, social graphs, and economic standing maintain coherent meaning across creator worlds.

## OASIS Compared to Traditional Metaverse Hubs

In traditional fiction, the OASIS is depicted as a monolithic physics engine simulating a single virtual universe. Nimi borrows the concept of a "hub of meaning," but implements it as a **social and semantic authority engine** rather than a physics simulator.

| Property | Traditional Metaverse Hub | Nimi OASIS |
| --- | --- | --- |
| Substrate | Monolithic physics simulation & rendering | Semantic models and social authority state |
| Rule system | All worlds inherit centralized physics/engine rules | Each world authors its own internal interaction and game logic |
| Cross-world identity | Often proprietary or loosely coupled | First-class platform citizen with protocol continuity |
| Hub authority | Owned and controlled by a single vendor | Canonical model governed by open platform protocols |
| Replaceability | Subject to vendor lock-in | Core protocol anchor; cannot be superseded by third-party worlds |

Nimi OASIS is a transit hub and continuity anchor, not a monolithic shared physics arena. World-internal rules are created by world creators, while cross-world movements and interactions strictly follow core platform protocols.

## Typical Scenario: A Participant Moves Between Two Worlds

A user in World A wants to visit World B:

1. **Initiate transit**: The user initiates movement. The Transit primitive contract governs and validates the transition.
2. **Hub routing**: The system routes the transition through OASIS: World A → OASIS → World B. Direct, uncontrolled creator-world-to-creator-world transit is disallowed.
3. **Identity continuity**: Throughout transit, the participant's identity remains canonical; no external world can forge an unverified persona.
4. **Governed admission**: World B admits the participant under its own local rules. The user arrives with their verified identity, social connections, and wallet intact.

Why route through OASIS? Direct world-to-world transit creates an $N \times N$ mesh of peering policies. An OASIS-centered architecture simplifies this into $N$ standardized contracts between each world and OASIS.

## Typical Scenario: Graceful Fallback When a World Goes Down

Suppose the creator world currently hosting a user is taken offline or experiences an outage:

- **Without a central hub**: The participant is stranded with disconnected state; the platform has no canonical place to route them safely.
- **With OASIS**: The participant returns automatically to OASIS. Their identity, credentials, and state remain intact, allowing them to freely choose another world to explore.

The hub serves not just as a launchpad, but as a resilient fail-safe that shields users from individual world downtime.

## Typical Scenario: Creator Autonomy and Hub Boundaries

A creator builds a premier world and wishes to funnel all affiliated sub-experiences exclusively through it:

- **First-class creator worlds**: Creators have full freedom to build rich, expressive worlds that operate as first-class citizens.
- **System main world cannot be replaced**: Platform transit protocols route through OASIS by design; creator worlds cannot act as system-level transit hubs.
- **OASIS cannot be bypassed**: Direct, unregulated creator-to-creator transit is outside supported protocol contracts.

This boundary is essential: if the central hub could be swapped out arbitrarily, the platform's guarantees of identity continuity and verifiable state would degrade immediately.

## Source Basis

- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
