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
│   ├── appregistry/     In-memory app manifest storage and validation
│   ├── auditlog/        Audit event recording
│   ├── authn/           JWT token extraction and validation from gRPC metadata
│   ├── config/          Configuration loading
│   ├── daemon/          Daemon lifecycle management
│   ├── endpointsec/     SSRF prevention (HTTPS enforcement, private address blocking)
│   ├── engine/          Local inference engine lifecycle (LocalAI, Nexa)
│   ├── entrypoint/      Bootstrap and wiring
│   ├── grpcerr/         gRPC Status error construction with ReasonCode details
│   ├── grpcserver/      gRPC server setup and interceptors
│   ├── health/          Health state projection
│   ├── httpserver/      HTTP diagnostics (/livez, /readyz, /healthz)
│   ├── idempotency/     LRU-based write-call replay cache with TTL
│   ├── modelregistry/   Model state persistence
│   ├── nimillm/         OpenAI-compatible multi-cloud AI inference client
│   ├── pagination/      Opaque base64url page token encoding/decoding
│   ├── protocol/        Protocol version negotiation
│   ├── providerhealth/  AI provider health tracking
│   ├── scheduler/       Global and per-app concurrency limiter
│   ├── scopecatalog/    OAuth scope catalog versioning and revocation
│   ├── usagemetrics/    Per-request queue wait metrics via context/trailers
│   ├── workerentry/     Worker subprocess boot with Unix socket listener
│   ├── workeripc/       Worker IPC path utilities (socket location, dial targets)
│   ├── workerproxy/     Request forwarding to isolated worker processes
│   ├── workers/         Worker supervisor with restart and backoff
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
├── gen/                 Generated protobuf Go stubs (READ-ONLY, see Proto Conventions)
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

## Test Placement

Tests are colocated with their source files as `*_test.go` in the same package directory. For example, `internal/services/ai/service_test.go` tests `internal/services/ai/service.go`. Live smoke tests follow the same convention (`live_provider_smoke_test.go`).

## Generated Directories (READ-ONLY)

- `gen/runtime/v1/` — Generated Go protobuf + gRPC stubs from `proto/runtime/v1/`. Never edit manually; regenerate with `buf generate` from the `proto/` directory.

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

Each gRPC service follows: constructor injection → validate → execute → audit → return. See `internal/services/*/service.go` for canonical examples.

## Key Patterns

- **AI routing**: `local-runtime` → LocalAI/Nexa subprocess, `token-api` → NimiLLM/cloud adapter
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

Runtime errors use gRPC status codes with `ReasonCode` in the message (plain string or JSON body with `reasonCode` + `actionHint`). All `ReasonCode` values are defined in `proto/runtime/v1/common.proto`.

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

## Layered Entry/Exit (MUST)

- Runtime is the first blocking layer for mod AI chains.
- Before SDK/Desktop/Mod debugging starts, runtime must be green on:
  - deterministic quality gates
  - provider invariants (`pnpm check:live-provider-invariants`)
- Do not accept fixes that rely on SDK/Desktop hardcode or legacy compatibility to compensate runtime contract drift.

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

### Live Smoke Tests

Live smoke tests validate real API key → provider → response chains. They live in `internal/services/ai/live_provider_smoke_test.go` and auto-skip when env vars are missing (safe for default CI).

**Naming convention:**

| Interface | Pattern |
|-----------|---------|
| Generate text | `TestLiveSmoke{Provider}GenerateText` |
| Embed | `TestLiveSmoke{Provider}Embed` |
| Media jobs | `TestLiveSmoke{Provider}SubmitMediaJobModalities/{modal}` |
| Connector TTS | `TestLiveSmokeConnector{Provider}TTS` |

**Env var convention:** `NIMI_LIVE_{PROVIDER}_{FIELD}` where FIELD is `API_KEY`, `BASE_URL`, `MODEL_ID`, `EMBED_MODEL_ID`, etc. See `dev/live-test.env.example` for the full list.

**Helper functions:**

- `requiredLiveEnv(t, key)` — skips test if env var is empty
- `liveEnvOrDefault(t, key, defaultValue)` — reads env var with fallback to provider catalog default

**Running live tests:**

```bash
# All skip (no API keys) — must always pass
go test ./internal/services/ai/ -run TestLiveSmoke -v -count=1

# Single provider
export NIMI_LIVE_OPENAI_API_KEY=sk-xxx
export NIMI_LIVE_OPENAI_MODEL_ID=gpt-4o-mini
go test ./internal/services/ai/ -run 'TestLiveSmokeOpenAI' -v -timeout 5m
```

**Adding a new provider live test:**

1. Add `TestLiveSmoke{Provider}GenerateText` following the existing pattern (explicit `Config` with `CloudProviders` map)
2. Use `liveEnvOrDefault` for base URL with the provider catalog default
3. Use `requiredLiveEnv` for API key and model ID (test must skip without them)
4. If the provider supports embedding, add `TestLiveSmoke{Provider}Embed`
5. Update `dev/live-test.env.example` with the new env vars

## Build

```bash
pnpm build:runtime
# or:
cd runtime && go build -o ../dist/nimi ./cmd/nimi
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
| `NIMI_RUNTIME_CLOUD_NIMILLM_BASE_URL` | — | Cloud NimiLLM endpoint |
| `NIMI_RUNTIME_ENABLE_WORKERS` | `false` | Enable worker subprocesses |
| `NIMI_RUNTIME_LOCAL_RUNTIME_STATE_PATH` | `~/.nimi/runtime/local-runtime-state.json` | Local runtime model/service/audit state persistence path |

## What NOT to Do

- Don't add `internal/` packages without a clear domain boundary
- Don't bypass gRPC service layer for direct business logic access
- Don't use `context.Background()` in request handlers — always propagate the incoming context
- Don't import `apps/desktop/` or `sdk/` packages — runtime is an independent module
- Don't skip audit events on error paths — all operations must be audited
- Don't accept arbitrary timeouts — clamp to V1 maximums (see `queue_timeout_helpers.go`)
