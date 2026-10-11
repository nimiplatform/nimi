# World State and Atomic Commit Architecture

In Nimi's digital world framework, World State represents the **authoritative present snapshot** of a world. It answers the fundamental question: "What does this world look like right now?". All mutations to a world's state are orchestrated through standardized Commit Envelopes managed atomically by Realm.

For an architectural comparison between live State and append-only History, see [World State vs. History](/platform/worlds/state-vs-history).

## Core Properties of World State

| Property | Value | Architectural Purpose |
| --- | --- | --- |
| **Storage Engine** | Realm Distributed State Tree (`R-WSTATE-*`) | High-availability, sub-millisecond snapshot queries |
| **Data Shape** | Normalized present-time snapshot of the world | Read-optimized; does not require replaying event streams |
| **Mutation Vector** | Strictly through verified Commit Envelopes | Prevents concurrency collisions and ensures auditability |
| **Authority** | Realm core services | System-wide Single Source of Truth |

## Commit Envelope Specifications

Every proposed mutation to world state is encapsulated within a structured envelope:

| Key Field | Description | Invariant & Validation |
| --- | --- | --- |
| `worldId` | Target world being modified | Must resolve to a valid registered world in Realm |
| `appId` | Calling application identity | Caller must hold verified write grants for this world |
| `sessionId` | Active session token | Tracks caller session lineage |
| `effectClass` | Blast radius classification | Declares whether state only or state + history is affected |
| `scope` | Granularity of mutation | `WORLD` (macro), `ENTITY` (single entity), `RELATION` (inter-entity link) |
| `schemaId` / `schemaVersion` | Schema and version reference | Enforces strict schema conformance on mutated attributes |
| `actorRefs` | Actors initiating the action | References users or characters driving the change |
| `reason` | Human-readable intent | Concise operational summary for monitoring and auditing |
| `evidenceRefs` | Supporting evidence references | Links to message IDs, transaction receipts, or user gestures |

Creator authoring tools and third-party extension apps follow the exact same commit envelope schema, ensuring fair, transparent authorization.

## Effect Classes

- `STATE_AND_HISTORY` (Default): Simultaneously updates live world state and permanently appends an immutable entry to the world history ledger.
- `STATE_ONLY`: Updates current state without appending to history (used for transient adjustments, temporary indicators, or cursor positions).
- `NONE` (Dry-Run): Evaluates preconditions and schema compliance without applying state mutations.

## Standard Mutation Flow

1. **Construct Envelope**: The app bundles the operational payload (e.g., player character entering a building).
2. **Submit to Realm**: Dispatches the signed request via the SDK.
3. **Validation & Optimistic Locking**: Realm checks permissions, schema versions, and optimistic concurrency version tags.
4. **Atomic Commit & Broadcast**: Mutation commits atomically to state storage, and incremental delta events broadcast to active world clients.
5. **Audit Archival**: Commit provenance is archived to the local audit ledger.

## Related Documentation

- [World History & Append-Only Log](/realm/world-history)

## Source Basis

- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
