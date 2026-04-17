# Design Pattern Contract — P-DESIGN-*

> Cross-app authority for the Nimi design pattern, shared primitives, theme packs, and hard gates.

## P-DESIGN-001 — Foundation Authority

- The Nimi design pattern is the single authoritative source for shared visual and interaction contracts across `desktop`, `forge`, `relay`, `overtone`, and `parentos`.
- Cross-app design authority must live in `.nimi/spec/platform/kernel/design-pattern-contract.md` and the structured fact sources under `.nimi/spec/platform/kernel/tables/`.
- App-local design prose may describe art direction, but must not redefine shared primitive families, token taxonomies, or governance rules.

## P-DESIGN-002 — Theme Pack Model

- Shared design foundation is constant across apps; theme expression is delivered through foundation scheme packs plus exactly one app accent pack.
- Governed app entries must import `@nimiplatform/nimi-kit/ui/themes/light.css`, `@nimiplatform/nimi-kit/ui/themes/dark.css`, and exactly one app accent pack from `@nimiplatform/nimi-kit/ui/themes/*-accent.css`.
- Foundation schemes are `nimi-light` and `nimi-dark`.
- Initial accent packs are `desktop-accent`, `forge-accent`, `relay-accent`, and `overtone-accent`.

## P-DESIGN-003 — Semantic Token Taxonomy

- Shared semantic tokens must be declared in `tables/nimi-ui-tokens.yaml`.
- Required token categories are `surface`, `text`, `action`, `overlay`, `sidebar`, `field`, `status`, `radius`, `spacing`, `typography`, `stroke`, `elevation`, `motion`, `z`, `sizing`, `border`, `opacity`, `focus`, `scrollbar`, `toggle`, `material`, `backdrop`, and `ambient`.
- Semantic tokens must declare whether they are `foundation` or `accent` layer tokens.
- Theme pack values must be declared in `tables/nimi-ui-themes.yaml`; app code must not invent parallel token registries for governed surfaces.

## P-DESIGN-004 — Theme Scheme Contract

- All governed apps must resolve theme state through one shared scheme mechanism.
- Shared scheme state is `light` or `dark`; governed apps must not define a parallel app-local theme entrypoint or root token system.
- Accent packs may express product identity, but they must layer on top of the shared foundation schemes and must not redefine primitive family structure.

## P-DESIGN-005 — Primitive Visual Authority

- Shared primitive variant taxonomy (which tones, sizes, states are valid) must be declared in `tables/nimi-ui-primitives.yaml`.
- Shared primitive visual implementations use CVA (class-variance-authority) + Tailwind utility classes in `@nimiplatform/nimi-kit/ui` component source, backed by Radix UI headless primitives for accessible behavior.
- Semantic theme tokens are registered as Tailwind theme values via `@theme` in generated CSS; primitive CSS class selectors are no longer generated.
- App code and shared-lib handwritten code may compose shared primitives, but may not define CVA variants for shared primitive families outside `kit/ui`.

## P-DESIGN-006 — No App-Local Shared Primitive Redefinition

- Governed app stylesheets must not define CVA variants or Tailwind utility overrides that target shared primitive families delivered by `@nimiplatform/nimi-kit/ui`.
- App-local wrappers may add composition class names, but they must not redefine the visual contract of shared primitive components.
- Controlled exceptions may style app-owned selectors only; they must not override shared primitive styling.

## P-DESIGN-007 — No App-Local Shared Token Overrides

- Governed app stylesheets must not assign values to `--nimi-*` CSS variables.
- Shared semantic token values must originate only from generated theme CSS emitted from `tables/nimi-ui-themes.yaml`.
- Shared-lib handwritten CSS may read semantic tokens, but must not provide fallback token authority.

## P-DESIGN-008 — Accent Alias Phase-Out

- Generated accent packs must emit shared `--nimi-*` semantic token values only; they must not emit app-scoped alias token namespaces such as `--ot-*`, `--color-ot-*`, `--color-brand-*`, or `--color-accent-*` as long-term authority.
- Legacy full-theme compatibility outputs such as `relay-dark.css` and `overtone-studio.css` must not remain in the generated shared-lib theme surface once the foundation-plus-accent model is active.
- Governed app chrome may layer app identity through shared semantic tokens and local `color-mix(...)` expressions, but it must not depend on app-scoped accent aliases for shared background, text, focus, or surface meaning.

