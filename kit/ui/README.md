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

`@nimiplatform/kit/ui/app-chrome` exports `NimiAppChrome`,
`NimiNavigationProvider`, navigation hooks and `NimiNavigationLink`. The App
creates one core controller and defines its destination validator and leave
policy. Render content from its snapshot, and route every entry through that
controller. Supply real App metadata, `locale`, and an optional `sidebar` layout
description; omitting the sidebar hides its button, menu item and shortcut help.
`scopeKey` is local UI invalidation, never a Host credential. Help and window
commands belong outside business/login gates; disable navigation while those
gates are closed. The chrome restores the original writable or readonly selection
before an edit menu action. Business data, drafts and one-shot effects stay in the
App; history carries references only.
