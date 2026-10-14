# OASIS

In Nimi's core platform protocol, OASIS is defined as the unique **system main world** and the canonical hub for cross-world transit and fallback return. It belongs to no individual creator and cannot be replaced by app-local conventions.

> **Current Implementation Boundary**: OASIS's role as the transit and return hub is a core protocol semantic. In the current Home experience, browsing world details only reads world metadata (`WorldCore`)—it does not invoke the `Transit` primitive, trigger automatic world-hopping, or switch an active world.

## What OASIS Is

| Property | Protocol Definition |
| --- | --- |
| Status | The globally unique system main world |
| Authority | Core entity within canonical Realm authority |
| Ownership | Platform-level public world; cannot be owned by any third-party creator |
| Replaceability | Non-replaceable; cannot be superseded by app conventions |
| Protocol Role | Canonical transit hub and default fallback return target between creator worlds |
| Realm Read Endpoint | `GET /api/realm/core/oasis` (exposed by Realm for canonical OASIS queries) |

OASIS is neither a marketing label nor a disposable tutorial scene that creators can clone or bypass. It anchors the platform's multi-world topology at the protocol layer.

For application developers, `GET /api/realm/core/oasis` documents the underlying Realm read route. Client surfaces and protected Apps should consume OASIS data through `@nimiplatform/sdk` (with Runtime managing credentials and proxy channels for protected Apps) rather than stitching raw REST requests.

## Why the Protocol Defines OASIS

Cross-world platforms that rely on arbitrary peer-to-peer (P2P) jumps between creator worlds quickly face $N \times N$ policy complexity and fragmented state. Nimi's protocol addresses this through a hub-and-spoke contract centered on OASIS:

- **Single-hop transit contract**: In the protocol model, creator worlds do not establish unregulated direct peer transits. Cross-world routes are modeled through OASIS (`World A → OASIS → World B`), turning $N \times N$ peering rules into $N$ standardized contracts with the system main world.
- **Canonical return target**: The protocol designates OASIS as the default destination when a participant exits a creator world or when a creator world becomes unavailable, avoiding reliance on any third-party creator world as a fallback anchor. (This does not imply OASIS or Realm is immune to outages; if Realm or OASIS itself is unreachable, consumers follow fail-closed semantics and surface an explicit unavailable state.)

## OASIS Compared to Traditional Metaverse Hubs

Traditional fiction often portrays a central hub as a monolithic 3D physics engine simulating an entire universe. Nimi defines OASIS instead as a **semantic and social authority anchor** within the platform protocol.

| Property | Traditional Metaverse Hub | Nimi OASIS |
| --- | --- | --- |
| Substrate | Monolithic physics simulation and rendering pipeline | Semantic models and Realm-governed authority state |
| Rule system | Sub-worlds inherit centralized physics/engine rules | Each world defines its own internal gameplay and scene logic |
| Cross-world identity | Often loosely coupled or tied to a single game engine | Governed by Realm with protocol-defined continuity |
| Hub authority | Proprietary lobby convention | Canonical entity governed by core platform protocol |
| Replaceability | Subject to app-level redesign | Core protocol anchor; cannot be replaced by creator worlds |

## Protocol Contract Scenarios

The following scenarios illustrate how OASIS functions within the target `Transit` protocol contracts. As noted above, current Home world-detail browsing does not execute live `Transit` routing or automatic session migration.

### Contract Scenario 1: Routing Between Two Creator Worlds

When a cross-world transition from World A to World B is executed under the `Transit` contract:

1. **Initiate transit**: The transition request is structured and validated against the `Transit` primitive contract.
2. **Hub routing**: The protocol routes the transition path through OASIS (`World A → OASIS → World B`) rather than permitting unverified direct jumps between creator worlds.
3. **Identity consistency**: Account identity, character settings, and social relationships remain anchored in Realm throughout the transition; neither world can forge an unverified identity.
4. **Local admission**: World B evaluates its own scene admission and gameplay rules while respecting the user's Realm-backed identity and permissions.

### Contract Scenario 2: Fallback Target When a Creator World Is Unavailable

In the protocol contract for handling an unreachable creator world:

- **Without a system main world**: A platform has no canonical destination to target when a third-party world goes offline.
- **With the OASIS return contract**: OASIS serves as the designated fallback destination so that return routing does not depend on another creator's world availability. If Realm or OASIS itself is unavailable during a request, the client fails closed and reports the unavailable state explicitly rather than fabricating a local fallback session.

### Contract Scenario 3: Creator Autonomy and Hub Boundaries

Suppose a creator builds a large-scale world and wants to link several related experiences around it:

- **Full creative freedom inside worlds**: Creators can build rich, first-class worlds with custom internal rules and local admission conditions.
- **System main world is non-replaceable**: A creator world cannot replace OASIS as the platform's system main world or act as an unauthorized system-level transit hub.
- **Owner and protocol boundaries**: No world or App can bypass OASIS in protocol transit contracts or override owner authority in Realm.

## Source Basis

- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
