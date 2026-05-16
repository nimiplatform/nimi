# Nimi Coding 核心契约 Schema

本页提供 Nimi Coding 核心记录工件和 table-family Schema 的字段级参考。

## Topic Schema

原始定义路径：`.nimi/contracts/topic.schema.yaml`

| 参数字段 | 必填 | 数据类型 / 有效枚举值 |
| --- | --- | --- |
| `topic_id` | 是 | 需符合 `YYYY-MM-DD-topic-slug` 命名格式 |
| `state` | 是 | `proposal` / `ongoing` / `pending` / `closed` |
| `created_at` | 是 | 标准 ISO 日期格式 |
| `last_transition_at` | 是 | 标准 ISO 日期格式 |
| `last_transition_reason` | 是 | 采用 Snake-case 格式的变更原因标识 |
| `title` | 是 | 人类可读标题 |
| `mode` | 是 | `greenfield` / `landed` / `superseding` |
| `posture` | 是 | `no_legacy_hard_cut` / `backward_compat` |
| `design_policy` | 是 | `complete_contract_first` / `mvp_incremental` |
| `parallel_truth` | 是 | `forbidden` / `admitted` |
| `layering` | 是 | `ontology` / `time_phased` |
| `risk` | 是 | `high` / `low` |
| `applicability` | 是 | `authority_bearing` / `high_risk_refactor` / `multi_wave_iteration` / `complex_remediation` |
| `entry_justification` | 是 | 客观理由陈述 (一段描述文本) |
| `execution_mode` | 是 | `inline_manager_worker` / `manager_worker_auditor` |
| `selected_next_target` | 是 | wave_id 标识或 `null` |
| `current_true_close_status` | 是 | `not_started` / `pending` / `true_closed` / `revoked` / `superseded` |
| `forbidden_shortcuts` | 是 | 工具包反模式目录及显式声明的 Topic 局部扩展配置 |
| `waves` | 否 | 所属 Wave 对象的有序列表 |

## Wave Schema

原始定义路径：`.nimi/contracts/wave.schema.yaml`

| 参数字段 | 必填 | 数据类型 / 有效枚举值 |
| --- | --- | --- |
| `wave_id` | 是 | 稳定且唯一的波次标识符 |
| `slug` | 是 | 符合 URL-safe 规范的标识短语 |
| `state` | 是 | `candidate` / `preflight_draft` / `preflight_admitted` / `implementation_admitted` / `implementation_active` / `needs_revision` / `overflowed` / `continuation_packet_open` / `closed` / `retired` / `superseded` |
| `primary_closure_goal` | 是 | 核心闭合目标的陈述描述 |
| `deps` | 是 | 关联的前置 wave_id 列表；允许为空数组 |
| `owner_domain` | 是 | 唯一的首要所有者归属域 |
| `parallelizable_after` | 是 | 已准入的并行执行标记状态 |
| `selected` | 是 | 布尔值；同一 Topic 范围内至多一项为 true |

## Packet Schema

原始定义路径：`.nimi/contracts/packet.schema.yaml`

| 参数字段 | 必填 | 数据类型 / 有效枚举值 |
| --- | --- | --- |
| `packet_id` | 是 | 稳定标识符；为避免生命周期混淆，建议融合 Wave 信息（如 `wave-1-add-reference-field`） |
| `topic_id` | 是 | 所属父级 Topic 标识 |
| `wave_id` | 是 | 所属父级 Wave 标识 |
| `packet_kind` | 是 | `implementation` / `authority` / `spec` / `redesign` / `preflight` |
| `status` | 是 | `draft` / `preflight` / `candidate` / `admitted` / `dispatched` / `closed` / `superseded` |
| `authority_owner` | 是 | 所有者域的规范文本说明 |
| `canonical_seams` | 是 | 系统关键不变量列表 |
| `forbidden_shortcuts` | 是 | 系统目录键值与 Topic 局部扩展约束列表 |
| `acceptance_invariants` | 是 | 可验证的条件断言 |
| `negative_tests` | 是 | 具体的负向排查执行标准 |
| `reopen_conditions` | 是 | 触发任务重开的明确条件准则 |
| `allowed_reads` | 否 | 定义路径通配符范围；针对指派至 Worker 的工作包为必需配置 |
| `allowed_writes` | 否 | 定义路径通配符范围；针对指派至 Worker 的工作包为必需配置 |

## Result Schema

原始定义路径：`.nimi/contracts/result.schema.yaml`

