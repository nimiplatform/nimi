# Growth Curve Detail Contract

> Owner Domain: `PO-GROWTH-DETAIL-*`

## Scope

This contract governs the ParentOS `/profile/growth` detail surface — the
top-stack rewrite that the topic
`2026-05-18-parentos-growth-curve-page-redesign` admits at wave-0. It is a
detail surface, not a console. It does not own metric ids, percentile bands,
freshness policies, capture protocols, evaluation policies, advisor strategy
selection, reminder kinds, reminder eligibility, knowledge-asset manifests,
or AI runtime construction.

It consumes the following authority by reference and must not redefine,
extend, or shadow it:

- `health-record-console-contract.md` — `HealthRecordConsoleSnapshot`
  projection, `PO-HREC-002` snapshot fields, `PO-HREC-004` storage of
  `health_record_events` + `health_record_values`, `PO-HREC-005` evaluation
  status taxonomy, `PO-HREC-006` freshness output, `PO-HREC-007` detail
  surface capture and bridge edit/delete retention, `PO-HREC-009`
  fail-close behaviors.
- `capture-orchestrator-contract.md` — `PO-CAPT-001` `CaptureIntent`,
  `PO-CAPT-002` modes, `PO-CAPT-004` save transaction.
- `timeline-contract.md` — reminder timeline writeback surface used by the
  next-check CTA when present.
- `reminder-interaction-contract.md` — reminder kind taxonomy boundary
  consumed at deep-link time.
- `knowledge-asset-contract.md` — `growth-standards` admitted reference
  data asset and its loader contract.

Governing fact sources:

- `tables/health-metric-registry.yaml` — canonical `growth.height`,
  `growth.weight`, `growth.head_circumference`, `growth.bmi` rows.
- `tables/health-evaluation-rules.yaml` — `growth.percentile-band`
  evaluation policy referenced by every growth metric.
- `tables/health-capture-protocols.yaml` — `growth-infant-monthly`,
  `growth-child-quarterly`, `growth-school-biannual` protocols used by
  the PO-CAPT Add CTA.
- `tables/routes.yaml#/profile/growth` and `tables/routes.yaml#/timeline`
  — admitted query-param surfaces this contract relies on.
- `tables/nimi-kit-compositions.yaml` — the four admitted app-owned
  compositions enumerated in PO-GROWTH-DETAIL-008.
- `tables/growth-milestone-rules.yaml` — the only authority for
  milestone derivation semantics consumed by PO-GROWTH-DETAIL-002 and
  PO-GROWTH-DETAIL-009.

This contract owns no metric ids of its own, no write path, no parallel
snapshot for the console, and no fallback that hides a typed contract
violation.

## PO-GROWTH-DETAIL-001 Scope

The `/profile/growth` route is a rich health-record domain detail surface
under `health-record-console-contract.md#PO-HREC-007`. It consumes the
canonical `health_record_events` + `health_record_values` storage via the
existing bridge and the `health-record-domain.ts` projection helpers; it
does not introduce a parallel storage path and does not redeclare console
projection semantics.

The detail surface owns:

- the page-local `GrowthDetailSnapshot` projection shape
  (PO-GROWTH-DETAIL-002),
- the threading of `HealthCaptureModal` props for the Add CTA
  (PO-GROWTH-DETAIL-004),
- the inline edit/delete affordance routing through the existing bridge
  (PO-GROWTH-DETAIL-005),
- the next-check reminder CTA branch selection
  (PO-GROWTH-DETAIL-006),
- the client-side history export
  (PO-GROWTH-DETAIL-007),
- the visual token boundary
  (PO-GROWTH-DETAIL-008),
- fail-close behavior
  (PO-GROWTH-DETAIL-009).

Every other concern — percentile band semantics, freshness state
machines, evaluation status taxonomy, capture protocol field sets, reminder
rule eligibility, advisor strategy selection, knowledge asset manifests —
belongs to the upstream contracts listed under Scope.

## PO-GROWTH-DETAIL-002 Detail Snapshot Contract

The detail surface consumes a `GrowthDetailSnapshot` produced by a pure
projection function. The projection function is deterministic; same input
yields same output, including all `GrowthMilestone.milestoneId` ULIDs.

