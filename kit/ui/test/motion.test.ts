import { expect, test } from 'vitest';
import {
  NIMI_SPRING_DEFAULT,
  NIMI_SPRING_MOMENTUM,
  NIMI_PRESSED_SCALE,
  nearestSnapTarget,
  nimiOverlayBackdropMotion,
  nimiOverlayPanelMotion,
  nimiReducedFade,
  nimiSpring,
  normalizeReleaseVelocity,
  projectMomentum,
  shouldCommitGesture,
} from '../src/motion/index.js';

test('spring presets mirror the spec motion.spring_* tokens', () => {
  // P-DESIGN-027: default is critically damped (no overshoot); momentum
  // carries a small bounce admitted only after velocity gestures.
  expect(NIMI_SPRING_DEFAULT).toEqual({ responseSeconds: 0.4, dampingRatio: 1 });
  expect(NIMI_SPRING_MOMENTUM).toEqual({ responseSeconds: 0.35, dampingRatio: 0.8 });
  expect(NIMI_PRESSED_SCALE).toBe(0.97);

  const defaultSpring = nimiSpring('default');
  expect(defaultSpring).toMatchObject({ type: 'spring', visualDuration: 0.4, bounce: 0 });
  const momentumSpring = nimiSpring('momentum');
  expect(momentumSpring).toMatchObject({ type: 'spring', visualDuration: 0.35 });
  expect((momentumSpring as { bounce?: number }).bounce ?? 0).toBeGreaterThan(0);
});

test('momentum projection uses exponential decay', () => {
  // v=1000px/s, d=0.998 -> 1000/1000 * 0.998/0.002 = 499px
  expect(projectMomentum(1000, 0.998)).toBeCloseTo(499, 0);
  expect(projectMomentum(0)).toBe(0);
  expect(projectMomentum(Number.NaN)).toBe(0);
  // direction is preserved
  expect(projectMomentum(-500, 0.99)).toBeLessThan(0);
});

test('nearest snap target follows the projected endpoint', () => {
  expect(nearestSnapTarget(190, [0, 200, 400])).toBe(200);
  expect(nearestSnapTarget(90, [0, 200, 400])).toBe(0);
  expect(nearestSnapTarget(390, [0, 200, 400])).toBe(400);
  expect(() => nearestSnapTarget(0, [])).toThrow('NIMI_MOTION_SNAP_TARGETS_EMPTY');
});

test('release velocity normalization divides by remaining distance', () => {
  expect(normalizeReleaseVelocity(50, 50, 150)).toBeCloseTo(0.5);
  expect(normalizeReleaseVelocity(50, 100, 100)).toBe(0);
});

test('commit decision uses velocity sign before position', () => {
  // flick toward target commits even from early in the path
  expect(shouldCommitGesture({ originValue: 0, currentValue: 20, targetValue: 300, releaseVelocityPxPerSec: 400 })).toBe(true);
  // flick away reverses even past the midpoint
  expect(shouldCommitGesture({ originValue: 0, currentValue: 280, targetValue: 300, releaseVelocityPxPerSec: -400 })).toBe(false);
  // low-velocity fallback must compare against the declared origin rather
  // than an implicit zero coordinate.
  expect(shouldCommitGesture({ originValue: 100, currentValue: 140, targetValue: 200, releaseVelocityPxPerSec: 0 })).toBe(false);
  expect(shouldCommitGesture({ originValue: 100, currentValue: 160, targetValue: 200, releaseVelocityPxPerSec: 0 })).toBe(true);
});

test('overlay panel motion is spring-based and symmetric', () => {
  const dialog = nimiOverlayPanelMotion({ kind: 'dialog' });
  expect(dialog.transition).toMatchObject({ type: 'spring' });
  expect(dialog.initial).toMatchObject({ opacity: 0, scale: 0.95 });
  expect(dialog.exit).toMatchObject({ opacity: 0, scale: 0.95 });

  const drawer = nimiOverlayPanelMotion({ kind: 'drawer' });
  expect(drawer.initial).toMatchObject({ x: '100%' });
  expect(drawer.exit).toMatchObject({ x: '100%' });
  expect(drawer.initial).not.toHaveProperty('scale');
});

test('popover motion anchors transform origin to the trigger side', () => {
  expect(nimiOverlayPanelMotion({ kind: 'popover', side: 'bottom' }).style)
    .toMatchObject({ transformOrigin: 'top center' });
  expect(nimiOverlayPanelMotion({ kind: 'popover', side: 'left' }).style)
    .toMatchObject({ transformOrigin: 'right center' });
});

test('reduced motion substitutes in-place cross-fades (no travel)', () => {
  const reduced = nimiOverlayPanelMotion({ kind: 'drawer', reducedMotion: true });
  expect(reduced.initial).toEqual({ opacity: 0 });
  expect(reduced.transition).not.toMatchObject({ type: 'spring' });

  const backdrop = nimiOverlayBackdropMotion({ reducedMotion: true });
  expect(backdrop.initial).toEqual({ opacity: 0 });
  expect(nimiReducedFade()).toMatchObject({ duration: 0.2 });
});
