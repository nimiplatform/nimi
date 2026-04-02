# Nimi Moment

Social moment capture and sharing app.

## Overview

Moment is a Tauri desktop application for capturing and sharing social moments within the Nimi platform.

## Tech Stack

- Tauri 2 + React 19 + Vite 7
- Tailwind 4 + Testing Library + Vitest

## Architecture

```text
src/shell/renderer/
├── app-shell/    # App shell and routing
├── bridge/       # Tauri ↔ renderer bridge
├── features/     # Feature modules
├── hooks/        # Shared hooks
└── i18n/         # Internationalization
```

Standard Tauri + React pattern with SDK runtime and realm integration.

## Development

```bash
pnpm -C apps/moment run dev:shell
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
