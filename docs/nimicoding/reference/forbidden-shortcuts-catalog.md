# Forbidden Shortcuts Catalog

Field-level reference for
`.nimi/contracts/forbidden-shortcuts.catalog.yaml`.

| Key | Contract meaning |
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

The catalog is consumed as a closed project contract. New keys require
an authority-bearing contract change; ad hoc task-local additions do not
become repository truth.

## Source Basis

- [`.nimi/contracts/forbidden-shortcuts.catalog.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/forbidden-shortcuts.catalog.yaml)
- [`.nimi/contracts/negative-fixtures.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/negative-fixtures.yaml)
