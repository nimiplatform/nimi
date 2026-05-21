# Profile Contract

> Owner Domain: `PO-PROF-*`

## Scope

This contract governs child profile CRUD, retained profile detail surfaces,
growth charts, vaccine tracking, milestone tracking, extended health-record
history surfaces, profile-local AI summaries, medical-event AI adjuncts,
posture assessment projection, and OCR-assisted measurement import.

The `/profile` first screen is now governed by
`health-record-console-contract.md` (`PO-HREC-*`). Structured add-data entry is
governed by `capture-orchestrator-contract.md` (`PO-CAPT-*`). This contract
retains child identity, detail/history surfaces, and domain-specific record
semantics that feed those contracts.

Covered features from `feature-matrix.yaml`:

- `PO-FEAT-001` child profile CRUD
- `PO-FEAT-004` growth data record
- `PO-FEAT-005` growth chart
- `PO-FEAT-006` vaccine tracking
- `PO-FEAT-007` milestone tracking
- `PO-FEAT-025` profile-local AI summaries
- `PO-FEAT-034` vision and eye-health records
- `PO-FEAT-035` dental records
- `PO-FEAT-036` allergy tracking
- `PO-FEAT-037` sleep tracking
- `PO-FEAT-038` medical events
- `PO-FEAT-039` posture assessment surface
- `PO-FEAT-040` Tanner puberty tracking
- `PO-FEAT-041` fitness assessments
- `PO-FEAT-022` OCR health-sheet ingestion

Governing fact sources:

- `tables/local-storage.yaml#children`
- `tables/local-storage.yaml#health_record_events`
- `tables/local-storage.yaml#health_record_values`
- `tables/local-storage.yaml#vaccine_records`
- `tables/local-storage.yaml#milestone_records`
- `tables/local-storage.yaml#allergy_records`
- `tables/reference-data-assets.yaml#growth-standards`
- `tables/health-metric-registry.yaml`
- `tables/health-capture-protocols.yaml`
- `tables/health-evaluation-rules.yaml`
- `tables/reference-data-assets.yaml#milestone-catalog`
- `tables/reminder-rules.yaml`
- `tables/routes.yaml#/profile`
- `tables/routes.yaml#/profile/*` (routeKind and summarySource metadata)
- `tables/routes.yaml#/profile/*` redirect shells

## PO-PROF-001 Child Record Shape

Phase 1 child records must round-trip these typed fields:

| Field | Type |
|---|---|
| `childId` | `string` |
| `familyId` | `string` |
| `displayName` | `string` |
| `gender` | `male \| female` |
| `birthDate` | `ISO 8601 date string` |
| `birthWeightKg` | `number \| null` |
| `birthHeightCm` | `number \| null` |
| `birthHeadCircCm` | `number \| null` |
| `avatarPath` | `string \| null` |
| `nurtureMode` | `relaxed \| balanced \| advanced` |
| `nurtureModeOverrides` | `Record<string, string> \| null` |
| `allergies` | `string[] \| null` |
| `medicalNotes` | `string[] \| null` |
| `recorderProfiles` | `RecorderProfile[] \| null` |
| `createdAt` | `ISO 8601 datetime string` |
| `updatedAt` | `ISO 8601 datetime string` |

Delete must cascade through all dependent child-scoped tables named in
`local-storage.yaml` child deletion cascade constraints, including
`health_record_events`, `health_record_values`, retained stateful health tables,
attachments, reminder states, journal entries, AI conversations, growth
reports, settings-adjacent child records, and orthodontic records.

## PO-PROF-002 Growth Measurement Inputs

This write contract is superseded by `capture-orchestrator-contract.md` and
`local-storage.yaml#health_record_events` / `#health_record_values`.
Profile detail surfaces may display growth history, but they must not own an
independent growth write path.

Required fields:

- `measurementId`
- `childId`
- `typeId`
- `value`
- `measuredAt`
- `ageMonths`
- `createdAt`

Optional fields:

- `percentile`
- `source`
- `notes`

Historical `typeId` semantics migrate to `health-metric-registry.yaml`
`metricId` values. The admitted `growth-standards` data asset remains a reference asset for
evaluation and percentile/chart rendering only.

## PO-PROF-003 Growth Chart Data Sources

Growth charts may consume only two data sources:

1. local `health_record_values` whose metric ids map to growth chart series
2. committed WHO-backed percentile assets for types whose `curveType` is `lms-percentile`

Supported LMS-backed types in Phase 1:

