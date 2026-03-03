# Scripts AGENTS.md

> Conventions for AI agents working on `scripts/` (CI checks, codegen, build, release).

## Context

`scripts/` contains all monorepo automation: CI gate checks, code generation, build helpers, and release tooling. Scripts are Node.js ESM (`.mjs`) or shell (`.sh`).

## Script Categories

### CI Checks (`check-*`)

Validation scripts run in CI. Each enforces a specific invariant.

| Script | Domain | What It Checks |
|--------|--------|----------------|
| `check-bundle-size.mjs` | SDK | Bundle size regression against baseline |
| `check-desktop-mods-smoke.mjs` | Desktop | Mod system smoke test |
| `check-desktop-spec-kernel-consistency.mjs` | Spec | Desktop spec YAML ↔ markdown consistency |
| `check-desktop-token-api-runtime-only.mjs` | Desktop | Token-API routing stays runtime-only |
| `check-experimental-api-lifecycle.mjs` | SDK | Experimental API lifecycle compliance |
| `check-future-spec-kernel-consistency.mjs` | Spec | Future spec YAML ↔ markdown consistency |
| `check-license-headers.mjs` | Repo | License header presence in source files |
| `check-local-chat-service-boundary.mjs` | Desktop | Local chat service boundary enforcement |
| `check-no-absolute-user-paths.mjs` | Repo | No hardcoded user paths in committed code |
| `check-no-create-nimi-client.mjs` | SDK | Forbids legacy `createNimiClient` usage |
| `check-no-legacy-cloud-provider-keys.mjs` | Runtime | Forbids legacy cloud provider env keys |
| `check-no-legacy-doc-contracts.mjs` | Docs | No legacy doc contract references |
| `check-package-license-matrix.mjs` | Repo | Package license matrix completeness |
| `check-platform-spec-kernel-consistency.mjs` | Spec | Platform spec YAML ↔ markdown consistency |
| `check-proto-drift.mjs` | Proto | Generated proto stubs match committed code |
| `check-realm-sdk-generator-smoke.mjs` | SDK | Realm SDK codegen smoke test |
| `check-realm-spec-kernel-consistency.mjs` | Spec | Realm spec YAML ↔ markdown consistency |
| `check-reason-code-constants.mjs` | SDK | ReasonCode constant integrity |
| `check-runtime-ai-media-coverage.mjs` | Runtime | AI media capability coverage |
| `check-runtime-go-coverage.mjs` | Runtime | Go test coverage threshold |
| `check-runtime-spec-kernel-consistency.mjs` | Spec | Runtime spec YAML ↔ markdown consistency |
| `check-scope-catalog-drift.mjs` | SDK | Scope catalog drift detection |
| `check-sdk-consumer-smoke.mjs` | SDK | SDK consumer smoke test |
| `check-sdk-coverage.mjs` | SDK | SDK test coverage threshold |
| `check-sdk-import-boundary.mjs` | SDK | Import boundary enforcement |
| `check-sdk-public-naming.mjs` | SDK | Public API naming conventions |
| `check-sdk-realm-legacy-clean.mjs` | SDK | No legacy realm naming |
| `check-sdk-single-package-layout.mjs` | SDK | Single-package layout enforcement |
| `check-sdk-spec-kernel-consistency.mjs` | Spec | SDK spec YAML ↔ markdown consistency |
| `check-sdk-version-matrix.mjs` | SDK | Version matrix completeness |
| `check-sdk-vnext-matrix.mjs` | SDK | vNext matrix validation |

### Code Generation (`generate-*`)

Scripts that produce derived artifacts from source-of-truth inputs.

| Script | Input | Output |
|--------|-------|--------|
| `generate-realm-sdk.mjs` | OpenAPI spec | `sdk/src/realm/generated/` |
| `generate-runtime-bridge-methods.mjs` | Runtime proto | Runtime bridge method types |
| `generate-scope-catalog.mjs` | Scope definitions | Scope catalog artifacts |
| `generate-runtime-spec-kernel-docs.mjs` | `spec/runtime/kernel/tables/*.yaml` | `spec/runtime/kernel/generated/*.md` |
| `generate-sdk-spec-kernel-docs.mjs` | `spec/sdk/kernel/tables/*.yaml` | `spec/sdk/kernel/generated/*.md` |
| `generate-desktop-spec-kernel-docs.mjs` | `spec/desktop/kernel/tables/*.yaml` | `spec/desktop/kernel/generated/*.md` |
| `generate-future-spec-kernel-docs.mjs` | `spec/future/kernel/tables/*.yaml` | `spec/future/kernel/generated/*.md` |
| `generate-platform-spec-kernel-docs.mjs` | `spec/platform/kernel/tables/*.yaml` | `spec/platform/kernel/generated/*.md` |
| `generate-realm-spec-kernel-docs.mjs` | `spec/realm/kernel/tables/*.yaml` | `spec/realm/kernel/generated/*.md` |
| `generate-spec-human-doc.mjs` | Spec sources | Human-readable spec docs |

### Build (`build-*`)

| Script | Purpose |
|--------|---------|
| `build-typescript-package.mjs` | Shared TypeScript package build helper |
| `build-runtime.mjs` | Builds Go runtime binary to `dist/nimi` |

### Proto Helpers

| Script | Purpose |
|--------|---------|
| `run-buf.sh` | Wrapper for running Buf CLI commands |
| `proto-breaking.sh` | Proto breaking change detection |

### Release

| Script | Purpose |
|--------|---------|
| `release/sign-and-sbom-artifacts.mjs` | Signs release artifacts and generates SBOM |

### Other

| Script | Purpose |
|--------|---------|
| `run-live-test-matrix.mjs` | Runs cross-layer live smoke tests |
| `bundle-size-baseline.json` | Bundle size baseline data (not a script) |

## Subdirectories

### `realm-sdk/`

Realm SDK codegen pipeline internals. Entry point: `generate-realm-sdk.mjs` → `realm-sdk/cli.mjs`.

Key modules: `openapi-pipeline.mjs` (OpenAPI parsing), `operations.mjs` (operation extraction), `models.mjs` (model generation), `render-service-registry-*.mjs` (service registry output).

Do not invoke `realm-sdk/*.mjs` directly — use `generate-realm-sdk.mjs` or `pnpm generate:realm-sdk`.

### `release/`

Release automation. Contains signing and SBOM generation for distribution artifacts.

## Conventions

- All scripts are ESM (`.mjs`) unless shell-specific (`.sh`)
- `check-*` scripts exit non-zero on failure (CI gate semantics)
- `generate-*` scripts are idempotent — safe to re-run
- Scripts are invoked from workspace root via `pnpm` script aliases (see `package.json`)
- Do not add new scripts without a corresponding `pnpm` script alias
- Spec is the normative source of truth; prefer adding or extending `spec/*` consistency checks over ad-hoc doc-only gates

## What NOT to Do

- Don't modify `realm-sdk/` internals without understanding the full codegen pipeline
- Don't add `check-*` scripts that require network access (CI must be offline-safe)
- Don't bypass check scripts with `--force` flags — fix the underlying issue
