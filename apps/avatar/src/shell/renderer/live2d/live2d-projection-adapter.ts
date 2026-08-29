import type {
  Live2DCompatibilityReport,
  PlayMotionOptions,
} from '@nimiplatform/kit/features/avatar/headless';
import type { BackendProjection } from '../carrier/backend-branch.js';

export type Live2DProjectionCommandEvent =
  | { kind: 'motion'; group: string; options: PlayMotionOptions }
  | { kind: 'motion-stop' }
  | { kind: 'expression'; id: string }
  | { kind: 'expression-clear' }
  | { kind: 'pose-clear' };

export type Live2DProjectionCommandBus = {
  emit(eventName: 'command', event: Live2DProjectionCommandEvent): void;
};

export type Live2DProjectionAdapterDeps = {
  commandBus: Live2DProjectionCommandBus;
  compatibility: Live2DCompatibilityReport | null;
};

function emitMotion(
  bus: Live2DProjectionCommandBus,
  group: string,
  priority: 'low' | 'normal' | 'high',
  options: Omit<PlayMotionOptions, 'priority'> = {},
): void {
  bus.emit('command', {
    kind: 'motion',
    group,
    options: { priority, ...options },
  });
}

function resolveActivityMotionGroup(
  compatibility: Live2DCompatibilityReport | null,
  activityName: string,
  intensity: number | null,
): string | null {
  const mapping = compatibility?.activityMotionGroups.get(activityName);
  if (mapping) {
    if (intensity !== null) {
      if (intensity <= 0.34 && mapping.weak_group) return mapping.weak_group;
      if (intensity >= 0.67 && mapping.strong_group) return mapping.strong_group;
    }
    if (mapping.group) return mapping.group;
  }
  return null;
}

function resolveIdleMotionGroup(
  compatibility: Live2DCompatibilityReport | null,
): string | null {
  return compatibility?.adapter ? compatibility.idleMotionGroup : null;
}

function resolveExpressionId(
  compatibility: Live2DCompatibilityReport | null,
  name: string,
): string {
  return compatibility?.adapter?.semantics?.expressions?.map?.[name] ?? name;
}

export function createLive2DProjectionAdapter(
  deps: Live2DProjectionAdapterDeps,
): BackendProjection {
  const { commandBus, compatibility } = deps;
  return {
    applyActivity({ name, intensity }) {
      if (!name) return;
      const motionGroup = resolveActivityMotionGroup(compatibility, name, intensity);
      if (!motionGroup) {
        console.warn(`[avatar:live2d] activity "${name}" has no admitted motion-group mapping; ignored`);
        return;
      }
      emitMotion(commandBus, motionGroup, 'normal');
    },
    applyEmotion({ current }) {
      if (!current) return;
      const expressionId =
        compatibility?.adapter?.semantics?.expressions?.map?.[current];
      if (!expressionId) return;
      commandBus.emit('command', { kind: 'expression', id: expressionId });
    },
    applyMotion({ routeId, fade, loop }) {
      if (!routeId) return;
      emitMotion(commandBus, routeId, 'normal', {
        ...(fade === undefined ? {} : { fadeIn: fade }),
        ...(loop === undefined ? {} : { loop }),
      });
    },
    applyExpression({ name }) {
      if (!name) return;
      commandBus.emit('command', { kind: 'expression', id: resolveExpressionId(compatibility, name) });
    },
    reset() {
      commandBus.emit('command', { kind: 'expression-clear' });
      commandBus.emit('command', { kind: 'pose-clear' });
      commandBus.emit('command', { kind: 'motion-stop' });
      const idleMotionGroup = resolveIdleMotionGroup(compatibility);
      if (idleMotionGroup) emitMotion(commandBus, idleMotionGroup, 'low', { loop: true });
    },
  };
}
