# Nimi Relay

Electron AI chat client with beat-first turn pipeline.

## Overview

Relay is a standalone Electron chat application that provides multi-session AI conversation management with Live2D avatar support, media decision policy, and model routing.

## Tech Stack

- Electron 36 + React 19
- Tailwind 4 + Zustand 5 + TanStack Query 5
- Socket.IO (realtime)
- Pixi.js (Live2D rendering)
- i18next (internationalization)

## Architecture

```text
src/
├── main/         # Electron main process: chat pipeline, session store, prompt compilation
├── preload/      # Electron preload scripts
├── renderer/     # React UI (thin consumer via IPC)
└── shared/       # Shared types and utilities
```

Main process owns the chat pipeline, session store, prompt compilation, media decision policy, and model routing. Renderer is a thin consumer via IPC.

## Development

```bash
pnpm -C apps/relay run dev
```

## Scripts

| Command | Description |
|---|---|
| `dev` | Start development mode |
| `dev:electron` | Start Electron dev |
| `build` | Production build |
| `test` | Run all tests |
| `test:transport` | Transport layer tests |
| `test:unit` | Unit tests |
| `test:interop` | Interop tests |

## Spec

Rule namespace: `RL-*`. Spec-driven via `spec/kernel/*.md`.
