# Orthodontic Contract

> Owner Domain: `PO-ORTHO-*`

## Scope

This contract governs orthodontic case and appliance tracking, daily compliance
checkins, orthodontic dynamic reminders, the orthodontic AI summary surface,
and the orthodontic photo-session image record.

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
- `tables/local-storage.yaml#orthodontic_photo_sessions`
- `tables/local-storage.yaml#attachments` (admitting `ownerTable = orthodontic_photo_sessions`)
- `tables/local-storage.yaml#health_record_events`
- `tables/local-storage.yaml#reminder_states`
- `tables/routes.yaml#/profile` and `/profile/dental` redirect shell

## PO-ORTHO-001 Five-Layer Data Model

Orthodontic state is modeled in exactly five tables, each with a distinct
semantic purpose. Implementation must never collapse them or cross-write.

| Table | Mandate |
|---|---|
| `health_record_events` | Low-frequency, clinical, whole-mouth-timeline events with dental/orthodontic metric ids. Orthodontic lifecycle clinical events (`ortho-assessment`, `ortho-review`, `ortho-adjustment`, `ortho-issue`, `ortho-end`) live here and remain visible in the unified dental timeline. |
| `orthodontic_cases` | One row per treatment course. Source of truth for `caseType`, `stage`, and review-date projection. |
| `orthodontic_appliances` | One row per appliance instance attached to a case. Source of truth for `applianceType`, active/paused/completed status, prescribed wear, review cadence, expander activation counters, and clear-aligner per-tray schedule (`totalAligners`, `daysPerAligner`). |
| `orthodontic_checkins` | Discrete clinical events parent-records. Admitted `checkinType` values are `aligner-change` and `expander-activation`. Daily wear is NOT a checkin (see `orthodontic_unwear_intervals`). Checkins do NOT appear in the dental clinical timeline. |
| `orthodontic_unwear_intervals` | Event stream of un-wear periods (when a removable appliance was taken out). Source of truth for compliance projection (PO-ORTHO-008). Applies only to `clear-aligner | twin-block | activator | retainer-removable`. |
| `orthodontic_photo_sessions` | One row per parent-captured photo session (front + side intra-oral). Source of truth for the orthodontic image record (PO-ORTHO-012). Image bytes live in the shared `attachments` table on disk under `${appLocalData}/parentos/photos/...`. Sessions are NOT clinical evidence and NOT input to any AI prompt. |

Invariant: review, adjustment, issue, and end events must write to
`health_record_events` only. A `checkinType` outside the admitted set, a
wear-gap interval on a non-removable appliance type, or a photo session
attachment with an angle outside `front | side` is a fail-close violation.

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

The advance-trigger UX surface is not constrained by this contract: rendering
may place the trigger anywhere admissible (top-card menu, dedicated affordance,
or inline strip), and may render a read-only stage strip elsewhere on the page.
The only invariants are (a) the trigger is parent-initiated, (b) the confirm
dialog enumerates the immediate next stage label, and (c) the `completed`
transition is blocked when `actualEndAt` is null.

`nextReviewDate` is a cache. A case deletion or appliance status change must
recompute it. It must never be edited directly by the UI.

### PO-ORTHO-002b Single Active Case Invariant

A child MAY hold **at most one** orthodontic case whose `stage` is not
`completed` at any point in time. This invariant is admitted because:

- The parent's mental model is "where am I now" — one ongoing journey, not a
  catalogue of parallel ones.
- Concurrent `clear-aligners` cases share the same `PO-ORTHO-UNWEAR-OPEN`
  family of physical events; a per-case cycle projection cannot tell which
  case "owns" a given un-wear interval without an explicit case linkage on
  the interval (which we deliberately do not require). `PO-ORTHO-WEAR-DAILY`
  was the legacy counterpart here and was permanently retired by
  PO-ORTHO-005b alongside the migration v15 cutover.
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
- `activationIntervalDays` — integer, nullable (expander only; per-appliance activation-turn cadence in days — overrides the protocol-rule default. MUST be NULL for every non-expander appliance type. See PO-ORTHO-014.)
- `totalAligners` — integer, nullable (clear-aligner only; total tray count in the prescribed series)
- `daysPerAligner` — integer, nullable (clear-aligner only; prescribed wear days per tray before switching)
- `currentPhase` — text, nullable; the appliance's current treatment phase. When non-null it MUST be a `phaseId` admitted for this `applianceType` in `orthodontic-protocols.yaml#appliancePhases`. NULL means "phase not yet set" — an admitted intermediate state, never a fail-close. See PO-ORTHO-013.
- `phaseStartedAt` — ISO 8601 date, nullable; the date `currentPhase` was entered. Drives the per-appliance month counter. MUST be NULL when `currentPhase` is NULL, and non-NULL when `currentPhase` is non-NULL.
- `reviewIntervalDays` — integer, nullable (default comes from protocol rule)
- `lastReviewAt` — ISO 8601 date, nullable
- `nextReviewDate` — ISO 8601 date, nullable
- `nextReviewAgenda` — text, nullable; parent-entered free-text describing what this appliance's next review visit is for (e.g. "评估扩弓量", "换主弓丝"). Never AI-generated. See PO-ORTHO-015.
- `pauseReason` — nullable, required when `status = paused`
- `notes` — nullable
- `createdAt`, `updatedAt`

