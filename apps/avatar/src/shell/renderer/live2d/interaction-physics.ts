import type { AgentDataBundle, AgentEvent } from '../driver/types.js';
import type { EmbodimentProjectionApi } from '../nas/embodiment-projection-api.js';

export type InteractionPhysicsController = {
  handle(event: AgentEvent, bundle: AgentDataBundle): void;
  reset(): void;
};

const ANGLE_X = 'ParamAngleX';
const ANGLE_Y = 'ParamAngleY';
const BODY_X = 'ParamBodyAngleX';
const DRAG_SWAY_X = 'ParamBodyAngleZ';
const STALE_EVENT_MS = 1_000;

const AVATAR_USER_EVENTS = new Set([
  'avatar.user.hover',
  'avatar.user.leave',
  'avatar.user.click',
  'avatar.user.double_click',
  'avatar.user.right_click',
  'avatar.user.drag.start',
  'avatar.user.drag.move',
  'avatar.user.drag.end',
]);

export function isAvatarUserInteractionEvent(name: string): boolean {
  return AVATAR_USER_EVENTS.has(name);
}

export function createInteractionPhysicsController(input: {
  projection: EmbodimentProjectionApi;
  nowMs?: () => number;
}): InteractionPhysicsController {
  const nowMs = input.nowMs ?? (() => Date.now());
  return {
    handle(event, bundle) {
      if (!isAvatarUserInteractionEvent(event.name)) return;
      if (isStale(event, nowMs())) {
        resetSignals(input.projection);
        return;
      }
      applyInteractionPhysics(input.projection, event, bundle);
    },
    reset() {
      resetSignals(input.projection);
    },
  };
}

export function applyInteractionPhysics(
  projection: EmbodimentProjectionApi,
  event: AgentEvent,
  bundle: AgentDataBundle,
): void {
  if (!isAvatarUserInteractionEvent(event.name)) return;
  if (event.name === 'avatar.user.leave' || event.name === 'avatar.user.drag.end') {
    resetSignals(projection);
    return;
  }

  const width = positiveNumber(bundle.app?.window?.width) ?? 400;
  const height = positiveNumber(bundle.app?.window?.height) ?? 600;
  const x = finiteNumber(event.detail['x']) ?? width / 2;
  const y = finiteNumber(event.detail['y']) ?? height / 2;
  const centeredX = clamp((x / width) * 2 - 1, -1, 1);
  const centeredY = clamp((y / height) * 2 - 1, -1, 1);
  const clickImpulse = event.name === 'avatar.user.click'
    || event.name === 'avatar.user.double_click'
    || event.name === 'avatar.user.right_click';

  projection.setSignal(ANGLE_X, round(centeredX * 15), 0.35);
  projection.setSignal(ANGLE_Y, round(-centeredY * 10), 0.35);
  projection.setSignal(BODY_X, round(centeredX * (clickImpulse ? 10 : 6)), 0.3);

  if (event.name === 'avatar.user.drag.start' || event.name === 'avatar.user.drag.move') {
    const deltaX = finiteNumber(event.detail['delta_x']) ?? 0;
    projection.setSignal(DRAG_SWAY_X, round(clamp(deltaX / width, -1, 1) * 12), 0.4);
  }
}

function resetSignals(projection: EmbodimentProjectionApi): void {
  projection.setSignal(ANGLE_X, 0, 0.2);
  projection.setSignal(ANGLE_Y, 0, 0.2);
  projection.setSignal(BODY_X, 0, 0.2);
  projection.setSignal(DRAG_SWAY_X, 0, 0.2);
}

function isStale(event: AgentEvent, nowMs: number): boolean {
  const timestampMs = Date.parse(event.timestamp);
  return Number.isFinite(timestampMs) && nowMs - timestampMs > STALE_EVENT_MS;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function positiveNumber(value: unknown): number | null {
  const number = finiteNumber(value);
  return number !== null && number > 0 ? number : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
