# AGENTS.md — kit/ui

## Scope

- Applies to `kit/ui/**`.
- `@nimiplatform/nimi-kit/ui` is the cross-app design authority (tokens,
  primitives, themes, generated visual contracts).
- Submodules: `components/`, `design-tokens.ts`, `tokens.ts`,
  `theme.tsx`, `styles.css`, `themes/`, `generated/`, `lib/`, `types/`.

## Hard Boundaries

- `kit/ui` is the design authority for all cross-app visuals. `kit/auth`
  and `kit/features/*` must consume its primitives and tokens; they must
  not fork parallel tokens, parallel primitives, or hand-author theme
  values.
- App packages (`apps/**`) must consume `kit/ui` through
  `@nimiplatform/nimi-kit/ui` and must not recreate the same baseline
  Surface/Button/Field shells locally once the kit surface exists.
- Hand-authored CSS rule bodies in `styles.css` must not target class
  names declared as slots or class_groups in
  `.nimi/spec/platform/kernel/tables/nimi-ui-primitives.yaml`. This is
  enforced by `pnpm check:nimi-ui-pattern`.
- Token authority lives in
  `.nimi/spec/platform/kernel/tables/nimi-ui-tokens.yaml` and
  `.nimi/spec/platform/kernel/tables/nimi-ui-themes.yaml`. `kit/ui` is
  a generator consumer, not an authority parallel. Token edits happen
  in the yaml tables; `kit/ui/src/generated/**` is produced by
  `pnpm generate:nimi-ui-lib` and must not be hand-edited.

## Glass Material Consumption (P-DESIGN-022)

- The material axis admits exactly **5 tiers** (2026-04-18): `solid`,
  `glass-thin`, `glass-regular`, `glass-thick`, `glass-chrome`. This
  5-tier taxonomy supersedes the W1 3-tier admission (`solid`,
  `glass-regular`, `glass-thick`) under parent topic
  `2026-04-16-kit-glass-material-and-parentos-alignment`; the 3 prior
  tier names are preserved byte-for-byte.
- Glass consumption is **only** via `<Surface material="...">` or the
  5-tier marker classes emitted by kit (`nimi-material-glass-thin`,
  `nimi-material-glass-regular`, `nimi-material-glass-thick`,
  `nimi-material-glass-chrome`).
- Named `backdrop-blur-*` Tailwind tokens outside kit-emitted utility
  classes are **forbidden** at `check:ui-glass-boundary` (Phase 1 of
  the topic `2026-04-18-nimi-ui-glassmorphism-system-uplift`). Governed
  modules must not inline `rgba(...)` material fills, inline
  `backdrop-filter` declarations, or hand-pick `backdrop-blur-[Npx]`
  arbitrary values outside kit surfaces.
- Adding a 6th tier requires a new admission; this boundary does not
  pre-authorize future expansion.
- Spec companion: `.nimi/spec/platform/kernel/nimi-ui-material-contract.md`.

## Retrieval Defaults

- Start in `kit/ui/src/components`, `kit/ui/src/design-tokens.ts`,
  `kit/ui/src/styles.css`, `kit/ui/src/theme.tsx`,
  `.nimi/spec/platform/kernel/design-pattern-contract.md`,
  `.nimi/spec/platform/kernel/nimi-ui-material-contract.md`,
  `.nimi/spec/platform/kernel/tables/nimi-ui-tokens.yaml`, and
  `.nimi/spec/platform/kernel/tables/nimi-ui-themes.yaml`.
- Skip `kit/ui/src/generated/**` except for drift inspection. Never
  hand-edit generated files.

## Verification Commands

- `pnpm generate:nimi-ui-lib` (after token/theme yaml edits)
- `pnpm --filter @nimiplatform/nimi-kit build && pnpm --filter @nimiplatform/nimi-kit test`
- `pnpm check:nimi-ui-pattern`
- `pnpm check:nimi-ui-lib-drift`
- `pnpm check:nimi-kit`
- `pnpm exec nimicoding validate-spec-governance --profile nimi --scope platform-consistency`
- `pnpm exec nimicoding generate-spec-derived-docs --profile nimi --scope platform --check`
