# Scripts AGENTS.md

## Scope
- Applies to `scripts/**`.
- `check-*` files are CI gates, `generate-*` files are source-to-derived pipelines, and they must stay deterministic and offline-safe.

## Hard Boundaries
- Keep root `pnpm` command names stable when refactoring script internals.
- Prefer thin CLI entrypoints plus reusable modules under `scripts/lib/**`.
- Do not add network-dependent `check-*` gates.
- Generated outputs must come from source-of-truth inputs; do not hand-edit generated targets to satisfy a drift check.
- Structure budget depth for scripts is measured from `scripts/`, so avoid introducing new nested helper trees when a flat lib module is sufficient.

## Retrieval Defaults
- Start in the exact script entrypoint and then the minimal helper modules it imports.
- Skip generated outputs and unrelated reports when debugging a script.

## Verification Commands
- Select the gate for the changed input or pipeline: `pnpm check:runtime-catalog-drift` for Runtime catalog projections, `pnpm proto:drift-check` for proto generation, and `pnpm spec:authority:check` for authority inputs or their checker integration.
- When changing script inputs, rerun the matching `generate:*` command and then the paired `check:*` command.
