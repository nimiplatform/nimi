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
- Repo guardrails: `pnpm nimicoding:validate-ai-governance --profile nimi --scope all`.
- Script-sensitive gates: `pnpm check:runtime-catalog-drift`, `pnpm exec nimicoding generate-spec-derived-docs --profile nimi --scope spec-human-doc --check`, `pnpm proto:drift-check`.
- When changing script inputs, rerun the matching `generate:*` command and then the paired `check:*` command.
