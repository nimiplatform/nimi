# Nimi Coding Schemas

Field-level reference for the core Nimi Coding artifact schemas.

## Topic Schema

`.nimi/contracts/topic.schema.yaml`

| Field | Required | Type / values |
| --- | --- | --- |
| `topic_id` | yes | `YYYY-MM-DD-topic-slug` pattern |
| `state` | yes | `proposal` / `ongoing` / `pending` / `closed` |
| `created_at` | yes | ISO date |
| `last_transition_at` | yes | ISO date |
| `last_transition_reason` | yes | Snake-case reason |
| `title` | yes | Human-readable |
| `mode` | yes | `greenfield` / `landed` / `superseding` |
| `posture` | yes | `no_legacy_hard_cut` / `backward_compat` |
| `design_policy` | yes | `complete_contract_first` / `mvp_incremental` |
| `parallel_truth` | yes | `forbidden` / `admitted` |
| `layering` | yes | `ontology` / `time_phased` |
| `risk` | yes | `high` / `low` |
| `applicability` | yes | `authority_bearing` / `high_risk_refactor` / `multi_wave_iteration` / `complex_remediation` |
| `entry_justification` | yes | One-paragraph reason |
| `execution_mode` | yes | `inline_manager_worker` / `manager_worker_auditor` |
| `selected_next_target` | yes | wave_id or `null` |
| `current_true_close_status` | yes | `not_started` / `pending` / `true_closed` / `revoked` / `superseded` |
| `forbidden_shortcuts` | yes | List from package catalog plus declared topic-local extensions |
| `waves` | optional | List of wave entries |

## Wave Schema

`.nimi/contracts/wave.schema.yaml`

| Field | Required | Type / values |
| --- | --- | --- |
| `wave_id` | yes | Stable wave identifier |
| `slug` | yes | URL-safe slug |
| `state` | yes | `candidate` / `preflight_draft` / `preflight_admitted` / `implementation_admitted` / `implementation_active` / `needs_revision` / `overflowed` / `continuation_packet_open` / `closed` / `retired` / `superseded` |
| `primary_closure_goal` | yes | One-paragraph goal |
| `deps` | yes | List of wave_ids; can be empty |
| `owner_domain` | yes | Single primary owner domain |
| `parallelizable_after` | yes | Admitted parallelization marker |
| `selected` | yes | At most one true per topic |

## Packet Schema

`.nimi/contracts/packet.schema.yaml`

| Field | Required | Type / values |
| --- | --- | --- |
| `packet_id` | yes | Stable packet identifier; use a wave-qualified id such as `wave-1-add-reference-field` for lifecycle artifacts |
| `topic_id` | yes | Parent topic |
| `wave_id` | yes | Parent wave |
| `packet_kind` | yes | `implementation` / `authority` / `spec` / `redesign` / `preflight` |
| `status` | yes | `draft` / `preflight` / `candidate` / `admitted` / `dispatched` / `closed` / `superseded` |
| `authority_owner` | yes | Owner domain prose |
| `canonical_seams` | yes | Invariants list |
| `forbidden_shortcuts` | yes | Catalog keys + topic extensions |
| `acceptance_invariants` | yes | Verifiable predicates |
| `negative_tests` | yes | Concrete checks |
| `reopen_conditions` | yes | What would reopen |
| `allowed_reads` | no | Path globs; expected for worker-bound packets |
| `allowed_writes` | no | Path globs; expected for worker-bound packets |

## Result Schema

`.nimi/contracts/result.schema.yaml`

| Field | Required | Type / values |
| --- | --- | --- |
| `result_id` | yes | Stable identifier |
| `topic_id` | yes | Parent topic |
| `wave_id` | yes | Parent wave |
| `result_kind` | yes | `preflight` / `implementation` / `audit` / `judgement` |
| `verdict` | yes | `PASS` / `NEEDS_REVISION` / `FAIL` / `OVERFLOW` |
| `verified_at` | yes | ISO8601 UTC timestamp; topic result records use UTC seconds precision such as `2026-05-06T16:47:20Z` |

Sweep-audit artifacts use their own contracts. Their CLI timestamps
use full JavaScript ISO UTC shape with milliseconds, such as
`2026-05-06T16:47:20.705Z`.

## Sweep Design Result

`.nimi/contracts/sweep-design-result.yaml`

Sweep design starts from audit findings and writes local-only design
artifacts under `.nimi/local/sweep-design/<run-id>/`. It records the
source findings hash at intake and keeps original audit findings
read-only.

