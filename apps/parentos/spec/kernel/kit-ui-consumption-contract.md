# ParentOS Kit UI Consumption Contract

This contract owns ParentOS-specific consumption of `@nimiplatform/kit/ui`.
The platform design spec owns shared primitives, tokens, material taxonomy, theme
schema, and generic validation rules. ParentOS owns the concrete renderer
inventory and retained app-owned compositions that consume those shared rules.

## PO-KITUI-001 — Local Consumption Authority

- ParentOS kit consumption inventory lives in `tables/nimi-kit-adoption.yaml`.
- ParentOS retained visual/domain compositions live in `tables/nimi-kit-compositions.yaml`.
- ParentOS domain-geometry inline style allowances live in
  `tables/nimi-kit-allowlists.yaml` and must not admit color, background,
  border, shadow, filter, or glass material authority.
- Platform design tables must not contain ParentOS module inventories or
  ParentOS-owned component rows.

## PO-KITUI-002 — Theme Entry

- ParentOS renderer must import `@nimiplatform/kit/ui/styles.css`,
  `light.css`, `dark.css`, and exactly one accent pack.
- ParentOS uses `nimi-accent` unless this app-local contract explicitly admits a
  different ParentOS-owned accent pack.
- ParentOS root rendering must use `NimiThemeProvider` from
  `@nimiplatform/kit/ui`.

## PO-KITUI-003 — No App-Local Shared Visual Truth

- ParentOS renderer code must not use `app-shell/page-style` or the `S` visual
  facade for shared-family visuals.
- ParentOS renderer CSS must not define a root `--color-*` token registry.
- ParentOS glass/material surfaces must use kit material primitives and must not
  inline `backdropFilter` or CSS `backdrop-filter`.
- Shared-family actions, fields, overlays, surfaces, sidebars, scroll areas,
  toggles, status treatments, and avatar shells must use kit primitives or
  app-local manifest-registered compositions that do not redefine primitive
  authority.

## PO-KITUI-004 — Domain Composition Boundary

- ParentOS may retain domain-specific compositions for child health, journal,
  reports, orthodontics, and growth visualization when they are registered in
  `tables/nimi-kit-compositions.yaml`.
- Registered domain compositions may own information architecture, data
  visualization geometry, copy structure, and domain interaction flow.
- Registered domain compositions must not define a parallel visual contract for
  kit primitive families.

## PO-KITUI-005 — Overlay Registry Authority

- Governed ParentOS dialog and drawer surfaces must be registered in
  `tables/renderer-design-overlays.yaml`.
- Registered overlay rows must name the owning module, overlay kind, surface
  tone, elevation, z-index token, testability posture, reduced-motion posture,
  current provider, target provider, migration wave, and exception posture.
- ParentOS overlay rows inherit `P-DESIGN-013` and must converge on
  `OverlayShell` unless a row is admitted as a narrow `P-DESIGN-021`
  controlled exception with an explicit sunset wave.
- Local overlay shells, inline `fixed inset-0` backdrops, and local portal
  wrappers are not new primitive authority. They are legacy implementation
  providers tracked by the overlay registry until migration removes them.
- New ParentOS overlay surfaces must not enter renderer code without both a
  `tables/nimi-kit-adoption.yaml` row declaring the `overlay` family and a
  `tables/renderer-design-overlays.yaml` row.

## Fact Sources

- `tables/nimi-kit-adoption.yaml`
- `tables/nimi-kit-compositions.yaml`
- `tables/nimi-kit-allowlists.yaml`
- `tables/renderer-design-overlays.yaml`
