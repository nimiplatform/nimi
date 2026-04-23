# Forge — Top-Level Product Spec

> Status: Draft | Date: 2026-04-23

## Product Positioning

Forge is a standalone Tauri desktop application for World and Agent creators in the nimi ecosystem.

Forge owns three connected product layers for creator work:
- **Catalog** — Stable creator inspection of worlds, agents, and current multimodal deliverable state
- **Ops** — World and agent multimodal deliverable generation, review, confirmation, and binding
- **Workbench** — Local draft authoring for create, maintain, import, review, and package publish

Current hard-cut product boundary:
- **World Management** — Full CREATE + MAINTAIN pipeline migrated from World-Studio and embedded into the workbench
- **Agent Management** — Master-created agents as reusable library assets plus world-owned agents carried across catalog, workbench, and ops surfaces
- **Import Pipelines** — Character Card V2 and novel import with local source-fidelity manifests and workspace-scoped review drafts
- **Creator Consume-Ops Topology** — Catalog, detail, roster, and asset surfaces for world and agent multimodal deliverables without treating workbench redirects or generic content utilities as hidden authority

Shared creator utilities remain supporting workflows, not parallel truth:
- **AI Content Creation** — Image generation, video upload, music generation, content library
- **Publishing Workflow** — App-level post composition, publish identity selection, and publish history

Workbench remains the authoring route. Catalog and ops remain first-class inspection and multimodal deliverable surfaces rather than redirect veneers or content-library side effects.

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

Current posture:

- `world-studio` 仍是 active migration source，不应被误写成已完成替代
- `nimi-mods/spec/**` 仍是当前 `world-studio` 与 shared chain 的 mods-local
  authority surface
- Forge 已迁入部分原 World-Studio workflow，并在 standalone app host model 下继续扩展
- Forge 是逐步替代 `world-studio` 的 admitted direction，但 replacement 仍未完成
- World-Studio 的长期 replacement direction 属于演进方向，不是本文件可直接宣告的 completed state

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
├── World Catalog + Ops             # FG-WORLD-* + FG-CONTENT-*
│   ├── /worlds/library             # Creator world catalog
│   ├── /worlds/:worldId            # Stable world detail + deliverable completeness
│   ├── /worlds/:worldId/agents     # World-owned agent roster
│   ├── /worlds/:worldId/assets     # World deliverable ops hub
│   └── /worlds/:worldId/assets/:family
├── Agent Catalog + Ops             # FG-AGENT-* + FG-CONTENT-*
│   ├── /agents/library             # Master catalog + world-context entrypoints
│   ├── /agents/:agentId            # Stable master detail
│   ├── /agents/:agentId/assets     # Agent deliverable ops hub
│   └── /agents/:agentId/assets/:family
├── Shared Creator Utilities        # FG-CONTENT-*
│   ├── /content/images             # Image studio
│   ├── /content/videos             # Video studio
│   ├── /content/music              # Music studio
│   ├── /content/library            # Content library
│   ├── /publish/releases           # App-level publish workspace
│   └── /publish/channels           # Publish identities and destinations
├── Deferred / Non-Core Modules
│   ├── /revenue                    # Revenue dashboard
│   ├── /revenue/withdrawals        # Withdrawal management
│   ├── /advisors                   # Advisor sessions
│   ├── /copyright                  # Future copyright module
│   ├── /templates                  # Future template marketplace
│   ├── /templates/mine             # Future template publishing
│   ├── /templates/:templateId      # Future template detail
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
| `kernel/content-creation-contract.md` | FG-CONTENT-* | World and agent multimodal deliverable ops, shared media creation, content library, publishing |
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
| Creator Catalog | No | New consume surfaces over existing world/agent/resource truth | 4 |
| Multimodal Deliverable Ops | No | New world and agent ops surfaces over existing world/agent/resource and binding truth | 4 |
| Content Creation + Publishing | No new backend in the current authority cut; existing media/resource/post surfaces only | New UI + runtime media/music + existing post primitives | Secondary |
| Revenue Statistics | No | Economy API (existing) | Non-core |
| Copyright Management | Deferred extension | Future design | Deferred |
| Template Marketplace | Deferred extension | Future design | Deferred |
| AI Advisors | No | Runtime AI (local) | Non-core |
| Data Analytics | Deferred extension | Future design | Deferred |
