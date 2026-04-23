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
- `tables/local-storage.yaml#dental_records`
- `tables/local-storage.yaml#reminder_states`
- `tables/routes.yaml#/profile/dental`

## PO-ORTHO-001 Three-Layer Data Model

Orthodontic state is modeled in exactly three tables, each with a distinct
semantic purpose. Implementation must never collapse them or cross-write.

| Table | Mandate |
|---|---|
| `dental_records` | Low-frequency, clinical, whole-mouth-timeline events. Orthodontic lifecycle clinical events (`ortho-assessment`, `ortho-review`, `ortho-adjustment`, `ortho-issue`, `ortho-end`) live here and remain visible in the unified dental timeline. |
| `orthodontic_cases` | One row per treatment course. Source of truth for `caseType`, `stage`, and review-date projection. |
| `orthodontic_appliances` | One row per appliance instance attached to a case. Source of truth for `applianceType`, active/paused/completed status, prescribed wear, review cadence, and expander activation counters. |
| `orthodontic_checkins` | High-frequency, structured parent-facing compliance rows. Only `wear-daily`, `aligner-change`, `expander-activation`, `retention-wear` are admitted. Checkins do NOT appear in the dental clinical timeline. |

Invariant: review, adjustment, issue, and end events must write to
`dental_records` only. A `checkinType` value outside the admitted four is a
fail-close violation.

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
- `reviewIntervalDays` — integer, nullable (default comes from protocol rule)
- `lastReviewAt` — ISO 8601 date, nullable
- `nextReviewDate` — ISO 8601 date, nullable
- `pauseReason` — nullable, required when `status = paused`
- `notes` — nullable
- `createdAt`, `updatedAt`

Admitted `applianceType` values MUST match `orthodontic-protocols.yaml#schema.applianceType`. The spec-to-runtime binding is validated by the knowledge-base check.

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
  its clinical timeline (`dental_records` rows) remains visible.

## PO-ORTHO-005 Checkin Shape

Orthodontic checkins must store and read:

- `checkinId` (ULID)
- `childId` (FK)
- `caseId` (FK)
- `applianceId` (FK)
- `checkinType` — one of `wear-daily | aligner-change | expander-activation | retention-wear`
- `checkinDate` — ISO 8601 date
- `actualWearHours` — decimal, nullable (wear-daily / retention-wear only)
- `prescribedHours` — decimal, nullable (wear-daily / retention-wear only; snapshot of appliance.prescribedHoursPerDay at checkin time)
- `complianceBucket` — one of `done | partial | missed`, nullable (computed at write time using `orthodontic-protocols.yaml#schema.complianceThresholds`)
- `activationIndex` — integer, nullable (expander-activation only)
- `alignerIndex` — integer, nullable (aligner-change only)
- `notes` — nullable
- `createdAt`, `updatedAt`

Invariants:

- `(childId, applianceId, checkinDate, checkinType)` is unique for `wear-daily` and `retention-wear` (one per day per appliance per type).
- `expander-activation` and `aligner-change` may repeat within a day if medically indicated; uniqueness is enforced by `checkinId` only.
- `complianceBucket` must never be stored for `aligner-change` or `expander-activation`; those checkins are boolean-completion only.
- A checkin with `applianceId` that does not resolve back to the declared `caseId` is a fail-close violation.

## PO-ORTHO-006 Dental-Record Cross-Write Rules

Orthodontic clinical events write to `dental_records` using these
eventType values (see `profile-contract.md#PO-PROF-008` for the full dental enum):

| Orthodontic lifecycle moment | `dental_records.eventType` |
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

The compliance projection consumed by the orthodontic dashboard is a
task-completion approximation, not a clinical wear-hours reconstruction.

- Thresholds are defined verbatim in `orthodontic-protocols.yaml#schema.complianceThresholds`.
- Dashboard wording MUST label the metric as "任务达成率近似" / "compliance approximation" and MUST NOT present raw `actualWearHours` numbers as clinical evidence.
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

- a persisted `orthodontic_checkins.checkinType` is outside the admitted four
- a persisted `orthodontic_appliances.applianceType` is outside the protocol enum
- a persisted `orthodontic_cases.caseType` or `stage` is outside its enum
- a protocol reminder writes a synthetic ruleId (anything not in the unioned catalog)
- an appliance is created whose `startedAt` is earlier than `PO-ORTHO-009` minAge
- `orthodontic_cases.nextReviewDate` is written directly without being recomputed from active appliances
- an AI summary emits forbidden wording from PO-ORTHO-010 and the surface still tries to display it
- a checkin references a `caseId`/`applianceId` pair that does not round-trip

## Phase Exclusions

- `compliance-v2` (smart-device or OCR-based wear ingest)
- case-level pause (explicitly prohibited by PO-ORTHO-004)
- cross-child comparative dashboards
- AI-driven treatment planning of any kind