## P-DESIGN-010 — Shared Primitive Contract

- Shared design primitives must be delivered by `@nimiplatform/nimi-kit/ui`, built on Radix UI headless primitives (Dialog, Tooltip, ScrollArea, Select, Switch, Avatar, Popover) and styled with CVA + Tailwind referencing `--nimi-*` semantic tokens.
- Governed app modules must use shared primitives for shell-level `surface`, `action`, `overlay`, `sidebar`, `field`, `status`, `scroll_area`, `toggle`, and `avatar` families.
- Thin compatibility wrappers are permitted only if they delegate directly to `@nimiplatform/nimi-kit/ui` and do not redefine the visual contract.

## P-DESIGN-011 — Surface Contract

- `Surface` is the only shared shell-level primitive for `canvas`, `panel`, `card`, `hero`, and `overlay` tones.
- Shared surface elevation and border treatment must resolve through semantic tokens, not feature-local shadow or color constants.

## P-DESIGN-012 — Action Contract

- `Button` and `IconButton` are the shared action primitives for shell-level and form-level interactions.
- Shared actions must resolve `primary`, `secondary`, `ghost`, and `danger` tone behavior through semantic tokens.

## P-DESIGN-013 — Overlay Contract

- `Dialog` (backed by `@radix-ui/react-dialog`) is the shared overlay primitive for `dialog` and `drawer` kinds. `Popover` (backed by `@radix-ui/react-popover`) handles popover overlays. `Tooltip` (backed by `@radix-ui/react-tooltip`) handles tooltips.
- `OverlayShell` is retained as a backward-compatible adapter mapping to `Dialog`.
- Governed overlays must keep reduced-motion behavior and stable testability surfaces.

## P-DESIGN-014 — Sidebar / Nav Contract

- Shared sidebars and shell-level navigation lists must use the shared sidebar family `nimi-sidebar-v1`.
- Allowed item kinds are `entity-row`, `category-row`, and `nav-row`.
- Allowed trailing affordances are `badge`, `status-dot`, `chevron`, and `count`.

## P-DESIGN-015 — Field / Input Contract

- `TextField`, `SearchField`, `TextareaField`, and `SelectField` are the shared field primitives for shell-level and publish/settings surfaces.
- Governed field surfaces must resolve background, stroke, placeholder, and focus states through semantic tokens.

## P-DESIGN-016 — Typography Contract

- Typography scale, font weights, line heights, and letter spacing for governed surfaces must be declared in `tables/nimi-ui-tokens.yaml`.
- Shared type utility classes such as page titles, section titles, body copy, captions, labels, overlines, and mono text must be generated from semantic typography tokens.
- Governed modules must not invent ad hoc typography scales when the toolkit taxonomy covers the needed role.

## P-DESIGN-017 — Spacing & Sizing Contract

- Shared spacing and component sizing scales must be declared in `tables/nimi-ui-tokens.yaml`.
- Shared primitives must resolve padding, gaps, min-heights, icon sizes, sidebar row sizes, and scrollbar sizes through semantic sizing and spacing tokens.
- Governed modules must not encode layout rhythm or component size contracts with raw values when a shared token exists.

## P-DESIGN-018 — Focus / Opacity / Icon Contract

- Shared focus rings, disabled opacity, interaction overlays, and icon size scales must be declared in `tables/nimi-ui-tokens.yaml`.
- Shared primitives must resolve focus, disabled, and hover/overlay treatments through semantic tokens rather than per-app constants.
- Governed apps may add app-specific icon glyphs, but icon sizing and focus behavior must come from the shared toolkit contract.

## P-DESIGN-019 — App-Owned Composition Boundary

- App-owned composition components are permitted only when they are explicitly registered in `tables/nimi-ui-compositions.yaml`.
- Thin wrappers over shared primitive families must delegate directly to `@nimiplatform/nimi-kit/ui` and must not add an app-owned visual contract for those shared families.
- App-owned compositions may define local interaction or layout selectors only for component families that are not yet part of the shared toolkit contract; they must not become a parallel authority for `action`, `field`, `surface`, `sidebar`, `overlay`, `status`, `scroll_area`, `toggle`, or `avatar`.

## P-DESIGN-020 — Adoption Registry

