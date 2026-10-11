# Worlds Architecture Overview

Worlds (`World`) are the core operational domains and experiential environments of the Nimi platform.

## What is a World

In Nimi, a World is a persistent interactive environment: characters reside within it, and narratives unfold continuously over time. Every world features creator-defined lore and operational rules, shared present-state that outlasts any individual user session, and an append-only audit history logging significant events.

Participants (human users and AI agents alike) are not local constructs of a single world: they arrive equipped with globally recognized character identities, established social graphs, and virtual asset balances valid across all worlds.

A world is **not**:
- **A Chat Room**: Dialogue represents an interaction surface inside a world; the world provides the surrounding environment that gives dialogue narrative context.
- **A Game Campaign**: Campaigns are transient game sessions; a world continues evolving even when human participants are offline.
- **A Single Level**: Levels are scripted encounters; a world operates under persistent rules and cumulative history independent of any single visit.
- **An Application**: Applications project platform surfaces; a world is the authoritative domain being projected.

A world functions as a consistent digital micro-universe: created by authors, animated by participants, and durable over time.

## The Three Dimensions of a World

Every world in Realm comprises three distinct, complementary architectural layers. See [State vs History](/platform/worlds/state-vs-history) for in-depth analysis.

| Dimension | Architectural Question Answered | Governing Authority |
| --- | --- | --- |
| **Truth** | Authoritative settings, foundational contracts, rules, and core objects governing the world (evolvable via authorized releases) | Realm `R-TRUTH-*` |
| **World State** | The current shared operational state (locations, relations, entity attributes) | Realm `R-WSTATE-*` |
| **World History** | The immutable, auditable log of accepted state mutations explaining how the world reached its current state | Realm `R-WHIST-*` |

Conflating these dimensions compromises system integrity: a world without truth lacks invariant rules; a world without state cannot render the present; a world without history cannot audit the past.

## Adjacent Realm Services

Worlds are augmented by adjacent Realm services:

| Realm Service | Architectural Responsibility |
| --- | --- |
| **Direct Chat** | Peer-to-peer thread synchronization, message delivery, and read-receipt tracking |
| **Social Graph** | Friendship admission and social topology gating interaction prerequisites |
| **Economy** | Creator monetization, credential ledgers, and transaction settlements |
| **Assets & Bindings** | World-bound models, resource bundles, and attachments to entities |
| **Transit** | Hub-and-spoke spatial routing between worlds via the OASIS system world |

These services are coordinated by Realm, transforming static data stores into immersive virtual worlds.

## Section Contents

- [State vs History](/platform/worlds/state-vs-history): Mutation envelopes and the `effectClass` model governing state updates versus history appends.
- [OASIS](/platform/worlds/oasis): The unique system main world and central transit hub.
- [Lifecycle](/platform/worlds/lifecycle): Creation, atomic release packaging, application binding, suspension, and revocation.

For schema-level field definitions, see [Reference → World Fields](/reference/world-fields).

## Scenario: Entering a World

When a user signs into Nimi and visits a world created by a friend:

- **Ecosystem Identity**: The user's account identity remains identical to their identity across Nimi. The world admits the user without redefining their persona.
- **Asset Portability**: Wallets, friendships, and global asset inventories are accessible within the world without state duplication.
- **Local Rule Enforcement**: The world enforces custom internal rules (e.g., custom local scrip or accelerated diurnal cycles). These local rules apply exclusively within the world and do not retroactively mutate global account standings.
- **Private Memory**: Dialogue with resident agents is continuous; agent memories are managed per agent by Cognition and accessed via Runtime, preventing leakage into public world state.
- **Hub Transit**: Departing the world routes through OASIS, ensuring verified identity continuity.

## Scenario: Publishing a World

When an author designs and publishes a new world:

- **Authoring Invariant Truth**: The creator defines core rules, resident character assets, scenes, and visual configurations.
- **Atomic WorldRelease**: The creator commits a `WorldRelease` package—an atomic transaction freezing truth schemas, resource checksums, and version metadata. Rollbacks are executed as forward-moving release operations.
- **Decoupled Local Economy**: Worlds may maintain internal tokens or point economies while platform settlement rails remain decoupled.
- **Destination Admission**: Once published, the world becomes an active destination reachable via OASIS transit.

## Source Basis

- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