Admitted `applianceType` values MUST match `orthodontic-protocols.yaml#schema.applianceType`. The spec-to-runtime binding is validated by the knowledge-base check.

`totalAligners` and `daysPerAligner` are clear-aligner-only fields. The Rust command layer MUST reject `insert_orthodontic_appliance` for `applianceType = 'clear-aligner'` when either is missing or non-positive (fail-close, mirroring the existing `prescribedHoursPerDay` rule). Both fields MUST be NULL for non-clear-aligner appliance types. These fields are independent of `reviewIntervalDays`: the latter is the clinical review cadence; these two govern the per-tray wear schedule and are not used to seed reminder_states.

`activationIntervalDays` is expander-only with the same fail-close shape as the clear-aligner fields: the Rust command layer MUST reject a non-null `activationIntervalDays` for any `applianceType` other than `expander`, and MUST reject a non-positive value for `expander`. `currentPhase` / `phaseStartedAt` are governed by PO-ORTHO-013; `nextReviewAgenda` is governed by PO-ORTHO-015.

### PO-ORTHO-003a Multi-Appliance Rendering Invariant

A single non-completed case MAY hold any number of `status = active` appliances concurrently (e.g. an expander + fixed braces + a retainer running in parallel during overlapping treatment phases). The renderer surface MUST render **every** active appliance of the active case, each as its own self-contained card with its own phase, ring metric, next-action, and review agenda. The renderer MUST NOT collapse the set to a single "primary" appliance, hide non-primary appliances, or merge their per-appliance state. A "primary" ordering MAY still be used for layout priority (which appliance occupies the most prominent slot), but it MUST NOT gate visibility. Paused / completed appliances are excluded from the active-treatment surface and live in the journey timeline.

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
- `checkinDate` — ISO 8601 date (the local calendar date on which the event occurred; day-bucketed indexes and journey grouping key off this).
- `checkinAt` — ISO 8601 datetime, nullable. When present, denotes the actual moment the event occurred (e.g. "aligner-change at 13:42 local"). Drives the cycle anchor in PO-ORTHO-008 with sub-day precision. NULL on legacy rows persisted before schema v19; consumers MUST fall back to `checkinDate` at 00:00 UTC for those rows.
- `activationIndex` — integer, nullable (expander-activation only)
- `alignerIndex` — integer, nullable (aligner-change only)
- `notes` — nullable
- `createdAt`, `updatedAt`

Invariants:

- `aligner-change` and `expander-activation` may repeat within a day if medically indicated; uniqueness is enforced by `checkinId` only.
- A checkin with `applianceId` that does not resolve back to the declared `caseId` is a fail-close violation.
- The command layer MUST reject any `checkinType` outside the admitted two; legacy `wear-daily` and `retention-wear` are permanently retired (PO-ORTHO-005b).
- When `checkinAt` is provided, its UTC date component MUST match `checkinDate`. The command layer fail-closes on mismatch so the day-bucketed indexes and sub-day anchor stay coherent.

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
cycleAnchor          = max(latest aligner-change checkinAt ?? checkinDate@00:00Z, appliance.startedAt)  -- prefer checkinAt (sub-day precision); legacy rows fall back to checkinDate at 00:00 UTC
cycleElapsedHours    = (now − cycleAnchor) in hours, clamped to >= 0
cycleTargetHours     = daysPerAligner × prescribedHoursPerDay      -- daysPerAligner from the appliance row; prescribedHoursPerDay defaults to 22 when null

