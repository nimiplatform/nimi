# Nimi UI Motion Contract

> Supplementary spec documentation for the `P-DESIGN-027 — Interaction &
> Motion Contract` rule declared in `design-pattern-contract.md`. This file
> is the prose companion to the `motion.*` token family in
> `tables/nimi-ui-tokens.yaml` and `tables/nimi-ui-themes.yaml`. It does
> not introduce a new token table or a new rule ID. It pins the interaction
> state model, the unified duration/easing scale, the spring presets, the
> momentum projection model, and the reduced-motion substitution rules.
>
> Apple/WWDC fluid-interface material is a reference for these behaviors,
> not a visual target. The goal for Nimi is coordination: one motion
> vocabulary shared by every governed surface, not an Apple look-alike.

## 1. Interaction State Model

Every interactive primitive resolves these states through the motion
contract; none may be skipped and none may be faked with hover-only
styling.

| State | Trigger | Required behavior |
|---|---|---|
| `idle` | — | No looping or decorative motion on operational surfaces. |
| `hover` | pointer over | Subtle token-driven color/border change only; no elevation shifts or translate lifts on standard actions. |
| `pressed` | pointer-down | Immediate `motion.pressed_scale` (`0.97`) transform in the same frame; never delayed to release. |
| `dragging` | pointer move past threshold | 1:1 tracking of the pointer from the grab offset; UI updates continuously, not at gesture end. |
| `settling` | release / re-target | Spring animation from the current presentation value with inherited velocity (§4). |
| `interrupted` | new input mid-motion | New animation starts from the live on-screen value; input is never locked out during a transition. |

## 2. Unified Duration & Easing Scale

One scale serves CSS transitions and TypeScript animation code. The CSS
custom properties are canonical; `kit/ui/src/motion/*` mirrors must
resolve to identical values.

| Token | Value | Use |
|---|---|---|
| `motion.fast` | `120ms` | pressed feedback, hover color changes, toggle thumb |
| `motion.base` | `200ms` | standard state transitions (tabs, menu items, field focus) |
| `motion.slow` | `320ms` | overlay fades, non-spring fallbacks, reduced-motion cross-fades |
| `motion.ambient` | `600ms` | ambient and theme-change transitions only |

| Token | Value | Use |
|---|---|---|
| `motion.ease_standard` | `cubic-bezier(0.2, 0, 0, 1)` | default state transitions |
| `motion.ease_emphasized` | `cubic-bezier(0.05, 0.7, 0.1, 1)` | reversible overlay paths; the outbound and return path share it so motion is mirrored |
| `motion.ease_decelerated` | `cubic-bezier(0, 0, 0, 1)` | enter-only non-spring fallbacks |
| `motion.ease_accelerated` | `cubic-bezier(0.3, 0, 1, 1)` | exit-only non-spring fallbacks |

## 3. Spring Presets

Springs are the admitted behavior model for overlays, gesture settle, and
any motion a user can interrupt. Presets use the designer-facing
(response, damping ratio) pair; the kit motion layer maps them onto the
`motion` package.

| Preset | Response | Damping ratio | Tokens | Use |
|---|---|---|---|---|
| `default` | `0.4s` (`motion.spring_default_response`) | `1.0` (`motion.spring_default_damping`) | critically damped, no overshoot | dialog/popover/drawer settle, repositioning |
| `momentum` | `0.35s` (`motion.spring_momentum_response`) | `0.8` (`motion.spring_momentum_damping`) | slight overshoot | only after velocity-carrying gestures (flick, throw, drag release) |

Rules:

- Bounce is admitted only when the preceding gesture carried momentum.
  A menu or dialog that simply appeared must not overshoot.
- Two-dimensional motion decomposes into independent X and Y springs.
- Re-targeting a running spring blends current velocity; it must not
  restart from the logical target value.

## 4. Velocity Handoff & Momentum Projection

When a gesture ends, the settle spring inherits the pointer's release
velocity so no seam is visible between dragging and animating.

- Spring APIs that accept absolute velocity receive the raw pointer
  velocity (px/s). APIs that expect relative velocity normalize it:
  `relativeVelocity = gestureVelocity / (targetValue − currentValue)`.
- Flick landing uses exponential-decay projection, then snaps to the
  snap point nearest the projected resting position:

```
projectedEndpoint = currentPosition + (releaseVelocity / 1000) * d / (1 - d)
d = decelerationRate; 0.998 for scroll-like feel, 0.99 for snappier settle
```

The kit motion layer (`kit/ui/src/motion/gestures.ts`) owns the admitted
`projectMomentum` and `nearestSnapTarget` helpers; app code must not
re-implement projection math.
- Commit/reverse decisions must receive both the origin and target values.
  A helper must not assume that the reverse destination is coordinate zero;
  low-velocity fallback compares the projected endpoint against both explicit
  destinations.

## 5. Overlay Motion Grammar

- **Dialog / modal panel:** fade + scale `0.95 → 1` on the `default`
  spring; exit is the exact reverse on the same spring. Scale origin is
  the panel center unless a triggering element is known, in which case
  the origin anchors to the trigger.
- **Drawer:** translates along its own edge axis only (right-edge drawer
  moves on X), `default` spring, no scale. Enter and exit paths are
  symmetric.
- **Popover / menu:** fade + scale `0.96 → 1` plus a 4px offset along the
  side it opens from, `transform-origin` pinned to the trigger-facing
  edge per side. Side-aware behavior is mandatory; a popover must read
  as emerging from its trigger.
- **Backdrop:** opacity only, `motion.slow` with `motion.ease_standard`;
  no blur or color animation.

## 6. Reduced Motion Substitution

`prefers-reduced-motion: reduce` keeps spatial causality and drops
travel. It does not mean "no feedback".

- Overlays cross-fade in place (`opacity`, `motion.slow`); no slide,
  scale, or spring.
- Pressed feedback remains (instant scale or color change with zero
  duration is acceptable feedback, not vestibular motion).
- Ambient, looping, and parallax motion stops (see P-DESIGN-023 for
  ambient backgrounds).
- The generated global duration guard is the floor; kit motion-layer
  code must additionally resolve spring presets to opacity-only
  transitions when reduced motion is requested.

## 7. Admitted Implementation Substrate

- The kit motion layer (`@nimiplatform/kit/ui/motion`) built on the
  `motion` package is the single animation substrate for governed
  surfaces.
- CSS transitions remain admitted for `idle/hover/pressed` micro-states
  and color transitions under `motion.fast`/`motion.base`.
- CSS keyframe animation is admitted only for ambient backgrounds under
  P-DESIGN-023 and loading indicators; it is not admitted for overlay
  enter/exit or gesture-driven motion.
- App code must not adopt a second animation library or hand-rolled
  `requestAnimationFrame` loops for governed surfaces.
