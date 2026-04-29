# Nimi UI Material Contract

> Supplementary spec documentation for the `P-DESIGN-022 — Material Layering
> Contract` rule declared in `design-pattern-contract.md`. This file is a
> prose companion to the token catalog in
> `tables/nimi-ui-tokens.yaml` and the value table in
> `tables/nimi-ui-themes.yaml`. It does **not** introduce a new token
> table or a new rule ID. It pins the 5-tier material taxonomy, declares
> the perf-downgrade hook-point interface at the spec level, fixes the
> a11y contrast threshold, and reserves an empty admitted-exceptions
> section for future controlled exceptions.
>
> Compatibility: this contract supersedes the prior 3-tier material taxonomy
> (`solid`, `glass-regular`, `glass-thick`), preserving those tier names
> byte-for-byte while admitting `glass-thin` and `glass-chrome` and
> re-anchoring the backdrop blur radii gradient.

## 1. Material Consumption Boundary

The 5-tier taxonomy admitted under `P-DESIGN-022` is the single material
authority for all governed surfaces in the repo. No app, mod, or feature
module may author a parallel material axis.

**Allowed tiers (in ascending opacity / blur intensity order):**

| Tier | Background token | Border token | Backdrop blur |
|---|---|---|---|
| `solid` | resolves through the surface-tone token family (`surface.*`) — no material bg/border token | — | — |
| `glass-thin` | `material.glass_thin.bg` (`--nimi-material-glass-thin-bg`) | `material.glass_thin.border` (`--nimi-material-glass-thin-border`) | `backdrop.blur_thin` (`--nimi-backdrop-blur-thin`) |
| `glass-regular` | `material.glass_regular.bg` (`--nimi-material-glass-regular-bg`) | `material.glass_regular.border` (`--nimi-material-glass-regular-border`) | `backdrop.blur_regular` (`--nimi-backdrop-blur-regular`) |
| `glass-thick` | `material.glass_thick.bg` (`--nimi-material-glass-thick-bg`) | `material.glass_thick.border` (`--nimi-material-glass-thick-border`) | `backdrop.blur_strong` (`--nimi-backdrop-blur-strong`) |
| `glass-chrome` | `material.glass_chrome.bg` (`--nimi-material-glass-chrome-bg`) | `material.glass_chrome.border` (`--nimi-material-glass-chrome-border`) | `backdrop.blur_chrome` (`--nimi-backdrop-blur-chrome`) |

**Blur radii gradient (in px):** `10 / 18 / 24 / 28` mapped to
`blur_thin / blur_regular / blur_strong / blur_chrome`. This supersedes
the W1 `24 / 32` two-value anchor.

**Consumer rules:**

- Governed surfaces must consume material only through the
  `<Surface material="...">` primitive in `@nimiplatform/nimi-kit/ui` or
  the equivalent `data-nimi-material="<tier>"` marker class.
- Inline `rgba(...)` material background fills, inline
  `backdrop-filter` declarations, and hand-picked `backdrop-blur-*`
  Tailwind named tokens outside kit-emitted utility classes are
  forbidden.
- Accent packs must not override `material.*` or `backdrop.*` tokens.
  Material tokens are neutral `foundation`-layer tokens.
- Adding a 6th tier requires a new admission; this contract does not
  pre-authorize future expansion.

## 2. Perf-Downgrade Hook-Point Interface (Spec-Level)

This contract declares the interface signature for runtime
perf-downgrade of material tiers. Runtime implementation remains a separate
consumer responsibility and does not change the material taxonomy.

**Interface signature (spec-level; React-context-free expression):**

```
TransparencyLevel = "auto" | "none" | "reduced" | "full"
SurfaceProvider.transparencyLevel: TransparencyLevel

downgrade(tier: MaterialTier, level: TransparencyLevel) => MaterialTier
```

**Downgrade ladder (authoritative):**

| Input tier | `level=auto` | `level=full` | `level=reduced` | `level=none` |
|---|---|---|---|---|
| `solid` | `solid` | `solid` | `solid` | `solid` |
| `glass-thin` | `glass-thin` | `glass-thin` | `solid` | `solid` |
| `glass-regular` | `glass-regular` | `glass-regular` | `glass-thin` | `solid` |
| `glass-thick` | `glass-thick` | `glass-thick` | `glass-regular` | `solid` |
| `glass-chrome` | `glass-chrome` | `glass-chrome` | `glass-thick` | `solid` |

- `auto` respects `prefers-reduced-transparency` and collapses to
  `reduced` (or further to `none` when the media feature reports
  `reduce` and the user's OS-level preference explicitly disables
  transparency). Runtime implementation defines the exact signal
  sources; this spec fixes the collapse semantics.
- `full` and `auto` MUST resolve identically when
  `prefers-reduced-transparency: no-preference`.
- Downgrade must be idempotent: `downgrade(downgrade(t, l), l) ===
  downgrade(t, l)` for every tier and level.
- Downgrade MUST NOT cross accent-pack boundaries. Accent tokens are
  not consulted.

Phase 3b is expected to implement `downgrade` inside
`@nimiplatform/nimi-kit/ui` as a pure function and wire
`SurfaceProvider.transparencyLevel` through the existing theme provider
without introducing a new context.

## 3. A11y Contrast Threshold

Every `(tier, tone)` combination rendered on top of the expected
`surface.app_background` beneath the material MUST meet **WCAG 2.1 AA
— 4.5:1** contrast ratio for normal body text and **3:1** for large
text.

- The 4.5:1 threshold is fixed at this contract. Future relaxation
  requires a new admission.
- `glass-thin` has the lowest inherent contrast margin; modules
  rendering body text inside a `glass-thin` surface over a noisy
  ambient background MUST NOT rely solely on the material's
  transparency — they must either (a) nest an opaque text surface, or
  (b) downgrade to `glass-regular` or `solid` under
  `prefers-reduced-transparency: reduce`.
- `glass-chrome` has the highest contrast headroom but imposes the
  largest blur cost; module authors should prefer `glass-thick` unless
  the surface is a full-chrome shell (top bar, nav rail, system
  chrome).

The enforcement script (`check:ui-contrast-matrix`) is **not** authored
by this contract. It is Phase 3a work under the same topic. This
contract fixes the threshold; Phase 3a implements the CI gate.

## 4. Admitted Exceptions

_None._

This section reserves room for per-combination exceptions admitted by
Phase 3a or later phases. Any exception filed here MUST include:

- the specific `(tier, tone, app, surface_slot)` tuple it covers
- the measured contrast ratio that falls below 4.5:1 / 3:1
- the rationale for the exception (typically: a signature visual where
  degraded contrast is visually critical and the surface is not a
  text-carrying surface)
- the admission topic ID and date

Exceptions are not backward-compatible retroactive relaxations of the
contract; they are narrow, named carve-outs with fixed scope. The
default enforcement threshold remains 4.5:1 / 3:1 for any
`(tier, tone, app, surface_slot)` not listed in this section.
