# Timeline Contract

> Owner Domain: `PO-TIME-*`

## Scope

This contract governs the reminder agenda engine, timeline home projection, sensitive-period guidance, and timeline-driven monthly report trigger.

The `/profile` first screen is no longer a timeline-like archive index. Current health metrics, evaluation status, latest record date, and next-record date are governed by `health-record-console-contract.md` (`PO-HREC-*`). Timeline may consume those projections as display hints only.

Reminder **interaction semantics** — the per-kind progression state machine, action enumeration, explain authoring contract, and advisor consultation writeback path — are delegated to `reminder-interaction-contract.md` (`PO-REMI-*`). This contract (`PO-TIME-*`) owns eligibility, scheduling, visibility, and agenda bucketing; `PO-REMI-*` owns what happens after a reminder has surfaced.

Covered features from `feature-matrix.yaml`:

- `PO-FEAT-002` reminder engine
- `PO-FEAT-003` growth timeline
- `PO-FEAT-011` sensitive period guide
- `PO-FEAT-046` automatic monthly report generation
- `PO-FEAT-053` reminder progression surface (interaction semantics delegated to `reminder-interaction-contract.md`)

Governing fact sources:

- `tables/reminder-rules.yaml`
- `tables/nurture-modes.yaml`
- `tables/reference-data-assets.yaml#sensitive-periods`
- `tables/local-storage.yaml#health_record_events`
- `tables/local-storage.yaml#health_record_values`
- `tables/local-storage.yaml#vaccine_records`
- `tables/local-storage.yaml#milestone_records`
- `tables/local-storage.yaml#journal_entries`
- `tables/local-storage.yaml#reminder_states`
- `tables/local-storage.yaml#growth_reports`
- `tables/routes.yaml#/timeline`
- `health-record-console-contract.md` - current health freshness projection consumed by timeline display hints only

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

The per-kind progression timestamp columns (`acknowledgedAt`, `reflectedAt`, `practiceStartedAt`, `practiceLastAt`, `practiceCount`, `practiceHabituatedAt`, `consultedAt`, `consultationConversationId`) are governed by `reminder-interaction-contract.md#PO-REMI-004`. This contract only guarantees that the timeline engine reads these columns as kind-scoped progression signals when computing lifecycle; write rules for those columns belong to `PO-REMI-*`.

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
| `dataGapAlert` | a constrained display hint derived from `PO-HREC-*` freshness when no visible reminder already covers the same need |

Timeline-home display bucket constraints:

- `recentChanges` may only derive from admitted structured local records such as measurements, vaccine records, milestone records, sleep records, and journal entries
- `recentChanges` must not invent diagnosis, treatment, or causal interpretation
- `recentChanges` must dedupe by domain for first-screen display and cap the total count
- `dataGapAlert` is display-only and must not mutate `reminder_states`
- `dataGapAlert` must consume `PO-HREC-*` freshness and must not compute its own metric freshness rules
- `dataGapAlert` must respect nurture mode visibility and suppress itself when a visible growth/checkup reminder already covers the same need

Cold-start suppression must obey these invariants:

- it may move a reminder into `onboardingCatchup`, but must not mutate reminder priority
- it must not persist any synthetic state row
- it must not weaken the `P0` push invariant from `PO-TIME-003`

## PO-TIME-005 Sensitive Period Projection

Sensitive-period guidance must be a direct lookup against the admitted
`sensitive-periods` data asset.

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

## PO-TIME-008 Timeline vs Health Record Console Boundary

The timeline and health record console surfaces serve complementary mandates. The authoritative profile-side boundary definition lives in `profile-contract.md#PO-PROF-021`; current health projection semantics live in `health-record-console-contract.md`. Timeline-side invariants:

- Timeline owns the action/agenda surface: reminders, recent changes, data freshness alerts, and sensitive-period guidance.
- Timeline must not serve as the current health metric console, record browsing, history exploration, or archive completeness surface. Those are `PO-HREC-*` / `PO-PROF-*` concerns.
- Timeline may link to profile sub-pages for deep record access or open `PO-CAPT-*` capture intents for `record_data` reminders.
- Timeline may display recent-change snippets (PO-TIME-004 `recentChanges` bucket) but must not duplicate the health console's metric status, next-record date, freshness status, or last-record summary projection.

## PO-TIME-010 Dashboard Task Families and Orchestration

The dashboard task surface is a `PO-TIME-*` orchestration projection. It composes a small daily list of finishable tasks from reminder agenda, health-record freshness, journal recency, orthodontic cycle, custom todos, and admitted catalog rows. It does not own the truth of any record, freshness state, reminder rule, observation entry, or orthodontic cycle. It does not weaken the `PO-TIME-003` P0 delivery invariant. It does not promote `dataGapAlert` from display-only.

### Task Family Vocabulary

Every dashboard task belongs to exactly one family. Each family names exactly one eligibility source and exactly one state owner.

| Family | Eligibility source | State owner |
|---|---|---|
| `must-do` | `reminder-rules.yaml`, `orthodontic-protocols.yaml`, and other admitted domain rules surfaced through PO-TIME-001/002 | `reminder-interaction-contract.md` (`PO-REMI-003.task` or `PO-REMI-003.guide` per existing reminder kind) |
| `maintain` | `dashboard-task-catalog.yaml` rows whose `family=maintain`, gated by PO-HREC-006 freshness projection and PO-REMI-013 record-data capture binding | `reminder-interaction-contract.md` (`PO-REMI-003.task` via record_data) |
| `observe` | `dashboard-task-catalog.yaml` rows whose `family=observe`, anchored on journal recency from `journal-contract.md` and observation-framework dimensions | `journal-contract.md` `PO-JOUR-001` entry for evidence; `PO-REMI-003.practice` when prompt habituation applies |
| `connect` | `dashboard-task-catalog.yaml` rows whose `family=connect`, gated by `knowledge-source-readiness.yaml#status=reviewed` content sources (see `PO-REMI-014`) | `reminder-interaction-contract.md` (`PO-REMI-003.practice` kind only — no new kind) |
| `personal` | `tables/local-storage.yaml#custom_todos` rows | `custom_todos` storage; not part of `dashboard-task-catalog.yaml` |

