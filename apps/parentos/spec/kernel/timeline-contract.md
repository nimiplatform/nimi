# Timeline Contract

> Owner Domain: `PO-TIME-*`

## Scope

This contract governs the Phase 1 reminder engine, timeline projection, and sensitive-period guidance.

Covered Phase 1 features from `feature-matrix.yaml`:

- `PO-FEAT-002` reminder engine
- `PO-FEAT-003` growth timeline
- `PO-FEAT-011` sensitive-period guide

Governing fact sources:

- `tables/reminder-rules.yaml`
- `tables/nurture-modes.yaml`
- `tables/sensitive-periods.yaml`
- `tables/local-storage.yaml#reminder_states`
- `tables/routes.yaml#/timeline`

## PO-TIME-001 Reminder Inputs

Reminder computation must consume only structured inputs:

| Input | Type | Source |
|---|---|---|
| `childId` | `string` | selected child |
| `birthDate` | `ISO 8601 date string` | child profile |
| `ageMonths` | `integer` | derived from `birthDate` and the evaluation date |
| `nurtureMode` | `relaxed \| balanced \| advanced` | child record |
| `ruleCatalog` | `ReminderRule[]` | compiled from `reminder-rules.yaml` |
| `reminderStates` | `ReminderStateRow[]` | SQLite |

The engine must not invent reminder rules outside the compiled catalog.

## PO-TIME-002 Reminder State Projection

`reminder_states` rows are the only persisted state for reminder delivery.

Phase 1 status values are:

- `pending`
- `active`
- `completed`
- `dismissed`
- `overdue`

For repeatable rules, the tuple `(childId, ruleId, repeatIndex)` must remain unique.

## PO-TIME-003 P0 Delivery Invariant

Every `P0` reminder must remain `push` in all three nurture modes.

- nurture mode may tune visibility and copy depth only for `P1-P3`
- nurture mode must not suppress a `P0` reminder
- nurture mode must not change medical or developmental thresholds

This invariant is enforced by `check-parentos-nurture-mode-safety`.

## PO-TIME-004 Timeline Output Shape

The timeline view must project reminders into structured buckets only.

Required bucket semantics:

| Bucket | Meaning |
|---|---|
| `today` | currently actionable reminders |
| `upcoming` | not yet due but approaching |
| `recent` | recently completed or dismissed records |

Each rendered item must carry at least:

- `ruleId`
- `priority`
- `status`
- `title`
- `domain`
- `triggerAge` or scheduled age metadata

## PO-TIME-005 Sensitive Period Projection

Sensitive-period guidance must be a direct lookup against `sensitive-periods.yaml`.

- active periods are determined by current age in months
- rendered copy must be table-backed and static in Phase 1
- the timeline may show current period, peak period, and linked observation cues
- the timeline must not generate new theory text beyond the reviewed table content

## PO-TIME-006 Fail-Close Behavior

The timeline layer must fail closed when:

- a persisted `ruleId` is not present in the compiled reminder catalog
- compiled reminder or sensitive-period assets are missing
- a reminder references an invalid nurture-mode projection
- a gated route is reintroduced into navigation as a substitute for timeline output

## Phase 1 Exclusions

The following are out of scope for this contract in Phase 1:

- AI-generated personalized reminders (`PO-FEAT-032`)
- `/reports` integration or report-derived timeline cards
- free-form explanation for `needs-review` domains
