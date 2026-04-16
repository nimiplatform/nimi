# Cognition Memory Service Contract

> Owner Domain: `C-COG-*`

## C-COG-039 Memory Service Operation Registry

The authoritative standalone cognition memory operation registry is
`tables/memory-service-operations.yaml`.

Fixed rules:

- every admitted memory service operation must appear in the registry exactly
  once
- every registered memory operation must declare admitted inputs, identity
  invariants, validation posture, retrieval posture, lifecycle effects,
  derived-view behavior, fail-closed reasons, and non-ownership boundary
- memory capability admission must be grounded in this registry rather than
  inferred from implementation naming alone

## C-COG-040 Memory Artifact Mutation And Deletion Semantics

Standalone cognition memory owns local artifact mutation over memory records.

Fixed rules:

- memory save paths must validate scope identity, record identity, and
  family-specific payload shape before commit
- save semantics may admit create-or-update behavior, but create/update
  ambiguity must remain explicit in operation-level contract and history output
- explicit delete semantics are required for public memory ownership; silent
  disappearance is not admitted as a delete contract
- archive or remove lifecycle changes triggered by digest must remain observable
  through memory history or lifecycle-bearing views
- caller-owned payload must not persist service-owned support, cleanup, drift,
  or serving metadata as if it were raw memory truth

## C-COG-041 Memory Retrieval, History, And Derived View Semantics

Standalone cognition memory retrieval must remain service-grade and explainable.

Fixed rules:

- raw artifact reads and derived serving-view reads must remain separate
  contracts
- retrieval posture must declare at least lexical retrieval behavior, derived
  support, lineage, invalidation, and cleanup-signal posture, and ordering
  semantics for list/search surfaces
- history or lineage reads must expose lifecycle-relevant transitions rather
  than forcing clients to infer them from current snapshot state
- derived views may project support or cleanup signals only when those fields
  are recomputed by a service-owned derivation path
- derived views may expose lineage and invalidation only when those fields are
  recomputed from live refs and current dependency state at read time
- memory retrieval must not silently pretend parity with runtime recall/history
  while exposing only a weaker storage lookup

## C-COG-042 Memory Non-Ownership Boundary

Standalone cognition memory remains independent from runtime-owned operational
infrastructure concerns.

Fixed rules:

- memory service does not own runtime provider routing, embedding bridge,
  replication truth, canonical review scheduling, or runtime event streaming
- standalone memory may expose lifecycle and history semantics, but that does
  not make it a runtime replication owner
- runtime-facing republication of overlapping memory semantics must route
  through `RuntimeCognitionService`; retired `RuntimeMemoryService` topology
  must not be restored as the future steady state
- derived-view support does not permit caller-owned mutation of service-owned
  ranking or cleanup posture