- `height`
- `weight`
- `head-circumference`
- `bmi`

Reference-range-only types must stay on the static reference-range path and must not be rendered as fabricated percentile curves.

## PO-PROF-004 WHO Data Boundary

WHO percentile rendering must obey these invariants:

- assets must originate from official WHO 2006/2007 tables
- data must be keyed by measurement `typeId` and child sex
- the loader must return typed percentile lines only when a real dataset exists for the requested combination
- when a dataset is unavailable for the requested combination or age coverage, the UI must fall back to child measurements only
- the app must not synthesize percentile values, fake LMS coefficients, or placeholder curves
- `weight.ageRange` stays open for local recording through 216 months, but official WHO percentile reference coverage stops at 120 months
- for `weight` requests beyond 120 months, the chart must remain measurement-only even though local recording stays available

## PO-PROF-005 Chart Safety Wording

Growth chart presentation is descriptive only in Phase 1.

- `P50` is the median reference line
- values below `P3` or above `P97` may trigger the fixed wording `suggest consulting a professional`
- the profile surface must not render diagnostic, comparative-ranking, or treatment language

## PO-PROF-006 Vaccine Record Shape

Vaccine tracking must store and read:

- `recordId`
- `childId`
- `ruleId`
- `vaccineName`
- `vaccinatedAt`
- `ageMonths`
- optional `batchNumber`, `hospital`, `adverseReaction`, `photoPath`

`ruleId` must map to a vaccine reminder rule. Completing a vaccine record must stay consistent with reminder-state completion semantics.

## PO-PROF-007 Milestone Record Shape

Milestone tracking must store and read:

- `recordId`
- `childId`
- `milestoneId`
- `achievedAt`
- `ageMonthsWhenAchieved`
- optional `notes`, `photoPath`
- `createdAt`
- `updatedAt`

`milestoneId` must exist in the admitted `milestone-catalog` data asset. Phase 1 rendering must use catalog facts and stored attainment data only.

## PO-PROF-008 Dental Record Shape

Dental tracking is now projected through `health_record_events` /
`health_record_values` for low-frequency clinical dental facts. `dental_records`
is not an independent write authority after the PO-HREC hard cut.

Dental tracking must still preserve these semantic fields through registered
capture protocols and metric ids:

- `recordId`
- `childId`
- `eventType` — one of `eruption | loss | caries | filling | cleaning | fluoride | sealant | checkup | ortho-assessment | ortho-review | ortho-adjustment | ortho-issue | ortho-end | ortho-start`
- `eventDate`
- `ageMonths`
- optional `toothId` (FDI notation), `toothSet`, `severity`, `hospital`, `notes`, `photoPath`

`toothId` uses FDI two-digit notation (e.g. `51` = upper-right primary central incisor). Whole-mouth events (`cleaning`, `checkup`, `ortho-assessment`, `ortho-review`, `ortho-adjustment`, `ortho-issue`, `ortho-end`, `ortho-start`) may omit `toothId`.

Orthodontic-lifecycle clinical events (`ortho-review`, `ortho-adjustment`, `ortho-issue`, `ortho-end`) are admitted cross-writes from the orthodontic surface into `health_record_events`; daily compliance checkins do NOT write dental timeline events and live in `orthodontic_checkins` instead. See `orthodontic-contract.md#PO-ORTHO-001`.

`ortho-start` is READ-ONLY historical. The dental command layer rejects new `ortho-start` writes; existing rows remain readable and render in the dental timeline. New orthodontic treatments must be modeled through `orthodontic_cases` and `orthodontic_appliances`. Migration v9 may stitch pre-contract `ortho-start` rows to an `unknown-legacy` case only when such rows exist (`orthodontic-contract.md#PO-ORTHO-006`).

The generic dental event picker likewise only exposes the writable subset: `eruption | loss | caries | filling | cleaning | fluoride | sealant | ortho-assessment | checkup`. Orthodontic lifecycle events (`ortho-review | ortho-adjustment | ortho-issue | ortho-end`) are written exclusively via the orthodontic workflow's clinical-event writer (`insert_ortho_clinical_dental_record`), not from the generic form.

## PO-PROF-009 Allergy Record Shape

Structured allergy tracking must store and read:

- `recordId`
- `childId`
- `allergen`
- `category` — one of `food | drug | environmental | contact | other`
- `severity` — one of `mild | moderate | severe`
- `status` — one of `active | outgrown | uncertain`
- optional `reactionType`, `diagnosedAt`, `ageMonthsAtDiagnosis`, `statusChangedAt`, `confirmedBy`, `notes`

