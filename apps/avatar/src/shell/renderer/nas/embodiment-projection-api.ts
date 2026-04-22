import type { AgentDataBundle } from '../driver/types.js';

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

// Handler-facing projection API. This surface is intentionally phrased around
// backend-neutral cues/signals. Backend branches may interpret ids using their
// own registries, assets, or parameter namespaces.
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
