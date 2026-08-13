# Nimi Web

`@nimiplatform/web` is the standalone first-party public and account surface.

It owns normal-path routes for the landing page, `/login`, `/register`, account recovery and two-factor continuation, `/account`, Nimi Home and App information, legal pages, download, and navigation. Nimi Home itself remains Desktop-hosted; App pages are informational and do not provide public installation, catalog, or distribution authority.

Account credential interaction uses `WebAccountAuthPage` with the public Realm SDK in `browser-session` response mode. Realm owns the HttpOnly browser cookie and current-account truth. Web never stores access or refresh tokens in URLs, localStorage, or other durable browser metadata. An `oauth_next` continuation must match the admitted Realm origin and unchanged authorize transaction; Web only navigates back and never consumes the Desktop authorization code.

Web does not import Desktop renderer/package surfaces, Runtime internals, native IPC, local-file behavior, or Simulator product source. There is no Web Shell, hash-shell route, Desktop adapter directory, or post/social permalink entry.

Development uses the same-origin Vite proxy when `NIMI_REALM_URL` is configured:

```bash
pnpm --filter @nimiplatform/web dev
```

Verification:

```bash
pnpm --filter @nimiplatform/web test
pnpm --filter @nimiplatform/web typecheck
pnpm --filter @nimiplatform/web build
```
