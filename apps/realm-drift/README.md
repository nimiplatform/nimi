# Nimi Realm Drift

World exploration and agent chat with 3D marble visualization.

## Overview

Realm Drift is a Tauri desktop application for exploring worlds and interacting with agents. It features a 3D marble visualization rendered via external iframe, human chat via Socket.IO, and typed Realm service integration.

## Tech Stack

- Tauri 2 + React 19 + Vite 7
- Tailwind 4 + Zustand 5 + TanStack Query 5
- Socket.IO (realtime human chat)

## Architecture

```text
src/shell/renderer/
├── app-shell/    # App shell and routing
├── bridge/       # Tauri ↔ renderer bridge
├── features/     # Feature modules (world exploration, agent chat)
├── hooks/        # Shared hooks
├── i18n/         # Internationalization
└── locales/      # Translation files
```

Uses typed Realm services for world and agent data. Human chat via Socket.IO. Marble 3D rendered via external iframe.

## Development

```bash
pnpm -C apps/realm-drift run dev:shell
```

## Scripts

| Command | Description |
|---|---|
| `dev:renderer` | Frontend-only dev |
| `dev:shell` | Full Tauri dev |
| `build` | Production build |
| `typecheck` | TypeScript check |
| `lint` | ESLint |
| `test` | Run tests |
