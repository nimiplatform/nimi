# Runtime AGENTS.md

## Scope
- Applies to `runtime/**`.
- Start from the package or consumer that produced the observed failure; inspect Runtime only when the trace, contract, or changed dependency points here.

## Hard Boundaries
- Keep Runtime self-contained: no imports from `sdks/**` or `apps/**`.
- Preserve Go rules: constructor injection, no global mutable state, `fmt.Errorf("op: %w", err)`, no `log.Println`.
- Treat `runtime/gen/**` and `runtime/internal/providerregistry/generated.go` as generated read-only outputs.
- Connector/provider authority lives in `.nimi/spec/runtime/{ai-provider,model-catalog}.authority.yaml`; catalog sources and generated snapshots are support projections, not parallel truth.
- Do not patch runtime gaps with desktop or SDK hardcodes.

## Retrieval Defaults
- Read the failing package, its direct dependencies, and the exact Runtime authority it implements.
- Read `runtime/catalog/source/**` only for catalog work; inspect generated outputs only for codegen or drift failures.
- Skip unrelated Runtime packages, generated files, large fixtures, and historical evidence.

## Verification Commands
- Targeted owner loop: `cd runtime && go test ./<affected-package>/...`.
- For a Runtime-wide change, run `cd runtime && go test ./...`; add `go vet ./...` and `go build ./...` only when the changed boundary requires them.
- For proto or catalog changes, run only their directly affected generation and drift checks.
