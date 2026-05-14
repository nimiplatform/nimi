# Avatar Kit UI Consumption Contract

> Authority: Avatar-local consumption of `@nimiplatform/nimi-kit`.
> Upstream foundation: `.nimi/spec/platform/kernel/design-pattern-contract.md`.

## A-KIT-UI-001 — Local Ownership

Avatar is a first-party app and consumes the shared Nimi design system as a downstream product surface. Concrete Avatar adoption rows, retained Avatar-owned compositions, and Avatar hard-cut exceptions live only in `.nimi/spec/avatar/kernel/tables/nimi-kit-*.yaml`.

Platform design authority may define shared primitives, token taxonomy, material tiers, theme-pack schema, and generic app integration rules. It must not list Avatar renderer modules, Avatar component inventories, Avatar token exceptions, or Avatar consumption progress.

## A-KIT-UI-002 — Shared Theme Contract

Avatar shell entrypoints consume:

- `@nimiplatform/nimi-kit/ui/styles.css`
- `@nimiplatform/nimi-kit/ui/themes/light.css`
- `@nimiplatform/nimi-kit/ui/themes/dark.css`
- `@nimiplatform/nimi-kit/ui/themes/nimi-accent.css`

Avatar does not own an app-specific accent pack in this contract. It uses the shared `nimi-accent` pack unless a later Avatar-local spec change admits an Avatar accent pack under `.nimi/spec/avatar/kernel/tables/nimi-kit-themes.yaml`.

## A-KIT-UI-003 — Shell Surface Scope

Avatar governed shell surfaces are the React renderer entrypoint, top-level shell, embodiment stage, companion surface, and degraded surface. Backend rendering internals under `live2d/**`, `vrm/**`, audio, NAS, and runtime carrier code are not shared UI primitive surfaces unless they render shell-level controls.

Avatar-owned compositions may preserve product-form behavior specific to a transparent floating embodiment surface, but they must consume shared theme tokens and shared primitives for actions, fields, overlays, status, and glass material where the toolkit provides coverage.

## A-KIT-UI-004 — Token Hard Cut

Avatar renderer styles must not define a parallel root design token registry. Historical `app-shell/tokens.css` values are downstream drift once this contract is active; the hard cut is to replace them with `--nimi-*` semantic tokens and toolkit primitives, not to promote Avatar token values into platform truth.

## Fact Sources

- `tables/nimi-kit-adoption.yaml`
- `tables/nimi-kit-compositions.yaml`
