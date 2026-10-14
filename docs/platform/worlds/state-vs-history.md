# State vs History

> Status: Planned contract (design reference). World State (`R-WSTATE-*`) and World History (`R-WHIST-*`) are planned independent Realm contracts, not live callable interfaces. Realm currently exposes no approved controllers or tracked OpenAPI read/write operations for these surfaces, and existing database models do not represent public endpoints. Today, apps interact with world data only through the fixed host-bound `WorldCore`, `WorldCharacter`, `WorldEntity`, and `WorldRelationship` operations.

In the planned world data model, Realm separates two durable records: **state** (what is true in the shared world right now) and **history** (the accepted sequence of what has happened). Neither surface replaces the other, and explicit protocol contracts govern which surface a commit may touch.

## What State Is

| Property | Planned Contract |
| --- | --- |
| Authority | Realm World State owner (`R-WSTATE-*`) |
| Purpose | Durable shared present-state of the world |
| Scope | `WORLD`, `ENTITY`, `RELATION` (`ENTITY` and `RELATION` do not define a generic JSON structure) |
| Mutation method | Explicit commit envelope |
| Commit envelope fields | `worldId`, `appId`, `sessionId`, `effectClass`, `scope`, `schemaId`, `schemaVersion`, `actorRefs`, `reason`, `evidenceRefs` |
| Excluded data | App story runtime variables, prompt context, render state, and cursor or ephemeral state |

World State is strictly for durable shared facts—for example, a character's current shared standing or a world-level condition. It never stores ephemeral UI state, cursor positions, render state, prompt context, or app-local story variables. All updates must arrive in an explicit commit envelope.

## What History Is

| Property | Planned Contract |
| --- | --- |
| Authority | Realm World History owner (`R-WHIST-*`) |
| Purpose | Canonical record of accepted facts and provenance |
| Append posture | Explicit append-only |
| Excluded data | Story traces, raw inference logs, and app-private narrative archives |
| Provenance per event | `worldId`, `appId`, `sessionId`, `actorRefs`, `reason`, `evidenceRefs`, and related state anchors |
| Mutation rule | Append-only; corrections append superseding or invalidating records without silent hard deletion |

World History records accepted facts of what happened: which commit occurred, submitted by which app, with what provenance and evidence references. It is not a raw stream of model tokens or private story transcripts; private story logs never automatically become world history.

## `effectClass` Determines Which Surface Updates

Every commit envelope must explicitly declare an `effectClass`. There is no default `effectClass`:

| `effectClass` | State write | History append |
| --- | --- | --- |
| `NONE` | No | No |
| `STATE_ONLY` | Yes | No |
| `STATE_AND_HISTORY` | Yes | Yes |

`effectClass` is a closed enumeration enforced by protocol contract. Clients cannot omit the field or introduce custom mutation classes.

## Run Mode and Matrix Authorization

Commits are gated by both the execution run mode and an explicit authorization matrix across `appId`, `schemaId`, `schemaVersion`, `effectClass`, and `scope`. Missing envelope fields, unrecognized scopes, unverifiable provenance, or unauthorized matrix combinations cause immediate rejection.

Key authorization rules:

| Rule | Constraint |
| --- | --- |
| `REPLAY` prohibits both State commits and History appends | `REPLAY` runs cannot commit to shared World State or append to World History (`R-WHIST-004`); there is no exception allowing replay runs to write shared state |
| `CANON_MUTATION` requires exact matrix authorization | Even under `CANON_MUTATION`, commits succeed only when the exact `(appId, schemaId, schemaVersion, effectClass, scope)` combination is authorized |
| App-private narrative archives remain App-owned | Owned privately by the App and excluded from Realm history (`R-WHIST-006`) |

## Why Two Separate Surfaces

If state absorbed history:
- Questions like "What was the prior accepted state before this change?" could not be answered from shared records.
- Provenance chains and post-incident reconstruction would be lost.
- Overwriting values in place would erase the sequence of accepted events.

