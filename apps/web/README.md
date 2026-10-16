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

Development uses the same-origin Vite proxy when `NIMI_REALM_URL` is configured:

```bash
pnpm --filter @nimiplatform/web dev
```

From the repository root, `pnpm dev:web` uses the same startup check. If this
workspace's Web development server is already listening on the configured port
(normally `3000`) in the same mode, the command prints its address and exits
successfully. Reuse does not take ownership of the original server: stop or
restart it in the terminal that launched it. Source edits continue to hot reload.
An unrelated service or another checkout on the port produces an explicit error;
the command never kills it or silently switches ports. Existing servers launched
before this check was added need one restart through the updated command.

Verification:

```bash
pnpm --filter @nimiplatform/web test
pnpm --filter @nimiplatform/web typecheck
pnpm --filter @nimiplatform/web build
```
