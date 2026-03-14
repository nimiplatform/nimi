# Nimi Web

`nimi-web` is the primary web site target for Nimi.

It serves a landing homepage at `/`, keeps static legal pages in the same build, and reuses the `apps/desktop` renderer for hash-routed web-shell flows such as `/#/login`.

## Goals

- Reuse `desktop` non-mod UI with minimal drift.
- Keep one renderer development source of truth (`desktop`).
- Deploy landing, legal pages, and web-shell from a standard Vite web app without Tauri runtime dependency.

## How It Works

- Entry is split by URL hash:
  - `/` renders landing content from `src/landing/**`
  - `/#/...` lazy-loads `@renderer/App`
- Static pages are emitted from the same build:
  - `/terms.html`
  - `/privacy.html`
  - `/blueyard.html`
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
  - `@renderer/features/mod-hub/mod-hub-page`

These adapters live in `src/desktop-adapter/`.

Landing-specific code lives in `src/landing/`.

## Environment

Required:

- `VITE_NIMI_SHELL_MODE=web`

Optional:

- `VITE_NIMI_GOOGLE_CLIENT_ID=...` (for Google OAuth in web auth menu)
- `VITE_NIMI_ACCESS_TOKEN=...`
- `VITE_NIMI_LOCAL_PROVIDER_ENDPOINT=...`
- `VITE_NIMI_LOCAL_PROVIDER_MODEL=...`
- `VITE_NIMI_LOCAL_OPENAI_ENDPOINT=...`
- `VITE_NIMI_CREDENTIAL_REF_ID=...`

Runtime wallet login is available in web mode when wallet providers are injected into `window`
(MetaMask / OKX / Binance Wallet).

API base URL policy in web mode:

- `@nimiplatform/web` always uses same-origin API routing from current page origin.
- `NIMI_REALM_URL` is not read by runtime request code in web-shell mode (to avoid client-side host lock-in).
- In local dev (`pnpm --filter @nimiplatform/web dev`), Vite proxies `/api`, `/healthz`, `/readyz`, and `/health` to `NIMI_REALM_URL` when it is set.
- In local dev, Vite proxies `/socket.io` to `NIMI_REALTIME_URL` when it is set; otherwise it derives the realtime target from `NIMI_REALM_URL` (`localhost:3002` -> `localhost:3003`).
- Monorepo root `.env` is auto-loaded for web dev, so `NIMI_REALM_URL` can be configured once at repo root.

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

## Cloudflare Pages

Production is intended to run as a Cloudflare Pages site on the primary web
origin, with same-origin proxying for backend traffic.

- Custom domain: your primary web origin (for example `app.example.com`)
- Static assets: served by Pages from `dist/`
- Backend proxy:
  [`functions/api/[[path]].js`](/Users/snwozy/nimi-realm/nimi/apps/web/functions/api/[[path]].js)
  and
  [`functions/socket.io/[[path]].js`](/Users/snwozy/nimi-realm/nimi/apps/web/functions/socket.io/[[path]].js)
  forward `/api/*` and `/socket.io/*` to `API_ORIGIN`
- Example `API_ORIGIN`: `https://api.example.com`

Suggested Pages project settings:

- Root directory: `apps/web`
- Build command: `pnpm install --frozen-lockfile && pnpm run build`
- Build output directory: `dist`

Suggested Pages environment variables:

- `VITE_NIMI_SHELL_MODE=web`
- `API_ORIGIN=https://api.example.com`

Notes:

- In production web mode, runtime request code uses same-origin API routing.
- `VITE_NIMI_REALM_URL` is only relevant for local Vite dev proxy behavior.

## Sync Rule

When desktop renderer evolves:

1. Keep feature UI changes in desktop renderer.
2. If change touches desktop-only runtime/mod hooks, update corresponding files in `src/desktop-adapter/`.
3. Rebuild `@nimiplatform/web` and verify output does not contain desktop runtime-mod bootstrap symbols.
