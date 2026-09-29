// @nimi-authority: rule.nimi.platform.ui-design-system.p-design-027c
// @nimi-authority: rule.nimi.platform.ui-design-system.p-design-027e
/**
 * Overlay motion grammar (P-DESIGN-027 / nimi-ui-motion-contract.md §5).
 *
 * Spring-based, symmetric enter/exit presets for governed overlays.
 * Exit is always the exact reverse of enter along the same path; popover
 * and menu surfaces anchor `transform-origin` to the trigger-facing edge.
 *
 * Reduced motion substitutes an in-place opacity cross-fade (no travel).
 */

import {
  createGeneratorEasing,
  spring,
  type GeneratorFactory,
  type MotionStyle,
  type TargetAndTransition,
  type Transition,
  type ValueAnimationOptions,
} from 'motion/react';
import { nimiReducedFade, nimiSpring, type NimiSpringPreset } from './springs.js';

export type NimiOverlayMotionKind = 'dialog' | 'drawer' | 'popover';
export type NimiPopoverSide = 'top' | 'right' | 'bottom' | 'left';

export type NimiOverlayMotionProps = {
  initial: TargetAndTransition;
  animate: TargetAndTransition;
  exit: TargetAndTransition;
  transition: Transition;
  style?: MotionStyle;
};

const POPOVER_SIDE_OFFSET_PX = 4;

const POPOVER_ORIGIN: Record<NimiPopoverSide, string> = {
  bottom: 'top center',
  top: 'bottom center',
  right: 'left center',
  left: 'right center',
};

/** A panel spring is settled once under this fraction of its travel remains ... */
const PANEL_SETTLE_DELTA_RATIO = 0.02;
/** ... and it moves slower than this fraction of its travel per second. */
const PANEL_SETTLE_SPEED_RATIO = 0.5;

/**
 * The admitted spring, ended once its remaining change is imperceptible.
 *
 * Motion's rest thresholds are absolute and tuned for layout distances, and a
 * browser-run value (opacity) is pre-sampled on a 0-100 scale while a
 * JavaScript-run value (scale, offset) keeps its real scale. A panel spring
 * therefore kept reporting motion for about twice its visual duration after
 * nothing visible changed, and an overlay holds its focus and pointer gates
 * until its exit completes, leaving its trigger inert meanwhile. Thresholds
 * as a fraction of the travel end the settle at the same moment on either
 * path. The spring itself and the symmetric path are unchanged.
 */
const nimiSettledSpring: GeneratorFactory = Object.assign(
  (options: ValueAnimationOptions<number>) => {
    const frames = options.keyframes;
    const travel = Math.abs((frames[frames.length - 1] ?? 0) - (frames[0] ?? 0)) || 1;
    return spring({
      ...options,
      restDelta: travel * PANEL_SETTLE_DELTA_RATIO,
      restSpeed: travel * PANEL_SETTLE_SPEED_RATIO,
    });
  },
  {
    // Mirrors spring.applyToOptions: a browser-run value gets the same spring
    // as a pre-sampled easing, so its settle ends where the JavaScript path's does.
    applyToOptions: (options: Transition): Transition => {
      const easing = createGeneratorEasing(options, 100, nimiSettledSpring);
      return { ...options, type: 'keyframes', ease: easing.ease, duration: easing.duration * 1000 };
    },
  },
);

function panelTransition(transition: Transition): Transition {
  return { ...transition, type: nimiSettledSpring };
}

function popoverAxisOffset(side: NimiPopoverSide): Pick<TargetAndTransition, 'x' | 'y'> {
  switch (side) {
    case 'bottom':
      return { y: -POPOVER_SIDE_OFFSET_PX };
    case 'top':
      return { y: POPOVER_SIDE_OFFSET_PX };
    case 'right':
      return { x: -POPOVER_SIDE_OFFSET_PX };
    case 'left':
      return { x: POPOVER_SIDE_OFFSET_PX };
  }
}

/**
 * Enter/exit motion props for an overlay panel.
 *
 * - `dialog`: fade + scale 0.95 -> 1, origin at panel center by default.
 * - `drawer`: translate along its own edge axis only (right-edge drawer
 *   moves on X), no scale.
 * - `popover`: fade + scale 0.96 -> 1 plus a 4px offset along the side it
 *   opens from; `transform-origin` pinned per side.
 *
 * `preset` defaults to the critically damped `default` spring; pass
 * `momentum` only when settling from a velocity-carrying gesture.
 */
export function nimiOverlayPanelMotion({
  kind,
  side = 'bottom',
  preset = 'default',
  reducedMotion = false,
}: {
  kind: NimiOverlayMotionKind;
  side?: NimiPopoverSide;
  preset?: NimiSpringPreset;
  reducedMotion?: boolean;
}): NimiOverlayMotionProps {
  if (reducedMotion) {
    return {
      initial: { opacity: 0 },
      animate: { opacity: 1 },
      exit: { opacity: 0 },
      transition: nimiReducedFade(),
    };
  }

  const transition = nimiSpring(preset);

  if (kind === 'drawer') {
    return {
      initial: { x: '100%', opacity: 1 },
      animate: { x: 0, opacity: 1 },
      exit: { x: '100%', opacity: 1 },
      transition: panelTransition(transition),
    };
  }

  if (kind === 'popover') {
    const offset = popoverAxisOffset(side);
    return {
      initial: { opacity: 0, scale: 0.96, ...offset },
      animate: { opacity: 1, scale: 1, x: 0, y: 0 },
      exit: { opacity: 0, scale: 0.96, ...offset },
      transition: panelTransition(transition),
      style: { transformOrigin: POPOVER_ORIGIN[side] },
    };
  }

  return {
    initial: { opacity: 0, scale: 0.95 },
    animate: { opacity: 1, scale: 1 },
    exit: { opacity: 0, scale: 0.95 },
    transition: panelTransition(transition),
  };
}

/**
 * Backdrop motion: opacity only, never blur or color animation
 * (motion contract §5).
 */
export function nimiOverlayBackdropMotion({
  reducedMotion = false,
}: {
  reducedMotion?: boolean;
} = {}): Pick<NimiOverlayMotionProps, 'initial' | 'animate' | 'exit' | 'transition'> {
  return {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
    transition: nimiReducedFade(reducedMotion ? 0.2 : 0.32),
  };
}
