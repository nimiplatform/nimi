# Kit Auth

## What It Is
Two explicit authentication boundaries: Web Account Auth for Realm-owned browser sessions, and Desktop Browser Auth Gate for Runtime-owned OAuth attempts and loopback carriage.

## Public Surfaces
- `@nimiplatform/kit/auth`
- `@nimiplatform/kit/auth/shell`
- `@nimiplatform/kit/auth/styles.css`
- `@nimiplatform/kit/auth/native-oauth-result-page`
- Current surfaces:
  - `headless`: active
  - `ui`: active
  - `runtime`: none
  - `realm`: none

## When To Use It
- Use `WebAccountAuthPage` with `WebAccountAuthAdapter` for Web email, OTP, password, two-factor, wallet, and provider interaction. The adapter must request Realm's browser-session response and expose no token persistence.
- Use `DesktopBrowserAuthGate` with `ShellOAuthCodeBridge` and `DesktopBrowserAuthRuntimeBroker` for Desktop. It has no credential methods and no bearer projection.

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
