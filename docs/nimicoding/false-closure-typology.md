# False Closure Typology

False closure is when the output looks complete by one closure
dimension while failing another. The methodology distinguishes
specific false-closure shapes that practitioners encounter. Each
has a distinct response.

## Build-Pass / Consumer-Fail

Build green, tests pass, source basis cited, but the consumer
(reader, user, operator) rejects the output.

| Symptom | Response |
| --- | --- |
| Build green | Hold topic in `pending`, do not mark closed |
| Tests pass | Admit a new wave addressing the consumer dimension |
| User rejects | Do not retroactively edit the closed wave |

**Real example**: the previous public docs topic that produced
this current docs remediation. Authority + semantic +
drift-resistance all passed; consumer failed.

## Source-Anchored / Unreadable

Every public claim has spec basis, but the prose is so
source-anchor-flavored that no reader can build a mental model.

| Symptom | Response |
| --- | --- |
| Source basis present | A follow-on rewrite wave |
| Reader cannot build mental model | Reorganize by reader purpose |

The follow-on does not reopen the source-basis decision; it
addresses the readability gap.

## Closed-But-Not-Accepted

A wave closes machine-side but human acceptance never recorded.
The methodology's `pending` state with explicit `close_trigger`
is for this exact case.

| Symptom | Response |
| --- | --- |
| Wave closeout recorded | Topic state stays `pending` until acceptance |
| User has not reviewed | Do not advance to true-close |
| Acceptance gate unrecorded | Maintain pending-note with reopen criteria |

The topic does not advance to true-close until acceptance is
recorded.

## Overflow Vs PASS

A wave that did not finish in its packet boundary returns
`OVERFLOW`, not `FAIL` and not `PASS`.

Overflow continuation is admitted **only** when:

- direction is still correct
- scope has not crossed into a new owner domain
- the current state is acceptable but the packet boundary was
  too thin

Overflow continuation is **rejected** when:

- shadow truth was introduced
- a fallback or alias was needed
- the packet crossed into a new owner domain

This distinction prevents the most insidious false closure: an
overflowing wave being silently extended past its owner domain,
accumulating implicit scope.

## Premature True-Close

A topic is folder-closed without recording an explicit true-close
audit.

| Symptom | Response |
| --- | --- |
| Folder moved to closed/ | Verify `topic.yaml.current_true_close_status` |
| `current_true_close_status: not_started` | Roll back; record true-close audit first |
| Passed true-close revoked later | Record revocation lineage |

Passed true-close may itself be revoked by a later independent
audit; revoked true-close requires follow-up lineage.

## Pseudo-Progress

New wave names exist without new closure. The wave-DAG policy's
anti-patterns explicitly catch this.

| Symptom | Response |
| --- | --- |
| Wave admitted but no primary closure goal | Reject admission |
| Wave admitted, no bounded result reached | Pause or re-preflight |
| Cascading wave names | Stop; renaming is not closure |

A wave needs a primary closure goal; if it cannot name one, it is
not a wave, it is a planning detour.

## Local-Requirement Trap

Small requests replace the mainline goal — a topic that started
about A becomes a backlog of micro-fixes for B/C/D.

| Symptom | Response |
| --- | --- |
| Topic accumulating unrelated micro-fixes | Refuse; topic is one major iteration line |
| Each micro-fix becoming its own wave | Move micro-fixes outside topic discipline |

The development-rhythm rules say a topic is the home for one
major iteration line, not a micro backlog.

## Giant Planning Topic

A topic that never commits to a bounded wave.

| Symptom | Response |
| --- | --- |
| Multiple consecutive planning waves | Stop; planning-only waves cap at one consecutive |
| No bounded closure reached after planning | Pause or re-preflight rather than open new planning waves |

The wave-limits policy is explicit: planning may harden one
execution target, but it must not chain indefinitely.

## Reader Scenario: Recognizing A Failure In Progress

You are managing a topic. The first wave's audit returns "PASS."
But the user, reviewing the rendered output, says "it's
correct but not impressive."

This is the **build-pass / consumer-fail** shape. The audit was
correct (PASS by machine criteria); the consumer dimension
failed.

Response:

1. Do not retroactively edit wave-1's record. The audit was
   correct.
2. Hold topic in `pending`.
3. Admit wave-2 addressing the consumer gap.
4. Wave-2's packet declares the new acceptance invariants based
   on the user feedback.
5. Wave-2 closes when consumer dimension is satisfied (subject
   to next user review).

The methodology turns "I don't know what to do next" into a
typed sequence.

## Reader Scenario: Reading An Overflow Verdict

A wave returns `OVERFLOW`, not `PASS` or `FAIL`. The worker
hit the packet boundary mid-implementation.

You evaluate:

- Direction still correct? Yes — the work being done is the work
  intended.
- Scope crossed into new owner domain? No — work stayed in the
  declared owner domain.
- Shadow truth introduced? No — no parallel paths created.
- Fallback or alias needed? No — work refused to fall back.
- Current state acceptable, packet boundary too thin? Yes.

**Continuation admissible.** Admit a continuation packet that
extends the boundary; complete the work.

If any answer had been "yes" to shadow / fallback / new domain,
continuation would be **rejected**; the wave returns to revision.

## Reader Scenario: A Topic Stuck In Planning

A topic has been ongoing for weeks. Three waves admitted; all
three were planning-only; no bounded closure reached.

This is the **giant planning topic** anti-pattern.

Response:

1. **No new planning wave.** Wave-limit policy forbids the
   fourth.
2. **Pause the topic** with explicit pending-note, OR
3. **Re-preflight.** Reframe and try once more with sharper stop
   line.

Pseudo-progress is what would happen if the manager just
admitted wave-4 with another planning name. The methodology's
limit is what stops it.

## Source Basis

- [`.nimi/methodology/four-closure-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/four-closure-policy.yaml)
- [`.nimi/methodology/topic-lifecycle-report.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/topic-lifecycle-report.yaml)
- [`.nimi/methodology/overflow-continuation-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/overflow-continuation-policy.yaml)
- [`.nimi/methodology/wave-dag-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/wave-dag-policy.yaml)
- [`.nimi/contracts/result.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/result.schema.yaml)
- [`.nimi/contracts/overflow-continuation.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/overflow-continuation.schema.yaml)
