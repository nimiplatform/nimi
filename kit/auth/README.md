# Kit Auth

## What It Is
Cross-app authentication feature module for sign-in UI, flows, adapters, storage, and callback helpers.

## Public Surfaces
- `@nimiplatform/nimi-kit/auth`
- `@nimiplatform/nimi-kit/auth/styles.css`
- `@nimiplatform/nimi-kit/auth/native-oauth-result-page`
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
- `forge`
- `overtone`
- `relay`
- `web`

## Verification
- `pnpm --filter @nimiplatform/nimi-kit build`
- `pnpm check:nimi-kit`
