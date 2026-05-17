// Wave 1 (step 2) of topic 2026-04-30-avatar-vrm-backend-branch.
//
// Live2D BackendProjection adapter — implements the ontology-level
// projection surface (`applyActivity / applyEmotion / applyMotion /
// applyExpression / reset`) by translating activity-mapping.yaml v2
// `live2d` routes into Cubism command bus events that
// `Live2DBackendSession.applyCommand` already consumes.
//
// Spec authorities:
//   - .nimi/spec/avatar/kernel/backend-branch-contract.md
//     §"BackendProjection ontology surface"
//   - .nimi/spec/avatar/kernel/embodiment-projection-contract.md (re-anchor)
//   - .nimi/spec/avatar/kernel/tables/activity-mapping.yaml v2
//     (`live2d.motion_group` / `fallback_motion_group`)
//
// Implementation notes:
//   - This module emits Cubism commands; it does not mutate runtime
//     ontology truth. Activity-id → motion-group resolution prefers any
//     adapter manifest mapping (Live2DCompatibilityReport), then falls
//     back to the default `Activity_<CamelCase>` naming convention
//     (live2d-render-contract §5.1).
//   - BackendProjection is intentionally narrow; `EmbodimentProjectionApi`
//     continues to drive cue-level NAS dispatch. This adapter and the cue
//     surface share the same command bus by design.

import { activityIdToMotionGroup } from '../nas/activity-naming.js';
import type {
  BackendProjection,
} from '../carrier/backend-branch.js';
import type {
  Live2DCommandBus,
  Live2DCommandEvent,
} from './plugin-api.js';
import type { Live2DCompatibilityReport } from './compatibility.js';

export type Live2DProjectionAdapterDeps = {
  commandBus: Live2DCommandBus;
  compatibility: Live2DCompatibilityReport | null;
};

function emitMotion(
  bus: Live2DCommandBus,
  group: string,
  priority: 'low' | 'normal' | 'high',
): void {
  const event: Live2DCommandEvent = {
    kind: 'motion',
    group,
    options: { priority },
  };
  bus.emit('command', event);
}

function resolveActivityMotionGroup(
  compatibility: Live2DCompatibilityReport | null,
  activityName: string,
  intensity: number | null,
): string {
  const mapping = compatibility?.activityMotionGroups.get(activityName);
  if (mapping) {
    if (intensity !== null) {
      if (intensity <= 0.34 && mapping.weak_group) return mapping.weak_group;
      if (intensity >= 0.67 && mapping.strong_group) return mapping.strong_group;
    }
    if (mapping.group) return mapping.group;
  }
  return activityIdToMotionGroup(activityName);
}

function resolveIdleMotionGroup(
  compatibility: Live2DCompatibilityReport | null,
): string {
  return compatibility?.idleMotionGroup ?? 'Idle';
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
      const group = resolveActivityMotionGroup(compatibility, name, intensity);
      emitMotion(commandBus, group, 'normal');
    },
    applyEmotion({ current }) {
      if (!current) return;
      // Live2D has no first-class emotion channel; route through the
      // expression manager when an adapter mapping exists, otherwise
      // no-op (emotion overlap with motion fallback is baseline
      // avatar-carrier behavior).
      const expressionId =
        compatibility?.adapter?.semantics?.expressions?.map?.[current];
      if (!expressionId) return;
      commandBus.emit('command', { kind: 'expression', id: expressionId });
    },
    applyMotion({ routeId }) {
      if (!routeId) return;
      emitMotion(commandBus, routeId, 'normal');
    },
    applyExpression({ name }) {
      if (!name) return;
      commandBus.emit('command', { kind: 'expression', id: resolveExpressionId(compatibility, name) });
    },
    reset() {
      commandBus.emit('command', { kind: 'expression-clear' });
      commandBus.emit('command', { kind: 'pose-clear' });
      commandBus.emit('command', { kind: 'motion-stop' });
      const idle = resolveIdleMotionGroup(compatibility);
      emitMotion(commandBus, idle, 'low');
    },
  };
}
