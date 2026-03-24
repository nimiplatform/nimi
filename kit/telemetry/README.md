# Kit Telemetry

## What It Is
Renderer-safe infrastructure module for shared emitters and error boundaries.

## Public Surfaces
- `@nimiplatform/nimi-kit/telemetry`
- `@nimiplatform/nimi-kit/telemetry/error-boundary`
- Current surfaces:
  - `headless`: active
  - `ui`: active
  - `runtime`: none
  - `realm`: none

## When To Use It
- Emit client-side events without app-specific schemas.
- Reuse a platform-safe React error boundary.

## What Stays Outside
- Node/Electron/Tauri direct imports.
- App-specific reporting schemas or transport bridges.

## Current Consumers
- `forge`
- `desktop`
- `relay`

## Verification
- `pnpm --filter @nimiplatform/nimi-kit build`
- `pnpm check:nimi-kit`