```text
getGrowthDetailSnapshot(childId, selectedMetricId, growthStandard, nowIso)
  -> GrowthDetailSnapshot

GrowthDetailSnapshot {
  child:            { childId, displayName, gender, birthDate, ageMonths, ageLabel }
  selectedMetric:   { metricId, displayName, unit, ageRangeMonths }
  recencyLabel:     string | null            // "最近更新 X 前" | null
  headline:         GrowthHeadline | { state: 'no_data' }
  crossMetric:      GrowthChip[]             // height / weight / BMI / head_circumference / bone_age
  milestones:       GrowthMilestone[]        // full-record events, ascending by occurredAt
  nextCheck:        GrowthNextCheck | { state: 'unscheduled' }
  trendStats:       GrowthTrendStat[]        // exactly three entries
  historyPage:      GrowthHistoryPage        // already paginated + filtered
  reference:        { standardId, datasetCoverage, datasetAvailable: boolean }
  generatedAt:      ISO8601DateTime
}

GrowthHeadline {
  state:               'has_data' | 'out_of_reference'
  currentValueDisplay: string                // "144 cm"
  currentPercentile:   number | null         // computed via computeApproxPercentile
  measuredAt:          ISO8601Date
  yearOverYearDelta:   { value: number, unit: string, sign: '+' | '-' | '0' }
  trend:               'steady' | 'accelerating' | 'decelerating' | 'plateau'
  ledeTemplate:        TemplateId            // ID into a deterministic template registry
  ledeTemplateInputs:  Record<string, string | number>
}

GrowthChip {
  kind:      'height' | 'weight' | 'bmi' | 'head' | 'bone_age'
  visible:   boolean                          // hide when no latest value
  primary:   string                           // "29.05 kg"
  secondary: string | null                    // "P62" | "偏瘦缘" | null
  tone:      'success' | 'warn' | 'info' | 'neutral'
}

GrowthMilestone {
  milestoneId:        string                  // ULID; deterministic from (ruleId, evidenceEventIds.sort().join(','))
  ruleId:             string                  // FK to tables/growth-milestone-rules.yaml#rules[].ruleId
  kind:               'threshold_crossed' | 'rapid_change'
  polarity:           'positive' | 'negative' // 'negative' = a cautionary node the surface marks distinctly
  deltaMagnitudeDisplay: string               // "+8"
  deltaUnitLabel:     string                  // "CM · 12 月"
  title:              string                  // "突破 140cm" | "体重下降 12%"
  detailLine:         string                  // "2026-02-08 · 9 岁 2 月 · P84"
  occurredAt:         ISO8601Date
  evidenceEventIds:   string[]
}

GrowthNextCheck {
  state:                  'scheduled'
  nextRecordAt:           ISO8601Date
  daysFromNow:            number
  badgeLabel:             string              // "月度复测" | "季度复测" | "半年复测" — from PO-HREC-006 freshness policy
  ledeTemplate:           TemplateId
  recheckRuleId:          RuleId | null       // age-active growth record_data rule the 更改 CTA targets (PO-GROWTH-DETAIL-006); null disables the CTA
}

GrowthTrendStat { label: string, value: string, unit: string, caption: string }

GrowthHistoryPage {
  rows:    GrowthHistoryRow[]                  // already paginated + filtered
  filters: { dateRangeKey: 'all'|'1y'|'6m'|'3m', sourceKey: 'all'|'manual'|'ocr'|'imported'|'reminder' }
  page:    number
  perPage: number                              // 10
  total:   number
}
```

The projection must consume only `health_record_events` +
`health_record_values` filtered by `childId` and the growth metric group;
it must not synthesize records, must not write, and must not call SQLite
or the runtime AI. Percentile values come from the existing
`computeApproxPercentile` helper consumed from
`health-record-domain.ts`; freshness comes from the existing
`resolveNextRecordAt`. The projection must not declare its own percentile
band or freshness state machine.

Growth key-node derivation (`milestones`) consumes two trigger families
from `tables/growth-milestone-rules.yaml`: absolute `threshold_cross` rules
(height achievements — always `polarity: 'positive'`) and `relative_change`
rules (a configured percent swing versus the immediately preceding recorded
value — e.g. a ≥10% weight change). A downward `relative_change` rule emits
`polarity: 'negative'` nodes; the detail surface marks negative nodes
distinctly so the parent notices them. Negative nodes describe recorded
data only — `title` / `detailLine` carry no diagnostic, evaluative, or
alarming wording, consistent with the Layer-1 boundary in
`parentos.md` / `profile-contract.md`. A `relative_change` rule may yield
multiple nodes across a long history (one per qualifying consecutive pair);
each `milestoneId` stays deterministic from `(ruleId, evidenceEventIds)`.

`GrowthDetailSnapshot` is a detail-only projection. It shares only the
`child` and `generatedAt` entity references with PO-HREC-002's
`HealthRecordConsoleSnapshot`. It must not be substituted for the console
snapshot and must not be cached in console storage.

## PO-GROWTH-DETAIL-003 — Retired

