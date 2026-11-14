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

`@nimiplatform/kit/auth/app/desktop` provides `createDesktopNimiAppSession()` over the verified Host. It reuses `auth.status()` and `currentUser.get()`; account changes remain Nimi Home-owned. Its connected snapshot preserves the actual native App client type, including native-only operations; the common scope type remains the default for platform-neutral UI. It provides no ordinary-App Account token or global logout.

Optional remote `accountBinding` supplies the current verified website context and expected existing association. `onVerifiedIdentity(identity, contextKey)` receives only a current SDK result; the website owns durable association and any backend verification. Network-uncertain logout remains explicit; Realm-confirmed invalid contexts and known expiry end local identity.

`auth/app/mobile` now supplies the Android 12+ Capacitor container adapter. Add the Kit native plugin through Capacitor sync, configure `plugins.NimiAppAccess.realmBaseUrl/clientId` to match the factory's public inputs, and set `loggingBehavior: 'none'`—Capacitor's default debug bridge logs native-call payloads, and the native adapter rejects an unsafe logging configuration before beginning login. Use a separately admitted native client. Distributed `android-app-link` sources require the registered package/signing certificate and an OS-verified HTTPS App Link. Local `android-dev-scheme` sources use an exact reverse-domain private-use callback, the registered installed package/signature, and a debug host; Realm accepts them only from an explicit local Registry in a non-production environment. Their origin is the scheme followed by `:/`, not a browser origin. Scheme routing is not a domain-verification claim, and the adapter never falls back between source types. The native HTTP bridge is limited to Realm coordination, has no cookie jar, and never follows redirects or retries. It carries no AI requests or files; those use the existing direct peer.

The system browser owns sign-in. The common controller accepts a callback without reloading the renderer, ignores unrelated/stale callback state without consuming the current attempt, and rechecks user context after native source verification. If the browser flow is dismissed, the pending attempt can be canceled from the standard account control. Backgrounding ends the old connection; resume checks the current identity before reconnecting an earlier active connection. In-memory context tokens are not persisted; losing the short sessionStorage login transaction requires signing in again.

Android project/JS compilation is not OS App Link or device acceptance. Real mobile acceptance requires source admission, the selected callback carrier and an actual device run; the distributed App Link carrier additionally requires domain association. There is no iOS factory or Web fallback masquerading as Android.

### Android coordination reconnect — local 0.24.0-rc.4

The narrow Realm HTTP client keeps no idle pooled connections. Real Presenton Android acceptance exposed a reused connection returning EOF before response headers on the first explicit reconnect after idle. The fix preserves the 20-second timeout and the existing no-cookie, no-redirect, no-automatic-retry behavior; it does not change the direct Runtime peer or App business requests. Debug hosts retain bounded failure diagnostics containing endpoint category, method, phase, exception classes, connection-attempt/acquisition flags, cancellation and elapsed time. They never log URLs, headers, bodies, exception messages or stack traces.

The four real OkHttp loopback regressions in `android/src/test` reproduce the prior EOF and cover the fix, single POST delivery on failure, cancellation, cookies and redirects. They passed both as JVM tests and through a consuming Android project's `:nimiplatform-kit:testDebugUnitTest`; Java compilation and the complete Kit/App APK builds passed. On 2026-11-14, the final Presenton APK completed official Android login, stayed naturally idle for approximately two minutes, then recovered My PC and all four retained drafts on the first explicit Disconnect → Connect. The earlier diagnostic candidate had failed that same path; the final safe failure log was empty and no business request was replayed.

This is local development evidence for the archived `integration-20261114-android-http-rc.4` cohort, not publication or a general claim about every mobile network. SDK/App Tools/native tarballs retain their frozen content; only Kit was rebuilt. These post-acceptance notes do not rewrite the archived package.
