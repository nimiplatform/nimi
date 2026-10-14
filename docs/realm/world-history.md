# World History and Append-Only Ledger

> **Status — Design Reference**: `WorldHistory` and `WorldState` are planned independent contracts. They do not currently expose approved controllers or tracked OpenAPI read/write operations, and any existing database models are internal residuals rather than callable interfaces. Today, applications read and manage world settings and characters through `WorldCore`, `WorldCharacter`, `PersonaCharacter`, `WorldEntity`, and `WorldRelationship`.

In Nimi's world modeling architecture, **World History** (`R-WHIST-*`) specifies how a digital world records admitted, occurred facts and their provenance over time. Designed as an **append-only** chronological ledger, it answers the question: *"How did this world evolve into its present state?"*

Private story logs, ephemeral conversation turns, prompt context, and local application state never automatically become world history. Only explicitly admitted world mutations leave a record on the shared timeline.

## Core Properties of the Planned Contract

| Dimension | Specification | Design Purpose |
| --- | --- | --- |
| **Contract Scope** | Realm World History (`R-WHIST-*`) | Records admitted world facts rather than private session or UI state |
| **Mutability** | Strictly Append-Only | Prevents silent overwrites and retrospective timeline tampering |
| **Execution Mode** | `REPLAY` vs. `CANON_MUTATION` | Isolates read-only simulation and replay from live world mutations |
| **Commit Envelope** | `worldId`, `appId`, `sessionId`, `effectClass`, `scope`, `schemaId`, `schemaVersion`, `actorRefs`, `reason`, `evidenceRefs` | Ensures every history entry carries explicit scope, actor provenance, rationale, and evidence |
| **Correction Model** | Appended superseding or invalidation records | Preserves the full revision trail without hard deletion |

## Commit Envelope and Effect Classes

In the planned write model, a submission to Realm must declare its target `scope` (`WORLD`, `ENTITY`, or `RELATION`) and its `effectClass` (`NONE`, `STATE_ONLY`, or `STATE_AND_HISTORY`). There is no default `effectClass`; every request must specify its intended effect explicitly:

- **`NONE`**: No shared state mutation and no history entry.
- **`STATE_ONLY`**: Updates persistent shared `WorldState` without appending an event to `WorldHistory`.
- **`STATE_AND_HISTORY`**: Commits the state change and appends the admitted fact to `WorldHistory` alongside `actorRefs`, `reason`, and `evidenceRefs`.

## Strict Isolation of Execution Modes

- **Replay Mode (`REPLAY`)**: Used for narrative re-simulation or timeline inspection. `REPLAY` strictly prohibits both shared `WorldState` commits and `WorldHistory` appends, with no exceptions.
- **Canon Mutation (`CANON_MUTATION`)**: Live operations that advance world state and/or append authoritative history entries. Every `CANON_MUTATION` request must pass an exact authorization matrix matching `appId`, `schemaId` / `schemaVersion`, `effectClass`, and `scope`.

## Corrections and Invalidation

Because the ledger is append-only, committed history records are never silently rewritten or hard-deleted. When a previously admitted fact needs to be corrected, the contract requires appending a new record:

1. **Superseding**: Appends a new record that explicitly references the prior entry, supplying updated attributes alongside the `reason` and `evidenceRefs`.
2. **Invalidation**: Appends an explicit invalidation record marking the prior entry as inactive for subsequent state evaluation.
3. **Preserved Provenance**: The original record remains on the timeline so readers can trace both the initial fact and the subsequent correction.

## World Modeling Layers

| Layer | Fundamental Question | Current & Planned Representation |
| --- | --- | --- |
| **World Settings & Characters** | What are the core lore, entities, and characters of this world? | **Available today**: `WorldCore`, `WorldCharacter`, `PersonaCharacter`, `WorldEntity`, and `WorldRelationship` (through resource-specific operations; App access to `WorldRelationship` is read-only) |
| **World State** | What is the persistent shared state of the world right now? | **Planned contract**: Present-time shared state (`WorldState`) |
| **World History** | What admitted facts brought the world here? | **Planned contract**: Append-only fact ledger (`WorldHistory`) |

## Related Documentation

- [World State Architecture](/realm/world-state)

## Source Basis

- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
