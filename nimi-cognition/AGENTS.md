# nimi-cognition AGENTS.md

## Scope
- Applies to `nimi-cognition/**`, a standalone Go module for per-agent local cognition.

## Hard Boundaries
- Keep the module on its own `go.mod`; do not depend on any other monorepo module or package.
- External dependencies stay limited to the admitted SQLite driver/runtime and transitive support libraries; SQLite is the only durable backend.
- Cognition completion status comes from cognition-owned authority and rule evidence, not from green module gates alone; unrelated repo blockers are not cognition failures.
- No imports from `runtime/**`, `sdks/**`, `apps/**`, or any other monorepo package.
- Runtime adaptation is outside this module; do not couple it to Runtime services.
- V1 contains only canonical long-term `memoryv1` and bounded typed Agent Source custody. Do not add Knowledge, kernel, graph, digest, skill/plugin registry, working-state, prompt, generic scheduler, or generic bridge families.
- Keep Memory and Agent Source stores independent; source storage must not create the Memory schema, and Memory storage must not create source or retired schemas.
- Use constructor injection, no global mutable state, `fmt.Errorf("op: %w", err)`, and no `log.Println`.
- Reject malformed data rather than accepting it silently.

## Retrieval Defaults
- Start with the affected package, its tests, and direct dependencies.
- Read `memoryv1/**` for canonical Memory behavior and `internal/storage/**` only for typed Agent Source persistence.
- Do not introduce or recover retired artifact families from Git history.

## Verification Commands
- Default: `cd nimi-cognition && go test ./<affected-package>`.
- Add direct dependent-package tests when an exported contract changes.
- Run `make all`, `make test-race`, and `make lint` only for module-wide, concurrency-sensitive, or release-level changes.
