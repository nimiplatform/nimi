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

## Standard App chrome

`@nimiplatform/kit/ui/app-chrome` exports `NimiAppChrome`, `NimiNavigationProvider`, navigation hooks, and `NimiNavigationLink`.

- **Controller & Navigation**: The App creates one core controller and defines its destination validator and leave policy. Render views from controller snapshots, and route every navigation entry through that controller.
- **Chrome Configuration**: Supply real App metadata, `locale`, and an optional `sidebar` layout description. Omitting the sidebar hides its toggle button, menu item, and shortcut help. `scopeKey` is strictly for local UI invalidation, never a Host credential.
- **Window Commands & Gating**: Help and window management commands belong outside business/login gates; disable navigation while those gates are closed. Chrome restores the original writable or readonly selection before executing an edit menu action.
- **State Boundaries**: App business data, drafts, and one-shot side effects remain inside the App; history carries references only.
