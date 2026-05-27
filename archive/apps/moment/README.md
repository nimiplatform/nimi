# Nimi Moment

Story-opening front door for Nimi.

## Overview

Moment is a Tauri desktop application for turning one image or one phrase into
one story-opening threshold, a short continuation session, and an app-local
saved shelf.

Moment owns app-local threshold, session, and library behavior. It does not
promote output into Realm canonical truth, world state, world history, or shared
social data unless a later explicit downstream write contract is added.

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

Standard Tauri + React pattern with SDK runtime and Realm boundary integration.

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