The bounded inline AI insight surface ("今日洞察") admitted at wave-0 is
retired. The `/profile/growth` detail surface no longer renders an inline
AI summary region, and no `GrowthInsightStrip` composition is registered in
`tables/nimi-kit-compositions.yaml`.

The on-demand `AISummaryButton` / `AISummaryCard` advisor surface is
unaffected by this retirement; its admission, prompt strategy, and
persistence remain governed by `advisor-contract.md`.

The clause number is retained as a tombstone so that PO-GROWTH-DETAIL-004
through PO-GROWTH-DETAIL-009 keep their stable identifiers.

## PO-GROWTH-DETAIL-004 Add Capture Affordance

The `+ 添加记录` CTA opens `<HealthCaptureModal>` with the following props
threaded from the detail surface:

```tsx
<HealthCaptureModal
  open={addOpen}
  childId={child.childId}
  childBirthDate={child.birthDate}
  initialGroupId="growth"
  initialMetricId={selectedMetricId}
  linkedReminder={null}
  onClose={...}
  onSaved={refreshHistory}
/>
```

The detail surface's contribution to the orchestrator's intent is exactly:

- `groupId = 'growth'` via the `initialGroupId` prop, and
- `metricId = selectedMetricId` via the `initialMetricId` prop.

`PO-GROWTH-DETAIL` does **not** construct a free-standing
`HealthCaptureIntent` object in the detail surface and does **not**
extend the TypeScript `HealthCaptureIntent` shape exported from
`apps/parentos/src/shell/renderer/features/profile/health-capture-orchestrator.ts`.
The semantic-level `CaptureIntent` defined by
`capture-orchestrator-contract.md#PO-CAPT-001` (with its `origin`,
`groupId`, `metricIds`, `recordedAtDefault`, `source`, `linkedReminder`,
`dashboardTaskId`, `prefillValues`, `postSaveBehavior`) is honored
end-to-end by the orchestrator at protocol-selection time. The orchestrator's
internal intent construction is unchanged. The `PO-CAPT-001` `origin`
enum is unchanged; `detail_page` is already an admitted value.

Mode selection (`manual` vs `prefilled`) is performed by the modal based
on whether a `linkedReminder` is present; the Add CTA passes `null` and
therefore drives the `manual` path admitted at
`health-capture-orchestrator.ts:20`.

The detail surface must not call `insertMeasurement`, `updateMeasurement`,
or `deleteMeasurement` directly from the Add flow; all structured growth
writes initiated by the Add CTA flow through `<HealthCaptureModal>` →
`health-capture-orchestrator.ts` → bridge.

For the growth group, the modal's existing dispatch
(`health-capture-modal.tsx` group → `<GrowthAddRecordContent>`) renders
the unified height/weight/head-circumference form. The `initialMetricId`
prop influences the **detail surface's** active metric tab on return
from save but does not change the modal's form fields. This is acceptable
behavior; first cut does not narrow the modal's field set per metric.

## PO-GROWTH-DETAIL-005 Edit / Delete Affordance

The history-row inline edit and delete actions remain via the existing
`updateMeasurement` / `deleteMeasurement` bridge calls.
`health-record-console-contract.md#PO-HREC-007` explicitly retains
domain interactions on detail surfaces; this is permitted because the
underlying bridge writes to the canonical `health_record_events` +
`health_record_values` storage per `PO-HREC-004`.

The detail surface must not introduce a new bridge command, must not
synthesize a parallel write path, and must not modify the records it
displays without round-tripping through the bridge.

## PO-GROWTH-DETAIL-006 Next-Check Reschedule Affordance

The `更改` CTA renders as the next-check node at the foot of the milestone
timeline (PO-GROWTH-DETAIL-002); it is not a standalone card. The next-check
is a real, repeating growth-measurement reminder, so the CTA reads `更改`
(adjust the existing schedule) rather than `设为提醒`.

The next-check node targets the child's **age-active growth `record_data`
reminder** — exactly one admitted rule in `tables/reminder-rules.yaml` whose
`domain` is `growth`, `actionType` is `record_data`, and whose `triggerAge`
range contains the child's age in months (`PO-REM-GRO-001` 0–12m monthly,
`PO-REM-GRO-002` 12–36m quarterly, `PO-REM-GRO-003` 36–216m biannual at the
time of writing). The projection resolves `GrowthNextCheck.recheckRuleId`
deterministically from the child's age; the detail surface does not author,
mutate, reorder, or extend growth rules.

Clicking `更改` opens the next-check reschedule modal — the
`parentos.profile.growth_next_check_modal` composition registered under
PO-GROWTH-DETAIL-008. The modal performs exactly two adjustments to the
targeted rule, both through mechanisms owned by
`reminder-interaction-contract.md`:

