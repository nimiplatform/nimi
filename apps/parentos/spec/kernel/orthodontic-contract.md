# Orthodontic Contract

> Owner Domain: `PO-ORTHO-*`

## Scope

This contract governs orthodontic case and appliance tracking, daily compliance
checkins, orthodontic dynamic reminders, and the orthodontic AI summary surface.

Covered features from `feature-matrix.yaml`:

- `PO-FEAT-048` orthodontic case management
- `PO-FEAT-049` orthodontic appliance management
- `PO-FEAT-050` orthodontic daily compliance checkins
- `PO-FEAT-051` orthodontic dynamic reminders
- `PO-FEAT-052` orthodontic compliance dashboard

Governing fact sources:

- `tables/orthodontic-protocols.yaml`
- `tables/local-storage.yaml#orthodontic_cases`
- `tables/local-storage.yaml#orthodontic_appliances`
- `tables/local-storage.yaml#orthodontic_checkins`
- `tables/local-storage.yaml#orthodontic_unwear_intervals`
- `tables/local-storage.yaml#health_record_events`
- `tables/local-storage.yaml#reminder_states`
- `tables/routes.yaml#/profile` and `/profile/dental` redirect shell

## PO-ORTHO-001 Four-Layer Data Model

Orthodontic state is modeled in exactly four tables, each with a distinct
semantic purpose. Implementation must never collapse them or cross-write.

| Table | Mandate |
|---|---|
| `health_record_events` | Low-frequency, clinical, whole-mouth-timeline events with dental/orthodontic metric ids. Orthodontic lifecycle clinical events (`ortho-assessment`, `ortho-review`, `ortho-adjustment`, `ortho-issue`, `ortho-end`) live here and remain visible in the unified dental timeline. |
| `orthodontic_cases` | One row per treatment course. Source of truth for `caseType`, `stage`, and review-date projection. |
| `orthodontic_appliances` | One row per appliance instance attached to a case. Source of truth for `applianceType`, active/paused/completed status, prescribed wear, review cadence, expander activation counters, and clear-aligner per-tray schedule (`totalAligners`, `daysPerAligner`). |
| `orthodontic_checkins` | Discrete clinical events parent-records. Admitted `checkinType` values are `aligner-change` and `expander-activation`. Daily wear is NOT a checkin (see `orthodontic_unwear_intervals`). Checkins do NOT appear in the dental clinical timeline. |
| `orthodontic_unwear_intervals` | Event stream of un-wear periods (when a removable appliance was taken out). Source of truth for compliance projection (PO-ORTHO-008). Applies only to `clear-aligner | twin-block | activator | retainer-removable`. |

Invariant: review, adjustment, issue, and end events must write to
`health_record_events` only. A `checkinType` outside the admitted set, or a
wear-gap interval on a non-removable appliance type, is a fail-close violation.

## PO-ORTHO-002 Case Shape

Orthodontic cases must store and read:

- `caseId` (ULID)
- `childId` (FK)
- `caseType` — one of `early-intervention | fixed-braces | clear-aligners | unknown-legacy`
- `stage` — one of `assessment | planning | active | retention | completed`
- `startedAt` — ISO 8601 date
- `plannedEndAt` — ISO 8601 date, nullable
- `actualEndAt` — ISO 8601 date, nullable
- `primaryIssues` — JSON array of free-text clinical concerns (parent-entered, not AI-inferred)
- `providerName` — nullable
- `providerInstitution` — nullable
- `nextReviewDate` — ISO 8601 date, nullable; cached projection of `min(appliances.nextReviewDate WHERE status='active')`
- `notes` — nullable
- `createdAt`, `updatedAt`

`stage` transitions are parent-initiated only; runtime must not auto-promote a
case between stages. `actualEndAt` is required when `stage = completed`.

`nextReviewDate` is a cache. A case deletion or appliance status change must
recompute it. It must never be edited directly by the UI.

### PO-ORTHO-002b Single Active Case Invariant

A child MAY hold **at most one** orthodontic case whose `stage` is not
`completed` at any point in time. This invariant is admitted because:

- The parent's mental model is "where am I now" — one ongoing journey, not a
  catalogue of parallel ones.
