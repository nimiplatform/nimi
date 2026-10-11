# State vs History

> Status: Active specification. World State (`R-WSTATE-*`) and World History (`R-WHIST-*`) are live Realm surfaces with distinct, complementary roles.

A world maintains two durable records in Realm: its **state** (what is true right now) and its **history** (the sequence of what happened). They are fundamentally distinct, neither replaces the other, and explicit platform contracts determine which surface an event mutates.

## What State Is

| Property | Value |
| --- | --- |
| Authority | Realm World State owner (`R-WSTATE-*`) |
| Purpose | Shared present-state of the world |
| Scope | Durable shared scopes only: `WORLD`, `ENTITY`, `RELATION` |
| Mutation method | Explicit commit envelope |
| Story-local control variables | Managed privately by the App; not stored in Realm |

State expresses the current shared truth: a character is at a specific location, a relationship has reached a particular milestone, or an entity possesses certain attributes. State changes exclusively through explicit commit envelopes.

## What History Is

| Property | Value |
| --- | --- |
| Authority | Realm World History owner (`R-WHIST-*`) |
| Purpose | Canonical record of verified facts and audit provenance |
| Append posture | Explicit append-only |
| Story trace / raw inference logs / app-private archives | Excluded from Realm history |
| Provenance per event | `appId`, `sessionId`, `actorRefs`, `reason`, `evidenceRefs`, and related state anchors |
| Mutation rule | Append-only; corrections model supersession or invalidation without silent hard deletion |

History stores the verified sequence of what has occurred: which turn committed a change, authored by which app under what run mode. It is not an uncurated stream of model generation tokens, but rather the official chronicle of platform-verified events.

## The `effectClass` Determines Which Surface Updates

Every commit envelope declares an explicit `effectClass`:

| `effectClass` | State write | History append |
| --- | --- | --- |
| `NONE` | No | No |
| `STATE_ONLY` | Yes | No |
| `STATE_AND_HISTORY` | Yes | Yes |

Clients must not introduce custom mutation classes; this closed enumeration is strictly enforced by protocol contracts.

## Run Mode Authorization

State writes require explicit app authorization, validated against an `(appId, schemaId, schemaVersion, effectClass) -> runMode` matrix alongside strict schema enforcement. Missing schema fields, unrecognized scopes, unverifiable provenance, or unauthorized run modes cause immediate rejection.

History append constraints:

| Rule | Constraint |
| --- | --- |
| `REPLAY` runs may NOT append to shared world history | `R-WHIST-004` |
| Only `CANON_MUTATION` rows authorized by the matrix may append | `R-WHIST-004` |
| App-private narrative archives | Owned privately by the App; excluded from Realm history (`R-WHIST-006`) |

## Why Two Separate Surfaces

If state absorbed history:
- "Has this entity ever been in another location?" becomes unanswerable.
- Auditability, deterministic replay, and post-incident reconstruction are lost.
- Relying on silent overwrites to patch data destroys audit trails.

If history absorbed state:
- Answering "Where is this entity right now?" requires replaying the entire history stream on every query.
- App read operations incur unbounded latency and compute costs.
- Under high concurrency, determining the "current" state becomes ambiguous.

Two dedicated surfaces serve a unified data model. Every event explicitly declares which surface it touches via `effectClass`.

## Typical Scenario: A `STATE_ONLY` Mutation

An app writes a transient world-state update without archival significance:

1. **Commit envelope**: The app submits with `effectClass: STATE_ONLY`.
2. **Realm validation**: Schema structure, provenance credentials, and run-mode permissions pass.
3. **State updated**: The world present-state reflects the change immediately.
4. **History unchanged**: No history row is appended; the update is stateful but not historical.

## Typical Scenario: A `STATE_AND_HISTORY` Mutation

An app commits a canonical milestone mutation:

1. **Commit envelope**: The app submits with `effectClass: STATE_AND_HISTORY`.
2. **Realm validation**: Passes base checks and verifies that the current run mode authorizes history append (`CANON_MUTATION`).
3. **State updated**: The world present-state updates accordingly.
4. **History appended**: A new row with full provenance metadata lands in history.
5. **Traceability**: Future replays or audits can reference this entry reliably.

## Typical Scenario: A Correction

An earlier history entry needs correction:

1. **No silent hard delete**: The original entry remains; corrections are modeled as superseding or invalidating events.
2. **Append a correction event**: The new entry references the previous ID and documents the rationale for supersession.
3. **Append-only integrity**: Auditors inspect both the original entry and the corrective action, preserving the provenance chain.

The append-only invariant ensures that Realm history serves as an immutable, long-term audit trail.

## Typical Scenario: A Replay Consumer Attempts to Write History

A replay consumer attempts to append history during execution:

1. **Replay executes**: Mutations are re-derived under `REPLAY` mode.
2. **Append blocked**: Per `R-WHIST-004`, `REPLAY` runs cannot append to shared history.
3. **Controlled state write**: If the authorization matrix permits state updates for this run mode, state changes apply while history remains unpolluted.
4. **Audit integrity**: The replay path is clearly marked; shared Realm history is untouched.

## Typical Scenario: An App Manages Private Narrative Logs

An interactive story app needs per-session narrative logs:

1. **Excluded from Realm history**: Realm history stores verified platform facts only.
2. **App-owned storage**: The app persists its narrative transcripts in its private store (`R-WHIST-006`).
3. **Clear boundary**: The app does not represent private narrative logs as Realm canonical history.

## Architectural Boundaries

- State and history remain distinct surfaces without implicit merging.
- `effectClass` is a closed enumeration with no ad-hoc extensions.
- Realm disallows covert writes outside the explicit commit envelope.
- `REPLAY` runs cannot append to history silently.
- App-private archives never become Realm canonical state.
- History entries are never silently hard-deleted.

## Boundary Summary

| Concern | Owner |
| --- | --- |
| Shared present-state | Realm (`R-WSTATE-*`) |
| Canonical facts and audit provenance | Realm (`R-WHIST-*`) |
| Commit envelope validation | Realm (`R-WSTATE-002`) |
| Run-mode authorization matrix | Realm (`R-WSTATE-005`) |
| `effectClass` closed enumeration | Realm (`R-WSTATE-004`) |

## Source Basis

- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
