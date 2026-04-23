# Advisor Contract

> Owner Domain: `PO-ADVS-*`

## Scope

This contract governs the AI growth advisor boundary, local snapshot assembly, advisor prompt strategy selection, reports generation and persistence, and report-specific runtime narration.

Covered features from `feature-matrix.yaml`:

- `PO-FEAT-010` AI growth advisor
- `PO-FEAT-023` growth reports surface
- `PO-FEAT-024` trend analysis
- `PO-FEAT-044` narrative growth reports
- `PO-FEAT-045` report history and narrative editing
- `PO-FEAT-046` automatic monthly report generation

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
- `tables/local-storage.yaml#reminder_states`
- `tables/routes.yaml#/advisor`
- `tables/routes.yaml#/reports`

Cross-contract authority:

- `reminder-interaction-contract.md#PO-REMI-007` — the consult-kind reminder → advisor conversation anchor and writeback sequence

## PO-ADVS-001 Snapshot Inputs

Advisor and reports requests may consume only the current child's structured local snapshot.

Required advisor-chat snapshot sections:

- child profile summary
- age in months
- growth measurements
- vaccine records
- milestone records
- journal entries

Reports may additionally consume reminder states and the profile-side health record surfaces already stored locally.

The message-level `contextSnapshot` stored in `ai_messages` must freeze the request-time snapshot and must not be retroactively mutated when local records change later.

## PO-ADVS-002 Advisor Prompt Strategy Selection

Advisor chat may enter the local runtime whenever request-time snapshot assembly and persistence succeed. The runtime prompt strategy must be selected from exactly one of:

- `generic-chat`
- `reviewed-advice`
- `needs-review-descriptive`
- `unknown-clarifier`

Selection rules:

- `reviewed-advice` is allowed only when every inferred requested domain is `reviewed` in `knowledge-source-readiness.yaml`
- any `needs-review` or mixed-domain question must use `needs-review-descriptive`
- child-specific questions with no resolved domain must use `unknown-clarifier`
- greetings, capability questions, model-identity questions, and other meta/product chat may use `generic-chat`

Boundary rules:

- `needs-review` domains must not enter the `reviewed-advice` prompt path
- `needs-review-descriptive` may only describe local facts, restate record context, clarify scope, and advise consulting a professional
- `unknown-clarifier` must not skip directly to child-specific conclusions
- all advisor strategies must remain local-only and must not bypass snapshot grounding for child-data turns

## PO-ADVS-003 Structured Advisor Fallback

When advisor chat runtime is unavailable, snapshot assembly fails, persistence fails, runtime output violates safety checks, or the runtime call itself fails, the advisor must return a structured fallback composed from local facts.

The fallback must:

- echo the user question
- summarize the child snapshot with structured facts only
- append source labels when a spec-backed source is known
- use fixed safety wording when a domain is `needs-review`

The fallback must not silently degrade into fake success or unsupported interpretation.

## PO-ADVS-004 Safety Language

AI output must not contain banned diagnostic or treatment wording.

Disallowed examples include:

- `developmental delay`
- `abnormal`
- `disorder`
- `should take`
- `recommend medication`
- `recommend treatment`
- `danger`
- `warning`

For anomalous structured data, the advisor or report surface may state the objective fact and the fixed phrase `suggest consulting a professional`.

## PO-ADVS-005 Source Attribution

When an answer uses the `reviewed-advice` strategy, the advisor must append source labels projected from `knowledge-source-readiness.yaml`.

When the strategy is `generic-chat`, `needs-review-descriptive`, or `unknown-clarifier`, the advisor must not invent citations or imply reviewed-domain authority that has not been admitted.

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

### PO-ADVS-006a Reminder-Anchored Consultation Writeback

When a conversation is created from a `consult`-kind reminder (see `reminder-interaction-contract.md#PO-REMI-007`), the advisor module carries two additional responsibilities:

