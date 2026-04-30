// Wave 3 chunk 3-C of topic 2026-04-30-avatar-vrm-backend-branch.
//
// VRM `BackendProjection` adapter — bridges ontology-level projection
// methods (applyActivity / applyEmotion / applyMotion / applyExpression
// / reset) to the chunk 3-A `VrmEmoteState` + chunk 3-B
// `VrmMotionPresetRegistry`, routing activity ids through an injected
// activity-mapping resolver (NAS layer wave_1).
//
// Spec: design-04 §"VRM Projection Adapter".
//
// Hard contract (per packet wave_3 negative_test #6 +
// backend-branch-contract.md drift_check): the BackendProjection
// surface is ontology-only; NO Live2D parameter id (`ParamMouthOpenY`
// / `parameterId` / etc) on any method here. Live2D parameter writes
// are reachable only through the kind-narrowed `live2dExtension`
// escape hatch on the BackendBranch union.
//
// Fail-close behavior:
//   - Unknown activity → log warn, no projection side effect (caller
//     is responsible for any further evidence emission).
//   - Activity route present but only some of {motion, emotion,
//     expression} populated → only those present branches execute
//     (each is independently optional per design-04 schema).

import type { VRM } from '@pixiv/three-vrm';
import type { BackendProjection } from '../carrier/backend-branch.js';
import type { VrmEmoteState } from './vrm-emote-state.js';
import type { VrmMotionPresetRegistry } from './vrm-motion-preset-registry.js';

/** Per-activity VRM route. Mirrors `VrmActivityRoute` in
 *  `nas/activity-mapping-resolver.ts`. Re-declared locally so the
 *  projection adapter can consume any resolver implementation that
 *  honors the same contract (test seam). */
export type VrmActivityRoute = {
  motion?: string;
  emotion?: string;
  expression?: string;
  fade?: number;
};

/** Minimal contract the adapter consumes from the activity-mapping
 *  resolver. The wave_1 NAS resolver already implements this method
 *  (`createActivityMappingResolver().resolveVrmRoute(...)`); chunk 3-D
 *  remains free to extend the resolver without breaking this adapter. */
export type ActivityMapping = {
  resolveVrmRoute(activityName: string): VrmActivityRoute | null;
};

export type CreateVrmProjectionAdapterInputs = {
  vrm: VRM;
  emoteState: VrmEmoteState;
  motionRegistry: VrmMotionPresetRegistry;
  activityMapping: ActivityMapping;
};

/** Default crossfade duration applied when an activity route omits
 *  the field. Mirrors design-04 §"VRM Projection Adapter" sample. */
export const DEFAULT_ACTIVITY_FADE_SEC = 0.2;
/** Default crossfade duration applied to direct `applyMotion` calls
 *  when the caller omits `fade`. */
export const DEFAULT_DIRECT_MOTION_FADE_SEC = 0.3;

/** Clamp + default rule for activity intensity:
 *  null → 1 (full); finite → clamp [0, 1]; non-finite → 0. */
export function scaleByIntensity(intensity: number | null | undefined): number {
  if (intensity === null || intensity === undefined) return 1;
  if (!Number.isFinite(intensity)) return 0;
  if (intensity < 0) return 0;
  if (intensity > 1) return 1;
  return intensity;
}

export function createVrmProjectionAdapter(
  input: CreateVrmProjectionAdapterInputs,
): BackendProjection {
  const { vrm, emoteState, motionRegistry, activityMapping } = input;

  return {
    applyActivity({ name, intensity }) {
      const route = activityMapping.resolveVrmRoute(name);
      if (!route) {
        // Fail-close: no fake projection. Caller may emit a diagnostic.
        console.warn(
          `[avatar:vrm] activity "${name}" has no vrm route admitted`,
        );
        return;
      }
      if (route.motion) {
        motionRegistry.play({
          presetId: route.motion,
          intensity,
          fade: route.fade ?? DEFAULT_ACTIVITY_FADE_SEC,
        });
      }
      if (route.expression) {
        // Single expression overlay (transient; bypasses the bundle
        // state machine — matches design-04 line 47).
        emoteState.applyTransientExpression(
          route.expression,
          scaleByIntensity(intensity),
        );
      }
      if (route.emotion) {
        emoteState.setEmote(route.emotion);
      }
    },
    applyEmotion({ current, previous }) {
      emoteState.setEmote(current, { previous });
    },
    applyMotion({ presetId, fade, loop }) {
      motionRegistry.play({
        presetId,
        fade: fade ?? DEFAULT_DIRECT_MOTION_FADE_SEC,
        loop: loop ?? false,
      });
    },
    applyExpression({ name, weight, fade }) {
      emoteState.applyTransientExpression(name, weight ?? 1, fade);
    },
    reset() {
      emoteState.reset({ vrm });
      motionRegistry.stopAll();
    },
  };
}
