# Design Pattern

> Status: Running today. The Nimi design pattern (`P-DESIGN-*`) is
> the shipped cross-app authority for shared visual + interaction
> contracts.

The Nimi **design pattern** is the shared visual + interaction
authority that sits inside `@nimiplatform/nimi-kit/ui`. It governs
kit primitives, semantic tokens, theme schemas, and the generic
contract any consuming app must follow.

## Foundation Authority

| Rule | Value |
| --- | --- |
| Authority spec | `.nimi/spec/platform/kernel/design-pattern-contract.md` |
| Authority tables | `.nimi/spec/platform/kernel/tables/` |
| Governed consumers | Declared by each app's local kit manifest |
| App-local spec may | Own concrete adoption inventory, app-owned compositions, accent selection, and art direction |
| App-local spec may NOT | Redefine shared primitive families, token taxonomies, or governance rules |

## Theme Pack Model (P-DESIGN-002)

The shared design foundation is **constant** across apps. App
identity comes from accent packs that layer on top.

| Layer | What it provides |
| --- | --- |
| Foundation scheme | Shared light / dark scheme (`nimi-light`, `nimi-dark`) |
| Shared accent pack | `nimi-accent` |
| Consumer accent pack | Optional app-owned pack declared in the consuming app spec manifest |

Governed app entries import:

```
@nimiplatform/nimi-kit/ui/themes/light.css
@nimiplatform/nimi-kit/ui/themes/dark.css
@nimiplatform/nimi-kit/ui/themes/<app>-accent.css   (exactly one)
```

There is no "mix two accent packs" mode and no "skip the foundation
scheme" mode.

## Semantic Token Taxonomy (P-DESIGN-003)

Shared semantic tokens live in `tables/nimi-ui-tokens.yaml`. The
admitted token categories include:

| Category | Examples |
| --- | --- |
| `surface` | Background tones |
| `text` | Text tones |
| `action` | Action / button tones |
| `overlay` | Overlay surfaces |
| `sidebar` | Sidebar tones |
| `field` | Form field tones |
| `status` | Status tones |
| `radius` | Corner radii |
| `spacing` | Spacing scale |
| `typography` | Font + size + weight |
| `stroke` | Stroke weights |
| `elevation` | Elevation tokens |
| `motion` | Motion durations + easing |
| `z` | Z-index scale |
| `sizing` | Component size tokens |
| `border` | Border tones |
| `opacity` | Opacity scale |
| `focus` | Focus ring tones |
| `scrollbar` | Scrollbar tones |
| `toggle` | Toggle tones |
| `material` | Material tokens (see [Nimi UI Material](/platform/kit/nimi-ui-material)) |
| `backdrop` | Backdrop blur tokens |
| `ambient` | Ambient effect tones |

Each semantic token declares whether it is a `foundation` or `accent`
layer token. Theme pack values live in `tables/nimi-ui-themes.yaml`.

App code must not invent parallel token registries for governed
surfaces.

## Theme Scheme Contract (P-DESIGN-004)

| Rule | Value |
| --- | --- |
| Resolved scheme states | `light` or `dark` |
| Apps may NOT define | Parallel app-local theme entrypoint or root token system |
| Accent packs may | Express product identity |
| Accent packs may NOT | Redefine primitive family structure |

## Primitive Visual Authority (P-DESIGN-005)

| Rule | Value |
| --- | --- |
| Variant taxonomy authority | `tables/nimi-ui-primitives.yaml` |
| Implementation pattern | CVA (class-variance-authority) + Tailwind utility classes inside `kit/ui` |
| Behavioral primitives | Radix UI headless primitives |
| Theme registration | Semantic tokens via Tailwind `@theme` in generated CSS |
| Primitive CSS class selectors | NOT generated separately; CVA composes |
| App / shared-lib code may | Compose shared primitives |
| App / shared-lib code may NOT | Define CVA variants for shared primitive families outside `kit/ui` |

## No App-Local Primitive Redefinition (P-DESIGN-006)

| Rule | Value |
| --- | --- |
| Governed app stylesheets may NOT | Define CVA variants or Tailwind utility overrides targeting shared primitive families |
| App-local wrappers may | Add composition class names |
| App-local wrappers may NOT | Redefine shared primitive visual contract |
| Controlled exceptions may | Style app-owned selectors only |

## No App-Local Token Overrides (P-DESIGN-007)

