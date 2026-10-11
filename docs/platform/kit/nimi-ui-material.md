# Nimi UI Material

> Status: Active specification contract; public capabilities are exposed via the Design/Runtime surface.

Under `P-DESIGN-022`, the 5-tier material taxonomy is fully specified and published in `config/platform-nimi-ui-tokens.yaml`. The performance-downgrade hook-point interface is reserved at the specification level; active rendering surfaces resolve material tiers through Kit and host transparency modes.

## What "Material" Means

In the Nimi design pattern, **material** describes the surface treatment of a component: its opacity, backdrop blur, and how it reads against underlying visual layers.

Material is an orthogonal axis to color hue: you can pair a `solid` action button, a `glass-thick` floating modal, or a `glass-chrome` overlay with any semantic color role (primary, danger, neutral, etc.) without conflict.

Material is organized as a **closed 5-tier taxonomy**. Applications and feature modules may not introduce parallel, unmanaged material hierarchies.

## The 5 Tiers

In ascending order of opacity and blur intensity:

| Tier | Background Token | Border Token | Backdrop Blur |
| --- | --- | --- | --- |
| `solid` | Resolves through `surface.*` tone families (no material bg/border token) | — | — |
| `glass-thin` | `material.glass_thin.bg` (`--nimi-material-glass-thin-bg`) | `material.glass_thin.border` | `backdrop.blur_thin` |
| `glass-regular` | `material.glass_regular.bg` | `material.glass_regular.border` | `backdrop.blur_regular` |
| `glass-thick` | `material.glass_thick.bg` | `material.glass_thick.border` | `backdrop.blur_strong` |
| `glass-chrome` | `material.glass_chrome.bg` | `material.glass_chrome.border` | `backdrop.blur_chrome` |

The platform's blur radius gradient maps strictly to `blur_thin / blur_regular / blur_strong / blur_chrome`.

This 5-tier classification supersedes the earlier 3-tier model (`solid` / `glass-regular` / `glass-thick`), preserving backwards compatibility while formally adding `glass-thin` and `glass-chrome`.

## Consumer Rules

| Rule | Enforcement Level |
| --- | --- |
| Consume materials via the `<Surface material="...">` primitive in `@nimiplatform/kit/ui` or the equivalent `data-nimi-material="<tier>"` marker | Mandatory |
| Hardcoded inline `rgba(...)` material background fills | Strictly forbidden |
| Inline `backdrop-filter` declarations | Strictly forbidden |
| Arbitrary `backdrop-blur-*` Tailwind classes outside Kit-emitted utilities | Strictly forbidden |
| Accent packs overriding `material.*` or `backdrop.*` tokens | Strictly forbidden (materials belong to the neutral foundation layer) |
| Adding a custom 6th tier | Requires formal platform specification proposal |

Using the `<Surface>` primitive guarantees visual consistency across various application surfaces.

## Design Rationale for Each Tier

Each tier satisfies a specific visual hierarchy and readability objective:

| Tier | Primary Purpose & Context |
| --- | --- |
| `solid` | High-contrast surfaces where text readability is paramount (forms, dense data grids) |
| `glass-thin` | Subtle hover surfaces and lightweight overlays that maintain spatial continuity |
| `glass-regular` | Standard frosted glass surfaces (drawers, floating sidebars, dropdowns) |
| `glass-thick` | Heavy frosted glass designed to suppress complex motion underneath (dialogs over active animations) |
| `glass-chrome` | Maximum blur and prominence for chrome-level system surfaces (application top bars, command palettes) |

The taxonomy is intentionally opinionated. Developers should not invent ad-hoc blur values for fleeting visual experiments.

## Performance Downgrade Hook Interface

Backdrop filters incur GPU processing overhead. The design specification reserves a performance-downgrade hook interface: when running on resource-constrained devices or under low battery profiles, runtime surfaces can step down higher-cost tiers to lower-cost representations. Implementation of the downgrade behavior is a consumer-surface responsibility; the specification defines the interface so applications read degraded tiers consistently.

Crucially, performance downgrades **do not alter** the component contract itself; they merely adjust the resolved tier at render time. A component declared as `glass-chrome` may render as `glass-regular` or solid on lower-tier hardware without requiring any application-level code modifications.

## Accessibility Contrast Thresholds

The specification pins strict accessibility (a11y) contrast minimums across material tiers against foundational text and border colors. Component styling must preserve readable contrast thresholds; specialized cases must utilize established platform contrast compensation rules rather than inventing arbitrary materials.

## Typical Scenario: Selecting a Tier for a Modal

An application presents a modal dialog over an active particle canvas:

1. **Identify visual requirement**: The modal requires crisp readability while subduing animated background noise. `glass-thick` is selected.
2. **Apply primitive**: `<Surface material="glass-thick">...</Surface>`.
3. **Automated token binding**: Background and borders map to `material.glass_thick.*`, and backdrop blur resolves to `backdrop.blur_strong`.
4. **Adaptive degradation**: On lower-power devices or accessibility modes, host rendering surfaces can step down rendering cost via Kit transparency modes (e.g., rendering as `glass-regular`) while keeping dialog text readable.

Developers specify `material="glass-thick"`; platform infrastructure manages variable mapping and contract resolution.

## Typical Scenario: Intercepting Ad-Hoc Inline Blur

A feature author writes inline styles: `style=\{\{ background: 'rgba(...)', backdropFilter: 'blur(20px)' \}\}`:

1. **Linting & review catch**: Static linters flag the disallowed inline blur declarations.
2. **Refactor to primitive**: The component is replaced with `<Surface material="glass-regular">`.
3. **Visual cohesion**: The panel now conforms to platform-wide aesthetic and accessibility baselines.

## Typical Scenario: Proposing a New Material Tier

A designer requests a novel blur intensity for a unique surface context:

1. **Closed taxonomy**: Applications cannot unilaterally introduce a 6th material tier.
2. **Formal evaluation**: A proposal is submitted to the design system maintainers to evaluate the blur gradient, followed by updating `config/platform-nimi-ui-tokens.yaml` and the `<Surface>` primitive.
3. **Ecosystem release**: Once released, all applications can consume the new tier under uniform rules.

This discipline prevents UI sprawl and guarantees long-term maintainability.

## Architectural Boundaries

- Accent packs cannot override foundational material tokens.
- Ad-hoc inline glass styling is forbidden.
- Custom blur radius values cannot be injected outside the token catalog.
- Material tiers cannot be extended without formal specification updates.
- Performance downgrades adjust render output only; component authoring contracts remain unchanged.

## Specification Summary

| Concern | Authority |
| --- | --- |
| 5-tier material taxonomy & tokens | `P-DESIGN-022` |
| Complete token catalog | `config/platform-nimi-ui-tokens.yaml` |
| Preset theme values | `config/platform-nimi-ui-themes.yaml` |
| `<Surface>` primitive | `@nimiplatform/kit/ui` |
| Performance downgrade interface | `P-DESIGN-022` (specification) |
| Downgrade execution & transparency modes | Kit and host rendering surfaces |

## Source Basis

- [`.nimi/spec/platform/ui-design-system.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/ui-design-system.authority.yaml)
- [`config/platform-nimi-ui-tokens.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/platform-nimi-ui-tokens.yaml)
- [`config/platform-nimi-ui-themes.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/platform-nimi-ui-themes.yaml)