| 参数字段 | 必填 | 数据类型 / 有效枚举值 |
| --- | --- | --- |
| `result_id` | 是 | 稳定且唯一的标识符 |
| `topic_id` | 是 | 所属父级 Topic 标识 |
| `wave_id` | 是 | 所属父级 Wave 标识 |
| `result_kind` | 是 | `preflight` / `implementation` / `audit` / `judgement` |
| `verdict` | 是 | `PASS` / `NEEDS_REVISION` / `FAIL` / `OVERFLOW` |
| `verified_at` | 是 | 采用 ISO8601 UTC 格式；Topic 返回的结果记录需精确至 UTC 秒（如 `2026-05-06T16:47:20Z`） |

注：Sweep audit 类别的工件遵循独立契约定义。其关联的 CLI 生成时间戳必须输出包含毫秒的完整 JavaScript ISO UTC 格式标准（如 `2026-05-06T16:47:20.705Z`）。

## Sweep Design Result

原始定义路径：`.nimi/contracts/sweep-design-result.yaml`

sweep design 流程发源于审计 finding，并将生成的本地专用设计工件写入 `.nimi/local/sweep-design/<run-id>/` 目录。系统在摄入阶段保存并锁定源发现项的哈希值；后续一切设计状态更新仅存于特定的 sweep design 关联工件内，绝对不会回溯覆写原始审计证据。

| 记录工件名称 | 核心系统职能 |
| --- | --- |
| `sweep-design-inventory` | 从审计结果中复制分离的可用评估集 |
| `sweep-design-design-auditor-packet` | 划定明确边界，专用于设计审计轮次的工作包配置 |
| `sweep-design-design-auditor-result` | 由设计审计系统会话返回的符合规范类型化要求的结果记录 |
| `sweep-design-revision-ledger` | 提供具备不可变 (Append-only) 属性的设计修订版本流 |
| `sweep-design-revision-entry` | 对 finding、cluster、wave 或 decision 执行的数据摘要哈希绑定变更日志 |
| `sweep-design-decision-queue` | 要求人工决策介入的待处理队列；此队列未处理将阻塞任务指派 |
| `sweep-design-auditor-prompt` | 对应工作包生成的系统执行提示词，以及对结果数据结构的约束 |
| `sweep-design-batch-manifest` | 基于相同场景编组的设计审计工作包集 |
| `sweep-design-final-state-report` | 独立供本地验证及分析系统状态的终结报告 |
| `sweep-design-wave-plan` | 生成后续 Topic Wave 的候选操作推荐指令；执行本项不会修改工程内实际的状态机 |

| 执行流转状态 | 技术含义解释 |
| --- | --- |
| `raw` | 源数据尚未经设计审计流程进行初步解析提取 |
| `confirmed` | 已确认有效的逻辑发现项，且当前正处于深度设计审计状态 |
| `needs_more_audit` | 系统识别到证据链不充分，需追加审查 |
| `needs_user_decision` | 此步骤因逻辑冲突或定义盲区，需人类专家执行工程判断 |
| `needs_authority_alignment` | 触及核心架构原则冲突，相关权威真相未能达成统一意见 |
| `needs_design` | 执行逻辑开发前，必须产出明确的设计说明工件支撑 |
| `ready_for_implementation_wave` | 该阶段已就绪，具备转化为后续执行 wave 的合规条件 |
| `blocked` | 流程因阻碍项陷入挂起，无法继续向前推进行为 |
| `duplicate` / `superseded` / `false_positive` | 宣告终止的非活跃状态，不会被引入后续的具体代码实现 |

## Closeout Schema

原始定义路径：`.nimi/contracts/closeout.schema.yaml`

| 参数字段 | 必填 | 数据类型 / 有效枚举值 |
| --- | --- | --- |
| `closeout_id` | 是 | 稳定标识符 |
| `topic_id` | 是 | 所属父级 Topic 标识 |
| `scope` | 是 | 限定于 `wave` / `topic` |
| `authority_closure` | 是 | `open` / `closed` / `blocked` |
| `semantic_closure` | 是 | 同上 |
| `consumer_closure` | 是 | 同上（或采用 `closed_pending_user_acceptance` 作为衍生子状态） |
| `drift_resistance_closure` | 是 | 同上 |
| `disposition` | 是 | `complete` / `partial` / `deferred`（或涵盖 `complete_pending_user_acceptance` 状态） |

## Topic Step Decision

原始定义路径：`.nimi/contracts/topic-step-decision.schema.yaml`

