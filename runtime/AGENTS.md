# Runtime AGENTS.md

> Conventions for AI agents working on nimi-runtime (Go).

## Context

nimi-runtime is an independent local AI daemon written in Go. It exposes 9 gRPC services (including `RuntimeLocalRuntimeService`) and manages AI inference, model lifecycle, workflow DAG execution, and app authorization.

## Project Structure

```
runtime/
├── cmd/
│   ├── nimi/            CLI entry (single binary: daemon + client)
├── internal/
│   ├── auditlog/        Audit event recording
│   ├── config/          Configuration loading
│   ├── daemon/          Daemon lifecycle management
│   ├── entrypoint/      Bootstrap and wiring
│   ├── grpcserver/      gRPC server setup and interceptors
│   ├── health/          Health state projection
│   ├── httpserver/      HTTP diagnostics (/livez, /readyz, /healthz)
│   ├── modelregistry/   Model state persistence
│   ├── providerhealth/  AI provider health tracking
│   └── services/        gRPC service implementations
│       ├── ai/          RuntimeAiService (inference routing)
│       ├── app/         RuntimeAppService (inter-app messaging)
│       ├── audit/       RuntimeAuditService (usage stats)
│       ├── auth/        RuntimeAuthService (session mgmt)
│       ├── grant/       RuntimeGrantService (authorization)
│       ├── knowledge/   RuntimeKnowledgeService (vector index)
│       ├── localruntime/ RuntimeLocalRuntimeService (local model/service lifecycle)
│       ├── model/       RuntimeModelService (model lifecycle)
│       └── workflow/    RuntimeWorkflowService (DAG execution)
├── proto/               Contract documentation
├── gen/                 Generated protobuf Go stubs
└── go.mod               Module: github.com/nimiplatform/nimi/runtime
```

## Go Conventions

- **Go 1.24+** with toolchain `go1.24.4`
- Module path: `github.com/nimiplatform/nimi/runtime`
- Use **ULID** (`oklog/ulid/v2`) for all generated IDs
- gRPC: `google.golang.org/grpc` v1.79+
- Protobuf: `google.golang.org/protobuf` v1.36+
- No `log.Println` — use structured logging
- No global state — pass dependencies through constructors
- Error wrapping with `fmt.Errorf("operation: %w", err)`

## Proto Conventions

- Proto source files are in `/proto/runtime/v1/`
- Generated Go stubs are in `/runtime/gen/`
- Use Buf CLI for linting and breaking change detection:
  ```bash
  cd ../proto
  buf lint
  buf breaking --against ../runtime/proto/runtime-v1.baseline.binpb
  ```
- After modifying `.proto` files, regenerate:
  ```bash
  buf generate
  ```
- Generated code is committed to the repo. CI runs regeneration and fails on diff.

## Service Implementation Pattern

Each gRPC service follows this structure:

```go
// internal/services/ai/service.go
type Service struct {
    pb.UnimplementedRuntimeAiServiceServer
    // dependencies injected via constructor
}

func New(deps ...Dependency) *Service {
    return &Service{...}
}

func (s *Service) Generate(ctx context.Context, req *pb.GenerateRequest) (*pb.GenerateResponse, error) {
    // 1. Validate request
    // 2. Execute business logic
    // 3. Emit audit event
    // 4. Return response
}
```

## Key Patterns

- **AI routing**: `local-runtime` → LocalAI/Nexa subprocess, `token-api` → LiteLLM/cloud adapter
- **Provider health**: Tracked in `providerhealth/`, propagated to `health/` for gRPC health service
- **Model registry**: JSON-backed model state in `~/.nimi/runtime/model-registry.json` (or `NIMI_RUNTIME_MODEL_REGISTRY_PATH`)
- **Audit**: All service calls emit audit events via `auditlog/`

## Interceptor Chain

gRPC requests pass through 4 interceptors (applied in order):

```
1. Lifecycle    → Rejects writes when STOPPING/STOPPED
2. Protocol     → Validates idempotency, protocol version
3. Authorization → Enforces protected capabilities for sensitive operations
4. Audit        → Records audit event for every RPC
```

Read-only methods (`GetRuntimeHealth`, `ListAuditEvents`, `ListUsageStats`, etc.) are exempt from lifecycle rejection.

## Health State Machine

```
STOPPED → STARTING → READY ↔ DEGRADED
                        ↓         ↓
                     STOPPING → STOPPED
```