-- Per-UTC-day baseline-gap accounting. Real life never has zero gaps —
-- a parent who logs nothing should not silently receive 24 h/day wear
-- credit. So each UTC-day segment inside [cycleAnchor, now] is graded
-- "trust the log if any" else "assume baseline gap":
for each UTC-day segment d overlapping [cycleAnchor, now]:
  segmentHours_d       = duration of intersect(d, [cycleAnchor, now])      -- partial at anchor / now edges
  loggedGapHours_d     = Σ overlap(gap, intersect(d, [cycleAnchor, now]))  -- closed + open gaps
  effectiveGapHours_d  = loggedGapHours_d  if  loggedGapHours_d > 0
                        else segmentHours_d × (24 − prescribedHoursPerDay) / 24
effectiveGapHoursInCycle = Σ effectiveGapHours_d
cycleNetWearHours        = max(0, cycleElapsedHours − effectiveGapHoursInCycle)

cycleProgressRatio   = cycleNetWearHours / cycleTargetHours        -- 0..1+; 1 = on schedule, <1 = behind
predictedSwitchDate  = now + (cycleTargetHours − cycleNetWearHours) / netWearRate hours
                       where netWearRate = cycleNetWearHours / cycleElapsedHours, fallback to prescribedHoursPerDay/24 when no data yet
daysShifted          = predictedSwitchDate − (cycleAnchor + daysPerAligner)  -- 0 = on schedule, +N = pushed back N days
```

Constraints:

- There is no `daily compliance bucket`. The cycle projection MUST NOT be re-bucketed into "今日达成 / 部分 / 缺席" verdict labels; the cycle metric wording stays cycle-relative ("本副已净戴 X / Y 小时", "下次换套预计 5/15（推后 1 天）"). The daily net-wear *view* admitted below is a raw tally, not a verdict bucket, and is the only daily-framed surface permitted.
- UI MUST label the metric as "任务达成率近似" / "净戴时长近似" and MUST NOT present `cycleNetWearHours` as a clinically precise wear-time reconstruction.
- The projection MUST reflect open intervals (still accumulating un-wear), so the displayed `cycleNetWearHours` updates monotonically while the appliance is out.
- Per-day baseline gap semantics: a UTC-day segment with ZERO logged gap hours is credited a presumed gap of `segmentHours × (24 − prescribedHoursPerDay) / 24` (≈ 2 h/day at the standard 22 h prescription). Any segment with non-zero logged gap hours uses the logged total verbatim — parents who actively record their own gaps are trusted even when the recorded total is below the baseline (e.g. a 1 h take-out day). The baseline exists so unrecorded days do not silently award 24 h/day wear credit, NOT to override actively-logged data.
- For non-clear-aligner removable appliances (twin-block / activator / retainer-removable) the same projection applies, with `cycleTargetHours` = (review interval days × prescribedHoursPerDay) since they have no aligner index.
- A future `compliance-v2` may extend this (e.g., smart-device ingest). It is intentionally out of scope for v1.

### PO-ORTHO-008a Daily Net-Wear View

For `retainer-fixed | retainer-removable` appliances, and for any removable appliance whose owning case is in `stage = retention`, the renderer MAY surface a **daily net-wear view** as the primary ring metric instead of the cycle ring. Rationale: the retention review cycle is ~180 days (`PO-ORTHO-RETENTION-REVIEW`); a 180-day cycle ring carries no day-to-day signal for the parent, whereas "今日是否戴够" is the actionable daily question.

```
todayNetWearHours = 24 − Σ gap_hours overlapping [today 00:00 local, now]
                    (open gap counted up to `now`; same overlap math as the cycle projection)
todayTargetHours  = appliance.prescribedHoursPerDay   -- the medically prescribed daily wear
```

Constraints (fail-close on the wording, same posture as PO-ORTHO-008):

- The view MUST be labelled "今日净戴近似" — it is a raw tally derived from the same wear-gap stream, NOT a clinical reconstruction and NOT a verdict bucket.
- `retainer-fixed` has no wear-gap stream (it is a fixed appliance, PO-ORTHO-005a); for it the daily view is not applicable and the ring falls back to the phase/month view (PO-ORTHO-013).
- The underlying per-cycle projection (`predictedSwitchDate` / `nextReviewDate` math) is unchanged and still runs; only the *displayed ring metric* differs. The daily view never replaces the cycle math, it re-frames the surface metric.
- This is a v1 admission scoped to retention surfaces only. It MUST NOT be applied to `clear-aligner` active-series wear, where the cycle ring remains the only admitted ring metric.

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

## PO-ORTHO-012 Photo Sessions

Orthodontic photo sessions are admitted as a structured local-only image
record so a parent can re-experience the treatment journey ("before / after"
intra-oral comparison). They are NOT clinical evidence and NOT input to any
AI prompt.

Governing fact sources:

- `tables/local-storage.yaml#orthodontic_photo_sessions`
- `tables/local-storage.yaml#attachments` (ownerTable admits `orthodontic_photo_sessions`)

