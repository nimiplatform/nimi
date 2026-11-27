# Six Core Primitives

Nimi defines six cross-world protocol primitives under the `P-PROTO-*` rule family. Each digital world retains control over its internal rules and narrative, while cross-world state and interactions follow these six foundational contracts.

## The Six Primitives Overview

| Primitive | Rule Prefix | Core Responsibility | Architectural Purpose |
| --- | --- | --- | --- |
| **Timeflow** | `P-PROTO-100` | World clocks, progression rates, and temporal ordering | Keeps multi-user and agent timelines consistent |
| **Social** | `P-PROTO-101` | Cross-world relationship graph and contact networks | Preserves social bonds across worlds without re-adding contacts |
| **Economy** | `P-PROTO-102` | Protocol-level value-transfer and exchange contract fields | Defines canonical value-conservation contract semantics (no active Realm Creator Economy or settlement API) |
| **Transit** | `P-PROTO-103` | Cross-world routing, movement, and session continuity | Maintains identity continuity across worlds via the OASIS hub-and-spoke model |
| **Context** | `P-PROTO-104` | Environmental settings and canonical world lore | Gives diverse apps a shared schema for world semantics |
| **Presence** | `P-PROTO-105` | Active occupancy, location coordinates, and availability | Coordinates scene admission and multi-participant awareness |

## Tiered Architectural Authorities

| Layer | Responsibility |
| --- | --- |
| **Platform Protocol** | Defines schemas, versioning rules, and validation contracts |
| **Realm Core** | Acts as the server-side Single Source of Truth and arbiter for cross-world primitives |
| **Applications (App)** | Renders state projections and submits compliant requests through admitted SDK operations |

## Cross-Primitive Invariants

Cross-world actions often span multiple primitives. The protocol specifies atomic checks across dependent domains:
- **Transit Compound Gates**: Moving between worlds checks Social (entry eligibility), Economy (protocol-level transfer constraints when applicable), and Context (lore compatibility) together.
- **Presence Conditioned on Social**: Entering active presence in a protected world requires meeting its Social admission rules first.
- **Timeflow & Economic Windows**: Under the protocol contract, world clock progression aligns with Economy accounting windows when Economy contracts are active.

## Strict Contract Conformance

- **Explicit Schema Versioning**: Every primitive payload declares its schema identifier and version.
- **Fail-Closed Diagnostics**: Payloads that do not match the declared schema fail closed with structured error codes that pinpoint missing or invalid fields.

## Related Documentation

- [Cross-World Transit Architecture](/realm/transit)
- [Social Graph](/realm/social-and-economy)

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