- Concurrent `clear-aligners` cases share the same `PO-ORTHO-UNWEAR-OPEN` /
  `PO-ORTHO-WEAR-DAILY` family of physical events; a per-case cycle projection
  cannot tell which case "owns" a given un-wear interval without an explicit
  case linkage on the interval (which we deliberately do not require).
- A new course of treatment naturally implies the prior course closed; the
  parent must transition the previous case to `completed` before starting the
  next one.

Enforcement (fail-close on each):

- `insert_orthodontic_case` MUST reject a write when a non-completed case
  already exists for the same `childId`. The error message MUST direct the
  parent to either complete the existing case or delete it.
- `update_orthodontic_case` MUST reject a stage transition that would result
  in two non-completed cases for the same `childId` (e.g. setting a completed
  case back to `active`).
- The renderer surface MUST render only the (single) non-completed case in
  the orthodontic page; completed cases live in the journey timeline and any
  future "history" surface, never in the active treatment view.
- Migration v16 enforces the invariant on existing data by selecting one
  winning case per child (most-advanced stage, ties broken by `startedAt`
  then `createdAt`) and either deleting empty losers or archiving losers that
  carry attached `orthodontic_appliances` rows by transitioning them to
  `completed` with `actualEndAt` set to the migration day. This is
  pre-launch admissible (no production users) and is the only path that may
  set a case to `completed` without a parent action.

### PO-ORTHO-002a `unknown-legacy` Transitional caseType

`unknown-legacy` is admitted only as a MIGRATION-AUTHORED transitional value.
Invariants (fail-close on each):

- `insert_orthodontic_case` and `update_orthodontic_case` MUST reject `unknown-legacy` on write. Only migration v9 is permitted to author these rows.
- The UI MUST render `unknown-legacy` cases with a clearly distinct "待确认历史疗程" treatment and MUST allow the parent to re-classify to one of the three primary `caseType` values (`early-intervention | fixed-braces | clear-aligners`).
- Protocol reminder seeding (PO-ORTHO-007) MUST NOT run for appliances attached to an `unknown-legacy` case until the case has been re-classified.
- Compliance dashboard projections MUST NOT include wear/checkin rows attached to an `unknown-legacy` case until re-classified.
- Appliance creation against an `unknown-legacy` case MUST be rejected at the command layer; parents must re-classify first.

Pause is not a case-level concept. See PO-ORTHO-004.

## PO-ORTHO-003 Appliance Shape

Orthodontic appliances must store and read:

- `applianceId` (ULID)
- `caseId` (FK cascade delete)
- `childId` (FK; redundant with case for query ergonomics, must stay consistent)
- `applianceType` — see `orthodontic-protocols.yaml#schema.applianceType`
- `status` — one of `active | paused | completed`
- `startedAt` — ISO 8601 date
- `endedAt` — ISO 8601 date, nullable
- `prescribedHoursPerDay` — integer, nullable (populated for wear-daily / retention-wear protocols)
- `prescribedActivations` — integer, nullable (expander only)
- `completedActivations` — integer, default 0 (expander only)
- `totalAligners` — integer, nullable (clear-aligner only; total tray count in the prescribed series)
- `daysPerAligner` — integer, nullable (clear-aligner only; prescribed wear days per tray before switching)
- `reviewIntervalDays` — integer, nullable (default comes from protocol rule)
- `lastReviewAt` — ISO 8601 date, nullable
- `nextReviewDate` — ISO 8601 date, nullable
- `pauseReason` — nullable, required when `status = paused`
- `notes` — nullable
- `createdAt`, `updatedAt`

Admitted `applianceType` values MUST match `orthodontic-protocols.yaml#schema.applianceType`. The spec-to-runtime binding is validated by the knowledge-base check.

`totalAligners` and `daysPerAligner` are clear-aligner-only fields. The Rust command layer MUST reject `insert_orthodontic_appliance` for `applianceType = 'clear-aligner'` when either is missing or non-positive (fail-close, mirroring the existing `prescribedHoursPerDay` rule). Both fields MUST be NULL for non-clear-aligner appliance types. These fields are independent of `reviewIntervalDays`: the latter is the clinical review cadence; these two govern the per-tray wear schedule and are not used to seed reminder_states.

