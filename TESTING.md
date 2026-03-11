# Testing Strategy

## Overview

Each component has its own test setup. All tests must pass before merging.

## Runtime (Go)

```bash
cd runtime
go test ./...
```

### Test patterns

- Unit tests: `*_test.go` alongside source
- Service integration tests: `internal/services/*/service_test.go`
- Table-driven tests preferred

```go
func TestGenerate(t *testing.T) {
    tests := []struct {
        name    string
        req     *pb.GenerateRequest
        wantErr bool
    }{
        {"valid request", validReq(), false},
        {"missing model", missingModelReq(), true},
    }
    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            // ...
        })
    }
}
```

### Proto contract tests

Verify gRPC services honor the proto contract:

```bash
buf breaking proto/ --against .git#branch=main
```

## SDK (TypeScript)

```bash
cd sdk
pnpm test
```

### Test framework

- **Node.js test runner via `tsx --test`** for unit and integration tests
- Tests in `__tests__/` or `*.test.ts` alongside source

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { Runtime } from '@nimiplatform/sdk';

test('Runtime constructor requires appId', () => {
  assert.throws(() => new Runtime({
    appId: '',
    transport: { type: 'tauri-ipc' },
  }));
});
```

### Codegen verification

CI runs `buf generate` and fails if the output differs from committed stubs:

```bash
buf generate
git diff --exit-code sdk/src/runtime/generated/
```

## Desktop (Tauri + React)

```bash
pnpm test
```

- Unit and contract tests run via `tsx --test test/**/*.test.ts`
- Tauri shell/e2e coverage is smoke-driven (`smoke:mods`) plus Rust/TS type checks

### Desktop runtime-mod local smoke

Use this before `dev:shell` to validate the installed runtime-mod contract:

```bash
export NIMI_RUNTIME_MODS_DIR=/ABS/PATH/TO/runtime-mods
pnpm run check:desktop-mods-smoke
```

It validates the runtime mods directory, installed manifest/entry integrity, and zero-bundle desktop discovery behavior.

## Cross-Component Contract Tests

SDK ↔ Runtime gRPC contract tests verify:

1. SDK-generated client matches proto service definition
2. Request/response serialization round-trips correctly
3. Error codes propagate as structured `NimiError`

## CI Pipeline

| Check | Command | Scope |
|-------|---------|-------|
| Go test | `go test ./...` | runtime |
| Go vet | `go vet ./...` | runtime |
| golangci-lint | `golangci-lint run` | runtime |
| TypeScript check | `tsc --noEmit` | sdk, desktop, web |
| TSX tests | `pnpm test` | sdk, desktop, web |
| ESLint | `pnpm lint` | sdk, desktop, web |
| Buf lint | `buf lint proto/` | proto |
| Buf breaking | `buf breaking proto/ --against .git#branch=main` | proto |
| Codegen drift | `buf generate && git diff --exit-code` | proto → sdk, runtime |

## Writing New Tests

1. Place test files next to the source they test
2. Name them `*_test.go` (Go) or `*.test.ts` (TypeScript)
3. Test the public API surface, not internal implementation
4. Use structured assertions — avoid string matching on error messages, match `reasonCode` instead
5. For gRPC services, test through the service interface, not internal functions
