# Forbidden Shortcuts

Nimi Coding gives recurring governance failures stable names so Codex,
reviewers, and deterministic gates can reject the same pattern
consistently.

| Key | Refused behavior |
| --- | --- |
| `mvp_subset_contract` | Replacing full product truth with a temporary minimum subset |
| `legacy_alias` | Keeping obsolete semantics alive through an alias |
| `compat_shim` | Hiding an incomplete owner cut behind compatibility code |
| `dual_read` | Retaining two unadmitted truth read paths |
| `dual_write` | Retaining two unadmitted truth write paths |
| `placeholder_success` | Claiming success when required truth or evidence is missing |
| `happy_path_only_closure` | Completing work after validating only success behavior |
| `time_phased_layering` | Using delivery phases as product architecture |
| `app_local_shadow_truth` | Letting app-local convenience state become hidden authority |
| `silent_owner_cut_reopen` | Reopening owner truth inside downstream implementation |

## How They Are Used

The current Codex task reads the catalog as project constraints.
Preflight names relevant risks, implementation avoids them, and tests or
validators make violations observable. The catalog does not dictate the
host's plan or next action.

## Example

An app introduces a local REST call because the SDK lacks one method.
The code works, but it creates `app_local_shadow_truth` and a boundary
bypass. The correct response is to add the public SDK surface at its
owner, then consume it from the app.

## Source Basis

- [`.nimi/contracts/forbidden-shortcuts.catalog.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/forbidden-shortcuts.catalog.yaml)
- [`.nimi/contracts/negative-fixtures.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/negative-fixtures.yaml)