| 参数字段 | 必填 | 系统核心用途 |
| --- | --- | --- |
| `decision_id` | 是 | 系统分配稳定的操作依据 id |
| `topic_id` | 是 | — |
| `wave_id` | 是 | — |
| `decision_kind` | 是 | — |
| `stop_class` | 是 | `continue` / `require_human_confirmation` / `await_external_evidence` / `blocked` / `completed` |
| `recommended_action` | 是 | `admit_wave` / `freeze_packet` / `dispatch_worker` / `dispatch_audit` / `record_result` / `open_remediation` / `continue_overflow` / `hold_topic` / `resume_topic` / `closeout_wave` / `closeout_topic` / `no_action` |
| `reason_code` | 是 | 系统反馈的具有明确类型的阻断或状态原因 |
| `requires_human_confirmation` | 是 | 布尔判定依据 |
| `recommended_decision` | 是 | 分析模型提供建议的下一步流转决策 |
| `recommendation_rationale` | 是 | 阐述操作原因的简明技术文本 |
| `expected_artifacts` | 是 | 预期后续流程阶段的关联工件对象列表 |
| `next_command_ref` | 是 | 推荐执行的具体下级命令字符串（在 `continue` 流转决策时不可留空占位） |

## Table Family Schema

原始定义路径：`.nimi/contracts/table-family.schema.yaml`

每个 kernel table 都声明共享的表契约字段：`table_family`、`owner`、`authority_class`、`row_schema`、`allowed_references`、`forbidden_fields`。

| 表族 | 权威类别 | 表族必填字段 |
| --- | --- | --- |
| `closed_enum` | `product_authority_table` | `table_family`、`owner`、`enum_id`、`values` |
| `state_machine` | `product_authority_table` | `table_family`、`owner`、`machine_id`、`states`、`transitions` |
| `protocol_surface` | `product_authority_table` | `table_family`、`owner`、`protocol_id`、`surfaces` |
| `owner_matrix` | `product_authority_table` | `table_family`、`owner`、`matrix_id`、`rows` |
| `product_catalog` | `product_authority_table` | `table_family`、`owner`、`catalog_id`、`entries` |
| `gate_registry` | `product_authority_table` | `table_family`、`owner`、`registry_id`、`schema_version`、`registry_version`、`profile_id`、`tiers`、`targets`、`reason_codes`、`gates` |
| `support_registry` | `support_registry` | `table_family`、`registry_id`、`owner`、`schema_ref`、`allowed_fields`、`forbidden_state_fields`、`entries` |

`gate_registry` 是 v0.2.1 新增的表族，用于产品自有的发布关卡注册表。发布关卡注册表不能建模成 `closed_enum`：它的权威形态包含 registry 元数据、profile、tier、target、reason code 和 gate 条目。

语义约束包括 `unknown_table_family_fails_closed` 和 `release_gate_registry_must_use_gate_registry_family_not_closed_enum`。

## Forbidden Shortcuts Catalog

系统内建的 10 项已准入限制原则（完整逻辑定义详见 [禁用反模式技术目录](/zh/nimicoding/reference/forbidden-shortcuts-catalog)）：

`mvp_subset_contract`、`legacy_alias`、`compat_shim`、`dual_read`、`dual_write`、`placeholder_success`、`happy_path_only_closure`、`time_phased_layering`、`app_local_shadow_truth`、`silent_owner_cut_reopen`。

## 来源依据

- [`nimi-coding/contracts/topic.schema.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/contracts/topic.schema.yaml)
- [`nimi-coding/contracts/wave.schema.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/contracts/wave.schema.yaml)
- [`nimi-coding/contracts/packet.schema.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/contracts/packet.schema.yaml)
- [`nimi-coding/contracts/result.schema.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/contracts/result.schema.yaml)
- [`nimi-coding/contracts/audit-plan.schema.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/contracts/audit-plan.schema.yaml)
- [`nimi-coding/contracts/sweep-design-result.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/contracts/sweep-design-result.yaml)
- [`nimi-coding/contracts/closeout.schema.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/contracts/closeout.schema.yaml)
- [`nimi-coding/contracts/topic-step-decision.schema.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/contracts/topic-step-decision.schema.yaml)
- [`nimi-coding/contracts/table-family.schema.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/contracts/table-family.schema.yaml)
- [`nimi-coding/contracts/forbidden-shortcuts.catalog.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/contracts/forbidden-shortcuts.catalog.yaml)
