# Proto AGENTS.md

> Conventions for AI agents working on `proto/` (Protocol Buffers).

## Context

`proto/` contains all Protocol Buffer source files for the nimi runtime gRPC API. Generated stubs are committed to the repo and CI-verified for zero-drift.

## File Inventory

```
proto/
├── buf.yaml                    Buf v2 module config (lint + breaking rules)
├── buf.gen.yaml                Code generation targets
├── README.md
└── runtime/v1/
    ├── common.proto            Shared types, enums, ReasonCode
    ├── ai.proto                AI inference service
    ├── app.proto               Inter-app messaging service
    ├── auth.proto              Session management service
    ├── audit.proto             Usage stats service
    ├── connector.proto         External connector service
    ├── grant.proto             Authorization service
    ├── knowledge.proto         Vector index service
    ├── local_runtime.proto     Local model/service lifecycle
    ├── model.proto             Model lifecycle service
    ├── script_worker.proto     Script worker service
    └── workflow.proto          DAG execution service
```

## Generation Targets

Defined in `buf.gen.yaml`:

| Plugin | Output | Language |
|--------|--------|----------|
| `buf.build/protocolbuffers/go` | `runtime/gen/` | Go structs |
| `buf.build/grpc/go` | `runtime/gen/` | Go gRPC stubs |
| `buf.build/community/timostamm-protobuf-ts` | `sdk/src/runtime/generated/` | TypeScript client |

## Generated Directories (READ-ONLY)

These directories are generated from proto sources. Never edit them manually:

- `runtime/gen/runtime/v1/` — Go protobuf + gRPC stubs
- `sdk/src/runtime/generated/runtime/v1/` — TypeScript protobuf client

## Commands

```bash
# Lint proto files
cd proto && buf lint
# or from workspace root:
pnpm proto:lint

# Check for breaking changes against baseline
cd proto && buf breaking --against ../runtime/proto/runtime-v1.baseline.binpb
# or from workspace root:
pnpm proto:breaking

# Generate stubs (Go + TypeScript)
cd proto && buf generate
# or from workspace root:
pnpm proto:generate

# Verify generated code matches committed code (CI drift check)
pnpm proto:drift-check
```

## Buf Configuration

- **Lint rules:** `STANDARD` with exceptions: `PACKAGE_DIRECTORY_MATCH`, `ENUM_VALUE_PREFIX`, `RPC_RESPONSE_STANDARD_NAME`, `RPC_REQUEST_RESPONSE_UNIQUE`
- **Breaking rules:** `FILE` category

## Proto Evolution Rules

- Never remove or renumber existing fields
- New fields use the next available number
- `reserved` protects removed field numbers
- CI runs `buf breaking` against committed baseline (`runtime/proto/runtime-v1.baseline.binpb`)
- Baseline update: `make proto-baseline` (after intentional breaking change)

## What NOT to Do

- Don't edit generated files in `runtime/gen/` or `sdk/src/runtime/generated/`
- Don't add proto files outside `runtime/v1/` without updating `buf.yaml` module config
- Don't skip `buf lint` before committing proto changes
- Don't remove `reserved` field numbers
