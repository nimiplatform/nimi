# SDK Context

> Quick context for AI agents working on @nimiplatform/sdk.

## What Is This

TypeScript SDK — unified developer interface to Nimi runtime (gRPC) and realm (REST+WS).

## File Map

```
sdk/
├── src/              @nimiplatform/sdk source root
│   ├── realm/        @nimiplatform/sdk/realm (HTTP/WS client)
│   │   └── generated/ OpenAPI codegen output
│   ├── runtime/      @nimiplatform/sdk/runtime (runtime transport client)
│   │   └── generated/ Proto codegen output
│   ├── mod/          @nimiplatform/sdk/mod/*
│   ├── types/        @nimiplatform/sdk/types (shared types)
│   └── ai-provider/  @nimiplatform/sdk/ai-provider (Vercel AI SDK v6)
├── test/
└── package.json      publish root (@nimiplatform/sdk)
```

## Dependency Graph (Strict)

```
sdk → realm, runtime, types
realm → types          (NEVER runtime)
runtime → types        (NEVER realm)
ai-provider → runtime  (NEVER realm)
types → nothing
```

## Key Types

```ts
// Client initialization
createNimiClient({ appId, realm?, runtime? })

// Error type (all errors)
NimiError { reasonCode, actionHint, traceId, retryable, source }

// AI routing
routePolicy: 'local-runtime' | 'token-api'

// Auth presets
AuthorizationPreset: 'readOnly' | 'full' | 'delegate'
```

## Common Tasks

| Task | Command |
|------|---------|
| Build all | `cd sdk && pnpm build` |
| Test | `cd sdk && pnpm test` |
| Type check | `pnpm exec tsc --noEmit` |

## Codegen

- `realm/` — From OpenAPI spec (source in closed-source nimi-realm)
- `runtime/` — From proto files (`buf generate`)
- Both committed. CI verifies zero-drift.

## Rules

- ESM with `.js` extension
- No `any` in public surface
- No cross-import realm ↔ runtime
- Never throw raw strings — always `NimiError`
- `idempotencyKey` required on all write operations
