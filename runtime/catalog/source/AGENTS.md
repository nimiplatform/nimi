# AGENTS.md

## Scope
- Applies to `runtime/catalog/source/**`, the reviewed authoring surface for `providers/*.source.yaml`.

## Hard Boundaries
- Repo-wide product authority remains under `.nimi/spec/**`.
- Connector/model semantics align with `.nimi/spec/runtime/{ai-provider,model-catalog}.authority.yaml`; source YAML and generated snapshots are projections, not parallel truth.
- Prefer official provider documentation; browser, aggregate listing, and live-probe output are support inputs only and never auto-promote into source.
- For `dynamic_endpoint`, do not mirror remote inventories into static `models` rows or invent defaults.
- A single specified model-row update reads and changes only that row and its cited source; do not review other rows, defaults, profiles, or emit a report.
- Produce a provider update report before mutation only for provider-wide refreshes, removals, `inventory_mode` changes, defaults or `selection_profiles` changes, or when the user requests one.
- Provider splitting, merging, deletion, mode changes, or multiple defensible canonical shapes require an authority decision; ordinary bounded row edits do not.
- Keep stable and dated rows distinct; label preview, legacy, deployment-scoped, and user-scoped rows without flattening provider families.

## Retrieval Defaults
- For one row, read its source file, exact row, cited official provider page, and generator diagnostics only if validation fails.
- For provider-wide or policy work, add the report standard and the relevant general or provider-specific curator prompt.
- Skip unrelated providers, aggregate inventories, generated snapshots, and historical reports.

## Verification Commands
- Generate projections with `pnpm generate:runtime-catalog`.
- Run `pnpm check:runtime-catalog-drift`; inspect the diff to confirm only the authorized source row and its generated projection changed.
- Add authority validation only when provider semantics, mode, defaults, or selection policy changed.
