# Health Record Console Contract

> Owner Domain: `PO-HREC-*`

## Scope

This contract governs the ParentOS `/profile` first-screen health record
console. The console is the current-state projection for a child: latest health
facts, record dates, freshness, next expected record dates, evaluation
semantics, and capture intents.

This contract does not own reminder agenda eligibility, notification delivery,
or reminder bucketing. Those remain `PO-TIME-*`. It does not own the capture
modal save transaction. That remains `PO-CAPT-*`.

Governing fact sources:

- `tables/health-metric-registry.yaml`
- `tables/health-evaluation-rules.yaml`
- `tables/health-capture-protocols.yaml`
- `tables/reminder-capture-targets.yaml`
- `tables/local-storage.yaml#health_record_events`
- `tables/local-storage.yaml#health_record_values`
- retained stateful tables explicitly listed in `tables/local-storage.yaml#health_record_unification`
- `tables/routes.yaml#/profile`
- `tables/routes.yaml#/profile/*` rich domain detail surfaces

## PO-HREC-001 Console Mandate

`/profile` is the health record console. Its primary mandate is to show the
current known health state of the active child, grouped by health domain.

The console must show:

- metric or domain row label
- latest value, when present
- latest record date
- freshness state
- next expected record date, when scheduled
- evaluation status
- a capture intent affordance
- a detail route affordance when a detail surface exists

The console must not render as the old archive directory grid. The existing
domain detail surfaces remain product assets: charts, timelines, analysis
cards, record expansion, filters, and domain-specific review interactions are
retained behind the console. The hard cut changes the first-screen entry and
write authority, not the existence of rich detail pages.

Domain detail routes are consumers of the health record authority rather than
independent sources of write-path truth.

## PO-HREC-002 Snapshot Contract

The console consumes one batch projection:

```text
getHealthRecordConsole(childId, evaluationDate) -> HealthRecordConsoleSnapshot
```

Snapshot shape:

```text
HealthRecordConsoleSnapshot {
  child: { childId, displayName, gender, birthDate, ageMonths }
  groups: HealthRecordGroup[]
  generatedAt: ISO8601DateTime
}

HealthRecordGroup {
  groupId
  displayName
  rank
  summaryState
  rows: HealthRecordRow[]
}

HealthRecordRow {
  metricId
  label
  latestValueDisplay
  latestRecordedAt
  latestSource
  trendDisplay
  evaluation
  freshness
  nextRecordAt
  captureIntentTemplate
  detailRoute
}
```

The snapshot must distinguish `missing`, `unrated`, `stale`, and `error`.
A failed query or failed evaluation must not render as no data.

## PO-HREC-003 Metric Registry Authority

`tables/health-metric-registry.yaml` is the only ParentOS authority for console
metric ids, grouping, units, precision, value shape, side semantics, capture
protocol references, evaluation policy references, freshness policy references,
and detail routes.

UI components, detail pages, reminder rows, and OCR confirmation flows must not
define metric ids or metric metadata locally.

Derived metrics such as BMI are not parent-entered facts. They are computed by
the domain kernel from admitted source metrics.

## PO-HREC-004 Storage Projection Boundary

`tables/local-storage.yaml#health_record_unification` defines which existing
domain tables fold into `health_record_events` and `health_record_values`, and
which tables remain stateful or projection-only.

Default hard-cut disposition:

| Shape | Disposition |
|---|---|
| measurement-shaped facts | fold into `health_record_events` and `health_record_values` |
| assessment-shaped metric sets | fold into `health_record_events` and `health_record_values` |
| stateful operational entities | retain under their owner contract and project into PO-HREC only through an admitted projection |
| configuration rows | retain as configuration, not record events |
| reminder, advisor, journal, todo rows | outside health record storage unification |

Dual-write and compatibility shim storage are forbidden. If a retained table
projects into the console, exactly one contract must own that projection.

