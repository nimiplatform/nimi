// @nimi-authority: rule.nimi.platform.ui-design-system.p-design-027c
/**
 * Gesture motion helpers (P-DESIGN-027 / nimi-ui-motion-contract.md §4).
 *
 * The admitted velocity handoff + momentum projection math. App code
 * must not re-implement projection; consume these helpers so every
 * governed surface throws and settles with the same physics.
 */

/**
 * Exponential-decay momentum projection. Projects the resting position
 * from the release velocity, exactly like scroll deceleration.
 *
 * `decelerationRate`: 0.998 for scroll-like feel, 0.99 for a snappier
 * settle. Returns the projected travel distance in px; add it to the
 * current position to get the projected endpoint.
 */
export function projectMomentum(
  releaseVelocityPxPerSec: number,
  decelerationRate = 0.998,
): number {
  if (!Number.isFinite(releaseVelocityPxPerSec) || releaseVelocityPxPerSec === 0) {
    return 0;
  }
  return (releaseVelocityPxPerSec / 1000) * decelerationRate / (1 - decelerationRate);
}

/** Snap target nearest the projected resting position. */
export function nearestSnapTarget<T extends number>(
  projectedEndpoint: number,
  targets: readonly T[],
): T {
  let best: T | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const target of targets) {
    const distance = Math.abs(projectedEndpoint - target);
    if (distance < bestDistance) {
      best = target;
      bestDistance = distance;
    }
  }
  if (best === undefined) {
    throw new Error('NIMI_MOTION_SNAP_TARGETS_EMPTY');
  }
  return best;
}

/**
 * Normalize a release velocity for spring APIs that expect relative
 * (distance-normalized) velocity rather than absolute px/s.
 *
 * `relativeVelocity = gestureVelocity / (targetValue − currentValue)`
 */
export function normalizeReleaseVelocity(
  gestureVelocityPxPerSec: number,
  currentValue: number,
  targetValue: number,
): number {
  const remaining = targetValue - currentValue;
  if (remaining === 0) return 0;
  return gestureVelocityPxPerSec / remaining;
}

/**
 * Decide commit vs. reverse at release using the velocity SIGN, not the
 * position: a flick toward the target commits even from the early half
 * of the path; a flick away reverses even past the midpoint.
 */
export function shouldCommitGesture({
  originValue,
  currentValue,
  targetValue,
  releaseVelocityPxPerSec,
  velocityThresholdPxPerSec = 50,
}: {
  originValue: number;
  currentValue: number;
  targetValue: number;
  releaseVelocityPxPerSec: number;
  velocityThresholdPxPerSec?: number;
}): boolean {
  const pathDirection = Math.sign(targetValue - originValue);
  if (pathDirection === 0) return true;
  const velocityDirection = Math.sign(releaseVelocityPxPerSec);
  if (Math.abs(releaseVelocityPxPerSec) >= velocityThresholdPxPerSec && velocityDirection !== 0) {
    return velocityDirection === pathDirection;
  }
  // Below the flick threshold, fall back to the projected resting side.
  // Both endpoints are explicit: an implicit zero origin would make this
  // helper incorrect for translated or reversed coordinate systems.
  const projected = currentValue + projectMomentum(releaseVelocityPxPerSec);
  return Math.abs(targetValue - projected) <= Math.abs(projected - originValue);
}

/**
 * Progressive boundary resistance (rubber-banding). The further past a bound
 * the pointer moves, the less the element follows — signaling a responsive
 * boundary rather than a frozen hard stop.
 */
export function rubberband(
  overshootPx: number,
  dimensionPx: number,
  constant = 0.55,
): number {
  if (!Number.isFinite(overshootPx) || !Number.isFinite(dimensionPx) || dimensionPx <= 0 || overshootPx === 0) {
    return 0;
  }
  return (overshootPx * dimensionPx * constant) / (dimensionPx + constant * Math.abs(overshootPx));
}