If history absorbed state:
- Reading the current shared state would require replaying historical events on every query.
- Read complexity would grow with the length of the world's chronicle rather than the size of its active state.
- Resolving the current state across concurrent updates would become ambiguous.

Keeping the two surfaces separate allows each commit envelope to declare its exact footprint through `effectClass`.

## Design Scenarios

### `STATE_ONLY`: Durable State Update Without History Append

An authorized app updates a durable shared state value that does not constitute a historical milestone:

1. **Commit envelope**: The app submits the full envelope with an explicit `effectClass: STATE_ONLY` and target `scope` (`WORLD`, `ENTITY`, or `RELATION`).
2. **Contract validation**: Realm verifies the `CANON_MUTATION` run mode, checks the `(appId, schemaId, schemaVersion, effectClass, scope)` authorization matrix, and validates provenance fields.
3. **State updated**: The durable shared state record updates.
4. **History unchanged**: No history entry is appended.

### `STATE_AND_HISTORY`: Canonical Fact Commit

An authorized app commits a milestone change that must be recorded as an accepted historical fact:

1. **Commit envelope**: The app submits the envelope with `effectClass: STATE_AND_HISTORY`.
2. **Contract validation**: Realm validates the schema, provenance (`actorRefs`, `reason`, `evidenceRefs`), `CANON_MUTATION` run mode, and exact matrix permission across app, schema, effect class, and scope.
3. **State updated**: The shared present-state reflects the change.
4. **History appended**: A new append-only record with provenance metadata is written to World History.

### Correcting an Earlier History Record

An earlier accepted history entry requires correction:

1. **No silent hard delete**: The original entry remains intact.
2. **Append a superseding or invalidating entry**: A new record references the prior entry and records the `reason` and `evidenceRefs` for supersession or invalidation.
3. **Intact provenance chain**: Both the original record and the correction remain visible in the append-only log.

### `REPLAY` Run Attempts to Write State or History

A replay consumer re-executes a session under `REPLAY` mode:

1. **Replay executes locally**: The consumer processes events under `REPLAY`.
2. **Shared writes blocked**: If the replay attempts to submit a commit envelope, Realm rejects both shared World State writes and World History appends (`R-WHIST-004`).
3. **No state-write exception**: Replay mode has no fallback path for mutating shared state or history.

### App-Private Narrative Logs

An interactive story app maintains session transcripts and local story variables:

1. **Excluded from Realm**: Story control variables, prompt context, render state, and narrative transcripts stay outside Realm World State and World History.
2. **App-owned storage**: The app persists its private narrative archives in App-owned storage (`R-WHIST-006`).
3. **Clear boundary**: Private story records are never automatically promoted to or represented as canonical world history.

## Architectural Boundaries

- World State and World History are planned independent contracts without live controller or OpenAPI read/write endpoints today.
- World State stores only durable shared state (`WORLD`, `ENTITY`, `RELATION`), never app runtime variables, prompt context, render state, or cursor/ephemeral data.
- `ENTITY` and `RELATION` scopes do not provide a generic unstructured JSON payload.
- `effectClass` (`NONE`, `STATE_ONLY`, `STATE_AND_HISTORY`) has no default value and admits no custom extensions.
- `REPLAY` runs are strictly barred from both shared State commits and History appends.
- `CANON_MUTATION` requires an exact authorization match across `appId`, `schemaId`, `schemaVersion`, `effectClass`, and `scope`.
- History corrections append superseding or invalidating records rather than performing silent hard deletes.

## Boundary Summary

| Concern | Planned Owner |
| --- | --- |
| Durable shared present-state | Realm (`R-WSTATE-*`) |
| Accepted facts and provenance log | Realm (`R-WHIST-*`) |
| Commit envelope validation | Realm (`R-WSTATE-002`) |
| Run-mode and `(app, schema, effect, scope)` authorization matrix | Realm (`R-WSTATE-005`) |
| `effectClass` closed enumeration | Realm (`R-WSTATE-004`) |

## Source Basis

- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
