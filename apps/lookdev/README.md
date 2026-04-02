# Nimi Lookdev

Visual design and look development tool.

## Overview

Lookdev is a Tauri desktop application for visual design exploration and look development within the Nimi platform. It provides design state management and data-driven workflows.

## Tech Stack

- Tauri 2 + React 19 + Vite 7
- Tailwind 4 + TanStack Query 5
- Testing Library + Vitest

## Architecture

```text
src/shell/renderer/
├── app-shell/    # App shell and routing
├── bridge/       # Tauri ↔ renderer bridge
├── data/         # Design data layer
├── features/     # Feature modules
├── hooks/        # Shared hooks
└── i18n/         # Internationalization
```

Comprehensive bridge and data layer for design state management.

## Development

```bash
pnpm -C apps/lookdev run dev:shell
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
