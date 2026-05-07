# Nimi Coding Schema

核心 Nimi Coding 工件 schema 的字段级参考。

## Topic Schema

`.nimi/contracts/topic.schema.yaml`

| 字段 | Required | 类型 / 值 |
| --- | --- | --- |
| `topic_id` | 是 | `YYYY-MM-DD-topic-slug` 模式 |
| `state` | 是 | `proposal` / `ongoing` / `pending` / `closed` |
| `created_at` | 是 | ISO 日期 |
| `last_transition_at` | 是 | ISO 日期 |
| `last_transition_reason` | 是 | Snake-case 原因 |
| `title` | 是 | 人可读 |
| `mode` | 是 | `greenfield` / `landed` / `superseding` |
| `posture` | 是 | `no_legacy_hard_cut` / `backward_compat` |
| `design_policy` | 是 | `complete_contract_first` / `mvp_incremental` |
| `parallel_truth` | 是 | `forbidden` / `admitted` |
| `layering` | 是 | `ontology` / `time_phased` |
| `risk` | 是 | `high` / `low` |
| `applicability` | 是 | `authority_bearing` / `high_risk_refactor` / `multi_wave_iteration` / `complex_remediation` |
| `entry_justification` | 是 | 一段原因 |
| `execution_mode` | 是 | `inline_manager_worker` / `manager_worker_auditor` |
| `selected_next_target` | 是 | wave_id 或 `null` |
| `current_true_close_status` | 是 | `not_started` / `pending` / `true_closed` / `revoked` / `superseded` |
| `forbidden_shortcuts` | 是 | 包目录 + 声明的 topic 局部扩展 |
| `waves` | 可选 | Wave 条目列表 |

## Wave Schema

`.nimi/contracts/wave.schema.yaml`

| 字段 | Required | 类型 / 值 |
| --- | --- | --- |
| `wave_id` | 是 | 稳定 wave 标识 |
| `slug` | 是 | URL-safe slug |
| `state` | 是 | `candidate` / `preflight_draft` / `preflight_admitted` / `implementation_admitted` / `implementation_active` / `needs_revision` / `overflowed` / `continuation_packet_open` / `closed` / `retired` / `superseded` |
| `primary_closure_goal` | 是 | 一段目标 |
| `deps` | 是 | wave_id 列表；可空 |
| `owner_domain` | 是 | 单一主 owner 域 |
| `parallelizable_after` | 是 | Admitted 并行 marker |
| `selected` | 是 | 每个 topic 至多一个 true |

## Packet Schema

`.nimi/contracts/packet.schema.yaml`

| 字段 | Required | 类型 / 值 |
| --- | --- | --- |
| `packet_id` | 是 | 稳定 packet 标识；生命周期工件建议用带 wave 身份的 id，例如 `wave-1-add-reference-field` |
| `topic_id` | 是 | 父 topic |
| `wave_id` | 是 | 父 wave |
| `packet_kind` | 是 | `implementation` / `authority` / `spec` / `redesign` / `preflight` |
| `status` | 是 | `draft` / `preflight` / `candidate` / `admitted` / `dispatched` / `closed` / `superseded` |
| `authority_owner` | 是 | Owner 域散文 |
| `canonical_seams` | 是 | 不变量列表 |
| `forbidden_shortcuts` | 是 | 目录 key + topic 扩展 |
| `acceptance_invariants` | 是 | 可验证 predicate |
| `negative_tests` | 是 | 具体检查 |
| `reopen_conditions` | 是 | 什么会重开 |
| `allowed_reads` | 否 | 路径 glob；worker-bound packet 应该写明 |
| `allowed_writes` | 否 | 路径 glob；worker-bound packet 应该写明 |

## Result Schema

`.nimi/contracts/result.schema.yaml`

| 字段 | Required | 类型 / 值 |
| --- | --- | --- |
| `result_id` | 是 | 稳定标识 |
| `topic_id` | 是 | 父 topic |
| `wave_id` | 是 | 父 wave |
| `result_kind` | 是 | `preflight` / `implementation` / `audit` / `judgement` |
| `verdict` | 是 | `PASS` / `NEEDS_REVISION` / `FAIL` / `OVERFLOW` |
| `verified_at` | 是 | ISO8601 UTC 时间戳；topic result record 使用 UTC 秒精度，例如 `2026-05-06T16:47:20Z` |

Sweep audit 工件走自己的合同。它的 CLI 时间戳使用完整 JavaScript ISO UTC 形状，带毫秒，例如 `2026-05-06T16:47:20.705Z`。

## Sweep Design Result

`.nimi/contracts/sweep-design-result.yaml`

