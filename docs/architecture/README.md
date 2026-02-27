# Architecture Overview

Nimi is an AI-native open world platform built on a layered architecture.

## Platform Layers

```
┌─────────────────────────────────────────────────────────────┐
│                         nimi-apps                            │
│                                                             │
│   desktop (1st party)    App A (3rd party)    App B    │
│   ┌──────────────────┐       ┌──────────┐    ┌──────────┐  │
│   │ Core UI          │       │          │    │          │  │
│   │ nimi-hook ↔ mods │       │          │    │          │  │
│   │ Runtime Console  │       │          │    │          │  │
│   └────────┬─────────┘       └────┬─────┘    └────┬─────┘  │
│            │                      │                │        │
├────────────┴──────────────────────┴────────────────┴────────┤
│                          nimi-sdk                            │
│     @nimiplatform/sdk/realm  +  @nimiplatform/sdk/runtime                    │
├────────────────────────────┬────────────────────────────────┤
│      nimi-realm (cloud)    │      nimi-runtime (local)       │
│                            │                                │
│  Identity / Social / Chat  │  AI Inference (all modalities) │
│  Economy / Worlds          │  Model Management / MCP        │
│  Agents / Memory           │  Audit / Knowledge / GPU       │
│                            │  App Auth / App Messaging      │
│   REST + WebSocket         │         gRPC                   │
└────────────────────────────┴────────────────────────────────┘
```

## Core Components

## SSOT Contracts

Public architecture contracts are maintained in:

- [`../../ssot/README.md`](../../ssot/README.md) (source of truth)
- [SSOT Map](./ssot.md) (docs navigation view)

### nimi-runtime — Local AI Runtime Service

An independent local daemon providing AI compute and infrastructure. Written in Go, communicates via gRPC.

**What it does:**
- AI inference across all modalities (text, image, video, TTS, STT, embedding)
- Dual-source routing: `local-runtime` (on-device models) and `token-api` (cloud providers)
- Model lifecycle management (pull, load, health check, remove)
- Workflow DAG engine for multi-model pipelines
- GPU arbitration for concurrent inference requests
- Local knowledge base with vector indexing
- App authorization gateway (ExternalPrincipal token lifecycle)
- Per-app usage auditing

**Execution stack (V1):**
- Local models: LocalAI + Nexa
- Cloud providers: NimiLLM + custom adapters (Alibaba, Bytedance, etc.)
- Schema toolchain: Buf CLI

**Lifecycle:** Auto-starts on first app connection, graceful shutdown when idle. Similar to Ollama / Docker Daemon.

### nimi-realm — Cloud Persistent World (Closed Source)

The cloud service cluster managing all shared persistent state: identity, social graph, economy, worlds, agents, and memory.

- **Communication:** REST + WebSocket (real-time push)
- **Stack:** NestJS + Prisma + PostgreSQL + Redis + OpenSearch
- **Key trait:** Shared source of truth — identity, social relationships, economic ledger, and world/agent definitions must be consistent across devices and apps

### nimi-sdk — Developer Interface

The only supported entry point for developers building on Nimi.

```
@nimiplatform/sdk
├── realm/          → nimi-realm (REST + WebSocket)
├── runtime/        → nimi-runtime (gRPC)
│   ├── ai.*        Single-model inference (Vercel AI SDK v6)
│   ├── workflow.*   DAG orchestration
│   ├── model.*      Model management
│   ├── knowledge.*  Local knowledge base
│   ├── app-auth.*   ExternalPrincipal authorization
│   └── audit.*      Local audit log
├── types/          → Shared type definitions
└── scope/          → Scope catalog (list/register/publish)
```

**Key design decisions:**
- Apps can use runtime-only (local AI tools) or realm-only (pure web app) or both
- SDK wraps both realm and runtime behind a unified client
- AI provider follows Vercel AI SDK v6 custom provider pattern

### desktop — First-Party Application

