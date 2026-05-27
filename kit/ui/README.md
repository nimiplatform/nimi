# Kit UI

## What It Is
Foundation design system for shared tokens, primitives, themes, and generated visual contracts.

## Public Surfaces
- `@nimiplatform/kit/ui`
- `@nimiplatform/kit/ui/styles.css`
- `@nimiplatform/kit/ui/themes/*`
- Current surfaces:
  - `headless`: none
  - `ui`: active
  - `runtime`: none
  - `realm`: none

## When To Use It
- Build shared visual primitives.
- Compose feature UIs that should inherit Nimi design tokens.

## What Stays Outside
- App-specific theme forks.
- Product logic, data adapters, or store bindings.

## Current Consumers
- `desktop`
- `web`

## Verification
- `pnpm --filter @nimiplatform/kit build`
- `pnpm --filter @nimiplatform/kit test`
- `pnpm check:nimi-ui-pattern`
- `pnpm check:nimi-ui-lib-drift`
