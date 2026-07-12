# 禁用反模式目录

`.nimi/contracts/forbidden-shortcuts.catalog.yaml` 的字段级参考。

| Key | 契约含义 |
| --- | --- |
| `mvp_subset_contract` | `do_not_cut_canonical_contract_truth_into_a_temporary_minimum_subset` |
| `legacy_alias` | `do_not_keep_obsolete_semantics_alive_via_soft_aliases` |
| `compat_shim` | `do_not_hide_owner_cut_gaps_behind_temporary_compatibility_code` |
| `dual_read` | `do_not_keep_two_parallel_truth_read_paths_without_explicit_admission` |
| `dual_write` | `do_not_keep_two_parallel_truth_write_paths_without_explicit_admission` |
| `placeholder_success` | `do_not_fake_success_or_closure_when_required_truth_is_missing` |
| `happy_path_only_closure` | `do_not_claim_closure_when_only_the_happy_path_is_closed` |
| `time_phased_layering` | `do_not_replace_semantic_layering_with_time_sliced_core_contracts` |
| `app_local_shadow_truth` | `do_not_let_app_local_convenience_state_become_hidden_canonical_truth` |
| `silent_owner_cut_reopen` | `do_not_reopen_owner_domain_truth_inside_downstream_execution_work` |

项目把目录作为闭合集合消费。新增 key 需要承载权威的契约变更；任务局部临时条目
不会成为仓库真相。

## 来源依据

- [`.nimi/contracts/forbidden-shortcuts.catalog.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/forbidden-shortcuts.catalog.yaml)
- [`.nimi/contracts/negative-fixtures.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/negative-fixtures.yaml)
