/**
 * Spring presets (P-DESIGN-027 / nimi-ui-motion-contract.md §3).
 *
 * TS mirror of the `motion.spring_*` tokens. The CSS custom properties
 * (`--nimi-motion-spring-*`) are the canonical render-time source; these
 * constants exist so spring-driven JS animation resolves to the same
 * admitted values without re-reading computed styles.
 *
 * Presets use the designer-facing (response, damping ratio) pair and map
 * onto the `motion` package's `visualDuration` + `bounce` spring form:
 *   damping 1.0 (critically damped) -> bounce 0
 *   damping 0.8 (momentum, slight overshoot) -> bounce 0.2
 */

import type { Transition } from 'motion/react';

export const NIMI_SPRING_DEFAULT = {
  responseSeconds: 0.4,
  dampingRatio: 1,
} as const;

export const NIMI_SPRING_MOMENTUM = {
  responseSeconds: 0.35,
  dampingRatio: 0.8,
} as const;

/** Pressed-state scale (motion.pressed_scale token mirror). */
export const NIMI_PRESSED_SCALE = 0.97;

export type NimiSpringPreset = 'default' | 'momentum';

/**
 * Resolve the admitted spring transition for a preset.
 *
 * `momentum` carries a small bounce and is admitted ONLY when the
 * preceding gesture carried velocity (flick/throw/drag release). UI that
 * simply appears must use `default` (no overshoot).
 */
export function nimiSpring(preset: NimiSpringPreset = 'default'): Transition {
  if (preset === 'momentum') {
    return {
      type: 'spring',
      visualDuration: NIMI_SPRING_MOMENTUM.responseSeconds,
      bounce: 0.2,
    };
  }
  return {
    type: 'spring',
    visualDuration: NIMI_SPRING_DEFAULT.responseSeconds,
    bounce: 0,
  };
}

/**
 * Reduced-motion substitution (motion contract §6): travel is removed,
 * spatial causality is kept via an in-place opacity cross-fade.
 */
export function nimiReducedFade(durationSeconds = 0.2): Transition {
  return { duration: durationSeconds, ease: [0.2, 0, 0, 1] };
}