The `children.allergies` JSON array remains as a quick-access denormalized summary. `allergy_records` is the structured source of truth for detailed allergy history including timeline and severity changes.

## PO-PROF-010 Sleep Record Shape

Sleep tracking is now captured through `health_record_events` /
`health_record_values`. It must preserve:

- `recordId`
- `childId`
- `sleepDate` — one record per night
- `ageMonths`
- optional `bedtime`, `wakeTime`, `durationMinutes`, `napCount`, `napMinutes`, `quality`, `notes`

The `sleepDate` + `childId` combination must be unique.

Age-appropriate sleep duration reference (descriptive only, not diagnostic):
- 0-3 months: 14-17 hours
- 4-11 months: 12-15 hours
- 1-2 years: 11-14 hours
- 3-5 years: 10-13 hours
- 6-12 years: 9-12 hours
- 13-18 years: 8-10 hours

## PO-PROF-011 Medical Event Shape

Medical events capture outpatient visits, emergency visits, hospitalizations, checkups/screenings, medication courses, and other notable health events through `health_record_events` / `health_record_values`. They must preserve:

- `eventId`
- `childId`
- `eventType` — one of `visit | emergency | hospitalization | checkup | medication | other`
- `title`
- `eventDate`
- `ageMonths`
- optional `endDate`, `severity`, `result`, `hospital`, `medication`, `dosage`, `notes`, `photoPath`

For screenings/checkups, `result` uses `pass | refer | fail` when applicable. Newborn hearing screening should be recorded as the first `checkup` event.

## PO-PROF-012 Tanner Assessment Shape

Puberty staging is now captured through `health_record_events` /
`health_record_values`. It must preserve:

- `assessmentId`
- `childId`
- `assessedAt`
- `ageMonths`
- optional `breastOrGenitalStage` (1-5), `pubicHairStage` (1-5), `assessedBy`, `notes`

Stage values must be integers 1-5 following the Tanner scale. `breastOrGenitalStage` records breast development for female children and genital development for male children.

## PO-PROF-013 Fitness Assessment Shape

Physical fitness assessments are now captured through `health_record_events` /
`health_record_values`. They must preserve:

- `assessmentId`
- `childId`
- `assessedAt`
- `ageMonths`
- optional `assessmentSource`, individual metric fields (`run50m`, `run800m`, `run1000m`, `run50x8`, `sitAndReach`, `standingLongJump`, `sitUps`, `pullUps`, `ropeSkipping`, `vitalCapacity`), `footArchStatus`, `overallGrade`, `notes`

Fitness metric fields follow China National Student Physical Fitness Standards (国家学生体质健康标准) test items. Not all fields are required per assessment — only populated metrics are meaningful.

Beyond the national-standard test items, the fitness domain also captures
general **sport-activity records** (running, swimming, cycling, ball sports,
and other activities a child takes part in). These are captured under the
`fitness-sport-activity` protocol and carry universal fields rather than
graded test items:

- `fitness.activity_category` — the sport/activity category (enum)
- `fitness.activity_duration` — duration in minutes (required)
- `fitness.activity_distance` — distance in metres (optional)
- `fitness.activity_intensity` — perceived intensity, light/moderate/vigorous (optional)

Sport-activity metrics are descriptive logs only — they are not evaluated
against any admitted standard and carry no evaluation or freshness policy.

## PO-PROF-014 Extended Eye Health Measurements

Beyond the base vision metrics, structured eye exam data is captured through
`health_record_values` metric ids in `health-metric-registry.yaml`:

- `corrected-vision-left`, `corrected-vision-right` — corrected (矫正) visual acuity
- `refraction-sph-left`, `refraction-sph-right` — spherical power (球镜 SPH)
- `refraction-cyl-left`, `refraction-cyl-right` — cylindrical power (柱镜 CYL)
- `refraction-axis-left`, `refraction-axis-right` — axis (轴位 AXIS, degrees 0-180)
- `axial-length-left`, `axial-length-right` — axial length (眼轴长度, mm)
- `corneal-curvature-left`, `corneal-curvature-right` — average corneal curvature (角膜曲率, diopters)

- `iop-left`, `iop-right` — intraocular pressure (IOP, mmHg)
- `corneal-k1-left`, `corneal-k1-right` — flat corneal curvature (K1)
- `corneal-k2-left`, `corneal-k2-right` — steep corneal curvature (K2)
- `acd-left`, `acd-right` — anterior chamber depth (ACD, mm)
- `lt-left`, `lt-right` — lens thickness (LT, mm)

