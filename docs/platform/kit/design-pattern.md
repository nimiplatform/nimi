# Design Pattern

> Status: Active specification. The Nimi Design Pattern (`P-DESIGN-*`) defines cross-app visual conventions and interaction contracts.

The Nimi **Design Pattern** is implemented and maintained in `@nimiplatform/kit/ui`. It governs UI primitives, semantic design tokens, theme layering schemas, and the shared contracts every consuming application complies with.

## Foundational Specifications

| Dimension | Specification & Rule |
| --- | --- |
| Authoritative spec | `.nimi/spec/platform/ui-design-system.authority.yaml` |
| Machine projection | `config/platform-*.yaml` |
| Managed consumers | Declared in each app's local Kit manifest |
| Allowed app ownership | Component composition, local layout, accent pack selection, product-specific visual identity |
| Disallowed app behavior | Redefining shared primitive families, inventing unmanaged token categories, or breaking platform contracts |

## Theme Pack Architecture (P-DESIGN-002)

The shared design foundation remains consistent across all applications. Individual app brand identity is expressed through an overlay accent pack.

| Layer | Content & Responsibility |
| --- | --- |
| Foundation scheme | Shared light and dark base schemes (`nimi-light`, `nimi-dark`) |
| Shared accent pack | Default platform accent scheme (`nimi-accent`) |
| Consumer accent pack | App-specific accent overlay, declared in app manifest |

Managed applications import their themes at entry:

```css
@nimiplatform/kit/ui/themes/light.css
@nimiplatform/kit/ui/themes/dark.css
@nimiplatform/kit/ui/themes/<app>-accent.css   /* Exactly one accent pack */
```

The system does not support combining multiple accent packs or bypassing the foundational base scheme.

## Semantic Token Taxonomy (P-DESIGN-003)

Platform-wide semantic tokens are defined in `config/platform-nimi-ui-tokens.yaml`:

| Category | Example Usage |
| --- | --- |
| `surface` | Card and background surface tones |
| `text` | Multi-tier text hierarchy and contrast |
| `action` | Interactive button and action state tones |
| `overlay` | Modal and popover backdrop overlays |
| `sidebar` | Navigation and sidebar backgrounds |
| `field` | Form input fields, borders, and controls |
| `status` | Informational, success, warning, and error states |
| `radius` | Consistent corner radius scale |
| `spacing` | Spacing and margin scale |
| `typography` | Font families, size scales, and weights |
| `stroke` | Border stroke weights |
| `elevation` | Shadows and depth layers |
| `motion` | Animation durations and bezier easings |
| `z` | Layer z-index scale |
| `sizing` | Standard control dimensions |
| `border` | Divider and border tones |
| `opacity` | General opacity scale |
| `focus` | Keyboard focus ring outlines |
| `scrollbar` | Custom scrollbar tracks and thumbs |
| `toggle` | Switch and checkbox active states |
| `material` | Material textures and frosted glass (see [Nimi UI Material](/platform/kit/nimi-ui-material)) |
| `backdrop` | Backdrop gaussian blur gradients |
| `ambient` | Ambient glow and atmospheric highlights |

Each semantic token belongs either to the `foundation` layer or the `accent` layer. Specific variable values are mapped in `config/platform-nimi-ui-themes.yaml`.

App code must not introduce parallel, unmanaged token registries.

## Theme Scheme Contract (P-DESIGN-004)

| Dimension | Contract Constraint |
| --- | --- |
| Resolved scheme | Evaluates strictly to `light` or `dark` |
| Disallowed | Apps may not establish parallel theme roots or private token systems |
| Accent freedom | Accent packs may freely convey app product identity |
| Accent constraint | Accent packs may not alter base structural schemes |

## Visual Primitives Specification (P-DESIGN-005)

