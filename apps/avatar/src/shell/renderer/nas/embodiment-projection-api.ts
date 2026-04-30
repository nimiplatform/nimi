// Wave 1 (step 3) of topic 2026-04-30-avatar-vrm-backend-branch (design-04).
//
// This module is the NAS-facing projection surface anchor. It exports
// two surfaces that coexist during wave_1:
//
//   1. `BackendProjection` — the canonical ontology surface
//      (applyActivity / applyEmotion / applyMotion / applyExpression /
//      reset). Authority: `carrier/backend-branch.ts` and
//      `embodiment-projection-contract.md`. NEW dispatch paths and
//      input-object NAS handlers (design-04 §"NAS handler signature
//      hard-cut") consume this surface.
//
//   2. `EmbodimentProjectionApi` — the legacy backend-neutral cue
//      surface (triggerMotion / setSignal / setExpression / setPose /
//      …). Retained for the existing handler sandbox, default
//      activity fallback, and interaction-physics code paths until
//      they migrate to the ontology surface in a follow-up wave_1
//      step. NEW callers MUST prefer `BackendProjection`; the legacy
//      surface stays read-only / no behavior changes here.
//
// The two surfaces are not interchangeable: `BackendProjection` is
// ontology-level (no Live2D parameter id leaks), while
// `EmbodimentProjectionApi` is the lower-level cue/signal surface
// the Live2D plugin currently exposes for activity-fallback /
// interaction-physics.

import type { AgentDataBundle } from '../driver/types.js';
import type {
  BackendProjection as CarrierBackendProjection,
  Live2DBackendExtension,
} from '../carrier/backend-branch.js';

/** Re-export of the canonical ontology projection surface. */
export type BackendProjection = CarrierBackendProjection;

/** Surface exposed to NAS handlers when the loaded backend is Live2D
 *  AND the handler manifest declares `requires: ['live2d-extension']`.
 *  Handlers receive `{ live2d?: Live2DBackendExtension }`; on VRM
 *  models the registry rejects the handler entirely (no extension is
 *  ever materialized for an incompatible backend). */
export type NasHandlerExtension = {
  live2d?: Live2DBackendExtension;
};

export type MotionPriority = 'low' | 'normal' | 'high';

export type PlayMotionOptions = {
  priority?: MotionPriority;
  loop?: boolean;
  fadeIn?: number;
  fadeOut?: number;
};

export type ProjectionBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ActivityFallbackOptions = {
  signal: AbortSignal;
  bundle: AgentDataBundle;
};

/** Legacy backend-neutral cue / signal surface. Retained for the
 *  existing handler sandbox, default activity fallback, and
 *  interaction-physics call sites. Do not extend with new methods —
 *  add new capabilities to `BackendProjection` (ontology) or to a
 *  branch-specific extension type instead. */
export interface EmbodimentProjectionApi {
  triggerMotion(motionId: string, opts?: PlayMotionOptions): Promise<void>;
  stopMotion(): void;
  setSignal(signalId: string, value: number, weight?: number): void;
  getSignal(signalId: string): number;
  addSignal(signalId: string, delta: number): void;
  setExpression(expressionId: string): Promise<void>;
  clearExpression(): void;
  setPose(poseId: string, loop?: boolean): void;
  clearPose(): void;
  wait(ms: number): Promise<void>;
  getSurfaceBounds(): ProjectionBounds;
  runDefaultActivity?(activityId: string, options: ActivityFallbackOptions): Promise<void>;
}