- The `ai_conversations` row must record the originating `reminderRuleId` and `repeatIndex` (via a typed metadata mechanism that must not mutate existing `ai_conversations` columns; the exact storage shape is admitted in Wave 5c). A conversation started outside a reminder context must not carry this anchor.
- When the runtime produces the first successfully-persisted `assistant` message for the anchored conversation, the advisor module must invoke the shared bridge call `upsertReminderConsultation(childId, ruleId, repeatIndex, conversationId, now)`. This writes `consultedAt` and `consultationConversationId` onto the matching `reminder_states` row.
- The writeback must be idempotent per `(childId, ruleId, repeatIndex)`. The first successful writeback wins; subsequent assistant messages on the same conversation do not re-emit the writeback.
- If `ai_conversations` creation fails, or the first assistant message cannot be persisted, or the runtime output is filtered by `PO-ADVS-004`, no writeback may occur. The reminder remains in its pre-consult progression state. The advisor surface must fall back to `PO-ADVS-003` structured wording.
- Deletion of the anchored `ai_conversations` row (including child-scope cascade per `local-storage.yaml` child deletion list) must clear `consultedAt` and `consultationConversationId` on the associated `reminder_states` row. Advisor retains the mandate to perform this paired clear; the reminder engine must not synthesize it.

This writeback is the only admitted path for `consultedAt` / `consultationConversationId`. Reminder panels and `/reminders` surfaces must not write these columns directly.

## PO-ADVS-007 Reports Surface Boundary

The reports surface may generate and persist either deterministic structured reports or runtime-assisted narrative reports from local child records.

Allowed report inputs:

- child profile summary
- period start and end
- growth measurements
- vaccine records
- milestone records
- journal entries
- reminder states
- other profile-local health records already stored in the app

Allowed report outputs:

- `version: 1` `format: structured-local`
- `version: 2` `format: narrative | narrative-ai`
- structured trend signals and evidence lines
- parent-editable narrative text for version 2 payloads

Report narration may summarize `needs-review` domains only as local factual description plus safety wording. Reports must not emit diagnosis, treatment, ranking, or unsupported causal explanation.

## PO-ADVS-008 Report Persistence

Report writes must round-trip through `growth_reports` with these required fields:

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

`reportType` is currently limited to:

- `monthly`
- `quarterly`
- `quarterly-letter`
- `custom`

`content` must remain typed JSON and may carry either the v1 structured schema or the v2 narrative schema.

## PO-ADVS-009 Report History, Editing, and Auto-Generation

Report authority includes:

- viewing persisted reports from `growth_reports`
- auto-generating the current month's report from the timeline surface
- parent editing of version 2 narrative content after generation

Edits must round-trip through the same `growth_reports.content` field. The app must not create shadow copies or out-of-band report text stores.

## PO-ADVS-010 Trend Analysis Boundary

Trend analysis must stay tied to local evidence lines.

- deterministic comparisons and counts are allowed
- runtime-assisted report narration is allowed only inside the reports surface
- trend signals must remain anchored to local rows or spec-backed section labels
- trend narration must not broaden advisor-chat runtime permission for `needs-review` domains

## PO-ADVS-011 Fail-Close Behavior

The advisor layer must fail closed when:

- an advisor chat request attempts to send `needs-review` knowledge into the `reviewed-advice` prompt path
- a generated answer violates banned wording checks
- a typed advisor snapshot cannot be assembled from local rows
- conversation persistence returns malformed typed data
- a reports request attempts to persist malformed report JSON or invalid `reportType`
- a reports runtime path emits narrative content without safety filtering
- a report history or editing path tries to read an unsupported payload shape

## Exclusions

The following remain outside this contract:

- broad `PO-FEAT-013` observation-pattern generation
- diagnosis, treatment guidance, or comparative ranking
- promotion of `needs-review` domains into reviewed-advice or expert-style guidance
- orphan report types or pages that are not admitted by `routes.yaml` and `local-storage.yaml`
