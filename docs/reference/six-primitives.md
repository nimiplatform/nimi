# Six Core Primitives

The Nimi platform defines six universal cross-world primitives (under the `P-PROTO-*` rule family) that form the foundational contract surface across digital worlds. Individual worlds maintain autonomy over their internal mechanics and narrative storylines, while cross-boundary transactions and states conform to these six core primitives.

## The Six Primitives Overview

| Primitive | Rule Prefix | Core Responsibility | Architectural Purpose |
| --- | --- | --- | --- |
| **Timeflow** | `P-PROTO-100` | Progression, clocks, and temporal ordering | Coordinates multi-user temporal consistency |
| **Social** | `P-PROTO-101` | Universal relationship graph and friendship networks | Universal identity bonds; eliminates per-world contact re-adds |
| **Economy** | `P-PROTO-102` | Value flows, exchanges, and settlement ledgers | Verifiable, audit-ready financial bookkeeping |
| **Transit** | `P-PROTO-103` | Cross-world movement, routing, and continuity | Guarantees identity persistence via OASIS hub-and-spoke |
| **Context** | `P-PROTO-104` | Shared environmental setting and world lore | Consistent conceptual semantics across heterogeneous apps |
| **Presence** | `P-PROTO-105` | Active occupancy, coordinates, and participant availability | Spatial awareness and scene admission |

## Tiered Architectural Authorities

| Layer | Responsibility |
| --- | --- |
| **Platform Protocol** | Establishes schema definitions, versioning rules, and contract validation criteria |
| **Realm Core** | Server-side Single Source of Truth and semantic execution engine for primitives |
| **Applications (App)** | Consumes and renders projections via SDK, submitting compliant actions |

## Cross-Primitive Invariants

Complex interactions often intersect multiple primitives. Realm enforces atomic compliance across interdependent domains:
- **Transit Compound Gates**: Transitioning between worlds requires concurrent validation across Social (entry access), Economy (travel fees or item transfers), and Context (lore compatibility).
- **Presence Conditioned on Social**: Registering active presence in protected worlds requires clearing social admission prerequisites.
- **Timeflow & Economic Windows**: World clock ticks respect economic settlement windows to preserve financial auditability.

## Strict Contract Conformance

- **Explicit Schema Versioning**: Each primitive interaction declares explicit schema identifiers and versions.
- **Fail-Closed Diagnostics**: Payloads that deviate from declared schemas fail closed with structured error codes, pointing developers directly to missing or malformed attributes.

## Related Documentation

- [Cross-World Transit Architecture](/realm/transit)
- [Universal Social Graph & Economy](/realm/social-and-economy)

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