| Artifact | Role |
| --- | --- |
| `sweep-design-inventory` | Forked finding workset |
| `sweep-design-design-auditor-packet` | Bounded packet for a design-auditor pass |
| `sweep-design-design-auditor-result` | Typed result from a design-auditor session |
| `sweep-design-revision-ledger` | Append-only design revision history |
| `sweep-design-revision-entry` | One hashed change to findings, clusters, waves, or decisions |
| `sweep-design-decision-queue` | User decisions that block worker dispatch |
| `sweep-design-auditor-prompt` | Prompt and expected result shape for a packet |
| `sweep-design-batch-manifest` | Batch of design-auditor packets |
| `sweep-design-final-state-report` | Local-only final state report |
| `sweep-design-wave-plan` | Candidate topic wave commands; non-mutating |

| State | Meaning |
| --- | --- |
| `raw` | Not resolved by design review yet |
| `confirmed` | Valid finding under active design review |
| `needs_more_audit` | Evidence is insufficient |
| `needs_user_decision` | Human judgement is required |
| `needs_authority_alignment` | Canonical authority is unresolved |
| `needs_design` | Needs a design artifact before implementation |
| `ready_for_implementation_wave` | Can become a topic wave candidate |
| `blocked` | Cannot progress |
| `duplicate` / `superseded` / `false_positive` | Terminal no-implementation states |

## Closeout Schema

`.nimi/contracts/closeout.schema.yaml`

| Field | Required | Type / values |
| --- | --- | --- |
| `closeout_id` | yes | Stable identifier |
| `topic_id` | yes | Parent topic |
| `scope` | yes | `wave` / `topic` |
| `authority_closure` | yes | `open` / `closed` / `blocked` |
| `semantic_closure` | yes | Same |
| `consumer_closure` | yes | Same (or `closed_pending_user_acceptance` as sub-state) |
| `drift_resistance_closure` | yes | Same |
| `disposition` | yes | `complete` / `partial` / `deferred` (or `complete_pending_user_acceptance`) |

## Topic Step Decision

`.nimi/contracts/topic-step-decision.schema.yaml`

| Field | Required | Purpose |
| --- | --- | --- |
| `decision_id` | yes | Stable id |
| `topic_id` | yes | — |
| `wave_id` | yes | — |
| `decision_kind` | yes | — |
| `stop_class` | yes | `continue` / `require_human_confirmation` / `await_external_evidence` / `blocked` / `completed` |
| `recommended_action` | yes | `admit_wave` / `freeze_packet` / `dispatch_worker` / `dispatch_audit` / `record_result` / `open_remediation` / `continue_overflow` / `hold_topic` / `resume_topic` / `closeout_wave` / `closeout_topic` / `no_action` |
| `reason_code` | yes | Typed reason |
| `requires_human_confirmation` | yes | Bool |
| `recommended_decision` | yes | Suggested next |
| `recommendation_rationale` | yes | Short prose |
| `expected_artifacts` | yes | List |
| `next_command_ref` | yes | Concrete next command (placeholder-free for `continue` decisions) |

## Forbidden Shortcuts Catalog

The 10 admitted catalog keys (see
[Forbidden Shortcuts Catalog](/nimicoding/reference/forbidden-shortcuts-catalog)
for full detail):

`mvp_subset_contract`, `legacy_alias`, `compat_shim`, `dual_read`,
`dual_write`, `placeholder_success`, `happy_path_only_closure`,
`time_phased_layering`, `app_local_shadow_truth`,
`silent_owner_cut_reopen`.

## Source Basis

- [`nimi-coding/contracts/topic.schema.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/contracts/topic.schema.yaml)
- [`nimi-coding/contracts/wave.schema.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/contracts/wave.schema.yaml)
- [`nimi-coding/contracts/packet.schema.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/contracts/packet.schema.yaml)
- [`nimi-coding/contracts/result.schema.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/contracts/result.schema.yaml)
- [`nimi-coding/contracts/audit-plan.schema.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/contracts/audit-plan.schema.yaml)
- [`nimi-coding/contracts/sweep-design-result.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/contracts/sweep-design-result.yaml)
- [`nimi-coding/contracts/closeout.schema.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/contracts/closeout.schema.yaml)
- [`nimi-coding/contracts/topic-step-decision.schema.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/contracts/topic-step-decision.schema.yaml)
- [`nimi-coding/contracts/forbidden-shortcuts.catalog.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/contracts/forbidden-shortcuts.catalog.yaml)
