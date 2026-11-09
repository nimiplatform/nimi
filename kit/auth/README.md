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
- `@nimiplatform/kit/auth/app/mobile`
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

`auth/app/mobile` now supplies the Android 12+ Capacitor container adapter. Add the Kit native plugin through Capacitor sync, configure `plugins.NimiAppAccess.realmBaseUrl/clientId` to the same public inputs as the factory, and set `loggingBehavior: 'none'`: Capacitor's default debug bridge logs native-call payloads. The native adapter rejects an unsafe logging configuration before beginning login. Use a separately admitted `android-app-link` client; the installed package/signing certificate and OS-verified HTTPS App Link must match the Registry source. The native HTTP bridge is limited to Realm coordination, has no cookie jar and never follows redirects or retries. It carries no AI requests or files; these use the existing direct peer.

The system browser owns sign-in. The common controller accepts a callback without reloading the renderer, ignores unrelated/stale callback state without consuming the current attempt, and rechecks user context after native source verification. A canceled browser flow can be canceled from the standard account control. Backgrounding ends the old connection; resume checks the current identity before reconnecting an earlier active connection. In-memory context tokens are not persisted; losing the short sessionStorage login transaction requires signing in again.

Android project/JS compilation is not OS App Link or device acceptance. The real mobile journey remains NOT-VERIFIED until source admission, domain association and an actual device run are complete. There is no iOS factory or Web fallback masquerading as Android.