### Session shape

A photo session row stores and reads:

- `sessionId` (ULID)
- `childId` (FK cascade delete)
- `caseId` (FK cascade delete on `orthodontic_cases`)
- `applianceId` (FK cascade delete on `orthodontic_appliances`, nullable; pin to a specific appliance when the session is anchored to one)
- `trayIndex` (INTEGER, nullable; clear-aligner only — the tray number when the session was captured)
- `sessionDate` (ISO 8601 date, parent-entered)
- `note` (TEXT, nullable; parent-entered free text — same boundary as `orthodontic_cases.notes`)
- `createdAt`, `updatedAt`

### Image storage

Each captured photograph is one row in the shared `attachments` table with:

- `ownerTable = 'orthodontic_photo_sessions'`
- `ownerId = sessionId`
- `metadataJson = '{"angle":"front"}'` or `'{"angle":"side"}'` — exactly one angle per attachment
- `filePath` pointing at a file under
  `${appLocalData}/parentos/photos/${childId}/${sessionId}/${angle}.{ext}`
- `mimeType` taken from the admitted image set `image/jpeg | image/png | image/webp`

The runtime MUST downsample any incoming bitmap so the longest edge is
≤ 1600 px, then re-encode as `image/jpeg` quality 82 before writing to disk.
This is a hard cap so the local DB / disk footprint stays bounded and so the
renderer can read the entire bitmap into memory without OOM risk.

#### Format-specific decode behavior

- **PNG with alpha** — incoming alpha is flattened onto an opaque white
  background before JPEG re-encode (JPEG has no alpha channel). Photographic
  intra-oral photos do not carry alpha; flatten-to-white is admitted so an
  occasional screenshot does not bounce off the gate. Future profiles MAY
  swap the background color but MUST not introduce a transparency channel
  on the persisted JPEG.
- **WebP animated** — the runtime decodes the **first frame only**. The
  `image` crate's WebP decoder does not expose later frames, and the
  album semantics (one photo per `(session, angle)` pair) intentionally
  do not preserve motion. Admitting animated WebP later requires a new
  schema slot, not a quiet upgrade of this contract.
- **JPEG with trailing garbage** — common camera-firmware quirk; the
  runtime MUST tolerate trailing bytes after the EOI marker as long as a
  valid frame decodes.
- **EXIF orientation** — the runtime does NOT currently re-orient images
  per the EXIF `Orientation` tag. A future revision MAY add normalization;
  until then UI surfaces show photos in their raw byte order. This is
  documented here so a "rotated phone photo" report is recognized as known
  behavior, not a bug.

A session may carry 0, 1, or 2 attachments (one per angle); a third attachment
with the same angle for the same session is a fail-close violation.

### Angle enum (v1)

Admitted `angle` values are `front | side`. Future extensions (e.g.
`upper-arch | lower-arch | bite | overjet`) are explicitly out of scope for
v1 and may NOT be quietly admitted without amending this section.

### Cascade and lifecycle

- Deleting an `orthodontic_cases` row MUST cascade-delete all
  `orthodontic_photo_sessions` rows for that case, all matching `attachments`
  rows, AND the corresponding files under
  `${appLocalData}/parentos/photos/${childId}/${sessionId}/`. The directory
  prune is a fail-safe step that does not error when the directory is missing.
- Deleting an `orthodontic_photo_sessions` row directly MUST cascade-delete
  its `attachments` rows + the on-disk session directory by the same fail-safe
  contract.
- Deleting a `children` row cascade-deletes every `orthodontic_photo_sessions`
  and matching `attachments` row through the existing FK chain; the runtime
  command must also prune `${appLocalData}/parentos/photos/${childId}/`.
- Pause / resume of an appliance does NOT affect photo sessions.

### AI boundary

Photo sessions are entirely out of scope for any AI prompt or summary. The
runtime MUST NOT read photo bytes, EXIF, captions, or per-session counts into
any prompt context, and the orthodontic AI summary surface (PO-ORTHO-010)
MUST NOT mention photo sessions even as a fact restatement. Photos are a
private parental memory artifact, not an analyzable signal.

### Privacy