- **Next occurrence date** — the modal dispatches the `PO-REMI-005`
  `schedule` action, writing the kind-agnostic `scheduledDate` column for
  that `(childId, ruleId, repeatIndex)`. A cleared date restores the
  rule-derived schedule.
- **Cadence** — the modal writes a `PO-REMI-015` per-`(childId, ruleId)`
  frequency override. Clearing the override restores the rule's authored
  `repeatRule` cadence.

The detail surface must not:

- write to `tables/reminder-rules.yaml` or any reminder rule table;
- introduce a new reminder `kind` — the growth reminders are admitted
  `task` kind;
- mark the reminder complete, synthesize a `completedAt`, or otherwise fake
  reminder completion from the reschedule flow (`record_data` completion is
  gated by `PO-REMI-013` capture-policy proof);
- write any kind-scoped progression timestamp.

The `record_data` completion path is unchanged: a measurement is still
recorded through PO-GROWTH-DETAIL-004 (`HealthCaptureModal`), never through
this CTA.

## PO-GROWTH-DETAIL-007 History Export

The CSV export is a pure client-side serialization of the currently
visible (paginated and filtered) history rows. Columns, in this fixed
order:

1. `effective_date` — ISO 8601 date
2. `age_label` — display string
3. `value` — numeric primary value
4. `unit` — unit string
5. `source` — `manual` | `ocr` | `imported` | `reminder`
6. `percentile` — number or empty

No header columns in any other language. The export does not include
rows for metrics other than the currently selected metric, does not
include AI-generated content, and does not include row identifiers that
would expose internal storage shapes.

## PO-GROWTH-DETAIL-008 Visual Token Boundary

The detail surface consumes only `@nimiplatform/kit/ui` primitives
and existing CSS custom properties — `--nimi-text-*`, `--nimi-surface-*`,
`--nimi-status-*`, `--nimi-accent-*`, `--nimi-action-*`, `--nimi-border-*`,
`--nimi-material-*`, `--nimi-elevation-*`. The mockup's `--mint`,
`--mint-deep`, `--mint-tint`, `--mint-band`, `--aurora`, `--paper`,
`--surface-strong`, `--ink-*`, `--radius-*` variables and the global
`.aurora` background are **not** introduced; they are recreated through
existing tokens per `kit-ui-consumption-contract.md`. No app-local design
token is introduced. No new kit primitive is admitted.

Future visual compositions for the growth detail page must be admitted in
`tables/nimi-kit-compositions.yaml` before they land. Expected app-owned
surfaces include the hero card, the milestone timeline (which also surfaces
the current-measurement and next-check nodes), and the next-check reschedule
modal (`parentos.profile.growth_next_check_modal`, PO-GROWTH-DETAIL-006),
each registered in `tables/nimi-kit-compositions.yaml`.

When those compositions are implemented, their authority placement under
`nimi-kit-compositions.yaml` with `classification: app_owned_composition`
is the only permitted form. None of them may be lifted into `kit/**`
without a new admission topic.

## PO-GROWTH-DETAIL-009 Fail-Close Behaviors

The surface must fail closed when any of the following occurs:

- the active `metricId` is not present in
  `tables/health-metric-registry.yaml` — render PO-HREC-009 fail-close.
- the WHO LMS dataset for the selected `growthStandard` is unavailable
  and the metric requires percentile computation — the hero dial
  switches to deterministic-only display with no percentile shown; the
  surface indicates `参考数据未加载` rather than rendering empty
  percentiles.
- the milestone projection encounters a rule it cannot evaluate
  (malformed `triggerCondition` payload after the YAML loader's typed
  parse, or an evidence event missing the required metric value) — skip
  that rule; never crash the surface, never substitute a placeholder
  milestone.
- the next-check freshness policy is unresolved — render
  `GrowthNextCheck = { state: 'unscheduled' }` with the policy-ref's
  diagnostic label; the CTA is disabled.
- no growth `record_data` rule is age-active for the child
  (`GrowthNextCheck.recheckRuleId` is `null`) — the `更改` CTA is disabled;
  the surface must not target an arbitrary rule, open the reschedule modal
  against a missing rule, or synthesize a reminder.
- the CDC growth-standards dataset is requested but no admitted CDC
  asset exists in `tables/reference-data-assets.yaml` — disable the CDC
  pill with explanatory tooltip; do not synthesize CDC LMS data.
- the predicted-adult-height chip is requested by future code without
  the algorithm being admitted by a separate topic — compile-time
  absent in this topic; the chip is not present in any composition.

Fail-close behavior must remain visible to the parent. The surface must
not synthesize success states and must not render placeholder reminder
writes.
