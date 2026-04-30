// Wave 1 (step 2) of topic 2026-04-30-avatar-vrm-backend-branch.
//
// Computes BackendHitRegion for the Live2D branch. Wave_1 ships the
// bbox snapshot path only (body+drag rectangles cover the full nominal
// viewport so OS-level click-through fallback works); the precise
// alpha-mask `isOpaqueAtClientPoint` query is deferred to wave_4 per
// `live2d-render-contract.md §"Hit Testing"` and the topic packet's
// `acceptance_invariants` (alpha-mask not required at this wave).
//
// Spec authorities:
//   - apps/avatar/spec/kernel/backend-branch-contract.md §BackendHitRegion
//   - apps/avatar/spec/kernel/live2d-render-contract.md §"Hit Testing"
//   - apps/avatar/spec/kernel/live2d-asset-compatibility-contract.md §6

import type { BackendHitRegion } from '../carrier/backend-branch.js';
import type { Live2DCompatibilityReport } from './compatibility.js';

/** Default: full-viewport bbox; drag rect equals body rect.
 *  alpha-mask is null (wave_4 hard-cut deferred). */
export const LIVE2D_DEFAULT_HIT_REGION: BackendHitRegion = Object.freeze({
  body: { left: 0, top: 0, right: 1, bottom: 1 },
  drag: { left: 0, top: 0, right: 1, bottom: 1 },
  isOpaqueAtClientPoint: null,
});

export type Live2DHitRegionInput = {
  /** Compatibility report drives `hit_regions.fallback`:
   *   - 'alpha_mask_only' adapter declarations still resolve to bbox at
   *     wave_1 (alpha-mask is wave_4); we surface the full-viewport
   *     bbox so click events reach the carrier instead of failing
   *     closed.
   *   - 'fail_closed' is honored by emitting a zero-area body bbox so
   *     the carrier rejects all clicks; drag remains 0-area.
   */
  compatibility?: Live2DCompatibilityReport | null;
};

const ZERO_REGION: BackendHitRegion = Object.freeze({
  body: { left: 0, top: 0, right: 0, bottom: 0 },
  drag: { left: 0, top: 0, right: 0, bottom: 0 },
  isOpaqueAtClientPoint: null,
});

export function computeLive2DHitRegion(
  input: Live2DHitRegionInput = {},
): BackendHitRegion {
  const adapter = input.compatibility?.adapter ?? null;
  const hitRegions = adapter?.semantics?.hit_regions;
  const fallback = hitRegions?.fallback ?? 'alpha_mask_only';
  if (fallback === 'fail_closed' && hitRegions?.disposition?.status !== 'supported') {
    return ZERO_REGION;
  }
  return LIVE2D_DEFAULT_HIT_REGION;
}
