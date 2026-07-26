# AGENTS.md — kit/ui

## Scope
- Applies to `kit/ui/**`.
- Canonical product authority lives in `.nimi/spec/platform/ui-design-system.authority.yaml`.
- `kit/ui` implements shared primitives and consumes generated token/theme projections; it does not create parallel product authority.

## Hard Boundaries
- Token/theme/primitive tables under `config/platform-nimi-ui-*.yaml` are admitted generator inputs; change them before regenerating affected outputs.
- Never hand-edit `kit/ui/src/generated/**`.
- Apps and Kit features consume shared surfaces through `@nimiplatform/kit/ui`; do not fork an existing primitive, token, theme value, or accessibility behavior.
- `styles.css` must not target slot or class-group names declared in `config/platform-nimi-ui-primitives.yaml`.
- Material use is limited to admitted `Surface material` values or Kit-emitted material classes; no inline material fills, backdrop filters, or arbitrary blur values outside Kit surfaces.
- New primitives, tokens, themes, or material tiers require alignment with canonical authority; app composition remains app-owned.

## Retrieval Defaults
- Read the affected primitive or style, its exact `config/platform-nimi-ui-*.yaml` row, and `.nimi/spec/platform/ui-design-system.authority.yaml` when semantics or ownership are in question.
- Inspect generated files only for drift; skip unrelated components and historical design prose.

## Verification Commands
- Component-only work: run the affected Kit test and `pnpm --filter @nimiplatform/kit build`.
- Token/theme/primitive-table work: `pnpm generate:nimi-ui-lib`, `pnpm check:nimi-ui-pattern`, and `pnpm check:nimi-ui-lib-drift`.
- Run `pnpm check:nimi-kit` for Kit-wide changes; run spec governance only when canonical authority changes.