Precutover data continuity is part of the storage boundary, not a runtime
parallel-read exception. Existing supported rows from folded measurement tables
must be transformed by idempotent migration/repair replay into
`health_record_events` + `health_record_values` with deterministic precutover
ids. After that replay, the console projects only the canonical tables; it must
not read folded tables as a fallback.

Retained rich detail UI may keep stable renderer-facing row shapes such as
`MeasurementRow` when those shapes are UI compatibility contracts for charts and
timelines. The bridge behind such shapes must project from
`health_record_events` + `health_record_values` and must reject unsupported
folded measurement writes fail-closed. Keeping the row shape is not permission
to read or write `growth_measurements` after the hard cut.

## PO-HREC-005 Evaluation Output

Evaluation is semantic first and color second.

```text
HealthEvaluation {
  status:
    on_track |
    watch |
    professional_review_prompt |
    unrated |
    missing |
    error
  statusReasonCode
  shortLabel
  explanation
  sourceRefs
  computedAt
  inputs
  safetyBoundary
}
```

UI color aliases:

| Status | Alias |
|---|---|
| `on_track` | green |
| `watch` | yellow |
| `professional_review_prompt` | red |
| `unrated` | neutral |
| `missing` | neutral |
| `error` | error |

The alias must not be treated as the rule. Components render the status they
receive; they do not compute the status.

`professional_review_prompt` means an admitted descriptive threshold prompts
consulting a qualified professional. It must not be worded as danger,
diagnosis, disease, developmental delay, or treatment need.

## PO-HREC-006 Freshness And Next Record

Metric freshness is owned by PO-HREC.

Timeline may surface agenda reminders. The console may consume visible reminder
targets as one freshness input, but it must not recompute timeline agenda
buckets such as `todayFocus`, `thisWeek`, `stageFocus`, or `history`.

Freshness output:

```text
HealthFreshness {
  freshnessState: current | due_soon | due | overdue | not_scheduled | error
  nextRecordAt: ISO8601Date | null
  reasonCode
}
```

## PO-HREC-007 Console Capture Affordances

Every console row with an admitted `captureProtocolId` exposes a capture intent
template. The template is consumed by PO-CAPT. The console must not directly
save records.

The independent add-data icon opens PO-CAPT in `manual` mode. Row-level actions
open PO-CAPT in `prefilled` mode.

Console rows expose drill-down navigation to the metric registry `detailRoute`.
When a rich domain detail surface exists, `detailRoute` must point to that
domain route, for example `/profile/vision` for visual acuity, eye-axis, and
IOP metrics, or `/profile/growth` for height, weight, head circumference, and
BMI. `/profile/health/:metricId` is a generic fallback only.

Detail surfaces may retain their domain UI and interaction depth: charts,
timeline views, per-record expansion, filters, domain summaries, reminders,
follow-up settings, and source/context cards. They must not create local metric
truth or independent structured health-record write paths. Any structured
health-record write from a detail surface must route through PO-CAPT, or through
an explicitly retained owner contract for non-folded stateful domains such as
vaccines, milestones, allergies, and orthodontic entities.

## PO-HREC-008 Profile Contract Disposition

The old profile index section-summary contract is replaced:

- `PO-PROF-021` is rewritten so profile owns current health status while
  timeline owns agenda eligibility.
- `PO-PROF-022` is retired as the `/profile` primary projection.
- `PO-PROF-023` remains as route classification, but routes must not own
  independent add-data write paths.
- `PO-PROF-024` migrates to PO-HREC as age-adaptive group and row ordering.

## PO-HREC-009 Fail-Close Behaviors

The console must fail closed when:

- a `metricId` is not present in `health-metric-registry.yaml`
- a row requires evaluation but has no admitted evaluation policy
- a freshness policy cannot be resolved
- a retained table projection has no declared owner
- a component attempts to compute status color locally
- missing records and failed queries are indistinguishable
- a derived metric lacks source values and still renders as a real latest value
- the console computes timeline agenda buckets directly
