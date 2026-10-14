# Design Pattern

> Status: Active specification. The Nimi Design Pattern (`P-DESIGN-*`) defines cross-app visual conventions and interaction contracts.

The Nimi **Design Pattern** is maintained in `@nimiplatform/kit/ui`. It governs UI primitives, semantic design tokens, theme layering, and the shared visual and interaction contracts that every managed application follows.

## Foundational Specifications

| Dimension | Specification & Rule |
| --- | --- |
| Authoritative spec | `.nimi/spec/platform/ui-design-system.authority.yaml` |
| Machine projection | `config/platform-*.yaml` |
| Managed consumers | Declared in each app's local Kit manifest |
| Allowed app ownership | Component composition, local layout, accent pack selection, and product-specific visual identity |
| Disallowed app behavior | Redefining shared primitive families, inventing unmanaged token categories, or breaking platform contracts |

## Theme Pack Architecture (P-DESIGN-002)

All applications share a common visual foundation, while each app expresses its own brand identity through a single accent pack overlay.

| Layer | Content & Responsibility |
| --- | --- |
| Foundation scheme | Shared light and dark base schemes (`nimi-light`, `nimi-dark`) |
| Shared accent pack | Default platform accent scheme (`nimi-accent`) |
| Consumer accent pack | App-specific accent overlay declared in the app manifest |

Managed applications import their theme stylesheets at the entry point:

```css
@nimiplatform/kit/ui/themes/light.css
@nimiplatform/kit/ui/themes/dark.css
@nimiplatform/kit/ui/themes/<app>-accent.css   /* Exactly one accent pack */
```

Combining multiple accent packs or rendering an accent pack without the foundational base scheme is not supported.

## Semantic Token Taxonomy (P-DESIGN-003)

Platform-wide semantic tokens are defined in `config/platform-nimi-ui-tokens.yaml`:

| Category | Example Usage |
| --- | --- |
| `surface` | Card and background surface tones |
| `text` | Multi-tier text hierarchy and opacity |
| `action` | Interactive button and action state tones |
| `overlay` | Modal and popover backdrop overlays |
| `sidebar` | Navigation and sidebar backgrounds |
| `field` | Form input fields, borders, and controls |
| `status` | Informational, success, warning, and error states |
| `radius` | Corner radius scale |
| `spacing` | Spacing and margin scale |
| `typography` | Font families, size scales, and weights |
| `stroke` | Border stroke widths |
| `elevation` | Shadows and depth layers |
| `motion` | Animation durations and bezier easings |
| `z` | Layer z-index scale |
| `sizing` | Standard control dimensions |
| `border` | Divider and border tones |
| `opacity` | General opacity scale |
| `focus` | Keyboard focus ring highlights |
| `scrollbar` | Custom scrollbar tracks and thumbs |
| `toggle` | Switch and checkbox active states |
| `material` | Material textures and frosted glass (see [Nimi UI Material](/platform/kit/nimi-ui-material)) |
| `backdrop` | Backdrop gaussian blur gradients |
| `ambient` | Ambient glow and atmospheric highlights |

Every semantic token belongs to either the `foundation` layer or the `accent` layer, with concrete values generated from `config/platform-nimi-ui-themes.yaml`. Application code must not maintain parallel, unmanaged token registries.

## Theme Scheme Contract (P-DESIGN-004)

| Dimension | Contract Constraint |
| --- | --- |
| Resolved scheme | Evaluates strictly to `light` or `dark` |
| Root variable rule | Apps must not define parallel theme roots or private root variable systems outside the spec |
| Accent freedom | Accent packs may freely express app-specific brand colors and emphasis styles |
| Accent constraint | Accent packs must not override foundational base schemes or alter primitive structure |

## Visual Primitives Specification (P-DESIGN-005)

| Dimension | Contract Constraint |
| --- | --- |
| Variant taxonomy | Defined in `config/platform-nimi-ui-primitives.yaml` |
| Implementation | Uses `cva` (Class Variance Authority) with Tailwind CSS utilities inside `kit/ui` |
| Interaction core | Built on accessible, unstyled Radix UI headless primitives |
| Token mapping | Bound via Tailwind `@theme` directives backed by generated CSS variables |
| Consumption | Consumed through CVA variant props rather than scattered class selectors |
| Allowed app ownership | Freely composing exported Kit primitives |
| Disallowed app behavior | Declaring custom CVA variants outside `kit/ui` for shared primitive families |

## No App-Local Primitive Redefinitions (P-DESIGN-006)