| Dimension | Contract Constraint |
| --- | --- |
| Variant taxonomy | Canonical definitions in `config/platform-nimi-ui-primitives.yaml` |
| Implementation | Uses `cva` (Class Variance Authority) with Tailwind CSS utilities inside `kit/ui` |
| Interaction core | Built atop accessible, unstyled Radix UI headless primitives |
| Token mapping | Registered via Tailwind `@theme` directives backed by generated CSS variables |
| Consumption | Components consume variants via CVA props rather than scattered CSS classes |
| Allowed app ownership | Composing exported Kit primitives |
| Disallowed app behavior | Declaring custom CVA variants outside `kit/ui` for shared primitive families |

## No App-Local Primitive Redefinitions (P-DESIGN-006)

| Dimension | Contract Constraint |
| --- | --- |
| Stylesheet restrictions | App stylesheets must not inject global overrides or conflicting utility classes on shared primitives |
| Wrapper components | Allowed to build business wrappers for local composition |
| Contract integrity | Local wrappers must not violate the established visual or interaction contracts of shared primitives |
| Scoped overrides | Custom styling may only target app-owned private DOM nodes and class selectors |

## No App-Local Token Overrides (P-DESIGN-007)

| Dimension | Contract Constraint |
| --- | --- |
| Variable assignment | App stylesheets must not directly assign values to `--nimi-*` global CSS variables |
| Token source | Semantic tokens are generated solely from `config/platform-nimi-ui-themes.yaml` |
| Safe consumption | Application components consume variables safely via standard `var(--nimi-*)` references |
| Conflict avoidance | Hardcoded values or conflicting token fallbacks should be avoided |

## Deprecating Legacy Aliases (P-DESIGN-008)

Compiled accent packs emit standardized `--nimi-*` semantic tokens. Legacy alias prefixes (such as `--ot-*`, `--color-ot-*`, `--color-brand-*`, `--color-accent-*`) are transitional artifacts and are being phased out.

Apps achieve nuanced brand expression by pairing standard semantic tokens with modern CSS functions like `color-mix(...)`, avoiding ad-hoc alias variables.

## Shared Primitives Contract (P-DESIGN-010)

Shared UI primitives:
- Are exported directly from `@nimiplatform/kit/ui`;
- Rely on accessible Radix UI headless components (Dialog, Tooltip, ScrollArea, Select, Switch, Avatar, Popover, etc.);
- Connect to `--nimi-*` semantic tokens via CVA variants and Tailwind classes.

Managed app modules must use the following shell-level primitive families: `surface`, `action`, `overlay`, `sidebar`, `field`, `status`, `scroll_area`, `toggle`, and `avatar`. Apps may provide lightweight wrappers, but must preserve baseline contracts.

## Typical Scenario: Adding an Accent Pack for a New App

A new app requires a tailored visual accent:

1. **Add accent stylesheet**: Place `<app>-accent.css` under `@nimiplatform/kit/ui/themes/`.
2. **Assign accent tokens**: Provide values for supported `accent` layer tokens; foundational base tokens remain untouched.
3. **Import configuration**: Import base light and dark CSS plus the app's specific accent stylesheet in the entry module.
4. **Distinct visual identity**: The application renders with its unique visual branding while preserving full platform accessibility and visual cohesion.

## Typical Scenario: Requesting a New Visual Variant

An application requires a button variant not covered by existing primitives:

1. **Check specifications**: Inspect `config/platform-nimi-ui-primitives.yaml` for supported variants.
2. **Outside current scope**: Avoid monkey-patching or writing custom CVA variants locally on the shared Button component.
3. **Supported approaches**: Propose a new variant for inclusion in the official Kit specifications, or create a private, locally scoped component that does not usurp the shared primitive's name.

## Architectural Boundaries

- Applications cannot redefine or tamper with shared primitive contracts.
- Applications cannot assign values directly to `--nimi-*` CSS variables.
- Accent packs customize the accent layer only; foundation schemes remain consistent.
- Arbitrary global CSS cannot hijack shared component selectors.

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
