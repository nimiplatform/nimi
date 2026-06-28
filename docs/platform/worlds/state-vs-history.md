# State vs History

> Status: Running today. World State (`R-WSTATE-*`) and World
> History (`R-WHIST-*`) are shipped Realm authority surfaces with
> distinct, complementary roles.

A world has two durable Realm-owned surfaces: **state** (what is
true now) and **history** (what happened). They are not the same
thing, they don't replace each other, and the rule for when an
event affects which surface is contractual.

## What State Is

| Property | Value |
| --- | --- |
| Authority | `realm/kernel/world-state-contract.md` (`R-WSTATE-*`) |
| Purpose | Shared present-state of the world |
| Scope | Durable shared scopes only: `WORLD`, `ENTITY`, `RELATION` |
| Mutation method | Explicit commit envelope |
| Story-local control variables | NOT in Realm — they stay outside |

State expresses the current shared truth: a character is in this
location, this relationship has this status, this entity has these
attributes. State changes only through the commit envelope.

## What History Is

| Property | Value |
| --- | --- |
| Authority | `realm/kernel/world-history-contract.md` (`R-WHIST-*`) |
| Purpose | Canonical happened facts |
| Append posture | Explicit append |
| Story trace / raw turn logs / app-private archives | NOT in Realm history |
| Provenance per event | `appId`, `sessionId`, `actorRefs`, `reason`, `evidenceRefs`, related state/truth anchors |
| Mutation | Append-only; corrections via supersede or invalidation; no silent hard delete |

History stores the canonical record of what happened: this turn
committed this mutation, this event was admitted by this app under
this run mode. It is not a log of every model token. It is the
admitted record of canonical events.

## The `effectClass` Determines Which Surface Updates

Every commit envelope declares an `effectClass`:

| `effectClass` | State write | History append |
| --- | --- | --- |
| `NONE` | No | No |
| `STATE_ONLY` | Yes | No |
| `STATE_AND_HISTORY` | Yes | Yes |

Clients must not invent additional mutation classes. The closed
enum is the contract.

## Run Mode Authorization

State writes require explicit app authorization through an
`(appId, schemaId, schemaVersion, effectClass) -> runMode` matrix
plus fail-close schema validation. Missing schema fields,
unrecognized scope, unverifiable provenance, or unauthorized run
mode reject the commit.

History append constraints:

| Rule | Value |
| --- | --- |
| `REPLAY` runs may NOT append shared world history | `R-WHIST-004` |
| Only `CANON_MUTATION` rows authorized by the matrix may append | `R-WHIST-004` |
| App-private narrative archives | App-owned, not Realm history (`R-WHIST-006`) |

## Why Two Surfaces

If state absorbed history:
- "Has this entity ever been in another location?" becomes
  unanswerable
- Audit / replay / reconstruction is impossible
- Corrections by silent overwrite become a side door to lose
  truth

If history absorbed state:
- "Where is this entity now?" requires reconstructing from a stream
  of past events on every read
- App reads pay an unbounded cost
- "Now" gets ambiguous when concurrent appends race

Two surfaces, one truth model. Each event explicitly declares which
surfaces it affects via `effectClass`.

## Reader Scenario: A `STATE_ONLY` Mutation

An app writes a transient world-state update with no historical
significance.

1. **Commit envelope.** App submits with
   `effectClass: STATE_ONLY`.
2. **Realm validates.** Schema, provenance, run-mode authorization
   all pass.
3. **State updated.** World present-state reflects the change.
4. **History unchanged.** No history row appended; the change is
   stateful but not historical.

## Reader Scenario: A `STATE_AND_HISTORY` Mutation

An app writes a canon-significant mutation.

1. **Commit envelope.** `effectClass: STATE_AND_HISTORY`.
2. **Realm validates.** Same checks; additionally checks that the
   run mode authorizes history append (`CANON_MUTATION`).
3. **State updated.** World present-state reflects.
4. **History appended.** A new row with full provenance lands in
   history.
5. **Future replay or correction** can reference this row.

## Reader Scenario: A Correction

An earlier history row needs to be corrected.

1. **No silent hard delete.** The original row stays; corrections
   are modeled as supersede or invalidation events.
2. **Append a correction event.** The new event references the
   prior row and explains the supersession.
3. **History stays append-only.** Reviewers see both the original
   and the correction; the truth chain is intact.

The append-only invariant is what makes history a reliable audit
surface across years.

## Reader Scenario: A REPLAY Run Tries To Write History

A WEE replay path attempts to append history during replay.

1. **Replay executes.** Mutation re-derived under `REPLAY` mode.
2. **Append blocked.** Per `R-WHIST-004`, `REPLAY` runs may not
   append shared history.
3. **State write may proceed** if the run mode authorizes it (per
   the matrix); history is not duplicated.
4. **Audit reflects** the replay path; Realm history is unchanged.

## Reader Scenario: An App Wants Its Own Narrative Archive

An app needs its own per-session narrative log.

1. **Realm history is not the place.** Realm history stores
   canonical happened facts only.
2. **App-owned archive.** The app stores its narrative archive
   under its own ownership (`R-WHIST-006`).
3. **Not represented as Realm history.** The app does not project
   its archive as Realm canonical world history.

## What State And History Do Not Do

- They do not silently merge: state is not history; history is not
  state.
- `effectClass` does not admit additional values.
- Realm does not privilege hidden write paths outside the explicit
  commit envelope.
- `REPLAY` runs do not silently get history append.
- App-private archives do not become Realm canonical truth.
- History rows are not silently hard-deleted.

## Boundary Summary

| Concern | Owner |
| --- | --- |
| Shared present-state | Realm (`R-WSTATE-*`) |
| Canonical happened facts | Realm (`R-WHIST-*`) |
| Commit envelope authority | Realm (`R-WSTATE-002`) |
| Run-mode authorization matrix | Realm (`R-WSTATE-005`) |
| `effectClass` closed enum | Realm (`R-WSTATE-004`) |
| WEE-side commit-request staging | Runtime (see [WEE Execution](/platform/worlds/wee-execution)) |

## Source Basis

- [`.nimi/spec/realm/README.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/README.md)
- [`.nimi/spec/realm/external-realm.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/external-realm.md)
- [`.nimi/spec/sdks/kernel/realm-api-consumer-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/realm-api-consumer-contract.md)
- [`.nimi/spec/sdks/kernel/realm-core-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/realm-core-contract.md)
- [`.nimi/spec/sdks/kernel/realm-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/realm-contract.md)
