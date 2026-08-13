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

import type { MotionStyle, TargetAndTransition, Transition } from 'motion/react';
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
      transition,
    };
  }

  if (kind === 'popover') {
    const offset = popoverAxisOffset(side);
    return {
      initial: { opacity: 0, scale: 0.96, ...offset },
      animate: { opacity: 1, scale: 1, x: 0, y: 0 },
      exit: { opacity: 0, scale: 0.96, ...offset },
      transition,
      style: { transformOrigin: POPOVER_ORIGIN[side] },
    };
  }

  return {
    initial: { opacity: 0, scale: 0.95 },
    animate: { opacity: 1, scale: 1 },
    exit: { opacity: 0, scale: 0.95 },
    transition,
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
