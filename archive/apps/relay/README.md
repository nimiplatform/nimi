# Nimi Relay

Archived Electron AI chat client with beat-first turn pipeline.

## Archive Status

This app is archived. Active chat functionality has been consolidated into `apps/desktop`.

`relay` is no longer part of the active workspace, root build, or root verification flow. Keep this directory for source preservation and historical reference only.

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

This archived app is not part of the active root workspace. If you need to inspect or revive it, work from this archived directory explicitly.

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