Axial length is the most predictive indicator for myopia progression. For school-age children, monitoring axial length every 6 months is more informative than visual acuity testing alone.

## PO-PROF-015 Lab Result Measurements

Blood test results are recorded through `health_record_values` using
reference-range metric ids:

- `lab-vitamin-d` — 25-OH Vitamin D (ng/mL)
- `lab-ferritin` — serum ferritin (ng/mL)
- `lab-hemoglobin` — hemoglobin (g/L)
- `lab-calcium` — serum calcium (mmol/L)
- `lab-zinc` — serum zinc (μmol/L)

Reference ranges are defined in the admitted `growth-standards` data asset. Values outside reference ranges may trigger descriptive-only wording and the standard "建议咨询专业人士" prompt. The profile surface must not render diagnostic or treatment language for lab results.

## PO-PROF-016 Profile-Local AI Summaries

`PO-FEAT-025` is a bounded profile-local summary surface.

- profile sub-pages may request runtime-generated summaries only from the current page's local structured records plus the active child profile
- the summary surface is descriptive only; it is not an advisor-chat knowledge gate and it does not expand `needs-review` domains into free-form expert guidance
- summary output must pass the shared safety filter before display or cache write
- cached summary text in `app_settings` is an implementation detail only; the source of truth remains the underlying local profile records
- the profile surface must not generate diagnosis, treatment plans, comparative ranking, or unsupported causal claims

## PO-PROF-017 Medical Event AI Adjuncts

The medical-events surface may use bounded runtime assistance on top of local event records.

Admitted AI adjuncts are:

- local medical-event timeline summary from current child records
- image-based OCR intake that extracts structured form candidates for the medical-event composer
- single-event descriptive analysis from an already saved local event row

These adjuncts must obey these invariants:

- they may consume only the current child's local medical-event context and the explicitly selected local image when OCR is invoked
- OCR intake is extraction-only and must return structured candidate fields for parent review; it must not auto-save
- smart summaries and event analysis must pass the shared safety filter before display
- the medical-events surface must not emit diagnosis, treatment recommendations, medication instructions, ranking, or unsupported causal explanation

## PO-PROF-018 OCR-Assisted Measurement Import

`PO-FEAT-022` is a profile-local ingestion flow for health-sheet photos or screenshots. OCR may also extract values for the extended eye health and lab result typeIds defined in PO-PROF-014 and PO-PROF-015.

The import flow is:

1. parent selects one local image
2. app requests local runtime image-aware text extraction
3. runtime returns structured measurement candidates only
4. parent confirms or edits candidate values and dates
5. confirmed rows are written through `capture-orchestrator-contract.md` into `health_record_events` and `health_record_values` with `recordKind = parent_confirmed_import`

OCR import must obey these invariants:

- the app must not upload the health-sheet image to arbitrary third-party endpoints
- OCR output is extraction-only and must not include diagnosis, treatment language, ranking, or developmental interpretation
- OCR candidates may target only spec-backed `health-metric-registry.yaml` metric ids supported by the current import surface; growth standards may be consulted only as reference assets
- no measurement row may be written before parent confirmation
- import failures must not silently create placeholder measurements

## PO-PROF-019 Posture Retained Domain

Posture and body-alignment review is an admitted retained-owner stateful
domain. A posture assessment is a discrete dated observation snapshot
(parent or clinician), not a value-at-time PO-HREC metric, so posture records
are stored in their own `posture_assessments` table
(`tables/local-storage.yaml`) and are not folded into `health_record_events`.

This supersedes the prior projection-only disposition: posture now has its
own persistence contract (the `posture_assessments` table), so the earlier
constraint against an independent `/profile/posture` page no longer applies.

- `/profile/posture` is a retained domain detail surface (`tables/routes.yaml`,
  `surfaceKind: health-record-domain-detail`). It owns posture record reads
  and writes against `posture_assessments`.
- `/profile` projects posture as its own console card — a sibling of the
  `health-metric-registry.yaml` snapshot groups, not one of them — that links
  to `/profile/posture`.
- Structured posture writes are owned by the posture detail surface and the
  `/profile` health-capture posture form. Both write only through the
  `posture_assessments` retained-owner path and must not create parallel
  metric truth in `health_record_events`.