| Dimension | Contract Constraint |
| --- | --- |
| Stylesheet restrictions | App stylesheets must not define global override classes or conflicting Tailwind rules targeting shared primitives |
| Wrapper components | Apps may build local business wrappers to arrange layout and composition |
| Contract integrity | Local wrappers must preserve the visual and interaction contracts of shared primitives |
| Scoped overrides | Custom styles may target only app-owned DOM nodes and private class names |

## No App-Local Token Overrides (P-DESIGN-007)

| Dimension | Contract Constraint |
| --- | --- |
| Variable assignment | App stylesheets must not reassign `--nimi-*` global CSS variables |
| Token source | Semantic tokens are compiled exclusively from `config/platform-nimi-ui-themes.yaml` |
| Safe consumption | Shared primitives and app components read tokens via `var(--nimi-*)` |
| Conflict avoidance | Avoid hardcoded color values or conflicting fallback tokens in local CSS |

## Deprecating Legacy Aliases (P-DESIGN-008)

Compiled accent packs emit standardized `--nimi-*` semantic tokens only. Legacy alias prefixes (`--ot-*`, `--color-ot-*`, `--color-brand-*`, `--color-accent-*`) are retired and must not be emitted or consumed as shared visual authority.

When apps need finer brand expression, they should pair standard semantic tokens with local `color-mix(...)` expressions rather than relying on private alias variables for core semantics such as surfaces, text, or focus states.

## Shared Primitives Contract (P-DESIGN-010)

Shared UI primitives:
- Are exported from `@nimiplatform/kit/ui`;
- Build on Radix UI headless components for accessibility (including Dialog, Tooltip, ScrollArea, Select, Switch, Avatar, and Popover);
- Reference `--nimi-*` semantic tokens through CVA variants and Tailwind utilities.

Managed app modules must use the following shell-level primitive families: `surface`, `action`, `overlay`, `sidebar`, `field`, `status`, `scroll_area`, `toggle`, and `avatar`. Apps may add lightweight business wrappers as long as the baseline visual and interaction contracts remain intact.

## Typical Scenario: Adding an Accent Pack for a New App

When a new app needs its own brand accent:

1. **Declare the accent**: Add app-owned accent values to the governed theme inputs so generation produces `<app>-accent.css` under `@nimiplatform/kit/ui/themes/`.
2. **Assign accent tokens**: Set values for supported `accent` layer tokens while leaving `foundation` tokens untouched.
3. **Import the theme files**: Import the base light/dark CSS and `<app>-accent.css` in the app entry module.
4. **Render the brand identity**: The app presents its own visual accent while staying aligned with platform-wide accessibility and interaction contracts.

An accent pack only assigns values to existing standard tokens; it must not introduce unregistered private token prefixes.

## Typical Scenario: Requesting a New Visual Variant

When an app needs a button style that existing primitives do not cover:

1. **Check the spec**: Review `config/platform-nimi-ui-primitives.yaml` for supported variants.
2. **Respect boundaries**: Do not patch or add custom CVA variants to the shared Button component inside app code.
3. **Choose a supported path**: For a new shared-family variant, update its official Kit contract and implementation. App-local business composition may arrange existing primitives but cannot evade their contracts by renaming a wrapper.

## Architectural Boundaries

- Apps must not override or alter the contracts of shared primitives.
- Apps must not assign values to `--nimi-*` CSS variables in local stylesheets.
- Accent packs apply only to the `accent` token layer and must not modify `foundation` tokens.
- Unmanaged global CSS must not target or pollute shared primitive selectors.

## Specification Summary

| Concern | Specification Authority |
| --- | --- |
| Foundational architecture | `P-DESIGN-001` |
| Theme layering model | `P-DESIGN-002` |
| Semantic token taxonomy | `P-DESIGN-003` + `config/platform-nimi-ui-tokens.yaml` |
| Scheme resolution contract | `P-DESIGN-004` |
| Visual primitive system | `P-DESIGN-005` + `config/platform-nimi-ui-primitives.yaml` |
| Local redefinition restrictions | `P-DESIGN-006`, `P-DESIGN-007`, `P-DESIGN-008` |
| Shared primitive contracts | `P-DESIGN-010` |

## Source Basis

- [`.nimi/spec/platform/ui-design-system.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/ui-design-system.authority.yaml)
- [`config/platform-nimi-ui-tokens.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/platform-nimi-ui-tokens.yaml)
- [`config/platform-nimi-ui-themes.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/platform-nimi-ui-themes.yaml)
- [`config/platform-nimi-ui-primitives.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/platform-nimi-ui-primitives.yaml)
