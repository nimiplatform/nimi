import { createEventBus, type EventBus } from '../infra/event-bus.js';
import type {
  ActivityFallbackOptions,
  EmbodimentProjectionApi,
  MotionPriority,
  PlayMotionOptions,
  ProjectionBounds,
} from '../nas/embodiment-projection-api.js';
import { activityIdToMotionGroup } from '../nas/activity-naming.js';
import type { Live2DCompatibilityReport } from './compatibility.js';

export type Live2DCommandEvent =
  | { kind: 'motion'; group: string; options: PlayMotionOptions }
  | { kind: 'motion-stop' }
  | { kind: 'parameter'; id: string; value: number; weight: number }
  | { kind: 'parameter-add'; id: string; delta: number }
  | { kind: 'expression'; id: string }
  | { kind: 'expression-clear' }
  | { kind: 'pose'; group: string; loop: boolean }
  | { kind: 'pose-clear' };

export type Live2DCommandBus = EventBus<{ command: Live2DCommandEvent }>;

export type PluginApiContext = {
  bounds: () => ProjectionBounds;
  parameterState: Map<string, number>;
  commandBus: Live2DCommandBus;
  compatibility?: Live2DCompatibilityReport | null;
};

const FALLBACK_IDLE_GROUP = 'Idle';

function resolveActivityIntensityMotion(activityId: string): string {
  const base = activityIdToMotionGroup(activityId);
  return base;
}

function resolveAdapterActivityMotion(
  compatibility: Live2DCompatibilityReport | null | undefined,
  activityId: string,
  intensity: string | null | undefined,
): string | null {
  const mapping = compatibility?.activityMotionGroups.get(activityId);
  if (!mapping) return null;
  if (intensity === 'weak' && mapping.weak_group) return mapping.weak_group;
  if (intensity === 'strong' && mapping.strong_group) return mapping.strong_group;
  return mapping.group ?? null;
}

async function runLive2DDefaultActivityFallback(
  context: PluginApiContext,
  activityId: string,
  options: ActivityFallbackOptions,
): Promise<void> {
  const intensity = options.bundle.activity?.intensity;
  const adapterMotion = resolveAdapterActivityMotion(context.compatibility, activityId, intensity);
  const base = resolveActivityIntensityMotion(activityId);
  const motion = adapterMotion ?? (intensity === 'weak'
    ? `${base}_Weak`
    : intensity === 'strong'
      ? `${base}_Strong`
      : base);
  if (!adapterMotion && context.compatibility?.missingActivity === 'diagnostic_no_success') {
    console.warn(`[avatar:live2d:compat] AVATAR_LIVE2D_COMPAT_UNSUPPORTED_SEMANTIC: no motion mapping for ${activityId}`);
    return;
  }
  try {
    context.commandBus.emit('command', {
      kind: 'motion',
      group: motion,
      options: { priority: 'normal' },
    });
  } catch (err) {
    if (options.signal.aborted) return;
    const idleGroup = context.compatibility?.idleMotionGroup ?? FALLBACK_IDLE_GROUP;
    console.warn(`[avatar:live2d:fallback] ${motion} failed (${String(err)}), falling back to ${idleGroup}`);
    context.commandBus.emit('command', {
      kind: 'motion',
      group: idleGroup,
      options: { priority: 'low' },
    });
  }
}

export function createLive2DBackendApi(context: PluginApiContext): EmbodimentProjectionApi {
  return {
    async triggerMotion(motionId, opts = {}) {
      context.commandBus.emit('command', { kind: 'motion', group: motionId, options: opts });
    },
    stopMotion() {
      context.commandBus.emit('command', { kind: 'motion-stop' });
    },
    setSignal(signalId, value, weight = 1) {
      context.parameterState.set(signalId, value);
      context.commandBus.emit('command', { kind: 'parameter', id: signalId, value, weight });
    },
    getSignal(signalId) {
      return context.parameterState.get(signalId) ?? 0;
    },
    addSignal(signalId, delta) {
      const next = (context.parameterState.get(signalId) ?? 0) + delta;
      context.parameterState.set(signalId, next);
      context.commandBus.emit('command', { kind: 'parameter-add', id: signalId, delta });
    },
    async setExpression(expressionId) {
      context.commandBus.emit('command', { kind: 'expression', id: expressionId });
    },
    clearExpression() {
      context.commandBus.emit('command', { kind: 'expression-clear' });
    },
    setPose(poseId, loop = false) {
      context.commandBus.emit('command', { kind: 'pose', group: poseId, loop });
    },
    clearPose() {
      context.commandBus.emit('command', { kind: 'pose-clear' });
    },
    async wait(ms) {
      await new Promise<void>((resolve) => globalThis.setTimeout(resolve, ms));
    },
    getSurfaceBounds() {
      return context.bounds();
    },
    async runDefaultActivity(activityId, options) {
      await runLive2DDefaultActivityFallback(context, activityId, options);
    },
  };
}

export function createCommandBus(): Live2DCommandBus {
  return createEventBus<{ command: Live2DCommandEvent }>();
}
