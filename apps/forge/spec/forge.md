# Forge — Top-Level Product Spec

> Status: Draft | Date: 2026-03-19

## Product Positioning

Forge is a standalone Tauri desktop application for World and Agent creators in the nimi ecosystem.

Its primary product is the world-centric creation workflow:
- **World Workbench** — A local workspace that unifies create, maintain, import, review, and publish
- **World Management** — Full CREATE + MAINTAIN pipeline migrated from World-Studio and embedded into the workbench
- **Agent Management** — Master-created agents as reusable library assets and world-owned agents managed inside the workbench
- **Import Pipelines** — Character Card V2 and novel import with local source-fidelity manifests and workspace-scoped review drafts

Forge also retains secondary creator utilities:
- **AI Content Creation** — Image generation, video upload, music generation, content library
- **Publishing Workflow** — App-level post composition, publish identity selection, and publish history

Revenue, advisors, copyright, templates, and analytics are non-core modules and do not define current Forge completion.

## Technical Stack

| Layer | Technology |
|-------|-----------|
| Desktop shell | Tauri 2.10 |
| Frontend | React 19 + Vite 7 + Tailwind 4 |
| State management | Zustand |
| Data fetching | TanStack Query |
| SDK | `@nimiplatform/sdk/runtime` + `@nimiplatform/sdk/realm` |
| World engine | `@world-engine` alias → `nimi-mods/runtime/world-studio/src/` |
| Shell core | `@nimiplatform/nimi-kit/core` |

Forge connects to both platform planes through the SDK root bootstrap:
- **Platform client** — `createPlatformClient({ appId: 'nimi.forge', runtimeTransport: 'tauri-ipc', sessionStore })`
- **Runtime / Realm** — consumed from the returned SDK client instead of app-local constructors

The Tauri shell only supplies runtime defaults and lifecycle affordances. Business requests do not call ad-hoc desktop bridge helpers directly.

## Project Location

```
nimi/apps/forge/
├── src-tauri/                    # Rust Tauri shell
│   ├── src/
│   │   └── main.rs
│   ├── tauri.conf.json
│   └── Cargo.toml
├── src/
│   ├── shell/
│   │   └── renderer/            # Vite root
│   │       ├── index.html
│   │       ├── main.tsx
│   │       ├── app-shell/       # Layout, providers, navigation
│   │       ├── infra/           # Bootstrap, query client, telemetry
│   │       └── pages/           # Feature page components
│   └── runtime/                 # Runtime adapter (platform-client, data-sync)
├── spec/                        # This spec tree
├── vite.config.ts
├── tailwind.config.ts
├── tsconfig.json
└── package.json
```

## Workspace Integration

- Package name: `@nimiplatform/forge`
- Workspace: `nimi/` pnpm workspace, pattern `apps/*` auto-discovers
- Dev server port: `1422` (desktop uses `1420`)
- Tauri identifier: `app.nimi.forge`

## Relationship to Desktop App

Forge is a **separate Tauri application**, not a tab/mod within the desktop app. Key differences:

| Aspect | Desktop App | Forge |
|--------|------------|----------------|
| Identifier | `app.nimi.desktop` | `app.nimi.forge` |
| Dev port | 1420 | 1422 |
| Mod system | Full mod runtime (register, lifecycle) | None — features are native pages |
| External agent gateway | Yes | No |
| Runtime access model | Mixed shell bridge + SDK | SDK direct (`Runtime` over `tauri-ipc`) |
| Realm access model | SDK direct | SDK direct |
| Local AI runtime | Yes (full) | Yes (creator subset — text.stream, image.generate, music.generate) |
| Target user | End users (consumers) | Creators (publishers) |

## World-Studio Reuse Strategy

Instead of copying World-Studio code, Forge references it via Vite alias:

```typescript
// vite.config.ts resolve.alias
'@world-engine': path.resolve(__dirname, '../../nimi-mods/runtime/world-studio/src/')
```

This provides direct access to:
- `@world-engine/engine/*` — Extraction, quality gate, synthesis
- `@world-engine/services/*` — Agent DNA, event graph, temporal order
- `@world-engine/generation/*` — Phase1/Phase2 pipeline adapters
- `@world-engine/contracts/*` — Type definitions, constants, capabilities

