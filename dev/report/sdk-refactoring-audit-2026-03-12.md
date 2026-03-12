# SDK Refactoring Audit - 2026-03-12

## Scope

- Package: `@nimiplatform/sdk`
- Target: hard-cut mod surface to release-state alignment with `spec/sdk` and `spec/runtime`
- Compatibility mode: none

## Surface Alignment

| Surface | Status | Evidence |
| --- | --- | --- |
| `@nimiplatform/sdk/runtime` | OK | retained in `sdk/package.json` exports |
| `@nimiplatform/sdk/ai-provider` | OK | retained in `sdk/package.json` exports |
| `@nimiplatform/sdk/realm` | OK | retained in `sdk/package.json` exports |
| `@nimiplatform/sdk/scope` | OK | retained in `sdk/package.json` exports |
| `@nimiplatform/sdk/types` | OK | retained in `sdk/package.json` exports |
| `@nimiplatform/sdk/mod` | OK | added root barrel at `sdk/src/mod/index.ts` and export entry in `sdk/package.json` |
| `@nimiplatform/sdk/mod/shell` | OK | retained as dedicated stable facade |
| `@nimiplatform/sdk/mod/lifecycle` | OK | retained as dedicated stable facade |

### Removed public subpaths

The following stable subpaths were removed from `sdk/package.json` exports and now hard-fail in consumer smoke:

- `@nimiplatform/sdk/mod/hook`
- `@nimiplatform/sdk/mod/runtime`
- `@nimiplatform/sdk/mod/types`
- `@nimiplatform/sdk/mod/logging`
- `@nimiplatform/sdk/mod/i18n`
- `@nimiplatform/sdk/mod/settings`
- `@nimiplatform/sdk/mod/utils`
- `@nimiplatform/sdk/mod/model-options`
- `@nimiplatform/sdk/mod/runtime-route`
- `@nimiplatform/sdk/mod/host`

### Explicit non-surface

- `sdk/src/mod/ui.tsx` remains internal-only and is not exported through `@nimiplatform/sdk/mod`.
- `sdk/src/mod/host.ts` remains an SDK-internal registry and is no longer package-exported.

## Forwarding Shell Cleanup

Removed forwarding access shells:

- `sdk/src/mod/internal/shell-access.ts`
- `sdk/src/mod/internal/lifecycle-access.ts`
- `sdk/src/mod/internal/logging-access.ts`

Replacement state:

- `sdk/src/mod/shell.ts` now reads `getModSdkHost().shell` directly and preserves `SDK_MOD_HOST_MISSING` error semantics.
- `sdk/src/mod/lifecycle.ts` now calls `getModSdkHost().lifecycle.*` directly.
- `sdk/src/mod/logging.ts` now calls `getModSdkHost().logging.*` directly.

### Hop evidence

Before:

- consumer -> public facade -> `internal/*-access` -> host registry -> capability facade

After:

- consumer -> public facade -> host registry -> capability facade

This removes one forwarding hop and restores compliance with the repository structure budget for these surfaces.

## Consumer and Governance Migration

Completed:

- migrated consumer imports from removed `@nimiplatform/sdk/mod/*` business subpaths to `@nimiplatform/sdk/mod`
- retained `@nimiplatform/sdk/mod/shell` and `@nimiplatform/sdk/mod/lifecycle`
- replaced public `mod/host` usage in repo-owned bootstrap and test helpers with internal wiring helpers
- updated guardrails:
  - `scripts/check-sdk-consumer-smoke.mjs`
  - `scripts/check-runtime-mod-hook-hardcut.mjs`
  - `apps/desktop/src/runtime/mod/codegen/preflight.ts`
- updated authoritative docs/specs and allowlists:
  - `spec/sdk/**`
  - `spec/desktop/kernel/codegen-contract.md`
  - `spec/desktop/kernel/tables/codegen-import-allowlist.yaml`
  - `sdk/README.md`
  - `sdk/AGENTS.md`
  - `nimi-mods/AGENTS.md`
  - `nimi-mods/README.md`
  - affected `nimi-mods/runtime/**/spec` import-contract docs

## Gate Results

### Runtime baseline

Passed:

- `go build ./...`
- `go vet ./...`
- `go test ./...`
- `go run ./cmd/runtime-compliance --gate`

### SDK and boundary gates

Passed:

- `pnpm build:sdk`
- `pnpm --filter @nimiplatform/sdk test`
- `pnpm check:sdk-consumer-smoke`
- `pnpm check:sdk-import-boundary`
- `pnpm check:sdk-public-naming`
- `pnpm check:sdk-single-package-layout`
- `pnpm check:reason-code-constants`
- `pnpm check:sdk-coverage`
- `pnpm check:runtime-bridge-method-drift`
- `pnpm check:sdk-spec-kernel-consistency`
- `pnpm check:sdk-spec-kernel-docs-drift`

### Downstream and governance gates

Passed:

- `pnpm check:runtime-mod-hook-hardcut`
- `pnpm check:mods-no-runtime-sdk`
- `pnpm --filter @nimiplatform/desktop test`
- `pnpm --filter @nimiplatform/web build`
- `pnpm check:desktop-spec-kernel-consistency`
- `pnpm check:desktop-spec-kernel-docs-drift`
- `pnpm check:agents-freshness`
- `pnpm check:ai-context-budget`
- `pnpm check:ai-structure-budget`
- `pnpm check:no-legacy-imports`
- `pnpm check:no-absolute-user-paths`

## Residual Risks

- Some consumer files were updated by a bulk import codemod and may carry noisy formatting-only diffs; no remaining forbidden business imports were found outside documented denylist and guardrail locations.

## Release Readiness

Rating: `Ready`

Rationale:

- SDK mod surface alignment is complete.
- Forwarding shell violations were removed.
- Import boundary, consumer smoke, structure-budget, spec consistency, and downstream desktop/web validation all passed.
- No remaining release blocker was observed in the verified SDK hard-cut path.