## PO-ORTHO-004 Pause Semantics

Pause is modeled at the appliance level only.

- `orthodontic_cases.stage` has no `paused` value. Pausing a course means
  moving one or more appliances to `status = paused` while the case stays
  `active` or `retention`.
- When an appliance flips to `paused`, the system must dismiss its currently
  active orthodontic protocol reminder_states (`dismissReason = 'appliance-paused'`).
- When an appliance flips back to `active`, fresh reminder_states are written
  with admitted `PO-ORTHO-*` ruleIds only; no synthetic ruleId is allowed.
- A case with no active appliances produces no active protocol reminders but
  its clinical timeline (`health_record_events` rows) remains visible.

## PO-ORTHO-005 Checkin Shape

Orthodontic checkins record discrete clinical events. Daily wear is NOT a
checkin — it is modelled as a wear-gap event stream (PO-ORTHO-005a). Admitted
`checkinType` values:

- `aligner-change` — clear-aligner switch to the next tray
- `expander-activation` — expander activation turn

Orthodontic checkins must store and read:

- `checkinId` (ULID)
- `childId` (FK)
- `caseId` (FK)
- `applianceId` (FK)
- `checkinType` — one of `aligner-change | expander-activation`
- `checkinDate` — ISO 8601 date
- `activationIndex` — integer, nullable (expander-activation only)
- `alignerIndex` — integer, nullable (aligner-change only)
- `notes` — nullable
- `createdAt`, `updatedAt`

Invariants:

- `aligner-change` and `expander-activation` may repeat within a day if medically indicated; uniqueness is enforced by `checkinId` only.
- A checkin with `applianceId` that does not resolve back to the declared `caseId` is a fail-close violation.
- The command layer MUST reject any `checkinType` outside the admitted two; legacy `wear-daily` and `retention-wear` are permanently retired (PO-ORTHO-005b).

## PO-ORTHO-005a Wear-Gap Interval Shape

Daily wear compliance is recorded as a stream of "未戴时段" (un-wear) intervals
in `orthodontic_unwear_intervals`. The default assumption is that a removable
appliance is being worn 22h/day; only **exceptions** (when the child takes the
appliance out) are stored. This inverts the previous wear-daily checkin model
and aligns with desktop-client usage frequency, parent recall patterns, and
clinical decision-making (cumulative un-wear time per cycle drives the
predicted aligner-switch date).

Applies to removable, daily-wear appliance types only:
`clear-aligner | twin-block | activator | retainer-removable`. Fixed appliances
(`metal-braces | ceramic-braces | retainer-fixed | expander`) do not have
wear-gap semantics.

Wear-gap intervals must store and read:

- `intervalId` (ULID)
- `childId` (FK)
- `caseId` (FK)
- `applianceId` (FK)
- `startAt` — ISO 8601 datetime (when the appliance was taken out)
- `endAt` — ISO 8601 datetime, nullable (when the appliance was put back; NULL means "still un-worn")
- `reason` — one of `meal | sport | school | sleep | other`, nullable
- `notes` — nullable
- `createdAt`, `updatedAt`

Invariants (fail-close on each):

- `endAt` MUST be strictly greater than `startAt` when both are present.
- At most ONE row per `applianceId` may have `endAt IS NULL` (the open interval). The schema enforces this with a partial unique index; the command layer enforces it on write.
- `applianceId` MUST resolve back to the declared `caseId`.
- The command layer MUST reject `insert_unwear_interval` for appliance types outside the four removable types listed above.
- An open-interval insert MUST seed an admitted `PO-ORTHO-UNWEAR-OPEN` reminder_state (stateId `ortho-unwear-{intervalId}`, `nextTriggerAt = startAt + 4h`); closing the interval MUST mark that reminder_state as `completed`; deleting the interval MUST cascade-delete the reminder_state.

## PO-ORTHO-005b Retired Checkin Types

`wear-daily` and `retention-wear` are permanently retired from the admitted
`checkinType` set. This is a hard cutover authored by migration v15:

- v15 DROPs all rows where `checkinType IN ('wear-daily', 'retention-wear')`.
- v15 DROPs the now-unused `orthodontic_checkins.actualWearHours`, `prescribedHours`, and `complianceBucket` columns.
- The Rust command layer MUST fail-close on any insert attempt with these types.
- TS bridge types MUST NOT export `wear-daily` / `retention-wear` / `OrthodonticComplianceBucket`.
- Reminder rule `PO-ORTHO-WEAR-DAILY` and `PO-ORTHO-RETENTION-WEAR` are retired from the protocol catalog (replaced by event-driven `PO-ORTHO-UNWEAR-OPEN`).

This is admissible only because the project is pre-launch with no production
data to migrate. Any future re-introduction of daily-wear semantics MUST go
through a new ruleId; reusing `wear-daily` / `retention-wear` is forbidden.

## PO-ORTHO-006 Dental-Record Cross-Write Rules

Orthodontic clinical events write to `health_record_events` using these
eventType values (see `profile-contract.md#PO-PROF-008` for the full dental enum):

| Orthodontic lifecycle moment | `health_record_events.metadataJson.eventType` |
|---|---|
| Clinical review visit | `ortho-review` |
| Fixed-appliance adjustment | `ortho-adjustment` |
| Bracket-debond, lost aligner, expander breakage, etc. | `ortho-issue` |
| End-of-treatment appointment | `ortho-end` |
| Historical pre-contract "start" marker | `ortho-start` (legacy only; new treatments must not emit this) |
| Pre-treatment assessment | `ortho-assessment` |

`ortho-start` is preserved only so the migration v9 legacy-repair step
(Phase 2) can stitch historical rows to `unknown-legacy` cases. New primary
workflows must not depend on `ortho-start` for modeling treatment state.

Legacy-stitched caseIds use the deterministic form `legacy-ortho-case-{childId}` (one per child with historical `ortho-start` rows). This is an admitted exception to the ULID convention in PO-ORTHO-002 and guarantees idempotent migration replay. All other caseIds must be ULID.

## PO-ORTHO-007 Protocol Catalog Binding

`orthodontic-protocols.yaml` is the single authority home for orthodontic
dynamic reminder rules. The knowledge-base compile step unions:

```
REMINDER_RULES = reminder-rules.yaml#rules
             ∪ orthodontic-protocols.yaml#rules          (lifted with the shared ReminderRule shape)
             ∪ orthodontic-protocols.yaml#dentalFollowUpRules
```

Invariants:

- Every persisted `reminder_states.ruleId` value must be in the unioned catalog. The reminder engine's PO-TIME-007 fail-close invariant covers this.
- Runtime code must not synthesize a ruleId. `dental-auto-*` and other on-the-fly ids are forbidden.
- Adding, renaming, or removing an admitted ruleId is a breaking change.

Active orthodontic protocol reminders default to `push` in all nurture modes
(`relaxed | balanced | advanced`). See `timeline-contract.md#PO-TIME-009`.

## PO-ORTHO-008 Compliance Approximation

Compliance is a **per-cycle continuous projection** derived from wear-gap
intervals (PO-ORTHO-005a). It is a task-completion approximation, not a
clinical wear-hours reconstruction.

The unit of measurement is the *aligner cycle* (clear-aligner) or the
*review cycle* (other removable appliances). Within one cycle:

```
cycleAnchor          = max(latest aligner-change checkinDate, appliance.startedAt)  -- ISO datetime treated as 00:00 UTC for cycle math
cycleElapsedHours    = (now − cycleAnchor) in hours, clamped to >= 0
sumGapHoursInCycle   = Σ (closed_gap.endAt − closed_gap.startAt) for closed gaps overlapping [cycleAnchor, now]
                       + (now − open_gap.startAt) if an open gap overlaps the cycle (open gap is treated as still accumulating)
cycleNetWearHours    = max(0, cycleElapsedHours − sumGapHoursInCycle)
cycleTargetHours     = daysPerAligner × prescribedHoursPerDay      -- daysPerAligner from the appliance row; prescribedHoursPerDay defaults to 22 when null
cycleProgressRatio   = cycleNetWearHours / cycleTargetHours        -- 0..1+; 1 = on schedule, <1 = behind
predictedSwitchDate  = cycleAnchor + (cycleTargetHours / netWearRate) days
                       where netWearRate = cycleNetWearHours / cycleElapsedHours, fallback to 22/24 when no data yet
daysShifted          = predictedSwitchDate − (cycleAnchor + daysPerAligner)  -- 0 = on schedule, +N = pushed back N days
```

