# Web AGENTS.md

> Conventions for AI agents working on `@nimiplatform/web`.

## Context

`apps/web/` is the web-shell target for desktop renderer reuse, not an independent Next.js app.

- Renderer entry: `src/main.tsx -> @renderer/App`
- Main strategy: reuse `desktop/src/shell/renderer/*`
- Web-only behavior is injected through `src/desktop-adapter/*`

No local runtime-mod execution is supported in web mode.

## Stack and Runtime Shape

- Build tool: Vite 7 (`vite.config.ts`)
- UI: React 19 + Tailwind 4
- Router: `react-router-dom`
- State/query: Zustand + TanStack Query (from reused renderer code)
- Shell mode: compile-time fixed `VITE_NIMI_SHELL_MODE=web`

## Alias Contract (Do Not Break)

`web` intentionally aliases desktop modules:

- `@renderer/* -> ../desktop/src/shell/renderer/*`
- `@runtime/* -> ../desktop/src/runtime/*`
- `@mods/* -> ../desktop/src/mods/*`

And replaces desktop-only entry points with adapters:

- `@renderer/infra/bootstrap/runtime-bootstrap`
- `@renderer/bridge`
- `@renderer/mod-ui/host/slot-host`
- `@renderer/mod-ui/host/slot-context`
- `@renderer/features/mod-workspace/mod-workspace-tabs`
- `@renderer/features/runtime-config/runtime-config-panel-view`
- `@renderer/features/marketplace/marketplace-page`

If desktop code touches these modules, sync the matching adapter in `apps/web/src/desktop-adapter/`.

## Environment

Required:

- `VITE_NIMI_SHELL_MODE=web` (injected by Vite define)

Optional:

- `VITE_NIMI_GOOGLE_CLIENT_ID`
- `VITE_NIMI_ACCESS_TOKEN`
- `VITE_NIMI_LOCAL_PROVIDER_ENDPOINT`
- `VITE_NIMI_LOCAL_PROVIDER_MODEL`
- `VITE_NIMI_LOCAL_OPENAI_ENDPOINT`
- `VITE_NIMI_LOCAL_OPENAI_API_KEY`

Web API base URL policy is same-origin. Do not add hardcoded API host overrides in web-shell flows.

## Coding Rules

- Keep feature UI and business logic in desktop renderer first; web only adds compatibility adapters.
- Do not import `@tauri-apps/*` in `apps/web/`.
- Do not implement local mod file access in web adapters (`listRuntimeLocalModManifests` must stay empty).
- Avoid deep private imports outside declared alias roots.
- Use typed APIs; avoid `any` in new public surfaces.

## Build and Verification

```bash
pnpm --filter @nimiplatform/web dev
pnpm --filter @nimiplatform/web typecheck
pnpm --filter @nimiplatform/web build
```
