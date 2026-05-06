# World History

World history is the **append-only canonical record** of what
happened in a world. Provenance is mandatory. Replay runs cannot
append; only canon-mutating runs may. Corrections happen by
supersession or invalidation, never by silent deletion.

## Append-Only

| Property | Value |
| --- | --- |
| Storage | Realm `R-WHIST-*` |
| Mutability | Append-only |
| Run kinds | `REPLAY` (cannot append) / `CANON_MUTATION` (may append) |
| Provenance | Mandatory on every record |
| Corrections | Supersession or invalidation; never silent deletion |

The append-only posture is the audit foundation. A reader can
trust that history is what happened, not what was edited
afterwards.

## Replay Vs Canon Mutation

| Run kind | Can append? | Purpose |
| --- | --- | --- |
| `REPLAY` | no | Reconstruct what happened |
| `CANON_MUTATION` | yes | Apply a real mutation |

A replay run reads history, runs typed projections, computes
results — without writing anything. A canon-mutation run is the
only kind that may append. This separation is what lets replay
be a real audit tool.

## Provenance

Every history record carries provenance: who, when, with what
evidence. Provenance is **mandatory** — there is no way to append
a record without it.

| Field | Purpose |
| --- | --- |
| Actor | Who acted |
| Time | When |
| Evidence refs | What supports this record |
| Schema version | What shape this record uses |
| Source | What produced this record (extension-app id, system, etc.) |

A history record without provenance is rejected at admission. The
platform does not silently accept un-attributed records.

## Corrections

When a creator (or the platform) needs to correct history, the
correction follows admitted patterns:

| Correction kind | Behavior |
| --- | --- |
| Supersession | A new record supersedes an older one; the older record stays in history |
| Invalidation | A record is marked invalid; the original stays |

What is **never** admitted: silent deletion. A history record
that was once committed cannot vanish. The user (auditor, future
reader) can always see "this was committed, then later
superseded by ..." or "this was invalidated for reason ..."

## Reader Scenario: A Wrong Action Gets Corrected

A history record was committed in error — perhaps a system bug
attributed an action to the wrong participant.

1. **Original record exists.** The wrong attribution is in
   history.
2. **Correction issued.** A creator-tooling-issued correction
   commits a supersession record.
3. **Both records exist.** History has the original (now
   superseded) and the correction.
4. **Reader sees lineage.** A reader querying history sees the
   timeline: original → superseded by correction.

The original is not deleted. The correction is its own typed
event with its own provenance.

## Reader Scenario: An Audit Replay

An auditor wants to understand exactly what happened over a
period — perhaps a specific incident.

1. **Replay run.** Reads history records under typed admission.
2. **Reconstruct.** The replay reconstructs the chain of state
   transitions, events, projections.
3. **No append.** The replay does not write anything to history.
4. **Result.** The auditor has a structured reconstruction.

Replay is a real audit tool because it is structurally bounded
not to append. There is no "the audit changed history" worry.

## Reader Scenario: A Provenance-Less Record Attempt

An app tries to append a history record without specifying
provenance.

1. **Admission check.** Realm validates the record against
   admitted history shape.
2. **Provenance missing.** The record fails the provenance
   requirement.
3. **Reject.** The record is not admitted; an error is returned.
4. **App sees typed error.** "missing provenance" with reason
   code.

There is no fallback to "best-effort accept." Records without
provenance simply do not enter history.

## Cross-Cutting With State And Truth

History is the third side of the triangle with truth and state.

| Question | Answered by |
| --- | --- |
| What is canonically true? | Truth |
| What does the world look like now? | State |
| How did it get this way? | History |

A surface that conflates them silently loses information. World
History gives the **how**, not the **what** or the **now**.

## Source Basis

- [`.nimi/spec/realm/world-history.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/world-history.md)
- [`.nimi/spec/realm/kernel/world-history-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/world-history-contract.md)
- [`.nimi/spec/realm/kernel/tables/world-history-contract.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/tables/world-history-contract.yaml)
- [`.nimi/spec/realm/world-state.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/world-state.md)
- [`.nimi/spec/realm/truth.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/truth.md)