All photo bytes live locally. The runtime MUST NOT upload, transmit, or
include them in any export that leaves the device. The session directory is
within the per-app local data dir already covered by the broader PIPL
boundary (`apps/parentos/AGENTS.md#Privacy Boundary`).

## PO-ORTHO-013 Per-Appliance Treatment Phase

Each appliance progresses through a clinically-ordered sequence of treatment
phases that is **specific to its `applianceType`** (排齐整平 → 关闭间隙 → … for
fixed braces; 加力扩弓 → 保持稳定 for an expander; etc.). This is distinct from
`orthodontic_cases.stage` (PO-ORTHO-002): `stage` is the course-level lifecycle
(初评 / 方案规划 / 治疗中 / 保持期 / 已完成); `currentPhase` is the per-appliance
clinical step *within* the active course. A case with three active appliances
can have each appliance in a different phase.

The admitted phase sequence per `applianceType` is governed solely by
`orthodontic-protocols.yaml#appliancePhases`. Each entry is an ordered list of
`{ phaseId, label, description, expectedMonths }`. `label` is the short phase
name on the appliance card pill; `description` is a one-sentence plain-language
explanation of what the phase means, surfaced in the phase-set / phase-advance
dialog for non-clinical readers. `description` is descriptive only — it states
what the phase IS and MUST NOT prescribe wear behavior or assert efficacy
(PO-ORTHO-010 boundary); it is human-authored static catalog text, never
AI-generated.

Invariants (fail-close on each):

- `orthodontic_appliances.currentPhase`, when non-null, MUST be a `phaseId`
  admitted for that row's `applianceType` in `appliancePhases`. A `currentPhase`
  outside the type's sequence is a fail-close violation.
- `currentPhase` NULL is an admitted intermediate state ("phase not yet set"),
  the same posture as a nullable `reviewIntervalDays`. The renderer surfaces a
  "设置阶段" affordance; it does not fail-close.
- `phaseStartedAt` MUST be NULL iff `currentPhase` is NULL, and a valid ISO 8601
  date otherwise.
- Phase transitions are **parent-initiated only** — runtime MUST NOT auto-promote
  an appliance between phases. The dedicated command
  `advance_orthodontic_appliance_phase` performs the transition; it MUST reject
  any target that is not the immediate next `phaseId` in the type's sequence
  (mirroring the PO-ORTHO-002 stage-adjacency rule), and MUST set `phaseStartedAt`
  to the transition date.
- The per-appliance month counter the UI shows is
  `monthsSince(phaseStartedAt ?? startedAt)` over the current phase's
  `expectedMonths`. `expectedMonths` is a typical-duration projection, never a
  hard deadline; the counter MAY exceed `expectedMonths` and the UI MUST NOT
  render that as an error or a "落后" verdict (PO-ORTHO-010 boundary).

## PO-ORTHO-014 Expander Activation Cadence

Expander activation ("加力 / 转动") is recorded as discrete `expander-activation`
checkins (PO-ORTHO-005) against a running `completedActivations` counter toward
`prescribedActivations`. PO-ORTHO-014 adds the forward cadence projection.

- `orthodontic_appliances.activationIntervalDays` is the per-appliance turn
  cadence in days. When set, it overrides the protocol-rule default
  (`PO-ORTHO-EXPANDER-ACTIVATION#defaultIntervalDays`) for both the
  reminder-state next-trigger computation and the UI "下次转动" projection.
- Next-activation projection:
  `nextActivationAt = max(latest expander-activation checkinAt, appliance.startedAt) + activationIntervalDays`.
  When `completedActivations >= prescribedActivations` the projection stops and
  the UI surfaces "已完成加力" instead of a next date (mirroring the protocol
  rule's `stopWhen`).
- Activation progress is `completedActivations / prescribedActivations`. This is
  the expander's ring metric (PO-ORTHO-013 phase view is the fallback when
  `prescribedActivations` is null).
- Bilateral / per-screw turn detail ("左 1 圈 + 右 1 圈") is NOT structured data;
  it lives in the `expander-activation` checkin's `notes` free-text field. The
  schema deliberately does not model per-side turn counts in v1.
- `activationIntervalDays` is expander-only and fail-closes for any other
  `applianceType` (PO-ORTHO-003, PO-ORTHO-011).

## PO-ORTHO-015 Per-Appliance Review Agenda

