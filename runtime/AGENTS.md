# Runtime AGENTS.md

## Scope
- Applies to `runtime/**`.
- Runtime is the first blocking layer for the repo; downstream fixes must wait until runtime gates are green.

## Hard Boundaries
- Keep runtime self-contained: no imports from `sdk/**` or `apps/**`.
- Preserve Go rules: constructor injection, no global mutable state, `fmt.Errorf("op: %w", err)`, no `log.Println`.
- Treat `runtime/gen/**` and `runtime/internal/providerregistry/generated.go` as generated read-only outputs.
- Runtime connector/provider authority: `.nimi/spec/runtime/ai-provider.authority.yaml` + `model-catalog.authority.yaml`(散文 `docs/authority/runtime-domain-guides-rationale.md`).
  Runtime catalog source files and generated snapshots are support/projection inputs only; they must not become
  parallel product truth for connector provider domains, model-list semantics, custody, owner, or probe behavior.
- Do not patch runtime gaps with desktop or SDK hardcodes.

## Retrieval Defaults
- Start in `runtime/internal/services`, `runtime/internal/config`, `runtime/internal/daemon`, `runtime/cmd/nimi`, and `runtime/catalog/source`.
- Skip `runtime/gen/**`, `runtime/catalog/providers/**`, `runtime/proto/*.binpb`, large test fixtures, and unrelated docs unless the task is codegen or drift analysis.
## Verification Commands
- Targeted owner loop: `cd runtime && go run ./cmd/runtime-compliance --profile=developer --package <affected-package>`.
- Runtime owner batch: `cd runtime && go run ./cmd/runtime-compliance --profile=owner-batch --package <affected-package>`; this owns build/vet plus every fresh test in the selected package for development diagnostics.
- Candidate/final admission: run `cd runtime && go run ./cmd/runtime-compliance --gate` exactly once. It owns fresh full Runtime tests, build, vet, and all 63 compliance items; do not precede it with duplicate `go build ./...`, `go vet ./...`, or `go test ./...`.
- Desktop, Zhiyu, Kit TypeScript, runner, and manifest-only changes do not invoke Runtime full compliance unless they also change a Runtime/proto/release-gate owner surface.
- Layered package commands: `pnpm test:runtime:fast` is non-admission; use real owner scripts such as `pnpm test:runtime:owner:nimillm`; `pnpm test:runtime:full` aliases the direct final gate, so never run both.
- Proto chain: `pnpm proto:lint`, `pnpm proto:generate`, `pnpm proto:breaking`, `pnpm proto:drift-check`, `pnpm check:runtime-proto-spec-linkage`.
- Runtime guardrails: `pnpm check:runtime-go-coverage`, `pnpm check:runtime-ai-scenario-coverage`, `pnpm check:runtime-catalog-drift`, `pnpm check:live-provider-invariants`.
