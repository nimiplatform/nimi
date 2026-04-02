# Nimi Forge

Creator studio for world, agent, and content management.

## Overview

Forge is a Tauri desktop application for creating, publishing, and managing worlds and agents on the Nimi platform. It includes content editing, analytics, and publishing workflows.

## Tech Stack

- Tauri 2 + React 19 + Vite 7
- Tailwind 4 + TypeScript
- Testing Library + Vitest

## Architecture

```text
src/shell/renderer/
├── app-shell/    # App shell and routing
├── bridge/       # Tauri ↔ renderer bridge
├── data/         # Data layer
├── features/     # Feature modules
├── hooks/        # Shared hooks
├── i18n/         # Internationalization
├── pages/        # Page components
└── state/        # State management
```

All runtime access via `@nimiplatform/sdk/runtime`, realm via `@nimiplatform/sdk/realm`. Rust side owns only transport and daemon lifecycle. OAuth via kit and shared-tauri `oauth_commands`.

## Development

```bash
pnpm -C apps/forge run dev:shell
```

## Scripts

| Command | Description |
|---|---|
| `dev:renderer` | Frontend-only dev |
| `dev:shell` | Full Tauri dev |
| `build:renderer` | Build renderer |
| `build` | Full production build |
| `typecheck` | TypeScript check |
| `lint` | ESLint |
| `test` | Run tests |