The **data layer** is rewritten: World-Studio uses `hookClient.data.query()` (mod runtime); Forge calls SDK realm client directly.

The **UI layer** is selectively migrated: panel components are imported but wrapped in Forge's layout system.

## Navigation Structure

```
Forge
├── Workbench (home)                # FG-WORLD-* + FG-AGENT-* + FG-IMPORT-*
│   ├── /                           # Primary entry
│   ├── /workbench                  # Recent workspaces, create, resume, import
│   ├── /workbench/new              # Create a new local world workspace
│   ├── /workbench/:workspaceId     # Unified world workspace
│   ├── /workbench/:workspaceId/import/character-card
│   ├── /workbench/:workspaceId/import/novel
│   └── /workbench/:workspaceId/agents/:agentId
├── World Library                   # FG-WORLD-*
│   └── /worlds/library             # Published worlds and drafts → open in workbench
├── Agent Library                   # FG-AGENT-*
│   ├── /agents/library             # Master library and world-owned entrypoints
│   └── /agents/:agentId            # Master agent detail + DNA editor
├── Secondary Utilities
│   ├── Content                     # FG-CONTENT-*
│   ├── /content/images             # Image studio
│   ├── /content/videos             # Video studio
│   ├── /content/music              # Music studio
│   └── /content/library            # Content library
│   └── Publish                     # FG-CONTENT-*
│   ├── /publish/releases           # App-level publish workspace
│   └── /publish/channels           # Publish identities and destinations
├── Deferred / Non-Core Modules
│   ├── /revenue                    # Revenue dashboard
│   └── /revenue/withdrawals        # Withdrawal management
│   └── /advisors                   # Advisor sessions
│   ├── /copyright                  # Future copyright module
│   ├── /templates                  # Future template marketplace
│   ├── /templates/mine             # Future template publishing
│   └── /analytics                  # Future analytics dashboard
└── Settings
    └── /settings                   # App preferences
```

## Normative Imports

This spec imports the following kernel contracts:

| Contract | Rule prefix | Scope |
|----------|-------------|-------|
| `kernel/app-shell-contract.md` | FG-SHELL-* | App shell, bootstrap, auth, layout |
| `kernel/world-migration-contract.md` | FG-WORLD-* | World CRUD, pipeline migration |
| `kernel/agent-management-contract.md` | FG-AGENT-* | Agent CRUD, DNA editing |
| `kernel/import-contract.md` | FG-IMPORT-* | Character Card V2 / novel import, source fidelity, publish safety |
| `kernel/content-creation-contract.md` | FG-CONTENT-* | Secondary image/video/music creation, content library, publishing |
| `kernel/copyright-contract.md` | FG-IP-* | Deferred copyright extension |
| `kernel/revenue-contract.md` | FG-REV-* | Revenue dashboard, withdrawals |
| `kernel/template-market-contract.md` | FG-TPL-* | Deferred template extension |
| `kernel/ai-advisor-contract.md` | FG-ADV-* | AI advisor sessions |
| `kernel/analytics-contract.md` | FG-ANA-* | Deferred analytics extension |

## Functional Module Summary

| Module | New backend required | Migration source | Phase |
|--------|---------------------|------------------|-------|
| App Shell | No | Desktop app (trimmed) | 1 |
| World Workbench | No | New workflow shell over world-studio + forge state | 1-3 |
| World Management | No | World-Studio mod | 2 |
| Agent Management | Partial — existing Creator API plus detail/update/delete completion if absent | Creator API + realm agent ownership vocabulary | 3 |
| Import Pipelines | No | New UI + local runtime + existing world/agent truth APIs | 3.5 |
| Content Creation + Publishing | Partial — existing Media API plus NEW audio upload extension | New UI + runtime media/music + existing post primitives | Secondary |
| Revenue Statistics | No | Economy API (existing) | Non-core |
| Copyright Management | Deferred extension | Future design | Deferred |
| Template Marketplace | Deferred extension | Future design | Deferred |
| AI Advisors | No | Runtime AI (local) | Non-core |
| Data Analytics | Deferred extension | Future design | Deferred |
