# Nimi UI Material

## Status: Admitted Contract; Public Use Follows Design/Runtime Surfaces

The 5-tier material taxonomy under `P-DESIGN-022` is admitted and
the token catalog is shipped under `tables/nimi-ui-tokens.yaml`. The
perf-downgrade hook-point interface is admitted at the spec level;
runtime-side perf-downgrade behavior is available only when exposed by
the owning design/runtime surface.

## What "Material" Means

In the Nimi design pattern, **material** describes the surface
treatment of a component: how opaque it is, how its backdrop blurs,
how it reads against what is behind it. Material is a separate axis
from color tone; you can have a `solid` action button, a
`glass-thick` panel, a `glass-chrome` overlay — independent from
their semantic color role.

Material is a **closed 5-tier taxonomy**. No app or feature
module may author a parallel material axis.

## The 5 Tiers

In ascending opacity / blur intensity order:

| Tier | Background token | Border token | Backdrop blur |
| --- | --- | --- | --- |
| `solid` | Resolves through `surface.*` tone family (no material bg/border token) | — | — |
| `glass-thin` | `material.glass_thin.bg` (`--nimi-material-glass-thin-bg`) | `material.glass_thin.border` | `backdrop.blur_thin` |
| `glass-regular` | `material.glass_regular.bg` | `material.glass_regular.border` | `backdrop.blur_regular` |
| `glass-thick` | `material.glass_thick.bg` | `material.glass_thick.border` | `backdrop.blur_strong` |
| `glass-chrome` | `material.glass_chrome.bg` | `material.glass_chrome.border` | `backdrop.blur_chrome` |

The blur radii gradient maps to `blur_thin / blur_regular /
blur_strong / blur_chrome`.

The 5-tier set supersedes a prior 3-tier (`solid` /
`glass-regular` / `glass-thick`) form. The original tier names are
preserved byte-for-byte; `glass-thin` and `glass-chrome` are admitted
additions.

## Consumer Rules

| Rule | Required |
| --- | --- |
| Consume material via `<Surface material="...">` primitive in `@nimiplatform/kit/ui`, OR equivalent `data-nimi-material="<tier>"` marker class | Yes |
| Inline `rgba(...)` material background fills | Forbidden |
| Inline `backdrop-filter` declarations | Forbidden |
| Hand-picked `backdrop-blur-*` Tailwind named tokens outside kit-emitted utility classes | Forbidden |
| Accent packs override `material.*` or `backdrop.*` tokens | Forbidden (material tokens are neutral foundation-layer) |
| Adding a 6th tier | Requires new admission (not pre-authorized) |

The bias toward consuming material through the `<Surface>` primitive
is what keeps tier behavior consistent across apps.

## Why The Tiers

Each tier exists for a particular reading purpose:

| Tier | Use |
| --- | --- |
| `solid` | High-priority surfaces where pixel readability matters most (forms, dense data) |
| `glass-thin` | Subtle hover / overlay surfaces that should not detach visually |
| `glass-regular` | Standard glass surfaces (most overlays, side panels) |
| `glass-thick` | Heavier glass for surfaces that need to dominate over background motion (modals over animation) |
| `glass-chrome` | The strongest glass treatment, for chrome-level surfaces (top bars, command palettes) |

The taxonomy is opinionated. Authors do not free-mix backdrop-blur
values for new visual effects.

## Perf-Downgrade Hook-Point Interface

Glass tiers carry GPU cost. The contract reserves a perf-downgrade
hook-point interface that runtime implementations can use to step
down a higher-cost tier when the device cannot sustain it. Runtime
implementation of the downgrade behavior is a separate consumer
responsibility; the contract pins the **interface** so apps can read
a degraded tier consistently.

The downgrade does **not** change the material taxonomy itself —
it changes which tier resolves at render time. A surface authored
as `glass-chrome` may render as `glass-regular` on a degraded
device; the authoring contract is unchanged.

## Accessibility Contrast Threshold

The contract pins an a11y contrast threshold for material tiers
against admitted tone families. Tier choice cannot drop text /
boundary contrast below the admitted threshold; consumers that
require non-default contrast must use an admitted exception
mechanism — not invent a parallel material axis.

## Reader Scenario: A Modal Picks Its Tier

An app needs a modal over animated background content.

1. **Pick the tier intent.** The modal must read clearly while the
   background may animate. `glass-thick` matches.
2. **Use the primitive.** `<Surface material="glass-thick">...</Surface>`.
3. **Token resolution.** Background and border resolve from
   `material.glass_thick.*`; backdrop blur from `backdrop.blur_strong`.
4. **Perf downgrade.** On a low-power device, runtime may downgrade
   to `glass-regular`; the modal still reads.

The author wrote one `material="glass-thick"` and the rest is
admitted.

## Reader Scenario: An App Tries Inline Glass

An app author writes inline `style=\{\{ background: 'rgba(...)',
backdropFilter: 'blur(20px)' \}\}` for a custom panel.

1. **Reject.** Per consumer rules, inline `rgba(...)` material
   background and inline `backdrop-filter` declarations are
   forbidden.
2. **Re-route.** The app uses `<Surface material="glass-regular">`
   or whichever admitted tier matches the intent.
3. **Visual consistency.** The app's panel matches every other
   admitted glass surface in the platform.

## Reader Scenario: Wanting A Sixth Tier

A designer proposes a sixth material tier for a new visual context.

1. **Closed taxonomy.** The contract does not pre-authorize
   expansion.
2. **Admission required.** The proposal goes through governance: new
   tier added to `tables/nimi-ui-tokens.yaml` material category, new
   blur radii admitted, new tier added to `<Surface>` primitive's
   variant set, perf-downgrade interface reviewed.
3. **After admission.** The new tier ships with the same consumer
   rules.

The boundary is intentional: free-form material expansion is what
turns a design system into per-app sprawl.

## What This Does Not Do

- It does not let accent packs override material tokens.
- It does not allow inline glass.
- It does not let apps invent custom blur values outside admitted
  Kit utility classes.
- It does not allow a 6th tier without admission.
- It does not change tier behavior under perf downgrade — only the
  resolved tier changes; the authoring contract is stable.

## Boundary Summary

| Concern | Authority |
| --- | --- |
| 5-tier taxonomy + tokens | `P-DESIGN-022` (this contract) |
| Token catalog | `tables/nimi-ui-tokens.yaml` |
| Theme values | `tables/nimi-ui-themes.yaml` |
| `<Surface>` primitive | `@nimiplatform/kit/ui` |
| Perf-downgrade interface | This contract (spec-level) |
| Runtime perf-downgrade implementation | Consumer responsibility (separate) |

## Source Basis

- [`.nimi/spec/platform/kernel/nimi-ui-material-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/nimi-ui-material-contract.md)
- [`.nimi/spec/platform/kernel/design-pattern-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/design-pattern-contract.md)
- [`.nimi/spec/platform/kernel/tables/nimi-ui-tokens.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/tables/nimi-ui-tokens.yaml)
- [`.nimi/spec/platform/kernel/tables/nimi-ui-themes.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/tables/nimi-ui-themes.yaml)
- [`.nimi/spec/platform/kernel/kit-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/kit-contract.md)
