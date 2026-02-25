# Runtime Context

> Quick context for AI agents working on nimi-runtime.

## What Is This

Go gRPC daemon providing local AI compute: inference, model management, workflow DAG, app authorization, audit.

## File Map

```
runtime/
├── cmd/nimi/          CLI entry (single binary)
├── internal/
│   ├── services/      gRPC service implementations
│   │   ├── ai/        Inference routing (local/cloud)
│   │   ├── auth/      Session management
│   │   ├── grant/     App authorization, token lifecycle
│   │   ├── model/     Model pull/load/remove
│   │   ├── workflow/  DAG execution
│   │   ├── knowledge/ Vector indexing
│   │   ├── app/       Inter-app messaging
│   │   └── audit/     Usage stats, events
│   ├── grpcserver/    Server setup, interceptors
│   ├── httpserver/    Diagnostics endpoints
│   ├── daemon/        Daemon lifecycle
│   ├── config/        Config loading
│   ├── modelregistry/ Model state persistence
│   ├── providerhealth/ Provider liveness tracking
│   ├── health/        Health state aggregation
│   ├── auditlog/      Audit event recording
│   └── entrypoint/    Bootstrap wiring
├── gen/               Generated protobuf Go stubs
└── proto/             Contract documentation
```

## Key Dependencies

- `google.golang.org/grpc` v1.79 — gRPC framework
- `google.golang.org/protobuf` v1.36 — Protobuf runtime
- `github.com/oklog/ulid/v2` — ID generation

## Common Tasks

| Task | Command |
|------|---------|
| Build | `go build -o nimi ./cmd/nimi` |
| Test | `go test ./...` |
| Lint | `go vet ./... && golangci-lint run` |
| Run daemon | `./nimi serve` |
| Check status | `./nimi status` |

## Proto → Code

Proto source: `/proto/runtime/v1/*.proto`
Generated Go: `/runtime/gen/runtime/v1/*.go`

```bash
buf generate   # regenerate
```

## Patterns

- Each service: struct with `Unimplemented*Server` embed + injected deps
- AI routing: `routePolicy` → local subprocess (gRPC-over-UDS) or cloud adapter (HTTPS)
- All operations emit audit events via `auditlog.Logger`
- Health: aggregated from `providerhealth` + model states → gRPC health + HTTP `/healthz`
