# Testing Strategy

Testing in Nimi follows a targeted, proportional approach: verify the immediate behavior being modified first, then run the nearest unit or integration test suite, expanding validation outward as needed. This document serves as a command reference and operational guide for local testing and CI workflows.

## Daily Development and Integration

Changes merged to `main` undergo automated continuous integration checks across all affected packages. For cross-cutting architectural changes, public contract modifications, native installer updates, or release workflows, open a pull request to ensure full remote validation passes across platforms prior to merging.

CI dynamically identifies affected owners and downstream consumers based on changed paths. Push builds preserve pending checks so that documentation updates do not obscure concurrent code test results.

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

`pnpm proto:breaking` compares the proto against the published wire named in `runtime/proto/runtime-v1.baseline.json`; the committed image must rebuild byte-for-byte from that component tag. The gate works offline, so a shallow checkout fetches that tag first, as CI does. A deliberate break is declared in that record with its reason and the CHANGELOG migration heading of the new 0.x minor, and still requires the corresponding implementation, consumers and tests to change. `pnpm proto:baseline:refresh` moves the baseline only to a newer published tag and records the difference adjudication; unpublished source never becomes the baseline.

Change generator inputs, regenerate, then run the corresponding drift check. Do not hand-edit generated output to pass. Authority changes use the pinned project-local commands in [AGENTS.md](AGENTS.md) and the [authoring guide](.nimi/methodology/authority-authoring.yaml); unrelated code changes do not require authority compilation or a corpus audit.

For authority changes, CI runs the complete scope check and `pnpm spec:authority:review --base <commit-SHA>` for legal identity transitions, declared impact, and configured audit. PRs use the event's base SHA; pushes use the event's before SHA; manual full runs use the selected commit's first parent. Missing history fails the check. Review completion does not establish business correctness or implementation conformance.

SDK/Runtime contract tests should exercise public serialization, service behavior and structured errors. Prefer observable behavior over implementation text matching. Use reason codes when the public error contract provides them.

## Build preparation and concurrency

Guarded workspace commands prepare SDK/Kit once for their child command chain and retain the output lock while consumers run. Independent invocations prepare their own current outputs. Do not export prepared flags into the shell or reuse them across source changes. Preserve real tests when removing repeated invocations.

Dependency installation does not install native toolchains. Runtime build and native preparation check the tools they use; install Go/Rust explicitly when needed.

## Product and Release Acceptance

End-to-end product journeys that have not been executed on real target platforms remain unconfirmed (`NOT-VERIFIED`). While unit tests, type checks, and process liveness tests verify static and modular correctness, full product confidence requires testing on actual Linux, Windows, or macOS host environments when native platform integrations are modified.

Release validation is tied to the exact binaries, packages, and manifests being published. Passing release tests on target artifacts is an absolute prerequisite for publication. When retrying failed publication steps, maintainers reuse validated artifacts rather than rebuilding an immutable release artifact.
