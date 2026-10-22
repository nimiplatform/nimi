# Nimi Web

`@nimiplatform/web` is the official public web portal and account management surface for the Nimi ecosystem.

## Overview

The web application handles public-facing and account-related routes, including:
- Official landing pages and product showcase
- User authentication (`/login`, `/register`, account recovery, two-factor authentication)
- Account management dashboard (`/account`)
- Desktop application downloads, ecosystem documentation, and legal notices

Nimi Home itself runs within the Desktop client; web pages provide product information, account controls, and secure OAuth/browser authentication handoffs.

### Security and Authentication Architecture

- **Session Security:** Web authentication uses `WebAccountAuthPage` powered by the Realm SDK in `browser-session` mode. Session state is secured via `HttpOnly`, `SameSite` browser cookies managed by Realm.
- **Token Protection:** The web client never exposes or persists access/refresh tokens in URLs, `localStorage`, or client-side storage.
- **OAuth Delegation:** During Desktop login handoffs, the web portal validates origin integrity and delegates authentication securely without exposing authorization secrets to untrusted client code.

## Development

When `NIMI_REALM_URL` is configured, the development server proxies Realm requests through the same-origin Vite server:

```bash
pnpm --filter @nimiplatform/web dev
```

From the repository root, `pnpm dev:web` runs the same startup check:

- **Same-workspace reuse:** If this workspace's Web dev server is already listening on the configured port (default `3000`) in the same mode, the command prints the active address and exits successfully. Reusing the server does not transfer process ownership—stop or restart it from the terminal that originally launched it. Source edits continue to hot-reload.
- **Port conflicts:** If an unrelated service or another checkout occupies the port, the command fails with an explicit error rather than killing the existing process or silently switching ports. (Any server started before this startup check existed must be restarted once with the updated command.)

## Verification

```bash
pnpm --filter @nimiplatform/web test
pnpm --filter @nimiplatform/web typecheck
pnpm --filter @nimiplatform/web build
```
