# Kit Auth

## What It Is
Official account authentication keeps Web Account Auth for Realm-owned browser sessions separate from Desktop Browser Auth Gate for Runtime-owned OAuth attempts. Ordinary ecosystem Apps use the additional shared App access surfaces below; they do not receive either official credential adapter.

## Public Surfaces
- `@nimiplatform/kit/auth`
- `@nimiplatform/kit/auth/shell`
- `@nimiplatform/kit/auth/styles.css`
- `@nimiplatform/kit/auth/native-oauth-result-page`
- `@nimiplatform/kit/auth/app`
- `@nimiplatform/kit/auth/app/web`
- `@nimiplatform/kit/auth/app/desktop`
- Current surfaces:
  - `headless`: active
  - `ui`: active
  - `runtime`: none
  - `realm`: none

## When To Use It
- Use `WebAccountAuthPage` with `WebAccountAuthAdapter` for Web email, OTP, password, two-factor, wallet, and provider interaction. The adapter must request Realm's browser-session response and expose no token persistence.
- Use `DesktopBrowserAuthGate` with `ShellOAuthCodeBridge` and `DesktopBrowserAuthRuntimeBroker` for Desktop. It has no credential methods and no bearer projection.
- Custom OAuth bridge callers must supply `expectedState` from the current
  attempt. The host ignores unrelated callbacks without consuming its listener;
  receiving a matching callback does not establish successful account login.

## What Stays Outside
- Realm identity, cookie, and authorization truth; Runtime login-attempt, code-exchange, refresh, and local token custody.
- App-local auth store wiring.
- Direct Electron/Tauri auth imports.
- Independent token systems outside `ui`.

## Current Consumers
- `web` consumes Web Account Auth.
- `desktop` consumes Desktop Browser Auth Gate.

## Verification
- `pnpm --filter @nimiplatform/kit build`
- `pnpm check:nimi-kit`

## Ordinary ecosystem Apps

`@nimiplatform/kit/auth/app/web` provides `createWebNimiAppSession(config)`. The App supplies its admitted source configuration; the factory composes existing SDK PKCE, callbacks, browser lifecycle and direct connection. Call `start()` once and dispose the instance on application teardown. `autoConnect: false` allows identity-only UI; a failed PC connection does not sign the user out.

`@nimiplatform/kit/auth/app` provides `NimiAppSessionProvider`, `NimiAccountControl`, `NimiAppAccessGate` and `useNimiAppSession`. Runtime-required children receive the current scope and must capture its client and respect its signal. Identity-only children are independently unmounted when identity ends. Display customization does not grant permissions.

`@nimiplatform/kit/auth/app/desktop` provides `createDesktopNimiAppSession()` over the verified Host. It reuses `auth.status()` and `currentUser.get()`; account changes remain Nimi Home-owned. It provides no ordinary-App Account token or global logout.

Optional remote `accountBinding` supplies the current verified website context and expected existing association. `onVerifiedIdentity(identity, contextKey)` receives only a current SDK result; the website owns durable association and any backend verification. Network-uncertain logout remains explicit; Realm-confirmed invalid contexts and known expiry end local identity.

No Mobile factory is exported yet: a real native source, callback and container implementation must exist first. This does not require a separate mobile identity system.
