# Realm Authoritative State and Architectural Boundaries

In Nimi's distributed architecture, shared invariants across all digital worlds—including universal account identities, social relationship graphs, creator economics, digital asset ownership, and world lifecycle rules—are authoritatively governed by Realm as the **Single Source of Truth**.

Local applications and desktop clients do not define or mutate these global invariants unilaterally. Instead, they interact with and consume authoritative state projections through type-safe interfaces provided by the SDK.

## Division of Responsibilities

| Platform Component | Primary Responsibility |
| --- | --- |
| **SDK Generated Realm Core** | Type-safe data access models and schemas compiled from Realm OpenAPI specifications |
| **SDK Realm Facade** | Manages session credential injection, retries, fail-closed error mapping, and transport scheduling |
| **Runtime / Desktop / Web** | Presentation and consumer surfaces that render read-only projections received from Realm |

## Core Invariants and Boundaries

- **Unified Authority**: Cross-world social networks, asset transfers, and creator payout rules are enforced centrally by Realm; local clients do not maintain conflicting local arbitration engines.
- **Identity Integrity**: Universal cryptographic identities and cross-world travel passes are issued exclusively by Realm.
- **Fail-Closed Semantics**: If Realm connectivity is interrupted or schema mismatch occurs, the platform surfaces explicit unavailable states, preventing fabricated local success.

Application developers should consume Realm services exclusively via `@nimiplatform/sdk`, avoiding manual endpoint stitching or synthesized local mock schemas.

## Related Documentation

- [World State vs. History](/platform/worlds/state-vs-history)

## Source Basis

- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
