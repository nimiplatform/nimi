# Timeline Contract

> Owner Domain: `PO-TIME-*`

## Scope

This contract governs the reminder agenda engine, timeline home projection, sensitive-period guidance, and timeline-driven monthly report trigger.

Covered features from `feature-matrix.yaml`:

- `PO-FEAT-002` reminder engine
- `PO-FEAT-003` growth timeline
- `PO-FEAT-011` sensitive period guide
- `PO-FEAT-046` automatic monthly report generation

Governing fact sources:

- `tables/reminder-rules.yaml`
- `tables/nurture-modes.yaml`
- `tables/sensitive-periods.yaml`
- `tables/local-storage.yaml#measurements`
- `tables/local-storage.yaml#vaccine_records`
- `tables/local-storage.yaml#milestone_records`
- `tables/local-storage.yaml#journal_entries`
- `tables/local-storage.yaml#sleep_records`
- `tables/local-storage.yaml#reminder_states`
- `tables/local-storage.yaml#growth_reports`
- `tables/routes.yaml#/timeline`

## PO-TIME-001 Reminder Inputs

Reminder computation must consume only structured inputs:

| Input | Type | Source |
|---|---|---|
| `childId` | `string` | selected child |
| `birthDate` | `ISO 8601 date string` | child profile |
| `ageMonths` | `integer` | derived from `birthDate` and the evaluation date |
| `profileCreatedAt` | `ISO 8601 datetime string` | `children.createdAt` |
| `nurtureMode` | `relaxed \| balanced \| advanced` | child record |
| `ruleCatalog` | `ReminderRule[]` | compiled from `reminder-rules.yaml` |
| `reminderStates` | `ReminderStateRow[]` | SQLite |

The engine must not invent reminder rules outside the compiled catalog.

## PO-TIME-002 Reminder State Projection

`reminder_states` rows are the only persisted state for reminder delivery.

Persisted state is limited to user-action outcomes and agenda stability metadata.

Required persisted fields include:

- `status`
- `completedAt`
- `repeatIndex`
- `snoozedUntil`
- `scheduledDate`
- `notApplicable`
- `plannedForDate`
- `surfaceRank`
- `lastSurfacedAt`
- `surfaceCount`

Legacy storage status values remain admitted:

- `pending`
- `active`
- `completed`
- `dismissed`
- `overdue`

The following values must be computed at runtime and must not be persisted:

- agenda bucket labels such as `today`, `thisWeek`, `stageFocus`, `history`
- derived logical state such as `scheduled`, `snoozed`, or `not applicable`
- rule-derived date windows

## PO-TIME-003 P0 Delivery Invariant

Every `P0` reminder must remain `push` in all three nurture modes.

- nurture mode may tune visibility and copy depth only for `P1-P3`
- nurture mode must not suppress a `P0` reminder
- nurture mode must not change medical or developmental thresholds

This invariant is enforced by `check-parentos-nurture-mode-safety`.

## PO-TIME-004 Timeline Output Shape

The timeline home and reminders views must project current state into two display layers:

- reminder agenda buckets
- timeline-home display buckets

Reminder agenda bucket semantics:

| Bucket | Meaning |
|---|---|
| `todayFocus` | reminders worth acting on today |
| `p0Overflow` | `P0` reminders that stay visible but exceed the first-screen cap |
| `onboardingCatchup` | pre-registration stale task reminders gathered into a dedicated catch-up entry |
| `thisWeek` | task reminders that matter soon but do not need immediate action |
| `stageFocus` | guidance reminders for the current developmental stage |
| `history` | completed, scheduled, snoozed, and not-applicable records |
| `overdueSummary` | compressed summary for stale overdue reminders |

Agenda bucket assignment must be recomputed from structured inputs on every evaluation.

Timeline-home display buckets are display-only projections and must not persist synthetic rows:

| Bucket | Meaning |
|---|---|
| `recentChanges` | top recent structured changes from local records, limited to the last 7 days and capped for first-screen display |
| `dataGapAlert` | a constrained freshness hint for key growth measurements when no visible reminder already covers the same need |

