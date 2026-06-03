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

export type AvatarActivityFallbackBundle = {
  activity?: {
    name?: string;
    intensity?: string | null;
  } | null;
};

export type ActivityFallbackOptions<TBundle extends AvatarActivityFallbackBundle = AvatarActivityFallbackBundle> = {
  signal: AbortSignal;
  bundle: TBundle;
};

export interface EmbodimentProjectionApi<TBundle extends AvatarActivityFallbackBundle = AvatarActivityFallbackBundle> {
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
  runDefaultActivity?(activityId: string, options: ActivityFallbackOptions<TBundle>): Promise<void>;
}
