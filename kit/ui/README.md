# Kit UI

## What It Is
Foundation design system for shared tokens, primitives, themes, and generated visual contracts.

## Public Surfaces
- `@nimiplatform/nimi-kit/ui`
- `@nimiplatform/nimi-kit/ui/styles.css`
- `@nimiplatform/nimi-kit/ui/themes/*`
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
- `forge`
- `overtone`
- `relay`

## Verification
- `pnpm --filter @nimiplatform/nimi-kit build`
- `pnpm --filter @nimiplatform/nimi-kit test`
- `pnpm check:nimi-ui-pattern`
- `pnpm check:nimi-ui-lib-drift`

