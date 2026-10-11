# World Lifecycle Management

Worlds in Nimi are built for long-term operational continuity. This document details the end-to-end lifecycle of a World: from conceptual authoring and atomic publishing, to application binding, ongoing maintenance, and eventual suspension or deprecation. Underlying state machines are governed authoritatively by Realm.

For schema-level state definitions, see [Reference → State Machines](/reference/state-machines) and [Reference → World Fields](/reference/world-fields).

## Authoring and Atomic Publishing

Creators design worlds using authoring suites. Tooling maintains the canonical `WorldCore` alongside verified resident characters (`WorldCharacterCore`), timeline tracks, spatial scenes, historical event structures, and product metadata.

The publishing operation is executed as an atomic commit (`Core Commit`) via a `WorldCoreIngressPackage` or a delta `CorePatch`, freezing verified core object states into an immutable canonical release. A commit strictly includes:

- **Core Schema Version**: Guaranteeing serialization compatibility;
- **Provenance Attestation**: Signing identity and build tooling metadata;
- **Checksums & Diff Manifests**: Ensuring artifact integrity and tamper-proofing;
- **Lineage Tree**: Declaring replacement or patch lineage.

**Atomicity is fundamental**: World core schemas, character entities, scenes, timelines, and history records land in a single transactional commit. Partially published or inconsistent worlds are rejected.

The publication package distinguishes four primary components:

| Component | Responsibility & Architectural Scope |
| --- | --- |
| **Core World Object** | Identity, ownership, timeflow models, timeline tracks, history, and presentation metadata |
| **Core Character Objects** | Canonical characters resident within and bound to the world |
| **Runtime Snapshot Inputs** | By-value materialization payloads required by Runtime to instantiate LocalAgents |
| **Governance & Metadata** | Semantic versioning, cryptographic provenance, and compliance audit records |

Lorebooks and prompt templates do not serve as the canonical center of the package. They represent source attributes or downstream inference inputs, but never supersede core world schemas.

## Rollback as a Forward Release Operation

When an active release exhibits critical defects, rolling back is itself executed as a forward-moving release transaction—not an ad-hoc overwrite or physical deletion of existing release history.

- The rollback `WorldRelease` explicitly references the preceding verified good release ID;
- Rollback lineage is embedded as immutable metadata within the release record;
- World history permanently logs the rollback as a `CANON_MUTATION` run;
- The defective release is never deleted from history; it is formally superseded.

This design guarantees unbroken auditability: retrospective reviews can verify exactly what was superseded, when, and why.

## App-to-World Binding Contracts

Worlds typically require client applications for interactive user experiences. Application bindings operate under two distinct modes:

| Binding Mode | Reads World State | Mutates/Writes World State | Concurrency Limit Per World |
| --- | --- | --- | --- |
| **Render App (`render-app`)** | Yes | No (Read-Only) | Multiple concurrent connections |
| **Extension App (`extension-app`)** | Yes | Yes (Read-Write) | At most one active binding per world |

A world allows at most one active **extension app (`extension-app`)** binding at any given time, eliminating conflicting writes. Multiple read-only **render apps (`render-app`)** may connect simultaneously without blocking each other.

### Binding Lifecycle State Machine

```
(new) ──admit──▶ active ──suspend──▶ suspended ──resume──▶ active
                  │                                          │
                  └────────────────revoke──────────────────────────▶ revoked
```

| Lifecycle State | Operational Meaning |
| --- | --- |
| `(new)` | World is published; no extension app is currently bound |
| `active` | An admitted extension app is bound with authorized write access |
| `suspended` | Binding is temporarily frozen; resumption requires explicit re-admission |
| `revoked` | Binding is permanently dissolved; the world is freed for new application admission |

Suspension is reversible; revocation is terminal. Replacing an extension app requires revoking the incumbent first—the platform never silently transfers write authority between applications.

## Spatial Transit and World Availability

Published worlds join the global transit network. Cross-world navigation routes exclusively through the system world OASIS (see [OASIS](/platform/worlds/oasis)). Worlds without an active extension app remain fully accessible in read-only mode to render apps.

If a creator takes a world offline for maintenance, active participants within that world are routed back to the OASIS hub automatically. User identities, friendship graphs, and asset inventories remain unaffected.

## Scenario: Publishing a World End-to-End

1. **Author Axioms**: Define world rules, resident characters, scenes, and visual bindings;
2. **Stage Draft Artifacts**: Assemble minimal staging sets (`importSource`, `truthDraft`, `stateDraft`, `historyDraft`) locally;
3. **Assemble Package**: Package drafts into a standardized bundle separating core rules, derived configs, and signatures;
4. **Execute Atomic Release**: Submit via `WorldRelease`, locking object schemas and content hashes;
5. **Join Transit Grid**: The world becomes an active destination reachable from OASIS, readable by render apps, and open for extension app admission;
6. **Audit Inscription**: World history records the release transaction as a permanent `CANON_MUTATION` milestone.

## Scenario: Replacing an Active Extension App

When an author transitions an active binding from Extension App A to Extension App B:

1. **Revoke Incumbent**: Author revokes App A; its binding transitions from `active` to `revoked`, immediately extinguishing write authority.
2. **Admit Successor**: Author binds App B; its binding transitions from `(new)` to `active`, granting write permissions.
3. **Eliminate Concurrency Race**: No overlapping window exists where both apps hold write privileges.

This strict mutual exclusion preserves a single authoritative present-state for the world.

## Source Basis

- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
