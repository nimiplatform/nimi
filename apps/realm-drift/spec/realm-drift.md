# Realm Drift — Top-Level Product Spec

> Status: Draft | Date: 2026-03-13

## Product Positioning

Realm Drift is a standalone Tauri desktop demo application that brings nimi worlds to life as explorable 3D environments. It provides:

- **World Discovery** — Browse available nimi worlds in a visual grid with metadata (genre, era, themes, agent count)
- **AI-Powered 3D Generation** — Transform nimi world data (descriptions, scenes, worldview, visual assets) into navigable 3D environments via the World Labs Marble API
- **Immersive Exploration** — Explore generated 3D worlds through an embedded interactive viewer (Gaussian Splat rendering)
- **In-World Agent Conversation** — Chat with world-resident agents in a side panel while exploring the 3D environment, using the nimi Runtime SDK for streaming AI responses
- **Cross-App Human Chat** — Chat with friends across nimi apps (Desktop, Relay) in real-time via Socket.IO, demonstrating the platform's multi-app interoperability
- **World Data Fusion** — Intelligently compose rich 3D generation prompts from nimi's structured world data (worldview physics, scene descriptions, lorebook entries, visual assets)
- **Demo Showcase** — Lightweight, focused app demonstrating the nimi platform's world data richness and SDK integration capabilities

## Technical Stack

| Layer | Technology |
|-------|-----------|
| Desktop shell | Tauri 2.10 |
| Frontend | React 19 + Vite 7 + Tailwind 4 |
| State management | Zustand |
| Data fetching | TanStack Query |
| SDK | `@nimiplatform/sdk/runtime` + `@nimiplatform/sdk/realm` |
| Shell core | `@nimiplatform/shell-core` |
| Realtime transport | Socket.IO (Realm realtime endpoint) |
| 3D Generation | World Labs Marble API (external) |
| 3D Rendering | Marble Web Viewer (iframe embed) |

Realm Drift connects to both platform planes directly:
- **Runtime** — `new Runtime({ transport: 'tauri-ipc' })` via `initializePlatformClient()`
- **Realm** — `new Realm({ baseUrl, auth })` via `initializePlatformClient()`

The Tauri shell supplies runtime defaults and lifecycle affordances only.

## External Dependencies

| Dependency | Provider | Type | Purpose |
|-----------|----------|------|---------|
| Marble API | World Labs | REST API | 3D world generation from text/image/video |
| Marble Viewer | World Labs | Web page (iframe) | Interactive 3D exploration |

API details enumerated in `kernel/tables/external-api-surface.yaml`.

## Project Location

```
nimi/apps/realm-drift/
├── src-tauri/                    # Rust Tauri shell (copied from forge)
│   ├── src/
│   │   ├── main.rs
│   │   ├── defaults.rs
│   │   ├── desktop_paths.rs
│   │   └── runtime_bridge/      # gRPC bridge for Runtime SDK
│   ├── tauri.conf.json
│   └── Cargo.toml
├── src/
│   ├── shell/
│   │   └── renderer/            # Vite root
│   │       ├── index.html
│   │       ├── main.tsx
│   │       ├── App.tsx
│   │       ├── app-shell/       # Providers, store, routes, layout
│   │       ├── features/        # world-browser, world-viewer, agent-chat
│   │       ├── infra/           # Bootstrap, query client
│   │       ├── bridge/          # Tauri IPC bridge (copied from forge)
│   │       └── i18n/            # Minimal i18n
│   └── runtime/                 # Platform client adapter
├── spec/                        # This spec tree
├── vite.config.ts
├── tsconfig.json
└── package.json
```

## Workspace Integration

- Package name: `@nimiplatform/realm-drift`
- Workspace: `nimi/` pnpm workspace, pattern `apps/*` auto-discovers
- Dev server port: `1424` (desktop uses `1420`, forge uses `1422`)
- Tauri identifier: `app.nimi.realm-drift`

## Relationship to Other Apps

| Aspect | Desktop App | Forge | Realm Drift |
|--------|------------|-------|-------------|
| Identifier | `app.nimi.desktop` | `app.nimi.forge` | `app.nimi.realm-drift` |
| Dev port | 1420 | 1422 | 1424 |
| Mod system | Full mod runtime | None | None |
| Runtime access | Mixed shell bridge + SDK | SDK direct | SDK direct |
| Realm access | SDK direct | SDK direct | SDK direct |
| Target user | End users (consumers) | Creators (publishers) | Demo audience (explorers) |
| External API | None | None | World Labs Marble API |
| Local AI runtime | Full | Creator subset | Chat streaming only |
| World engine | Yes (via mods) | Yes (via @world-engine alias) | No |
| Creator gate | No | Yes | No |
| Navigation | Multi-feature sidebar | Multi-feature sidebar | Minimal (2 routes) |

## Code Reuse Strategy

Realm Drift copies the forge app shell pattern without the world engine:

```typescript
// vite.config.ts resolve.alias
'@renderer': './src/shell/renderer',
'@runtime': './src/runtime',
'@nimiplatform/sdk': '../../sdk/src',
'@nimiplatform/shell-core': '../_libs/shell-core/src',
// No @world-engine alias — Realm Drift does not use the world creation engine
```

Copied from forge (adapted):
- `src-tauri/` — Entire Rust shell including runtime_bridge
- `src/shell/renderer/bridge/` — Tauri IPC bridge helpers
- `src/runtime/platform-client.ts` — SDK initialization (appId changed)
- Bootstrap sequence — Simplified from forge's 7-step to 5-step

## Navigation Structure

All routes defined in `kernel/tables/routes.yaml` (authoritative source). Two routes: `/` (world browser) and `/world/:worldId` (split-pane viewer with 3D + tabbed chat).

## Normative Imports

This spec imports the following kernel contracts:

| Contract | Rule prefix | Scope |
|----------|-------------|-------|
| `kernel/app-shell-contract.md` | RD-SHELL-* | Tauri config, bootstrap, auth, layout, store |
| `kernel/world-exploration-contract.md` | RD-EXPLORE-* | World browser, viewer, 3D embedding, state machine |
| `kernel/marble-integration-contract.md` | RD-MARBLE-* | Marble API client, prompt composition, polling, costs |
| `kernel/agent-chat-contract.md` | RD-CHAT-* | Agent discovery, chat streaming, session semantics |
| `kernel/human-chat-contract.md` | RD-HCHAT-* | Cross-app human chat, Socket.IO realtime, friend list |

## Functional Module Summary

All features with phasing, priority, dependencies, and migration sources are enumerated in `kernel/tables/feature-matrix.yaml` (authoritative source).

Key characteristic: **no new backend work** — Realm Drift consumes existing nimi Realm API and Runtime services. The only external dependency is the World Labs Marble API.

## Environment Variables

| Variable | Required | Purpose | Example |
|----------|----------|---------|---------|
| `NIMI_REALM_URL` | Yes | Realm API base URL | `https://api.nimi.app` |
| `NIMI_ACCESS_TOKEN` | Yes | JWT for Realm/Runtime auth | `eyJ...` |
| `VITE_MARBLE_API_KEY` | Yes | World Labs Marble API key | `wlt_...` |
| `VITE_MARBLE_API_URL` | No | Marble API base URL override | `https://api.worldlabs.ai/marble/v1` |
| `VITE_MARBLE_QUALITY` | No | Default generation quality | `mini` or `standard` (default: `mini`) |
