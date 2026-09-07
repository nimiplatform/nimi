# Testing Strategy

Run the affected behavior first, then the nearest test or build that can detect the change's failure. After a repair, rerun the same failing target before expanding validation. The [AGENTS hierarchy](AGENTS.md) owns scope and proportionality; this document is command navigation.

## Daily work and integration

Ordinary changes may enter `main` after relevant local checks. Push CI validates the integrated commit; temporary failures must be repaired or reverted. Shared public contracts, native installation, data handling, and release workflow changes use a PR with the relevant remote results before merge. Neither a PR nor a green `main` proves release readiness.

CI selects affected owners and consumers. Main push runs must retain pending and running verification across later pushes; a later documentation-only success does not resolve an earlier code failure. PR updates may cancel earlier runs of the same PR.

## Component entrypoints

| Changed surface | Starting point | Expand when needed |
| --- | --- | --- |
| Runtime | The affected package's `go test` from `runtime/` | `pnpm test:runtime:go` for Runtime-wide changes; related vet/build and native platform checks |
| TypeScript SDK | `pnpm --filter @nimiplatform/sdk test` | SDK build, generator/conformance checks and affected consumers for public contract changes |
| Kit | Affected Kit test and `pnpm --filter @nimiplatform/kit build` | Kit-wide tests/contracts and actual App consumer types/builds |
| Desktop Electron | Affected Desktop test and `pnpm --filter @nimiplatform/desktop typecheck` | `pnpm --filter @nimiplatform/desktop build` for Electron or integration changes; Product Control native tests when affected |
| Web | `pnpm --filter @nimiplatform/web test` | Web typecheck/build when affected |
| App Tools | `pnpm --filter @nimiplatform/app-tools test` | Actual packed-tool/scaffold behavior for packaging changes |
| Proto | `pnpm proto:lint`, `pnpm proto:breaking` | Regenerate changed contracts and run `pnpm proto:drift-check` plus affected consumers |
| Workflow | `pnpm check:actionlint` and affected script tests | Actual selected PR/main jobs; local YAML validation is not CI acceptance |

Use each package's scripts for its test runner. The complete Desktop build includes Electron compilation and TypeScript checking; a Vite renderer build alone does not provide that coverage.

`pnpm test:workspace:full` runs the complete workspace and script suite. `pnpm test:full` adds Runtime Go and Python tests. These broad commands remain available for cross-cutting work and release validation; they are not mandatory for every local change.

## Contracts and generated output

`pnpm proto:breaking` uses the committed `runtime/proto/runtime-v1.baseline.binpb` through the guarded script. A deliberately changed wire contract requires the corresponding implementation, consumers and tests to change; refreshing the baseline alone does not prove correctness or authorize a breaking change.

Change generator inputs, regenerate, then run the corresponding drift check. Do not hand-edit generated output to pass. Authority changes use the pinned project-local commands in [AGENTS.md](AGENTS.md) and the [authoring guide](.nimi/methodology/authority-authoring.yaml); unrelated code changes do not require authority compilation or a corpus audit.

SDK/Runtime contract tests should exercise public serialization, service behavior and structured errors. Prefer observable behavior over implementation text matching. Use reason codes when the public error contract provides them.

## Build preparation and concurrency

Guarded workspace commands prepare SDK/Kit once for their child command chain and retain the output lock while consumers run. Independent invocations prepare their own current outputs. Do not export prepared flags into the shell or reuse them across source changes. Preserve real tests when removing repeated invocations.

Dependency installation does not install native toolchains. Runtime build and native preparation check the tools they use; install Go/Rust explicitly when needed.

## Product and release acceptance

A product journey not run is `NOT-VERIFIED`. Type checks, unit tests, a process remaining alive, or a scaffold being created do not prove a complete installed App journey. Run real Linux/Windows/macOS paths when the affected supported behavior requires them.

Release validation belongs to the exact version and artifacts being published. Its required failures or missing checks prevent publication even when the source is on `main`. Reuse validated artifacts when retrying a failed publication job; do not rebuild or move an immutable release merely to obtain another green result.

Use existing command output, CI jobs and a short description of the observed behavior. Do not add receipts, evidence manifests, permanent test-count gates or repeated audits to prove that the process was followed. DCO is a contribution declaration, not a technical security or product test.
