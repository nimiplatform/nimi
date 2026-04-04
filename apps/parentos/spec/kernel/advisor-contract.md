# Advisor Contract

> Owner Domain: `PO-ADVS-*`

## Scope

This contract governs the AI growth advisor boundary, local snapshot assembly, reviewed-domain runtime use, structured fallback behavior, and the frozen Phase 2 structured report surface.

Covered features from `feature-matrix.yaml`:

- `PO-FEAT-010` AI growth advisor
- `PO-FEAT-023` structured growth report generation
- `PO-FEAT-024` structured local trend analysis

Explicit Phase 1 exclusion from the same matrix:

- `PO-FEAT-013` broad observation-pattern recognition remains out of scope unless separately frozen to a narrower structured-only contract

Governing fact sources:

- `tables/knowledge-source-readiness.yaml`
- `tables/local-storage.yaml#ai_conversations`
- `tables/local-storage.yaml#ai_messages`
- `tables/local-storage.yaml#children`
- `tables/local-storage.yaml#growth_measurements`
- `tables/local-storage.yaml#vaccine_records`
- `tables/local-storage.yaml#milestone_records`
- `tables/local-storage.yaml#journal_entries`
- `tables/local-storage.yaml#growth_reports`
- `tables/routes.yaml#/advisor`
- `tables/routes.yaml#/reports`

## PO-ADVS-001 Snapshot Inputs

Phase 1 advisor requests may consume only the current child's structured local snapshot.

Required snapshot sections:

- child profile summary
- age in months
- growth measurements
- vaccine records
- milestone records
- journal entries

The message-level `contextSnapshot` stored in `ai_messages` must freeze the request-time snapshot and must not be retroactively mutated when local records change later.

## PO-ADVS-002 Runtime Eligibility Gate

Runtime free-form generation is allowed only when every inferred requested domain is `reviewed` in `knowledge-source-readiness.yaml`.

- `reviewed` domains may enter the runtime prompt
- `needs-review` domains must not enter Phase 1 free-form prompt assembly
- mixed-domain questions must be treated as not runtime-eligible

This gate is authoritative even when a local structured record exists for the domain.

## PO-ADVS-003 Structured Fallback

When runtime generation is not allowed, the advisor must return a structured fallback composed from local facts.

The fallback must:

- echo the user question
- summarize the child snapshot with structured facts only
- append source labels when a spec-backed source is known
- use fixed safety wording when a domain is `needs-review`

The fallback must not silently degrade into fake success or unsupported interpretation.

## PO-ADVS-004 Safety Language

AI output must not contain the banned diagnostic or treatment wording defined by ParentOS Phase 1.

Disallowed examples include:

- `developmental delay`
- `abnormal`
- `disorder`
- `should take`
- `recommend medication`
- `recommend treatment`
- `danger`
- `warning`

For anomalous structured data, the advisor may state the objective fact and the fixed phrase `suggest consulting a professional`.

## PO-ADVS-005 Source Attribution

When an answer references reviewed-domain knowledge, the advisor must append source labels projected from `knowledge-source-readiness.yaml`.

When no reviewed-domain source applies, the advisor must return the structured local summary without invented citations.

## PO-ADVS-006 Conversation Persistence

Advisor conversations must persist through:

- `ai_conversations`
- `ai_messages`

Stored messages must preserve:

- `messageId`
- `conversationId`
- `role`
- `content`
- `contextSnapshot`
- `createdAt`

The persistence layer must not omit `contextSnapshot` for user turns that depend on child data.

## PO-ADVS-007 Structured Report Boundary

`PO-FEAT-023` is limited in the current freeze to structured local reports persisted in `growth_reports`.

Allowed report inputs:

- child profile summary
- period start / end
- growth measurements
- vaccine records
- milestone records
- journal entries
- reminder states

Allowed report outputs:

- typed JSON content assembled from local facts
- fixed, deterministic section titles and summaries
- source labels derived from spec-backed tables or local record categories

The reports surface must not:

- send `growth`, `milestone`, `vaccine`, or `observation` facts into free-form runtime prompt generation while those domains remain `needs-review`
- generate diagnosis, treatment, ranking, or causal explanations
- fabricate empty success content when local report generation fails

## PO-ADVS-008 Report Persistence

Structured report writes must round-trip through `growth_reports` with these required fields:

- `reportId`
- `childId`
- `reportType`
- `periodStart`
- `periodEnd`
- `ageMonthsStart`
- `ageMonthsEnd`
- `content`
- `generatedAt`
- `createdAt`

`content` must remain typed JSON. Phase 2 report generation must not store prose-only blobs that discard structure.

## PO-ADVS-009 Structured Trend Analysis Boundary

`PO-FEAT-024` is frozen in the current scope as deterministic local trend analysis only.

Allowed inputs:

- local growth measurements
- local journal entries
- period metadata already used by structured reports

Allowed outputs:

- typed structured trend signals persisted inside the same report JSON payload
- deterministic comparisons such as count changes, latest-versus-previous measurement deltas, and top-recorded observation dimensions
- fixed evidence lines derived directly from local rows

The trend-analysis surface must not:

- call runtime free-form generation for `growth` or `observation`
- emit diagnosis, ranking, causal explanation, or treatment guidance
- use open-vocabulary labels outside the existing spec-backed measurement and observation catalogs

## PO-ADVS-010 Fail-Close Behavior

The advisor layer must fail closed when:

- a request attempts to send `needs-review` knowledge into the runtime prompt
- a generated answer violates banned wording checks
- a typed advisor snapshot cannot be assembled from local rows
- conversation persistence returns malformed typed data
- a reports request attempts to emit free-form AI explanation for `needs-review` domains
- a trend-analysis payload contains malformed structured signals
- a report persistence payload is missing typed JSON content or period metadata

## Phase Exclusions

The following remain outside this contract:

- broad `PO-FEAT-013` observation-pattern generation
- broad `PO-FEAT-024` AI trend narration over `needs-review` domains
- monthly, quarterly, or annual free-form AI narrative generation over `needs-review` domains
- any promotion of `growth`, `milestone`, `vaccine`, or `observation` into free-form AI knowledge while they remain `needs-review`
