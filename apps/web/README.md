# Nimi Web

`@nimiplatform/web` is the official public web portal and account management surface for the Nimi ecosystem.

## Overview

The web application handles public-facing and account-related routes, including:
- Official landing pages and product showcase
- User authentication (`/login`, `/register`, account recovery, two-factor authentication)
- Account management dashboard (`/account`)
- Desktop application downloads, ecosystem documentation, and legal notices

Nimi Home itself runs within the Desktop client; web pages provide product information, account controls, and secure OAuth/browser authentication handoffs.

## Production hosting and releases

The existing Cloudflare Pages project **`nimi`** (`nimi-6jb.pages.dev`) hosts both the public portal and account UI from this package. The Cloudflare account is `91f8e657f85b6ae12cc333397190709d`. Do not create a second landing application or install Web archives on Realm ECS.

| Origin | Responsibility |
| --- | --- |
| `https://nimi.ai` | Public portal, account, `/account/runtime` management, App introductions, download and legal pages |
| `https://www.nimi.ai` / `https://web.nimi.ai` | Redirect to the same path and query on `https://nimi.ai`; no separate login site |
| Existing `nimi.xyz` / `www.nimi.xyz` aliases | Same canonical redirects; no separate account identity |
| `https://realm.nimi.ai` | ECS API, Realtime, account sessions and coordination |
| `https://admin.nimi.ai` | Existing ECS administration site |
| `https://assets.nimi.ai` | Existing media Worker/R2 deployment |

`public/_worker.js` performs host/path redirects and serves Pages assets. It preserves OAuth query parameters, never proxies Realm requests, sets no cookies and exposes no AI execution endpoint. Multi-page HTML files use Pages clean URLs; routes without static HTML use its SPA fallback. `_routes.json` keeps large static directories outside Functions, and `_headers` gives fingerprinted assets immutable caching. Account HTML is `no-store`. Preview documents deny cross-origin connections and form submissions and are not production Registry or CORS origins.

`.github/workflows/deploy-web.yml` owns release execution. Pages remains connected to `nimiplatform/nimi`, with production branch `main` and automatic Cloudflare Git builds disabled in both environments so a second build cannot overwrite a release. The GitHub workflow runs on relevant `main` pushes or explicit dispatch, installs the pinned workspace, tests/builds Web once, deploys and checks a preview, then publishes the same directory to production and checks the public routes. Deployment URLs, IDs and source SHA are recorded in the GitHub run summary and Cloudflare history. A failed preview prevents production publication; a failed production check leaves the real failure visible and does not silently roll back.

Build inputs are public configuration: `NIMI_REALM_URL=https://realm.nimi.ai`, `VITE_NIMI_REALM_ENVIRONMENT_ID=production`, and `VITE_NIMI_RUNTIME_MANAGER_CLIENT_ID=nimiplatform.runtime-manager.web`. The manager source requires the Registry-approved exact origin `https://nimi.ai` and callback `https://nimi.ai/account/runtime`. The `.web` client ID identifies the carrier, not a subdomain. Realm continues to own host-only HttpOnly cookies and exact credentialed CORS. Neither Pages aliases nor previews receive new account or Runtime permissions. Realm's official Web URL must also be `https://nimi.ai`; the PC enters Realm's authorize endpoint and keeps its independent loopback callback.

The build job has no production secrets. A separate deployment runner downloads the immutable artifact ID produced by that same run, prepares Wrangler `4.127.1` without credentials, then injects `CLOUDFLARE_PAGES_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` only for upload/verification steps. It does not install or execute workspace dependencies and uses `--no-bundle`. Rollback has its own runner and injects the Pages token only for the rollback call. The Pages token is separate from the install gateway's Worker token; neither workflow uses the retired shared `CLOUDFLARE_API_TOKEN` repository secret. DNS changes remain a separate operation.

For an exact release, dispatch **Deploy official Web** with `commit_sha` set to a full SHA already on `main`. Set `publish=false` to build and verify only a preview before a domain cutover. For rollback, leave `commit_sha` empty and set `rollback_deployment_id` to a previously verified, compatible **production** deployment from this project. The workflow validates the target through Cloudflare, uses its rollback API and reads back the active deployment. Preview deployments are rejected. Do not roll back to pre-manager builds for production account use; after a rollback, recheck login, account deep links and the affected user journey. Rollback changes Web only, never Realm data, Registry admission or Runtime state.

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

Configure the non-secret `VITE_NIMI_RUNTIME_MANAGER_CLIENT_ID` and `VITE_NIMI_REALM_ENVIRONMENT_ID` for the deployment. The exact HTTPS origin and `/account/runtime` callback must be Registry-qualified as an `official_manager`; setting these environment variables does not grant that role. The owner signs in normally and confirms the source once in PC Home. If the source is unregistered, host access is disabled, or the direct network is unreachable, management remains unavailable. The page does not proxy AI or management through Realm.

For local HTTPS development, set `NIMI_WEB_DEV_TLS_CERT` and `NIMI_WEB_DEV_TLS_KEY` to PEM paths and choose a free explicit development port. Both must be present; keys are never included in public Vite environment defines. This development mode uses the existing same-origin `/api` proxy to `NIMI_REALM_URL`, so account cookies do not cross from an HTTPS page to an HTTP backend. Production Realm routing is unchanged. The browser must trust the certificate. If Node needs the same local CA for dev-server identity checks, supply its public CA certificate through `NODE_EXTRA_CA_CERTS`. Do not disable TLS verification. Realm's browser origin allowlist and the registered source must match the chosen HTTPS origin.

HTTPS or LAN development also requires `NIMI_WEB_DEV_ORIGIN`, for example `https://localhost:3443`, in the process environment or repository `.env`. It must match the TLS mode and explicit listening port. Requests with another Host receive 421 before the login page or Realm proxy, even if the certificate includes that alias. Use a different hostname for ecosystem reference websites: different ports on one hostname share the cookie boundary. For a LAN test, use `--host <local-LAN-IP>` and an exact registered origin reachable from the client PC; do not bind unrelated interfaces.

The first-party browser keeps Account access/refresh credentials in Realm's HttpOnly cookies. A short-lived PKCE transaction is held in session storage for the management handoff; the returned scoped Runtime-client session stays in memory and is ended on disconnect/unmount. This is not a generic Account bearer.

### Checks

```bash
pnpm --filter @nimiplatform/web test
pnpm --filter @nimiplatform/web typecheck
pnpm --filter @nimiplatform/web build
```
