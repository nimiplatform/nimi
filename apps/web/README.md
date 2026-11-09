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

- **Same-workspace reuse:** If this workspace's Web dev server is already listening on the configured port (default `3000`) in the same mode and with the same configured official origin, the command prints the active address and exits successfully. Reusing the server does not transfer process ownership—stop or restart it from the terminal that originally launched it. Source edits continue to hot-reload.
- **Port conflicts:** If an unrelated service or another checkout occupies the port, the command fails with an explicit error rather than killing the existing process or silently switching ports. (Any server started before this startup check existed must be restarted once with the updated command.)

## Verification

### Remote primary Runtime management

The existing `/account/runtime` page supports the implemented direct management subset: current service state, source pause/resume, an existing remote App's AIConfig, and explicit stop. It is independent of the PC Home lifecycle; closing the website only disconnects this client. A stopped host must be started from the PC.

Configure the non-secret `VITE_NIMI_RUNTIME_MANAGER_CLIENT_ID` and `VITE_NIMI_REALM_ENVIRONMENT_ID` for the deployment. The exact HTTPS origin and `/account/runtime` callback must be Registry-qualified as an `official_manager`; setting these environment variables does not grant that role. The owner signs in normally and confirms the source once in PC Home. Missing registration, disabled host access or an unreachable direct network remains unavailable. The page does not proxy AI or management through Realm.

For local HTTPS development, set `NIMI_WEB_DEV_TLS_CERT` and `NIMI_WEB_DEV_TLS_KEY` to PEM paths and choose a free explicit development port. Both must be present; keys are never included in public Vite environment defines. This development mode uses the existing same-origin `/api` proxy to `NIMI_REALM_URL`, so account cookies do not cross from an HTTPS page to an HTTP backend. Production Realm routing is unchanged. The browser must trust the certificate. If Node needs the same local CA for dev-server identity checks, supply its public CA certificate through `NODE_EXTRA_CA_CERTS`. Do not disable TLS verification. Realm's browser origin allowlist and the registered source must match the chosen HTTPS origin.

HTTPS or LAN development also requires `NIMI_WEB_DEV_ORIGIN`, for example `https://localhost:3443`, in the process environment or repository `.env`. It must match the TLS mode and explicit listening port. Requests with another Host receive 421 before the login page or Realm proxy, even if the certificate includes that alias. Use a different hostname for ecosystem reference websites: different ports on one hostname share the cookie boundary. For a LAN test, use `--host <local-LAN-IP>` and an exact registered origin reachable from the client PC; do not bind unrelated interfaces.

The first-party browser keeps Account access/refresh credentials in Realm's HttpOnly cookies. A short-lived PKCE transaction is held in session storage for the management handoff; the returned scoped Runtime-client session stays in memory and is ended on disconnect/unmount. This is not a generic Account bearer.

### Checks

```bash
pnpm --filter @nimiplatform/web test
pnpm --filter @nimiplatform/web typecheck
pnpm --filter @nimiplatform/web build
```
