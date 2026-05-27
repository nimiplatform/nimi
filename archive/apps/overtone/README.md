# Nimi Overtone

Music creation and collaboration app.

## Overview

Overtone is a Tauri desktop application for music production with a brief/lyrics/takes/compare/publish workflow. It uses Web Audio API for audio processing and the Nimi runtime for AI-assisted generation.

## Tech Stack

- Tauri 2 + React 19 + Vite 7
- Tailwind 4 + Zustand 5 + TanStack Query 5
- Web Audio API

## Architecture

```text
src/shell/renderer/
├── app-shell/    # App shell and routing
├── bridge/       # Tauri ↔ renderer bridge
├── features/     # Feature modules (brief, lyrics, takes, compare, publish)
├── hooks/        # Shared hooks
└── i18n/         # Internationalization
```

Renderer owns product logic. Rust side is minimal (transport/daemon only). No Overtone-specific backend — uses SDK `runtime` and `realm` directly. Uses HashRouter.

## Development

```bash
pnpm -C apps/overtone run dev:shell
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
