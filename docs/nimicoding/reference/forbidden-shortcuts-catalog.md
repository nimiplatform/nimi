# Forbidden Shortcuts Catalog

Field-level reference for the 10 admitted catalog keys. For
narrative explanation see
[Forbidden Shortcuts](/nimicoding/forbidden-shortcuts).

Catalog source: `.nimi/contracts/forbidden-shortcuts.catalog.yaml`.

## Catalog

| Key | Forbidden meaning |
| --- | --- |
| `mvp_subset_contract` | do_not_cut_canonical_contract_truth_into_a_temporary_minimum_subset |
| `legacy_alias` | do_not_keep_obsolete_semantics_alive_via_soft_aliases |
| `compat_shim` | do_not_hide_owner_cut_gaps_behind_temporary_compatibility_code |
| `dual_read` | do_not_keep_two_parallel_truth_read_paths_without_explicit_admission |
| `dual_write` | do_not_keep_two_parallel_truth_write_paths_without_explicit_admission |
| `placeholder_success` | do_not_fake_success_or_closure_when_required_truth_is_missing |
| `happy_path_only_closure` | do_not_claim_closure_when_only_the_happy_path_is_closed |
| `time_phased_layering` | do_not_replace_semantic_layering_with_time_sliced_core_contracts |
| `app_local_shadow_truth` | do_not_let_app_local_convenience_state_become_hidden_canonical_truth |
| `silent_owner_cut_reopen` | do_not_reopen_owner_domain_truth_inside_a_downstream_execution_wave |

## Per-Pattern Detail

### `mvp_subset_contract`

| Property | Value |
| --- | --- |
| Trigger | Contract is admitted as minimum subset with deferred parts |
| Failure shape | Subset becomes de facto contract; future expansion is breaking change |
| Correct alternative | Design the full contract first; layer by ontology not chronology |
| Related catalog keys | `time_phased_layering` |

### `legacy_alias`

| Property | Value |
| --- | --- |
| Trigger | Old semantics kept alive via soft alias |
| Failure shape | Parallel truth; permanent migration burden |
| Correct alternative | Hard cut; or admit dual-truth explicitly with timeline |
| Related catalog keys | `compat_shim`, `dual_read`, `dual_write` |

### `compat_shim`

| Property | Value |
| --- | --- |
| Trigger | Owner-cut gap hidden behind temporary compatibility code |
| Failure shape | Same as `legacy_alias` |
| Correct alternative | Same |

### `dual_read`

| Property | Value |
| --- | --- |
| Trigger | Two parallel truth read paths without explicit admission |
| Failure shape | Drift between paths; consumers see different truths |
| Correct alternative | Single read path; or admit dual-truth with explicit transition contract |
| Related catalog keys | `dual_write`, `legacy_alias` |

### `dual_write`

| Property | Value |
| --- | --- |
| Trigger | Two parallel truth write paths without explicit admission |
| Failure shape | Drift; "migrating from one to the other" becomes permanent |
| Correct alternative | Same as `dual_read` |

### `placeholder_success`

| Property | Value |
| --- | --- |
| Trigger | Typed contract failure hidden behind a fallback returning "something" |
| Failure shape | Downstream code sees no signal of failure; audit cannot detect |
| Correct alternative | Fail closed with typed reason; retry is for transport / auth, not contract rescue |

### `happy_path_only_closure`

| Property | Value |
| --- | --- |
| Trigger | Closure claimed when only happy path is closed |
| Failure shape | Failure modes implicit; consumers do not know what fails |
| Correct alternative | Pin failure modes explicitly before semantic closure |

### `time_phased_layering`

| Property | Value |
| --- | --- |
| Trigger | Layering by time (v1 → v2 → v3) instead of by ontology (core / extended / custom) |
| Failure shape | Permanent supersession churn; each "next version" is soft `legacy_alias` |
| Correct alternative | Layer by what abstraction means, not by when it was added |

### `app_local_shadow_truth`

| Property | Value |
| --- | --- |
| Trigger | App-local convenience state becomes hidden canonical truth |
| Failure shape | App's state diverges from canonical; other apps disagree; audit cannot reconstruct |
| Correct alternative | App state is admitted as ephemeral and local; persist in owner domain only |

### `silent_owner_cut_reopen`

| Property | Value |
| --- | --- |
| Trigger | Reopening owner-domain truth inside a downstream execution wave |
| Failure shape | Owner-domain mutation hidden in execution; audit lineage broken |
| Correct alternative | Admit a separate owner-domain wave first; then run downstream execution against updated truth |

## Topic-Local Extensions

A topic may declare additional topic-local forbidden shortcuts.
Extensions must:

- Use named keys (snake_case identifiers).
- Not free-form prose.
- Be declared in the topic's `forbidden_shortcuts` field
  alongside the package-owned catalog keys.

Example topic-local extension:

```yaml
forbidden_shortcuts:
  # package-owned
  - mvp_subset_contract
  - legacy_alias
  - compat_shim
  - dual_read
  - dual_write
  - placeholder_success
  - happy_path_only_closure
  - time_phased_layering
  - app_local_shadow_truth
  - silent_owner_cut_reopen
  # topic-local extensions
  - sidebar_links_to_unwritten_pages
  - product_pages_inventing_facts_not_in_extracted_sources
```

## Detection

| Mechanism | What it catches |
| --- | --- |
| Audit | Pattern detection in code / docs |
| Closeout drift-resistance | Verifies forbidden shortcuts remain forbidden |
| Topic-step-decision | Refuses admission if pattern detected |

## Source Basis

- [`.nimi/contracts/forbidden-shortcuts.catalog.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/forbidden-shortcuts.catalog.yaml)
- [`.nimi/contracts/packet.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/packet.schema.yaml)
- [`.nimi/methodology/four-closure-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/four-closure-policy.yaml)