Timeline-home display bucket constraints:

- `recentChanges` may only derive from admitted structured local records such as measurements, vaccine records, milestone records, sleep records, and journal entries
- `recentChanges` must not invent diagnosis, treatment, or causal interpretation
- `recentChanges` must dedupe by domain for first-screen display and cap the total count
- `dataGapAlert` is display-only and must not mutate `reminder_states`
- `dataGapAlert` must respect nurture mode visibility and suppress itself when a visible growth/checkup reminder already covers the same need

Cold-start suppression must obey these invariants:

- it may move a reminder into `onboardingCatchup`, but must not mutate reminder priority
- it must not persist any synthetic state row
- it must not weaken the `P0` push invariant from `PO-TIME-003`

## PO-TIME-005 Sensitive Period Projection

Sensitive-period guidance must be a direct lookup against `sensitive-periods.yaml`.

- active periods are determined by current age in months
- rendered copy must be table-backed and static
- the timeline may show current period, peak period, and linked observation cues
- the timeline must not generate new theory text beyond the reviewed table content

## PO-TIME-006 Monthly Report Trigger

The timeline may trigger automatic monthly report generation for the active child.

- the trigger is monthly and local-child scoped
- generated reports must persist through `growth_reports`
- generated content must obey the reports authority in `advisor-contract.md`
- missing runtime, missing local inputs, or generation failure must not fabricate placeholder reports

## PO-TIME-007 Fail-Close Behavior

The timeline layer must fail closed when:

- a persisted `ruleId` is not present in the compiled reminder catalog
- compiled reminder or sensitive-period assets are missing
- a reminder references an invalid nurture-mode projection
- a persisted reminder row contains agenda metadata that cannot be interpreted deterministically
- a report trigger path attempts to persist malformed report payloads

## PO-TIME-009 Orthodontic Protocol Reminder Invariants

Active orthodontic protocol reminders emitted from `orthodontic-protocols.yaml`
have stronger delivery guarantees than generic dental reminders:

- `nurtureMode` visibility for every admitted `PO-ORTHO-*` rule must default to `push` across all three modes (`relaxed | balanced | advanced`). Per-mode downgrade is a contract violation.
- When the owning `orthodontic_appliances` row flips to `paused` or `completed`, or when the `orthodontic_cases.stage` leaves `active` / `retention`, the app must dismiss the associated `reminder_states` rows (fail-close on silent leakage).
- Protocol reminders are NOT age-gated through `triggerAge`. They are gated by live case/appliance state. The compiled rule representation may use a full `triggerAge` window of `{ startMonths: 0, endMonths: 216 }` with state-driven dismissal.
- Protocol reminders MUST use admitted ruleIds from `orthodontic-protocols.yaml#rules`. Any synthesized or prefixed ruleId (e.g. `dental-auto-*`, `ortho-dyn-*`) is a PO-TIME-007 fail-close violation.

`reminder-rules.yaml` remains the authority home for rigid/stage age-based
dental reminders. Follow-up reminders previously produced by the dental form
at runtime (`dental-auto-*`) now live in `orthodontic-protocols.yaml#dentalFollowUpRules` under admitted static ruleIds (`PO-DEN-FOLLOWUP-*`).

## PO-TIME-008 Timeline vs Profile Boundary

The timeline and profile surfaces serve complementary mandates. The authoritative boundary definition lives in `profile-contract.md#PO-PROF-021`. Timeline-side invariants:

- Timeline owns the action/agenda surface: reminders, recent changes, data freshness alerts, and sensitive-period guidance.
- Timeline must not serve as a record browsing, history exploration, or archive completeness surface. Those are profile concerns.
- Timeline may link to profile sub-pages for deep record access.
- Timeline may display recent-change snippets (PO-TIME-004 `recentChanges` bucket) but must not duplicate the profile's record-count or last-updated summary projection.

## Exclusions

The following remain outside this contract:

- AI-generated personalized reminders (`PO-FEAT-032`)
- free-form explanation outside the advisor/report boundaries
- orphan report history or upload pages that are not registered routes
