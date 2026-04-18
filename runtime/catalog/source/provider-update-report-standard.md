# Provider Update Report Standard

## Purpose

This document defines the standard shape and review rules for provider catalog
update reports.

It exists outside any specific topic because it is a reusable maintenance
standard for `runtime/catalog/source/providers/*.source.yaml`.

## Core Rule

A provider update report is a `candidate discovery` and `review` artifact.
It is not authority mutation by itself.

Only reviewed edits to `runtime/catalog/source/providers/*.source.yaml` may
change source truth.

## Report Modes

Every report must declare one of:

- `provider_wide`
- `family_scoped`

If `family_scoped`, it must explicitly declare the families in scope.

## Family Taxonomy

Use explicit capability families such as:

- `text`
- `vision_language`
- `embedding`
- `image`
- `video`
- `tts`
- `realtime_tts`
- `asr`
- `realtime_asr`
- `voice_workflow`
- `world`
- `music`

If a provider needs another capability family, name it explicitly instead of
collapsing it into a generic bucket.

## Multi-Axis Classification

For complex providers, capability family alone is not enough.

Provider update reports may need up to three axes:

1. `product_family`
2. `capability_family`
3. `lineage_or_track`

Use these when a provider mixes multiple first-party brands or product lines
under one provider id.

Examples:

- `dashscope`
  - `product_family`: `qwen`, `wan`, `tongyi`, `fun_asr`
  - `capability_family`: `text`, `vision_language`, `image`, `video`, `tts`,
    `realtime_tts`, `asr`, `realtime_asr`
  - `lineage_or_track`: `max`, `plus`, `flash`, `vc`, `vd`, `realtime`

If overlapping first-party lines exist in the same capability family, the
report must not force them into one "winner" bucket prematurely.

## Evidence Hierarchy

Preferred evidence order:

1. official provider docs, changelog, API reference, pricing
2. official provider product or console pages
3. credentialed live probe output, when already available
4. aggregate catalogs and third-party integrations as hints only

If evidence conflicts:

- official provider evidence wins over aggregates
- source remains unchanged until a reviewer resolves the conflict

## Statistical Requirements

Each report must compare:

1. `current_source_inventory`
2. `official_current_inventory`
3. `gap_summary`
4. `curation_decision`
5. `review_actions`

The comparison must be done at the appropriate scoped axis:

- at minimum per capability family
- and for complex providers, per `product_family + capability_family`
- and when needed, also per `lineage_or_track`

## Curation Rules

- `latest 1-2 generations` must be interpreted per scoped line, not only per
  provider id
- additive catch-up should be preferred before removals
- stable rows and dated snapshot rows must be distinguished
- realtime lines must not be silently collapsed into non-realtime lines
- preview, legacy, deployment-scoped, and user-scoped rows must be labeled
  explicitly
- overlapping first-party lines in the same capability family must be modeled
  as coexistence when official docs present them as parallel active options

## Required Output Fields

```yaml
provider: <provider_id>
report_date: YYYY-MM-DD
audit_mode: provider_wide | family_scoped
families_in_scope:
  - text
taxonomy_axes:
  product_family: []
  capability_family: []
  lineage_or_track: []
refresh_policy:
  keep_latest_generations: 2
  authority_home: runtime/catalog/source/providers/<provider>.source.yaml
evidence_urls:
  official: []
  official_product: []
  aggregate_hints: []
current_source_inventory: {}
official_current_inventory: {}
gap_summary:
  missing_in_source: []
  stale_in_source: []
  extra_legacy_in_source: []
  uncertain_items: []
curation_decision:
  keep: []
  add: []
  defer: []
  reject_or_noise: []
review_actions:
  selection_profiles_review_required: true
  defaults_review_required: true
  capability_review_required: false
notes: []
confidence: high|medium|low
```

## Review Expectations

Every report should answer:

- what exists in local source now
- what official current families and rows exist now
- what product families and lineages are active in scope
- what is missing from source
- what is stale but still present
- what should be added now
- what should be deferred
- what should not be admitted
- whether defaults and `selection_profiles` need review

## Non-Goals

This standard does not authorize:

- automatic source mutation from browser output
- aggregate catalogs as authority
- provider-wide flattening that hides family-level drift
- forced collapse of parallel first-party product lines into one synthetic track