State transitions:
- `STARTING → STOPPED`: Worker supervisor fails (unrecoverable), audit event emitted
- `STARTING → READY`: All services online
- `READY → DEGRADED`: All AI providers unhealthy, or worker crash
- `READY/DEGRADED → STOPPING`: Graceful shutdown initiated
- `STOPPING → STOPPED`: Shutdown complete

## Error Handling

Runtime errors use gRPC status codes with `ReasonCode` in the message:

```go
// Return structured error
return nil, status.Error(codes.NotFound, runtimev1.ReasonCode_AI_MODEL_NOT_FOUND.String())

// Return error with actionHint (JSON body)
errBody := fmt.Sprintf(`{"reasonCode":"%s","actionHint":"%s"}`, reasonCode.String(), actionHint)
return nil, status.Error(codes.PermissionDenied, errBody)
```

All `ReasonCode` values are defined in `proto/runtime/v1/common.proto`.

## Proto Evolution Rules

- Never remove or renumber existing fields
- New fields use the next available number
- `reserved` protects removed field numbers
- CI runs `buf breaking` against committed baseline (`proto/runtime-v1.baseline.binpb`)
- Baseline update: `make proto-baseline` (after intentional breaking change)

## Compliance Gate

23-item compliance checklist in `cmd/runtime-compliance/main.go`:

```bash
# Run compliance check (CI runs this with --gate)
go run ./cmd/runtime-compliance --gate

# Output JSON report
go run ./cmd/runtime-compliance --output report.json
```

The gate fails CI if any checklist item fails. Items cover:
- Proto schema freeze + breaking check
- Version negotiation
- Auth/grant chain tests
- AI reason-code mapping
- Route policy regression
- Model management contract
- Audit field completeness
- Health subscription contract
- DAG state machine
- GPU arbitration

## CI Gates

Runtime code must pass all of these:

| Check | Command |
|-------|---------|
| Build | `go build ./...` |
| Test | `go test ./...` |
| Vet | `go vet ./...` |
| Compliance | `go run ./cmd/runtime-compliance --gate` |
| Proto lint | `cd ../proto && buf lint` |
| Proto breaking | `cd ../proto && buf breaking --against ../runtime/proto/runtime-v1.baseline.binpb` |
| Proto drift | `cd .. && pnpm proto:drift-check` |

## Testing

```bash
cd runtime
go test ./...
go vet ./...

# Run specific test
go test ./internal/services/ai/ -run TestGenerateSuccess -v

# Run compliance gate
go run ./cmd/runtime-compliance --gate
```

## Build

```bash
cd runtime
go build -o nimi ./cmd/nimi
```

## Configuration

| Env Var | Default | Purpose |
|---------|---------|---------|
| `NIMI_RUNTIME_GRPC_ADDR` | `127.0.0.1:46371` | gRPC listen address |
| `NIMI_RUNTIME_HTTP_ADDR` | `127.0.0.1:46372` | HTTP health/metrics |
| `NIMI_RUNTIME_SHUTDOWN_TIMEOUT` | `10s` | Graceful shutdown timeout |
| `NIMI_RUNTIME_AI_HEALTH_INTERVAL` | `8s` | Provider probe interval |
| `NIMI_RUNTIME_AI_HTTP_TIMEOUT` | `30s` | Provider probe timeout |
| `NIMI_RUNTIME_LOCAL_AI_BASE_URL` | — | Local provider endpoint |
| `NIMI_RUNTIME_CLOUD_LITELLM_BASE_URL` | — | Cloud LiteLLM endpoint |
| `NIMI_RUNTIME_ENABLE_WORKERS` | `false` | Enable worker subprocesses |
| `NIMI_RUNTIME_LOCAL_RUNTIME_STATE_PATH` | `~/.nimi/runtime/local-runtime-state.json` | Local runtime model/service/audit state persistence path |

## What NOT to Do

- Don't add `internal/` packages without a clear domain boundary
- Don't bypass gRPC service layer for direct business logic access
- Don't use `context.Background()` in request handlers — always propagate the incoming context
- Don't import `apps/desktop/` or `sdk/` packages — runtime is an independent module
- Don't skip audit events on error paths — all operations must be audited
- Don't accept arbitrary timeouts — clamp to V1 maximums (see `queue_timeout_helpers.go`)
