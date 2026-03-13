# Forge — Top-Level Product Spec

> Status: Draft | Date: 2026-03-13

## Product Positioning

Forge is a standalone Tauri desktop application for World and Agent creators in the nimi ecosystem. It provides:

- **World Management** — Full CREATE + MAINTAIN pipeline migrated from World-Studio mod
- **Agent Management** — World-local agents and master-created agents with CRUD, DNA editing, personality preview
- **AI Content Creation** — Image generation, video upload, music generation, content library
- **Publishing Workflow** — App-level post composition, publish identity selection, and publish history
- **Revenue Statistics** — Earnings dashboard, revenue share, Stripe Connect, withdrawals
- **AI Advisors** — World consistency checker, agent coach, revenue optimizer
- **Deferred Extensions** — Copyright, templates, and analytics remain future modules

## Technical Stack

| Layer | Technology |
|-------|-----------|
| Desktop shell | Tauri 2.10 |
| Frontend | React 19 + Vite 7 + Tailwind 4 |
| State management | Zustand |
| Data fetching | TanStack Query |
| SDK | `@nimiplatform/sdk/runtime` + `@nimiplatform/sdk/realm` |
| World engine | `@world-engine` alias → `nimi-mods/runtime/world-studio/src/` |
| Shell core | `@nimiplatform/shell-core` |

Forge connects to both platform planes directly:
- **Runtime** — `new Runtime({ transport: 'tauri-ipc' })` via `initializePlatformClient()`
- **Realm** — `new Realm({ baseUrl, auth })` via `initializePlatformClient()`

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
├── Dashboard (home)
├── Worlds                          # FG-WORLD-*
│   ├── /worlds                     # World list
│   ├── /worlds/create              # CREATE pipeline
│   └── /worlds/:worldId/maintain   # MAINTAIN pipeline
├── Agents                          # FG-AGENT-*
│   ├── /agents                     # Agent list
│   └── /agents/:agentId            # Agent detail + DNA editor
├── Content                         # FG-CONTENT-*
│   ├── /content/images             # Image studio
│   ├── /content/videos             # Video studio
│   ├── /content/music              # Music studio
│   └── /content/library            # Content library
├── Publish                         # FG-CONTENT-*
│   ├── /publish/releases           # App-level publish workspace
│   └── /publish/channels           # Publish identities and destinations
├── Revenue                         # FG-REV-*
│   ├── /revenue                    # Revenue dashboard
│   └── /revenue/withdrawals        # Withdrawal management
├── AI Advisors                     # FG-ADV-*
│   └── /advisors                   # Advisor sessions
├── Deferred Extensions             # Placeholder routes only
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
| `kernel/content-creation-contract.md` | FG-CONTENT-* | Image/video/music creation, content library, publishing |
| `kernel/copyright-contract.md` | FG-IP-* | Deferred copyright extension |
| `kernel/revenue-contract.md` | FG-REV-* | Revenue dashboard, withdrawals |
| `kernel/template-market-contract.md` | FG-TPL-* | Deferred template extension |
| `kernel/ai-advisor-contract.md` | FG-ADV-* | AI advisor sessions |
| `kernel/analytics-contract.md` | FG-ANA-* | Deferred analytics extension |

## Functional Module Summary

| Module | New backend required | Migration source | Phase |
|--------|---------------------|------------------|-------|
| App Shell | No | Desktop app (trimmed) | 1 |
| World Management | No | World-Studio mod | 2 |
| Agent Management | Partial — existing Creator API plus detail/update/delete completion if absent | Creator API + realm agent ownership vocabulary | 3 |
| Content Creation + Publishing | Partial — existing Media API plus NEW audio upload extension | New UI + runtime media/music + existing post primitives | 4 |
| Revenue Statistics | No | Economy API (existing) | 5 |
| Copyright Management | Deferred extension | Future design | 5 |
| Template Marketplace | Deferred extension | Future design | 6 |
| AI Advisors | No | Runtime AI (local) | 6 |
| Data Analytics | Deferred extension | Future design | 6 |