Constraints:

- There is no `daily compliance bucket`. UI wording MUST be cycle-relative ("本副已净戴 X / Y 小时", "下次换套预计 5/15（推后 1 天）"), not "今日达成 / 部分 / 缺席".
- UI MUST label the metric as "任务达成率近似" / "净戴时长近似" and MUST NOT present `cycleNetWearHours` as a clinically precise wear-time reconstruction.
- The projection MUST reflect open intervals (still accumulating un-wear), so the displayed `cycleNetWearHours` updates monotonically while the appliance is out.
- For non-clear-aligner removable appliances (twin-block / activator / retainer-removable) the same projection applies, with `cycleTargetHours` = (review interval days × prescribedHoursPerDay) since they have no aligner index.
- A future `compliance-v2` may extend this (e.g., smart-device ingest). It is intentionally out of scope for v1.

## PO-ORTHO-009 Early-Intervention Age Gate

Admission of an appliance is gated by child age using
`orthodontic-protocols.yaml#applianceMinAge`. The UI must not permit creation
of an appliance whose `startedAt` puts the child below the minimum age for
its `applianceType`. Minimum gates:

- `twin-block | expander | activator` → 48 months
- `metal-braces | ceramic-braces | clear-aligner | retainer-fixed | retainer-removable` → 84 months

The Rust command layer must also enforce this gate; fail-close on violation.

## PO-ORTHO-010 AI Boundary

The orthodontic profile surface may request bounded runtime summaries of the
current child's local orthodontic records. Admitted outputs:

- fact restatement: case count, active appliances, last review date, checkin counts
- descriptive trend wording using `observation-framework`-compatible verbs (`观察到`, `本周相比上周`)
- compliance-bucket wording that matches `orthodontic-protocols.yaml#schema.complianceThresholds` verbatim

Forbidden outputs:

- treatment recommendation ("建议继续戴", "可以考虑换装置")
- efficacy inference ("治疗效果好", "咬合改善")
- wear-time prescription ("应该多戴", "请加长佩戴")
- comparative ranking against other children or reference populations
- diagnosis or clinical-severity labels

Violations must be filtered by the shared AI safety filter. If filtered output
is empty, the surface must display no summary rather than placeholder text.

## PO-ORTHO-011 Fail-Close Behaviors

The orthodontic layer must fail closed when:

- a persisted `orthodontic_checkins.checkinType` is outside the admitted set (`aligner-change | expander-activation`); legacy `wear-daily` / `retention-wear` are permanently retired (PO-ORTHO-005b)
- a persisted `orthodontic_appliances.applianceType` is outside the protocol enum
- a persisted `orthodontic_cases.caseType` or `stage` is outside its enum
- a protocol reminder writes a synthetic ruleId (anything not in the unioned catalog)
- an appliance is created whose `startedAt` is earlier than `PO-ORTHO-009` minAge
- `orthodontic_cases.nextReviewDate` is written directly without being recomputed from active appliances
- an AI summary emits forbidden wording from PO-ORTHO-010 and the surface still tries to display it
- a checkin references a `caseId`/`applianceId` pair that does not round-trip
- a second non-completed case is inserted (or updated into) for the same `childId` (PO-ORTHO-002b)
- an `orthodontic_unwear_intervals` row is inserted with `endAt <= startAt`
- a second open interval (`endAt IS NULL`) is inserted for the same `applianceId` while another open interval already exists
- a wear-gap interval is inserted for an appliance type outside `clear-aligner | twin-block | activator | retainer-removable`
- a wear-gap interval references a `caseId` / `applianceId` pair that does not round-trip
- closing or deleting an interval fails to update the matching `PO-ORTHO-UNWEAR-OPEN` reminder_state

## Phase Exclusions

- `compliance-v2` (smart-device or OCR-based wear ingest)
- case-level pause (explicitly prohibited by PO-ORTHO-004)
- cross-child comparative dashboards
- AI-driven treatment planning of any kind
