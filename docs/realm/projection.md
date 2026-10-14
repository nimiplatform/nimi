# Realm State Projection Mechanics

In Nimi's distributed architecture, client applications consume data from Realm through structured, **read-only State Projections** provided by the SDK. Projections serve UI presentation layers in the supported desktop and web experiences, while authoritative data invariants and persistence remain governed by Realm.

## Consumer Layering and Invariants

| Layer | Responsibility | Architectural Rationale |
| --- | --- | --- |
| **SDK Generated Core** | Compiled directly from external Realm OpenAPI specifications | Types follow the checked-in contract; the deployed service must support that contract |
| **SDK Facade** | Preserves typed requests, retry policies, and structured errors; Runtime holds credentials for protected App access | Simplifies application development while shielding transport nuances |
| **Application & Desktop Views** | Renders state projections and manages ephemeral UI caches | Caches optimize rendering responsiveness; authoritative state lives upstream |

## Protocol Evolution and Anti-Drift Strategy

When Realm APIs evolve across releases:
- **Schema-Driven Regeneration**: Re-compile SDK core models from updated OpenAPI specifications to maintain strict contract compliance.
- **Fail-Closed Diagnostics**: If schema mismatch or API drift is detected, SDK facades emit structured error reasons, guiding developers to upgrade dependencies rather than risking silent client corruption.

## Related Documentation

- [Unified Glossary](/reference/glossary)

## Source Basis

- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