- posture surfaces must not render diagnosis, treatment plans, or comparative
  ranking (AI boundary Layer 2).

## PO-PROF-021 Timeline vs Profile Responsibility Boundary

`/timeline` and `/profile` serve complementary but non-overlapping mandates.
This section is hard-cut by `health-record-console-contract.md`: `/profile` is
the current health record console, not the old archive directory.

| Concern | `/timeline` (Timeline) | `/profile` (Health Record Console) |
|---|---|---|
| **Core mandate** | Current action agenda: reminders, today focus, this week, stage focus, report triggers | Current child health state: latest values, record dates, freshness, next-record display, evaluation semantics |
| **Time orientation** | Present and near-future agenda | Current-state snapshot backed by full local records |
| **Data display** | Agenda-driven projection (reminders, recent changes, freshness alerts) | Health-record-console projection from `getHealthRecordConsole(childId, evaluationDate)` |
| **Owned features** | `PO-FEAT-002` reminder engine, `PO-FEAT-003` growth timeline, `PO-FEAT-011` sensitive period guide, `PO-FEAT-046` monthly report trigger | `PO-FEAT-001` child profile CRUD, `PO-FEAT-004`–`PO-FEAT-007` record surfaces, `PO-FEAT-022`/`PO-FEAT-025`/`PO-FEAT-034`–`PO-FEAT-041` extended profile surfaces |
| **Quick stats** | May show agenda-derived counts (overdue, due-today, upcoming) | Must not duplicate timeline agenda counts; shows PO-HREC freshness, next-record dates, and evaluation states |

Invariants:

- Profile must not recompute or display reminder-agenda buckets (`todayFocus`, `thisWeek`, `stageFocus`, `history`, `overdueSummary`, etc.). Reminder state is owned by `timeline-contract`.
- Timeline must not serve as a health record console, record browsing, or history exploration surface. Deep record access is owned by profile detail surfaces and PO-HREC.
- Profile may display next expected record dates and freshness through PO-HREC; those are not timeline agenda buckets.
- Both surfaces may link to each other through typed routes and capture intents.

## PO-PROF-022 Profile Section Summary Projection

The old profile section-summary card grid is retired as the `/profile` primary
projection. `/profile` consumes PO-HREC console snapshots instead.

If archive/detail pages still need section summaries, they must be secondary
detail helpers and must not be used to rebuild the first-screen profile
console. Any retained section summary contains:

| Field | Type | Semantics |
|---|---|---|
| `sectionId` | `string` | Route-derived identifier (e.g., `growth`, `vaccines`, `sleep`) |
| `recordCount` | `number` | Total records in this section for the active child |
| `lastUpdatedAt` | `string \| null` | ISO 8601 datetime of the most recent record, or `null` if no records |
| `state` | `'ok' \| 'empty' \| 'error'` | Load result discriminator |
| `errorMessage` | `string \| null` | Human-readable error description when `state` is `error` |

A retained secondary summary projection must be retrieved via a single batch
call `getProfileSectionSummaries(childId)` that returns all section summaries
in one response. This avoids per-section waterfall queries and provides
consistent snapshot semantics.

Invariants:

- The projection must distinguish `empty` (zero records, successfully loaded) from `error` (load failed). A failed query must not produce `recordCount: 0`.
- `lastUpdatedAt` must reflect the actual most-recent record timestamp, not the query timestamp.
- The batch call must not silently drop failed sections. Every registered archive section must appear in the response with an explicit `state`.
- Any retained secondary UI must render section summaries using the `state` discriminator: `ok` shows count and recency, `empty` shows a contextual empty-state prompt, `error` shows the error with a retry affordance.

## PO-PROF-023 Route Classification and Tool Separation

Profile child route shells fall into two legacy classification kinds:

| `routeKind` | Meaning | Examples |
|---|---|---|
| `archive` | A retained route shell for a structured record domain whose primary UI now lives in `/profile` | `/profile/growth`, `/profile/vaccines`, `/profile/sleep`, etc. |
| `tool` | A retained route shell for an intake utility whose primary UI now lives in PO-CAPT through `/profile` | `/profile/report-upload` |

Invariants:

- The `/profile` root is no longer an archive grid; it is governed by PO-HREC.
- Detail/archive/tool child routes with `redirectTarget: /profile` must redirect to `/profile` and must not mount independent read/write pages.
- PO-CAPT opens from `/profile` or typed reminder capture intent; child routes must not own independent add-data save paths after PO-CAPT admission.
- `tool` routes must not appear as health metric rows unless represented by an admitted `health-metric-registry.yaml` metric or domain projection.
- The `routeKind` value is declared in `routes.yaml` for each `/profile/*` child route.

