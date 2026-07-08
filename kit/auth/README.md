# Kit Auth

## What It Is
Cross-app authentication feature module for sign-in UI, flows, adapters, storage, and callback helpers.

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
- Reuse shared email, OTP, wallet, and OAuth auth flows.
- Keep platform-specific auth glue behind `AuthPlatformAdapter`.

## What Stays Outside
- App-local auth store wiring.
- Direct Electron/Tauri auth imports.
- Independent token systems outside `ui`.

## Current Consumers
- `desktop`
- `web`

## Verification
- `pnpm --filter @nimiplatform/kit build`
- `pnpm check:nimi-kit`
