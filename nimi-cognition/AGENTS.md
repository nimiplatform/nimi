# nimi-cognition AGENTS.md

## Scope
- Applies to `nimi-cognition/**`, a standalone Go module for per-agent local cognition.

## Hard Boundaries
- Keep the module on its own `go.mod`; do not depend on any other monorepo module or package.
- External dependencies stay limited to the admitted SQLite driver/runtime and transitive support libraries; SQLite is the only durable backend.
- Cognition completion status comes from cognition-owned authority and rule evidence, not from green module gates alone; unrelated repo blockers are not cognition failures.
- No imports from `runtime/**`, `sdks/**`, `apps/**`, or any other monorepo package.
- Runtime adaptation is outside this module; do not couple it to Runtime services.
- Keep package dependencies acyclic: facades and routines may depend on domain packages and internal storage support, never the reverse.
- Digest never mutates agent or world kernels directly; all kernel mutation goes through `kernelops/**`.
- Use constructor injection, no global mutable state, `fmt.Errorf("op: %w", err)`, and no `log.Println`.
- Reject malformed data rather than accepting it silently.

## Retrieval Defaults
- Start with the affected package, its tests, and direct dependencies.
- Read `kernelops/**` for kernel mutation, `internal/storage/**` for persistence, and `routine/digest/**` only when the observed path crosses them.
- Do not preload all artifact families, internal packages, or module history.

## Verification Commands
- Default: `cd nimi-cognition && go test ./<affected-package>`.
- Add direct dependent-package tests when an exported contract changes.
- Run `make all`, `make test-race`, and `make lint` only for module-wide, concurrency-sensitive, or release-level changes.