`orthodontic_appliances.nextReviewAgenda` is a parent-entered free-text note
describing what the appliance's next review visit is for ("评估扩弓量",
"换主弓丝", "拍片确认稳定"). It is purely parent input — the runtime MUST NOT
synthesize, infer, or AI-generate it, consistent with `orthodontic_cases.primaryIssues`
and PO-ORTHO-010.

- When a case has multiple active appliances, the renderer aggregates a
  case-level "下次复诊" surface: the consolidated review date is
  `min(active appliances.nextReviewDate)` (the same projection PO-ORTHO-002
  caches into `orthodontic_cases.nextReviewDate`), and the "当次议程" list
  enumerates each active appliance alongside its `nextReviewAgenda`.
- `nextReviewAgenda` is out of scope for any AI prompt or summary, the same
  boundary as photo sessions (PO-ORTHO-012) and `notes`.
- A NULL `nextReviewAgenda` renders as a neutral empty marker for that
  appliance (e.g. an em-dash) — never as fabricated, inferred, or AI-generated
  agenda text. The empty-state marker is not "placeholder content"; it is the
  absence of content, surfaced so the appliance still appears in the agenda
  list with its identity.

## PO-ORTHO-011 Fail-Close Behaviors

The orthodontic layer must fail closed when:

- a persisted `orthodontic_checkins.checkinType` is outside the admitted set (`aligner-change | expander-activation`); legacy `wear-daily` / `retention-wear` are permanently retired (PO-ORTHO-005b)
- a persisted `orthodontic_appliances.applianceType` is outside the protocol enum
- a persisted `orthodontic_cases.caseType` or `stage` is outside its enum
- a protocol reminder writes a synthetic ruleId (anything not in the unioned catalog)
- an appliance is created whose `startedAt` is earlier than `PO-ORTHO-009` minAge
- a persisted `orthodontic_appliances.currentPhase` is non-null but not in the `appliancePhases` sequence for that row's `applianceType` (PO-ORTHO-013)
- `orthodontic_appliances.phaseStartedAt` and `currentPhase` disagree on nullness (one set, the other null) (PO-ORTHO-013)
- `advance_orthodontic_appliance_phase` is called with a target that is not the immediate next `phaseId` in the type's sequence (PO-ORTHO-013)
- `orthodontic_appliances.activationIntervalDays` is non-null for an `applianceType` other than `expander`, or non-positive for `expander` (PO-ORTHO-014)
- `orthodontic_cases.nextReviewDate` is written directly without being recomputed from active appliances
- an AI summary emits forbidden wording from PO-ORTHO-010 and the surface still tries to display it
- a checkin references a `caseId`/`applianceId` pair that does not round-trip
- a second non-completed case is inserted (or updated into) for the same `childId` (PO-ORTHO-002b)
- an `orthodontic_unwear_intervals` row is inserted with `endAt <= startAt`
- a second open interval (`endAt IS NULL`) is inserted for the same `applianceId` while another open interval already exists
- a wear-gap interval is inserted for an appliance type outside `clear-aligner | twin-block | activator | retainer-removable`
- a wear-gap interval references a `caseId` / `applianceId` pair that does not round-trip
- closing or deleting an interval fails to update the matching `PO-ORTHO-UNWEAR-OPEN` reminder_state
- an `orthodontic_photo_sessions` row references a `caseId` / `applianceId` pair that does not round-trip (PO-ORTHO-012)
- an `attachments` row claims `ownerTable = 'orthodontic_photo_sessions'` but its `ownerId` does not resolve to a live `orthodontic_photo_sessions` row (PO-ORTHO-012)
- an `attachments.metadataJson` for a photo-session attachment is missing `angle`, or `angle` is outside the admitted enum `front | side` (PO-ORTHO-012)
- a third photo attachment is inserted with an `angle` that already exists for the same `sessionId` (PO-ORTHO-012)
- an incoming photo bitmap fails the `≤ 1600 px longest edge` cap or the `image/jpeg quality 82` re-encode step (PO-ORTHO-012)
- a photo upload is attempted outside the admitted mime set `image/jpeg | image/png | image/webp` (PO-ORTHO-012)
- deletion of a case / child / session fails to prune the matching files under `${appLocalData}/parentos/photos/...` (PO-ORTHO-012; directory-missing is fail-safe, anything else is fail-close)
- any code path reads photo bytes, captions, or session metadata into an AI prompt or export payload (PO-ORTHO-012)

## Phase Exclusions

- `compliance-v2` (smart-device or OCR-based wear ingest)
- case-level pause (explicitly prohibited by PO-ORTHO-004)
- cross-child comparative dashboards
- AI-driven treatment planning of any kind
