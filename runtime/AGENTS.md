# Runtime AGENTS.md

## Scope
- Applies to `runtime/**`.
- Runtime is the first blocking layer for the repo; downstream fixes must wait until runtime gates are green.

## Hard Boundaries
- Keep runtime self-contained: no imports from `sdk/**` or `apps/**`.
- Preserve Go rules: constructor injection, no global mutable state, `fmt.Errorf("op: %w", err)`, no `log.Println`.
- Treat `runtime/gen/**` and `runtime/internal/providerregistry/generated.go` as generated read-only outputs.
- Runtime connector/provider authority comes from `.nimi/spec/runtime/connector.md`,
  `.nimi/spec/runtime/kernel/connector-contract.md`, and the imported kernel
  provider catalog/capability tables. Runtime catalog source files and generated
  snapshots are support/projection inputs only; they must not become parallel
  product truth for connector provider domains, model-list semantics, custody,
  owner, or probe behavior.
- Do not patch runtime gaps with desktop or SDK hardcodes.

## Retrieval Defaults
- Start in `runtime/internal/services`, `runtime/internal/config`, `runtime/internal/daemon`, `runtime/cmd/nimi`, and `runtime/catalog/source`.
- Skip `runtime/gen/**`, `runtime/catalog/providers/**`, `runtime/proto/*.binpb`, large test fixtures, and unrelated docs unless the task is codegen or drift analysis.

## Verification Commands
- Core: `cd runtime && go build ./...`, `cd runtime && go vet ./...`, `cd runtime && go test ./...`.
- Compliance: `cd runtime && go run ./cmd/runtime-compliance --gate`.
- Proto chain: `pnpm proto:lint`, `pnpm proto:generate`, `pnpm proto:breaking`, `pnpm proto:drift-check`, `pnpm check:runtime-proto-spec-linkage`.
- Runtime guardrails: `pnpm check:runtime-go-coverage`, `pnpm check:runtime-ai-scenario-coverage`, `pnpm check:runtime-catalog-drift`, `pnpm check:live-provider-invariants`.
