# GitHub Copilot Instructions

## Project

Nimi is an AI-native open world platform. This monorepo contains a Go runtime, TypeScript SDK, Tauri desktop app, and mod ecosystem.

## Language Conventions

### TypeScript (SDK, Desktop, Web, Mods)

- ESM imports with `.js` extension for `.ts` files
- Use ULID for new IDs (`import { ulid } from 'ulid'`)
- Use Zod `safeParse` for runtime validation
- Explicit type signatures on all public API methods
- No `any` in public API surface
- No `console.log` — use structured `NimiError`

### Go (Runtime)

- Module: `github.com/nimiplatform/nimi/runtime`
- Use ULID (`oklog/ulid/v2`) for generated IDs
- Constructor injection, no global state
- Error wrapping: `fmt.Errorf("operation: %w", err)`
- Table-driven tests

### Protocol Buffers

- Source in `proto/runtime/v1/`
- Use Buf CLI for lint/breaking/generate
- Generated code is committed to the repo

## Architecture Boundaries

```
apps/desktop + apps/web → @nimiplatform/sdk → runtime (gRPC) / realm (REST+WS)
mods → nimi-hook → @nimiplatform/sdk → runtime/realm
```

Do not suggest:
- Direct imports from `runtime/internal/` in SDK or Desktop
- Cross-imports between `sdk/realm` and `sdk/runtime`
- Bypassing nimi-hook from mod code
- Raw HTTP/gRPC calls from Desktop (use SDK)

## Error Handling

All errors should be structured:

```ts
{ reasonCode: string, actionHint: string, traceId: string, retryable: boolean, source: 'realm' | 'runtime' | 'sdk' }
```

## Key References

- `AGENTS.md` — Project conventions
- `runtime/AGENTS.md` — Go conventions
- `sdk/AGENTS.md` — TypeScript conventions
- `apps/desktop/AGENTS.md` — Tauri + React conventions
