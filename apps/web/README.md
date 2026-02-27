# Nimi Web

`nimi-web` is the web-shell target for `apps/desktop` renderer.

It reuses desktop renderer UI directly, while removing desktop-only runtime/mod execution paths through compile-time adapters.

## Goals

- Reuse `desktop` non-mod UI with minimal drift.
- Keep one renderer development source of truth (`desktop`).
- Deploy as a standard Vite web app without Tauri runtime dependency.

## How It Works

- Entry reuses desktop renderer app:
  - `src/main.tsx` -> `@renderer/App`
- Vite/TS path aliases point to desktop sources:
  - `@renderer/*` -> `../desktop/src/shell/renderer/*`
  - `@runtime/*` -> `../desktop/src/runtime/*`
- Web-only adapters replace desktop runtime/mod entry modules:
  - `@renderer/infra/bootstrap/runtime-bootstrap`
  - `@renderer/bridge`
  - `@renderer/mod-ui/host/slot-host`
  - `@renderer/mod-ui/host/slot-context`
  - `@renderer/features/mod-workspace/mod-workspace-tabs`
  - `@renderer/features/runtime-config/runtime-config-panel-view`
  - `@renderer/features/marketplace/marketplace-page`

These adapters live in `src/desktop-adapter/`.

## Environment

Required:

- `VITE_NIMI_SHELL_MODE=web`

Optional:

- `VITE_NIMI_GOOGLE_CLIENT_ID=...` (for Google OAuth in web auth menu)
- `VITE_NIMI_ACCESS_TOKEN=...`
- `VITE_NIMI_LOCAL_PROVIDER_ENDPOINT=...`
- `VITE_NIMI_LOCAL_PROVIDER_MODEL=...`
- `VITE_NIMI_LOCAL_OPENAI_ENDPOINT=...`
- `VITE_NIMI_LOCAL_OPENAI_API_KEY=...`

Runtime wallet login is available in web mode when wallet providers are injected into `window`
(MetaMask / OKX / Binance Wallet).

API base URL policy in web mode:

- `@nimiplatform/web` always uses same-origin API routing from current page origin.
- `NIMI_REALM_URL` is ignored for web-shell API requests to avoid accidental `localhost` lock-in on LAN access.

Desktop browser authorization note:

- `desktop` uses `NIMI_WEB_URL` as browser-auth launch base.
- Example: `NIMI_WEB_URL=http://localhost` (login hash path is auto-appended as `#/login`).
- `localhost` and `localhost:3000` are different localStorage scopes.

## Commands

```bash
pnpm --filter @nimiplatform/web dev
pnpm --filter @nimiplatform/web typecheck
pnpm --filter @nimiplatform/web build
```

## Sync Rule

When desktop renderer evolves:

1. Keep feature UI changes in desktop renderer.
2. If change touches desktop-only runtime/mod hooks, update corresponding files in `src/desktop-adapter/`.
3. Rebuild `@nimiplatform/web` and verify output does not contain desktop runtime-mod bootstrap symbols.