### Eligibility Composition

The orchestrator composes today's candidate list from:

- the `PO-TIME-002` reminder state projection,
- the `PO-HREC-006` freshness and next-record projection (consumed; never recomputed),
- the `journal-contract.md` recency view,
- the `orthodontic-contract.md` cycle projection,
- `dashboard-task-catalog.yaml` rows whose owner contract resolves,
- `custom_todos` rows.

A catalog row whose `ownerContract`, `captureProtocolIdRef`, `observationDimensionRef`, or `microActionContentRef` does not resolve is excluded from eligibility (fail-close at orchestration; see `PO-TIME-007` extension below).

### Monthly Dispersion

Within a calendar month, the main dashboard list must surface at most one `maintain` task per day. `maintain` tasks are dispersed across `week-1 | week-2 | week-3 | week-4 | rolling` windows declared by each row's `dispersionWindow` field. Heavy tasks (`slotPreference: weekend-heavy`) prefer Saturday/Sunday slots; light tasks (`slotPreference: weekday-evening-light`) prefer weekday-evening slots. Hard-time tasks (`slotPreference: hard-time`) retain their domain schedule and are not subject to dispersion.

### Biological Anchor Rule

When a catalog row sets `biologicalAnchor: birthDayOfMonth`, the row's monthly window anchors on the child's birth-day-of-month rather than calendar month start. If the anchor day is a weekday and `slotPreference: weekend-heavy`, the orchestrator selects the nearest weekend. If `slotPreference: weekday-evening-light`, the row may stay on the anchor weekday evening.

### Same-Day Mutual Exclusion

The main dashboard task surface caps simultaneous display at:

- one `maintain` task per day,
- one `observe` task per day,
- one `connect` task per day,
- unlimited `must-do` tasks subject to the `PO-TIME-003` P0 delivery invariant,
- unlimited `personal` tasks (subject to user authorship).

If today's eligible set includes a hard-time orthodontic, vaccine, appointment, or P0 `must-do` task that shares a `mutualExclusionGroup` value with a `maintain` row, the `maintain` row defers to the next eligible day. `PO-TIME-003` is restated verbatim here: P0 reminders must be visible in `todayFocus`. Dispersion, mutual exclusion, and decay must not suppress a P0 reminder.

### Display Window and Decay

Each catalog row declares `displayWindowDays`. A row that becomes eligible enters the main dashboard list for that window. After the window expires without user engagement (no save, no snooze, no `mark_not_applicable`):

- The row downgrades to a low-disturbance indicator equivalent to `PO-TIME-004`'s `dataGapAlert` semantics. The indicator is display-only and must not mutate `reminder_states`. The indicator must not become a new task source. Promoting `dataGapAlert` (or its equivalent) into an eligible task source is a fail-close violation of this section.
- The row remains eligible to re-surface in a later cadence window per its `cadencePolicy` and `dispersionWindow`.
- If the row's `decayStrategy` is `resurface-next-cycle`, the orchestrator drops it from the main list immediately at window expiry and schedules the next eligibility window. If `low-disturbance-downgrade`, the orchestrator keeps the indicator visible until next eligibility.

### Snooze

Each catalog row declares `snoozeDefaultDays`. The `PO-REMI-005` snooze action enumeration is unchanged. `PO-REMI-010` admissibility constraints are unchanged; P0 `task` rules cannot be hidden by snooze.

### Ranking

The orchestrator ranks today's eligible candidates in this order:

1. `must-do` hard-time and `P0` rows,
2. `must-do` due rows with admitted capture target available,
3. `must-do` orthodontic cycle proximity rows,
4. `maintain` rows by freshness severity and `slotPreference` match for today,
5. stage-specific `observe` and `connect` rows by content freshness and `slotPreference`,
6. `personal` (`custom_todos`) rows by user-authored ordering.

Ranking must preserve same-day mutual exclusion and the `PO-TIME-003` P0 invariant. Ranking is not authority over individual record state; it is a display projection.

### Fail-Close Behavior

The orchestrator must fail closed when:

- a `dashboard-task-catalog.yaml` row references a `captureProtocolId` that is not present in `health-capture-protocols.yaml`,
- a row references a `metricId` that is not present in `health-metric-registry.yaml`,
- a `family=connect` row references a `microActionContentRef` whose `knowledge-source-readiness.yaml#status` is not `reviewed`,
- a row's `ownerContract` does not resolve to an admitted contract,
- a row would suppress a `P0` reminder for any dispersion, mutual-exclusion, snooze, or decay purpose,
- a row would recompute `PO-HREC-*` freshness locally instead of consuming the PO-HREC snapshot,
- a row would write directly to `health_record_events` / `health_record_values` instead of opening a `PO-CAPT-*` intent.

These fail-close conditions extend `PO-TIME-007`. They do not weaken or replace it.

## Exclusions

The following remain outside this contract:

- AI-generated personalized reminders (`PO-FEAT-032`)
- free-form explanation outside the advisor/report boundaries
- orphan report history or upload pages that are not registered routes