## PO-PROF-024 Age-Adaptive Section Ordering

Age-adaptive first-screen ordering migrates to PO-HREC. The profile contract no
longer owns section-card ordering for `/profile`.

Ordering principles:

- Health record console groups and rows with higher expected activity at the child's current age rank higher.
- The admitted group set does not change by age; age changes ordering and due/freshness state, not authority.
- Ordering must be deterministic for a given `ageMonths` value.

Health record console ordering tiers (descending priority):

| Age range (months) | Top-tier sections |
|---|---|
| 0–12 | growth, milestones, vaccines, sleep, medical-events |
| 13–36 | growth, milestones, vaccines, dental, sleep |
| 37–72 | growth, dental, vision, vaccines, fitness |
| 73–120 | vision, growth, fitness, dental, tanner (if admitted) |
| 121–216 | vision, fitness, growth, tanner, dental |

Rows not listed in a tier's top group appear after the top group in
`health-metric-registry.yaml` rank order, not route registration order.

## PO-PROF-025 First-Screen Health Summary Card

The `/profile` health record console renders a single profile-local AI health
summary card above the full group list. The card replaces the prior static
key-metrics value row; latest per-metric values remain available on the
group-list rows below it.

Invariants:

- The card is the shared profile AI summary surface (`AISummaryCard`) bound to
  the `overview` domain. It must resolve runtime params through the governed
  `parentos.profile.summary.*` surface helper, warm the local runtime before
  generation, and pass output through shared AI safety filtering.
- The card `dataContext` is derived only from the current `HealthRecordSnapshot`
  projection already rendered by the console. It must not introduce new data
  sources, new bridge calls, or independent storage.
- When no metric snapshot across all groups has a `latestValue`, the card must
  render the shared "record more data" hint instead of a generated summary; it
  must not fabricate summary text.
- The card must fail closed per PO-PROF-020 when a summary is attempted without
  current local page data or when generated output fails safety filtering.
- The card must not own an independent capture or write path, and must not
  duplicate timeline agenda counts or reminder buckets.

## PO-PROF-020 Fail-Close Behavior

The profile layer must fail closed when:

- a stored `typeId`, `ruleId`, or `milestoneId` has no spec-backed catalog entry
- a WHO asset lookup is requested for a missing dataset and the UI tries to display fabricated percentile output
- JSON child fields cannot be decoded into their typed shapes
- create, edit, or delete operations return a malformed typed payload
- a profile-local AI summary path attempts to summarize without current local page data
- a profile-local AI summary path emits text that fails shared safety filtering and still tries to display the unsafe text
- a medical-event OCR intake emits malformed JSON or unsupported event fields and still tries to prefill the form
- a medical-event AI adjunct tries to persist or mutate local rows without explicit parent confirmation
- OCR output is missing required structured measurement fields
- OCR returns a candidate with an unsupported `typeId`
- a candidate import path attempts to write rows without a confirmed measurement date and numeric value
- a dental `toothId` does not match valid FDI notation
- a Tanner stage value is outside the integer range 1-5
- an allergy `status` transition has no `statusChangedAt` timestamp
- a sleep record violates the `childId + sleepDate` uniqueness constraint

### Card-Level Error Isolation (PO-PROF-020a)

Retained secondary archive-summary cards must isolate errors at the card level,
not the page level. The `/profile` first-screen console uses PO-HREC snapshot
error semantics instead.

- A failed section summary query must render an error state on that specific card only. Other cards with successful loads must remain fully functional.
- `.catch(catchLog(...))` or equivalent silent error swallowing that produces `0` / `--` / empty state indistinguishable from "no records" is a fail-close violation.
- Each card must render one of three visual states based on the `state` discriminator from PO-PROF-022: `ok` (data loaded), `empty` (zero records, load succeeded), `error` (load failed, show error + retry).
- A page-level loading failure (e.g., no active child) is a separate concern and renders a page-level empty state, not per-card errors.

## Phase Exclusions

The following remain outside this contract:

- PDF export (`PO-FEAT-031`)
- any fabricated WHO reference data to fill missing datasets
- use of growth data as free-form AI prompt knowledge while `growth` remains `needs-review`
- OCR-triggered automatic save without human confirmation
- OCR-triggered diagnosis, explanation, or treatment guidance
