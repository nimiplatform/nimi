// Authority: docs/authority/avatar-embodiment-rationale.md.
//
// VRM `BackendProjection` adapter — bridges ontology-level projection
// methods (applyActivity / applyEmotion / applyMotion / applyExpression
// / reset) to `VrmEmoteState` and the
// generated motion runtime, routing activity ids through an injected
// activity-mapping resolver.
//
// Hard contract (per backend-branch-contract.md): the BackendProjection
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
//     (each is independently optional per the activity-mapping schema).

import type { VRM } from '@pixiv/three-vrm';
import type { VrmActivityRoute } from './vrm-activity-mapping.js';
import type { BackendProjection } from '../carrier/backend-branch.js';
import type { VrmEmoteState } from './vrm-emote-state.js';
import type { VrmGeneratedMotionRuntime } from './vrm-generated-motion-contract.js';

/** Minimal contract the adapter consumes from the activity-mapping
 *  resolver. Kit's resolver implements this method; tests may inject
 *  alternate resolvers that honor the same route contract. */
export type ActivityMapping = {
  resolveVrmRoute(activityName: string): VrmActivityRoute | null;
};

export type CreateVrmProjectionAdapterInputs = {
  vrm: VRM;
  emoteState: VrmEmoteState;
  generatedMotionRuntime: VrmGeneratedMotionRuntime<VRM>;
  activityMapping: ActivityMapping;
};

/** Default crossfade duration applied when an activity route omits
 *  the field, as declared by the VRM projection contract. */
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
  const { vrm, emoteState, generatedMotionRuntime, activityMapping } = input;

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
        generatedMotionRuntime.play({
          routeId: route.motion,
          intensity,
          fade: route.fade ?? DEFAULT_ACTIVITY_FADE_SEC,
        });
      }
      if (route.expression) {
        // Single expression overlay (transient; bypasses the bundle
        // state machine defined by the VRM projection contract.
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
    applyMotion({ routeId, fade, loop }) {
      generatedMotionRuntime.play({
        routeId,
        fade: fade ?? DEFAULT_DIRECT_MOTION_FADE_SEC,
        loop: loop ?? false,
      });
    },
    applyExpression({ name, weight, fade }) {
      emoteState.applyTransientExpression(name, weight ?? 1, fade);
    },
    reset() {
      emoteState.reset({ vrm });
      generatedMotionRuntime.stopAll();
    },
  };
}