Sweep design 从审计 findings 开始，在 `.nimi/local/sweep-design/<run-id>/` 下写本地专用的设计工件。`intake` 会记录源 findings 的 hash，后续设计状态只写在 sweep design 自己的工件里，不回改原始审计结果。

| 工件 | 作用 |
| --- | --- |
| `sweep-design-inventory` | 复制出来的 finding 工作集 |
| `sweep-design-design-auditor-packet` | 设计审计 pass 的边界 packet |
| `sweep-design-design-auditor-result` | 设计审计 session 返回的类型化结果 |
| `sweep-design-revision-ledger` | Append-only 的设计 revision 历史 |
| `sweep-design-revision-entry` | 对 finding、cluster、wave 或 decision 的一次带 hash 变更 |
| `sweep-design-decision-queue` | 阻止 worker dispatch 的用户判断队列 |
| `sweep-design-auditor-prompt` | Packet 对应的 prompt 和期望结果形状 |
| `sweep-design-batch-manifest` | 一组设计审计 packet |
| `sweep-design-final-state-report` | 本地专用 final state report |
| `sweep-design-wave-plan` | 候选 topic wave 命令；不改状态 |

| 状态 | 含义 |
| --- | --- |
| `raw` | 尚未被设计审计解析 |
| `confirmed` | 有效 finding，正在设计审计中 |
| `needs_more_audit` | 证据不够 |
| `needs_user_decision` | 需要人判断 |
| `needs_authority_alignment` | 规范权威尚未明确 |
| `needs_design` | 实现前还需要设计工件 |
| `ready_for_implementation_wave` | 可以成为候选 topic wave |
| `blocked` | 不能继续推进 |
| `duplicate` / `superseded` / `false_positive` | 终态，不进入实现 |

## Closeout Schema

`.nimi/contracts/closeout.schema.yaml`

| 字段 | Required | 类型 / 值 |
| --- | --- | --- |
| `closeout_id` | 是 | 稳定标识 |
| `topic_id` | 是 | 父 topic |
| `scope` | 是 | `wave` / `topic` |
| `authority_closure` | 是 | `open` / `closed` / `blocked` |
| `semantic_closure` | 是 | 同 |
| `consumer_closure` | 是 | 同（或 `closed_pending_user_acceptance` 作子状态） |
| `drift_resistance_closure` | 是 | 同 |
| `disposition` | 是 | `complete` / `partial` / `deferred`（或 `complete_pending_user_acceptance`） |

## Topic Step Decision

`.nimi/contracts/topic-step-decision.schema.yaml`

| 字段 | Required | 用途 |
| --- | --- | --- |
| `decision_id` | 是 | 稳定 id |
| `topic_id` | 是 | — |
| `wave_id` | 是 | — |
| `decision_kind` | 是 | — |
| `stop_class` | 是 | `continue` / `require_human_confirmation` / `await_external_evidence` / `blocked` / `completed` |
| `recommended_action` | 是 | `admit_wave` / `freeze_packet` / `dispatch_worker` / `dispatch_audit` / `record_result` / `open_remediation` / `continue_overflow` / `hold_topic` / `resume_topic` / `closeout_wave` / `closeout_topic` / `no_action` |
| `reason_code` | 是 | 类型化原因 |
| `requires_human_confirmation` | 是 | Bool |
| `recommended_decision` | 是 | 建议下一步 |
| `recommendation_rationale` | 是 | 短散文 |
| `expected_artifacts` | 是 | 列表 |
| `next_command_ref` | 是 | 具体下个命令（`continue` 决定无占位） |

## 禁用捷径目录

10 个 admitted 目录 key（完整细节见 [禁用捷径目录](/zh/nimicoding/reference/forbidden-shortcuts-catalog)）：

`mvp_subset_contract`、`legacy_alias`、`compat_shim`、`dual_read`、`dual_write`、`placeholder_success`、`happy_path_only_closure`、`time_phased_layering`、`app_local_shadow_truth`、`silent_owner_cut_reopen`。

## 来源

- [`nimi-coding/contracts/topic.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/topic.schema.yaml)
- [`nimi-coding/contracts/wave.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/wave.schema.yaml)
- [`nimi-coding/contracts/packet.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/packet.schema.yaml)
- [`nimi-coding/contracts/result.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/result.schema.yaml)
- [`nimi-coding/contracts/audit-plan.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/audit-plan.schema.yaml)
- [`nimi-coding/contracts/sweep-design-result.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/sweep-design-result.yaml)
- [`nimi-coding/contracts/closeout.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/closeout.schema.yaml)
- [`nimi-coding/contracts/topic-step-decision.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/topic-step-decision.schema.yaml)
- [`nimi-coding/contracts/forbidden-shortcuts.catalog.yaml`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/contracts/forbidden-shortcuts.catalog.yaml)
