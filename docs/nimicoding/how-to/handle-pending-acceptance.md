# How To Handle Pending Acceptance

Your wave closed by machine criteria but human acceptance has
not been recorded. You are unsure whether to true-close or wait.

## Recipe

1. **Do not move topic to `closed`.** Stay in `pending`.
2. **Record an explicit pending-note** with `close_trigger` and
   `reopen_criteria`.
3. **Mark the wave's `consumer_closure: closed_pending_user_acceptance`**
   (not `closed`). This is the honest dimension status.
4. **Write the wave's audit residual risk explicitly.** Audit
   verdict can be PASS for machine-observable criteria, but the
   audit itself notes "final consumer acceptance still requires
   human review."
5. **Wait.** Pending is a real state with explicit reopen
   criteria; it is not "stuck."
6. **When the user reviews:**
   - Accepts → execute true-close ceremony.
   - Rejects with new findings → admit a remediation wave under
     the same topic.
   - Rejects with structural findings → revisit topic.yaml wave
     deps before admitting next wave.

## Recipe For Recording The Pending-Note

```yaml
---
pending_note_id: pending-<topic-id>
topic_id: <topic-id>
entered_from_state: ongoing
reason: awaiting-human-docs-acceptance
summary: |
  <One-paragraph factual summary of what's done and why we're
  waiting>
status: active
reopen_criteria: |
  <What user feedback would trigger reopen — be specific>
close_trigger: |
  <What user action would trigger true-close — usually
  "explicit acceptance">
---

# Pending Note

<Human-readable expansion of the above>
```

The reopen criteria and close trigger must be explicit. "Eventually
the user will look at this" is not a criteria.

## Reader Scenario: Wave Closed, User Hasn't Reviewed

You ran a docs-rewrite wave. Audit passed. User hasn't reviewed
the rendered output yet.

| Step | Action |
| --- | --- |
| Topic state | `ongoing → pending` |
| Wave state | `closed` |
| Wave consumer_closure | `closed_pending_user_acceptance` |
| Pending-note close_trigger | "User explicitly accepts the rendered docs" |
| Pending-note reopen_criteria | "User reports rendered docs do not meet acceptance bar" |

Now: wait. Don't true-close. Don't keep working on adjacent items
without admitting them.

## Reader Scenario: User Reviews And Accepts

User confirms the docs are acceptable.

| Step | Action |
| --- | --- |
| Topic state | `pending → closed` (in topic-true-close ceremony) |
| current_true_close_status | `not_started → passed` (with audit) |
| Topic-true-close-audit | Recorded |
| Folder | Move topic to `.nimi/topics/closed/...` |

The acceptance is what authorized the move.

## Reader Scenario: User Reviews And Rejects

User says the docs still need work in a specific area.

| Step | Action |
| --- | --- |
| Topic state | Stay in `pending` (or move back to `ongoing` as part of admitting next wave) |
| Admit remediation wave | New wave with `acceptance_invariants` reflecting the user's specific feedback |
| Wave deps | Reference the closed prior wave |
| Pending-note | Update to reflect new wait condition |

The user's feedback drove the next wave's invariants. The
methodology turns "user said it's not good" into "next wave's
acceptance is X."

## Reader Scenario: Mistake — Topic Moved To Closed Prematurely

You moved the topic folder to `.nimi/topics/closed/` because all
waves were closed, but the user hasn't accepted yet.

| Step | Recovery |
| --- | --- |
| Inspect `current_true_close_status` | If `not_started`, the topic was not properly true-closed |
| Move topic back to `pending` | Folder + topic.yaml |
| Record explicit pending-note | What it should have been |
| Record `last_transition_reason: rolled_back_premature_topic_close_to_pending_for_user_acceptance` | Audit record |

Premature true-close is itself a false-closure pattern. Recovery
is to undo the move and record the correction.

## What To Watch For

| Symptom | Meaning |
| --- | --- |
| Topic moved to closed without true-close audit | Premature; roll back |
| Wave consumer_closure marked `closed` without user review | Soft pass; reconcile to `closed_pending_user_acceptance` |
| No pending-note despite pending state | Rule violation; create explicit pending-note |
| Pending-note without close_trigger | Soft; rewrite with explicit trigger |

## Source Basis

- [`nimi-coding/methodology/topic-lifecycle-report.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/methodology/topic-lifecycle-report.yaml)
- [`nimi-coding/contracts/topic.schema.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/contracts/topic.schema.yaml)
- [`nimi-coding/contracts/closeout.schema.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/contracts/closeout.schema.yaml)
- [`nimi-coding/contracts/pending-note.schema.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/contracts/pending-note.schema.yaml)
- [`nimi-coding/contracts/true-close.schema.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/contracts/true-close.schema.yaml)
