# Desktop Context

> Quick context for AI agents working on `nimi/apps/desktop`.

## What Is This

Tauri 2 desktop app (Rust backend + React 19 frontend). First-party Nimi app with mod hosting. Uses the same SDK as third-party apps — no special privileges.

## File Map

```
apps/desktop/
├── src/shell/renderer/        React UI
│   ├── app-shell/             Layout, routing, topbar
│   ├── features/              Feature modules
│   │   ├── auth/              Login
│   │   ├── chats/             Chat interface
│   │   ├── contacts/          Contact list
│   │   ├── economy/           Gifts, assets
│   │   ├── explore/           Discovery feed
│   │   ├── home/              Home feed
│   │   ├── agent-detail/      Agent profiles
│   │   ├── world-detail/      World details
│   │   ├── profile/           User profile
│   │   ├── settings/          App settings
│   │   ├── runtime-config/    Runtime provider settings
│   │   ├── marketplace/       App/mod store
│   │   ├── mod-workspace/     Mod panels
│   │   ├── turns/             Conversation turns
│   │   └── notification/      Notifications
│   ├── components/            Shared UI components
│   ├── hooks/                 React hooks
│   ├── stores/                Zustand stores
│   ├── services/              API service layer
│   └── utils/                 Utilities
├── src/runtime/               Runtime integration
├── src/mods/                  Mod system (hook, sandbox, governance)
├── src-tauri/                 Tauri Rust backend
│   ├── src/                   Rust source
│   ├── capabilities/          Permission declarations
│   └── resources/             Default mod manifests
└── scripts/                   Build scripts
```

## Tech Stack

- Tauri 2.1, React 19, React Router 7, Tailwind 4
- Zustand 5 (state), TanStack Query 5 (server state)
- Zod 4 (validation), Socket.IO (real-time)
- i18next (i18n, Chinese primary)

## Path Aliases

- `@renderer/*` → `src/shell/renderer/*`
- `@runtime/*` → `src/runtime/*`
- `@types/*` → `src/types/*`

## Common Tasks

| Task | Command |
|------|---------|
| Dev (renderer only) | `pnpm dev:renderer` |
| Dev (full Tauri) | `pnpm dev:shell` |
| Build | `pnpm build` |

## Rules

- All platform access through `@nimiplatform/sdk` (never direct HTTP/gRPC)
- Mods access platform through nimi-hook (never SDK directly)
- Features are self-contained modules under `features/`
- Shared components in `components/`, not duplicated
- No `console.log` — structured logging

## nimi-hook Subsystems

| Subsystem | Purpose |
|-----------|---------|
| event-bus | Pub/sub events |
| data-api | Data registration and query |
| ui-extension | UI slot registration |
| turn-hook | Conversation pipeline intercept |
| inter-mod | Cross-mod messaging |