| Rule | Value |
| --- | --- |
| Governed app stylesheets may NOT | Assign values to `--nimi-*` CSS variables |
| Shared semantic token values | Originate only from generated theme CSS emitted from `tables/nimi-ui-themes.yaml` |
| Shared-lib handwritten CSS may | Read semantic tokens |
| Shared-lib handwritten CSS may NOT | Provide fallback token authority |

## Accent Alias Phase-Out (P-DESIGN-008)

Generated accent packs emit shared `--nimi-*` semantic token values
only. App-scoped alias namespaces (`--ot-*`, `--color-ot-*`,
`--color-brand-*`, `--color-accent-*`) are not long-term authority.
Retired app-specific full-theme compatibility outputs cannot remain
in the generated shared-lib theme surface once foundation-plus-accent
is active.

Governed app chrome may layer app identity through shared semantic
tokens and local `color-mix(...)` expressions, but not through
app-scoped accent aliases for shared background / text / focus /
surface meaning.

## Shared Primitive Contract (P-DESIGN-010)

Shared primitives:

- Delivered by `@nimiplatform/nimi-kit/ui`
- Built on Radix UI headless primitives (Dialog, Tooltip, ScrollArea,
  Select, Switch, Avatar, Popover)
- Styled with CVA + Tailwind referencing `--nimi-*` semantic tokens

Governed app modules **must** use shared primitives for shell-level
families: `surface`, `action`, `overlay`, `sidebar`, `field`,
`status`, `scroll_area`, `toggle`, `avatar`. Thin compatibility
wrappers are permitted only if they delegate directly to
`@nimiplatform/nimi-kit/ui` and do not redefine the visual contract.

## Reader Scenario: Adding An Accent Pack For A New App

A new admitted Nimi app needs its own accent identity.

1. **Add accent pack.** A new
   `<app>-accent.css` lands under
   `@nimiplatform/nimi-kit/ui/themes/`.
2. **Tokens overridden.** The accent pack assigns values to admitted
   `accent`-layer semantic tokens; foundation tokens stay untouched.
3. **App imports.** App entry imports the foundation light + dark CSS
   plus exactly its own `-accent.css`.
4. **Visual identity emerges.** The app feels distinct while
   sharing the foundation scheme.

The accent pack did not invent new token namespaces. It values
admitted tokens.

## Reader Scenario: A Mod Wants A New Visual Variant

A mod author wants a button variant that doesn't match any admitted
shared primitive variant.

1. **Check the variant table first.** `tables/nimi-ui-primitives.yaml`
   declares admitted variants.
2. **If the variant isn't there:** the mod cannot define a new CVA
   variant for the shared primitive family in app-local code.
3. **Options:** propose a new admitted variant for the shared
   primitive (governance flow), or use a custom app-local component
   that does not hold the same primitive name.

The boundary keeps the shared primitive contract honest.

## What The Design Pattern Does Not Do

- It does not allow per-app shared primitive redefinition.
- It does not allow per-app `--nimi-*` token overrides.
- It does not let accent packs change foundation tokens.
- It does not allow free-form CSS to claim authority over shared
  primitive families.

## Boundary Summary

| Concern | Authority |
| --- | --- |
| Foundation authority | `P-DESIGN-001` |
| Theme pack model | `P-DESIGN-002` |
| Semantic token taxonomy | `P-DESIGN-003` + `tables/nimi-ui-tokens.yaml` |
| Theme scheme contract | `P-DESIGN-004` |
| Primitive visual authority | `P-DESIGN-005` + `tables/nimi-ui-primitives.yaml` |
| App-local redefinition rules | `P-DESIGN-006`, `P-DESIGN-007`, `P-DESIGN-008` |
| Shared primitive contract | `P-DESIGN-010` |

## Source Basis

- [`.nimi/spec/platform/kernel/design-pattern-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/design-pattern-contract.md)
- [`.nimi/spec/platform/kernel/tables/nimi-ui-tokens.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/tables/nimi-ui-tokens.yaml)
- [`.nimi/spec/platform/kernel/tables/nimi-ui-themes.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/tables/nimi-ui-themes.yaml)
- [`.nimi/spec/platform/kernel/tables/nimi-ui-primitives.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/tables/nimi-ui-primitives.yaml)
- [`.nimi/spec/platform/kernel/kit-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/kit-contract.md)