- Every governed shell-level module must be explicitly registered in `tables/nimi-ui-adoption.yaml`.
- Registry rows must declare `scheme_support`, `default_scheme`, and `accent_pack`; governed apps may not encode these decisions only in app-local code.
- Hard gate enforcement is driven by the registry, not by ad hoc path guesses or reviewer memory.

## P-DESIGN-021 — Controlled Exceptions

- Exceptions to shared primitive adoption must be explicit and narrow.
- The only initial controlled exceptions are:
  - `desktop world-detail`
  - `desktop chat avatar viewport chrome (Live2D / VRM)`
  - `desktop contacts profile-detail hero shell`
  - Overtone waveform / transport-bar signature visualization surfaces
- Controlled exceptions must still consume shared semantic tokens and may not define an independent token system.

## P-DESIGN-022 — Material Layering Contract

- Material is an axis orthogonal to the surface `tone` family declared in P-DESIGN-011. Governed surfaces that are not `solid` must declare both a tone and a material.
- Allowed materials are `solid`, `glass-regular`, and `glass-thick`. `solid` is the default and preserves backwards compatibility for surfaces that do not declare a material.
- `glass-regular` and `glass-thick` must resolve background fill, border color, and backdrop-filter blur strength through semantic `material.*` and `backdrop.*` tokens declared in `tables/nimi-ui-tokens.yaml`. Governed modules must not inline `rgba(...)` material values or inline `backdrop-filter` declarations.
- Material tokens are `foundation`-layer tokens. Every `material.*` and `backdrop.*` token must declare both light and dark values in `tables/nimi-ui-themes.yaml`.
- Material tokens must stay neutral. Accent expression is delivered through accent packs per P-DESIGN-002 and must not be welded into material values.
- Governed modules that consume a glass material must provide a `@supports not (backdrop-filter: blur(1px))` fallback that preserves legibility without requiring backdrop-filter, and must honor the `prefers-reduced-transparency` media feature by downgrading to a `solid` material.

## P-DESIGN-023 — Ambient Background Contract

- Ambient backgrounds are first-class governed surfaces, not decorative absolute-positioned elements authored per app.
- Allowed ambient variants are `mesh`, `minimal`, and `none`. `none` is the default and imposes no ambient treatment.
- `mesh` composes a radial-gradient aurora field plus soft blurred color halos. Its color slots and radii must resolve through `ambient.*` tokens declared in `tables/nimi-ui-tokens.yaml`; governed modules must not inline raw gradient stacks or hex halo colors.
- Ambient color-slot tokens are `foundation`-layer tokens with neutral defaults in the shared light and dark schemes. Accent packs may override any ambient slot to express product identity without changing the composition structure; overrides remain opt-in and must not remove the foundation default.
- Every `ambient.*` token must declare both light and dark values in `tables/nimi-ui-themes.yaml`.
- Governed modules that render ambient `mesh` must honor `prefers-reduced-motion` by disabling halo animation and must honor `prefers-reduced-transparency` by falling back to `minimal` or `none`.

## P-DESIGN-090 — Nimi Design Hard Gate

- `pnpm check:nimi-ui-pattern` is the hard gate for cross-app design compliance.
- The gate must fail when:
  - a governed module does not import `@nimiplatform/nimi-kit/ui`
  - an app renderer entry does not import the shared foundation CSS, both scheme packs, and exactly one accent pack
  - an app renderer entry does not apply theme state through the shared scheme runtime
  - a governed module defines local shell/sidebar/surface/action/overlay/toggle/scroll_area/avatar helper families
  - an app-local stylesheet defines a parallel root token registry or `@theme` block for governed semantic `--nimi-*` tokens
  - an app-local stylesheet assigns values to `--nimi-*` variables
  - a governed module defines CVA variants for shared primitive families outside `kit/ui`
  - a governed module introduces raw visual contract values outside `tables/nimi-ui-allowlists.yaml`
  - a foundation scheme or accent pack omits a required token value for its layer

## Fact Sources

- `tables/nimi-ui-tokens.yaml`
- `tables/nimi-ui-primitives.yaml`
- `tables/nimi-ui-themes.yaml`
- `tables/nimi-ui-adoption.yaml`
- `tables/nimi-ui-compositions.yaml`
- `tables/nimi-ui-allowlists.yaml`
- `tables/rule-evidence.yaml`