The flagship Nimi app. Architecturally it is a regular nimi-app with no special privileges — it uses the same SDK as third-party apps.

**Unique features:**
- **nimi-hook:** Mod host system providing sandboxed APIs to mods
- **Core UI:** World, Agent, Social, Economy management
- **Runtime Console:** Runtime health, model status, usage analytics, diagnostics
- **Mod ecosystem:** 8-stage governance chain (discovery → manifest → signature → dependency → sandbox → load → lifecycle → audit)

### nimi-mods — Desktop Mini-Programs

Lightweight extensions running inside desktop's sandbox. Access platform capabilities through nimi-hook, which internally calls nimi-sdk.

Local development contract (no-legacy):

1. Mods source root is external and must be set by `NIMI_MODS_ROOT` (absolute path).
2. Runtime discovery root is `NIMI_RUNTIME_MODS_DIR` and must be set explicitly in dev.
3. In local joint-debug, `NIMI_RUNTIME_MODS_DIR` should equal `NIMI_MODS_ROOT`.
4. Desktop uses no implicit fallback or path guessing for mod discovery.

## Communication Map

```
nimi-mods ↔ desktop       : in-process nimi-hook (zero latency)
desktop → nimi-realm      : @nimiplatform/sdk/realm (REST + WS)
desktop → nimi-runtime    : @nimiplatform/sdk/runtime (gRPC)
nimi-apps → nimi-realm         : @nimiplatform/sdk/realm (REST + WS)
nimi-apps → nimi-runtime       : @nimiplatform/sdk/runtime (gRPC)
nimi-apps ↔ nimi-apps          : gRPC via runtime app.message
nimi-runtime → local models    : subprocess / gRPC over UDS
nimi-runtime → cloud providers : HTTPS
```

## Realm and Runtime Relationship

```
     nimi-realm (cloud)              nimi-runtime (local)
     ┌──────────┐                   ┌──────────┐
     │ Shared   │                   │ Local    │
     │ State    │                   │ Compute  │
     └────┬─────┘                   └────┬─────┘
          │                              │
          │  Independent, bridged by SDK │
          │                              │
          └──────────┬───────────────────┘
                     │
                  nimi-sdk
```

- **Parallel, independent** — neither depends on the other
- An app can use realm-only (pure web, no local AI)
- An app can use runtime-only (local AI tool, no cloud)
- Full experience uses both

## Platform Protocol

The platform defines a three-layer protocol:

| Layer | Scope | Content |
|-------|-------|---------|
| L0 Core Envelope | Universal | `protocolVersion`, `participantId`, `traceId`, `idempotencyKey`, error semantics |
| L1 Runtime Access | Runtime | AI inference, model management, workflow, app authorization |
| L2 Realm Core Profile | Realm | Six Social Engine primitives |

### Six Primitives (Social Engine)

Nimi's "World Engine" is a social engine, not a physics engine:

| Primitive | Purpose |
|-----------|---------|
| **Timeflow** | World-specific time rules (tick rate, drift, catch-up) |
| **Social** | Relationship graph, follow, friend, block |
| **Economy** | Assets, transactions, revenue sharing |
| **Transit** | Cross-world migration with state preservation |
| **Context** | Active AI context scope, injection priority, handoff |
| **Presence** | User/device liveness, heartbeat, visibility |

## Audit Model

| Layer | Scope | Storage |
|-------|-------|---------|
| Runtime (local) | AI calls, model ops, app messaging, auth token chain | Local file / SQLite |
| Realm (cloud) | Business ops (transactions, social, world changes), compliance | PostgreSQL |

Both layers operate independently. Local audit can optionally report to realm for cross-device aggregation.

## License Boundaries

| Component | License |
|-----------|---------|
| runtime, sdk, proto | Apache-2.0 |
| desktop, nimi-mods, web | MIT |
| docs, protocol | CC-BY-4.0 |
| realm (closed source) | Proprietary |
