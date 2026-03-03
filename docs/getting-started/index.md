# Getting Started

This guide helps you run `nimi-runtime` locally and send your first request with `@nimiplatform/sdk`.

## Prerequisites

- Go `1.24+`
- Node.js `24+`
- pnpm `10+`

## 1. Start runtime

```bash
cd runtime
go run ./cmd/nimi serve
```

Default endpoints:

- gRPC: `127.0.0.1:46371`
- HTTP health: `127.0.0.1:46372`

## 2. Verify runtime health

```bash
cd runtime
go run ./cmd/nimi health --source grpc
go run ./cmd/nimi providers --source grpc
curl http://127.0.0.1:46372/v1/runtime/health
```

## 3. Run an SDK example

```bash
npx tsx examples/sdk/sdk-quickstart.ts
```

All runnable examples are in `/examples`.

## 4. Next steps

- App integration guide: [App Developer](../guides/app-developer.md)
- Mod integration guide: [Mod Developer](../guides/mod-developer.md)
- Runtime integration guide: [Runtime Integrator](../guides/runtime-integrator.md)
- Recipe index: [Quick Recipes](../cookbook/quick-recipes.md)

## Spec pointers

- Spec index: [`spec/INDEX.md`](../../spec/INDEX.md)
- Human-readable generated spec: [`spec/generated/nimi-spec.md`](../../spec/generated/nimi-spec.md)
