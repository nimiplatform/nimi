# Nimi Video Food Map

Food-related video content geolocation mapping.

## Overview

Video Food Map is a Tauri desktop application for mapping food-related video content to geographic locations.

## Tech Stack

- Tauri 2 + React 19 + Vite 7
- TanStack Query 5

## Architecture

```text
src/shell/renderer/   # Minimal renderer setup
src-tauri/            # Rust backend
```

Lightweight app with minimal dependencies. Does not depend on `@nimiplatform/sdk` directly.

## Development

```bash
pnpm -C apps/video-food-map run dev:shell
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
