# Kit Core

## What It Is
Pure shared logic module for shell-mode detection, env helpers, and OAuth utilities.

## Public Surfaces
- `@nimiplatform/kit/core/shell-mode`
- `@nimiplatform/kit/core/oauth`
- Current surfaces:
  - `headless`: active
  - `ui`: none
  - `runtime`: none
  - `realm`: none

## When To Use It
- Share logic that must stay UI-free and framework-light.
- Parameterize OAuth or capability logic without app bindings.

## What Stays Outside
- React hooks and CSS.
- App shell assumptions.
- Direct runtime or realm business-service integration.

## Current Consumers
- `desktop`
- `web`

## Verification
- `pnpm --filter @nimiplatform/kit build`
- `pnpm check:nimi-kit`
