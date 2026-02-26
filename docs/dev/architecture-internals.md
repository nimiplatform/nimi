# Architecture Internals

This document explains key internal architecture decisions for contributors. For the public-facing overview, see [Architecture](../architecture/README.md).

## Why Go for Runtime?

Runtime is a control plane (gRPC server, process management, scheduling, audit). Go provides:

- High delivery efficiency for gRPC + daemon patterns
- Single-binary distribution (no runtime dependencies)
- Native concurrency primitives for process management
- Mature gRPC ecosystem

**Re-evaluation triggers** (must meet one to discuss Rust):
1. Control plane SLO persistently fails due to Go GC characteristics
2. Main path requires in-process zero-copy / shared memory (V1 explicitly does not)
3. New high-risk local sandbox executor requiring language-level safety constraints

## Why Tauri for Desktop?

- Rust backend provides native OS integration (keychain, tray, filesystem)
- Web frontend (React) enables code sharing with `apps/web/` adapter
- Smaller binary than Electron
- Security: Tauri's capability-based permission model for OS access

## Runtime Process Model

```
nimi (daemon)
├── gRPC Server (main goroutine)
│   ├── Interceptors (lifecycle, protocol, authz, audit)
│   └── 9 Service handlers (ai/app/audit/auth/grant/knowledge/localruntime/model/workflow)
├── HTTP Server (diagnostics)
│   └── /livez, /readyz, /healthz, /v1/runtime/health
├── Process Manager
│   ├── LocalAI subprocess
│   ├── Nexa subprocess
│   └── LiteLLM subprocess
├── Model Registry (JSON file)
├── GPU Arbiter
├── Audit Logger
└── Health Aggregator
```

AI inference flow:
1. App calls `RuntimeAiService.Generate` via gRPC
2. Service resolves `routePolicy` → local or cloud
3. Local: forwards to subprocess via gRPC-over-UDS
4. Cloud: forwards to LiteLLM/adapter via HTTPS
5. Response wrapped with audit metadata and returned

## SDK Package Architecture

```
@nimiplatform/sdk (facade)
       │
       ├── realm/ (HTTP/WS client)
       │   └── Generated from OpenAPI spec (closed-source origin)
       │
       ├── runtime/ (gRPC client)
       │   └── Generated from proto/ definitions
       │
       ├── types/ (shared types)
       │   └── No I/O, no business logic
       │
       └── ai-provider/ (Vercel AI SDK v6)
            └── Translates AI SDK calls → gRPC
```

**Strict dependency rules:**
- `realm` and `runtime` must never import each other
- `ai-provider` depends on `runtime` only (never `realm`)
- `types` depends on nothing
- Cross-boundary types must live in `types/`

## Desktop → Platform Access

```
Mod code
  │
  ├─ createHookClient(modId).event.subscribe(...)
  ├─ createHookClient(modId).data.query(...)
  └─ createAiClient(modId).generateText(...)
       │
       └─ hook runtime facade (desktop governed)
            │
            ├─ @nimiplatform/sdk/realm  → REST/WS → Realm
            └─ @nimiplatform/sdk/runtime → gRPC → Runtime
```

Desktop itself also uses SDK for all platform access. No backdoor APIs.

## App Authorization Model

```
App decides policy (preset or custom)
    │
    ▼
SDK packages request
    │
    ▼
Runtime.AuthorizeExternalPrincipal (single-transaction RPC)
    │
    ├─ Creates app-auth policy
    ├─ Issues access token
    ├─ Binds scopeCatalogVersion
    └─ Emits audit event
    │
    ▼
ExternalPrincipal uses token to access app capabilities
```

Key invariants:
- One RPC = one atomic operation (no split create+issue)
- Token scope ⊆ app-auth policy scope
- Delegated token scope ⊆ parent token scope
- Policy update → all tokens invalidated
- `delegate` preset defaults to single-hop

## Audit Two-Layer Model

| Layer | What | Where |
|-------|------|-------|
| Runtime (local) | AI calls, model ops, app messaging, auth chain | `~/.nimi/audit/` (file-backed local audit stream) |
| Realm (cloud) | Business ops (transactions, social, world changes) | PostgreSQL |

Layers are independent. Local audit optionally reports to realm for cross-device aggregation. `traceId` links events across layers.

## Proto Schema Strategy

- Source of truth: `proto/runtime/v1/*.proto`
- Schema toolchain: Buf CLI (lint, breaking change detection, codegen)
- Generated Go stubs: `runtime/gen/`
- Generated TS stubs: `sdk/src/runtime/generated/`
- Both generated outputs are committed. CI runs `buf generate` and fails on any diff.

This ensures:
1. Proto changes are always reviewed (they're in the commit)
2. No build-time codegen surprises
3. AI agents can read generated types without running codegen
