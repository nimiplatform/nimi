import { describe, expect, it, vi } from 'vitest';
import type { AgentDataBundle, AgentEvent } from '../driver/types.js';
import type { EmbodimentProjectionApi } from '../nas/embodiment-projection-api.js';
import { createInteractionPhysicsController, isAvatarUserInteractionEvent } from './interaction-physics.js';

function createBundle(): AgentDataBundle {
  return {
    posture: {
      posture_class: 'baseline',
      action_family: 'observe',
      interrupt_mode: 'welcome',
      transition_reason: 'test',
      truth_basis_ids: [],
    },
    status_text: '',
    execution_state: 'IDLE',
    active_world_id: 'world-1',
    active_user_id: 'user-1',
    app: {
      namespace: 'avatar',
      surface_id: 'avatar-window',
      visible: true,
      focused: true,
      window: { x: 0, y: 0, width: 200, height: 400 },
      cursor_x: 0,
      cursor_y: 0,
    },
    runtime: {
      now: '2026-04-26T00:00:00.000Z',
      session_id: 'anchor-1',
      locale: 'en-US',
    },
  };
}

function createProjection(): EmbodimentProjectionApi & { setSignal: ReturnType<typeof vi.fn<(signalId: string, value: number, weight?: number) => void>> } {
  const setSignal = vi.fn<(signalId: string, value: number, weight?: number) => void>();
  return {
    triggerMotion: vi.fn(async () => undefined),
    stopMotion: vi.fn(),
    setSignal,
    getSignal: vi.fn(() => 0),
    addSignal: vi.fn(),
    setExpression: vi.fn(async () => undefined),
    clearExpression: vi.fn(),
    setPose: vi.fn(),
    clearPose: vi.fn(),
    wait: vi.fn(async () => undefined),
    getSurfaceBounds: vi.fn(() => ({ x: 0, y: 0, width: 200, height: 400 })),
  };
}

function event(name: string, detail: Record<string, unknown>, timestamp = '2026-04-26T00:00:00.500Z'): AgentEvent {
  return {
    event_id: `event-${name}`,
    name,
    timestamp,
    detail,
  };
}

describe('interaction physics', () => {
  it('maps admitted avatar.user events to bounded Live2D parameter signals', () => {
    const projection = createProjection();
    const controller = createInteractionPhysicsController({
      projection,
      nowMs: () => Date.parse('2026-04-26T00:00:00.750Z'),
    });

    controller.handle(event('avatar.user.drag.move', {
      x: 150,
      y: 100,
      delta_x: 60,
    }), createBundle());

    expect(projection.setSignal).toHaveBeenCalledWith('ParamAngleX', 7.5, 0.35);
    expect(projection.setSignal).toHaveBeenCalledWith('ParamAngleY', 5, 0.35);
    expect(projection.setSignal).toHaveBeenCalledWith('ParamBodyAngleX', 3, 0.3);
    expect(projection.setSignal).toHaveBeenCalledWith('ParamBodyAngleZ', 3.6, 0.4);
  });

  it('resets physics on leave, drag end, stale events, and shutdown reset', () => {
    const projection = createProjection();
    const controller = createInteractionPhysicsController({
      projection,
      nowMs: () => Date.parse('2026-04-26T00:00:02.500Z'),
    });

    controller.handle(event('avatar.user.hover', { x: 100, y: 100 }, '2026-04-26T00:00:00.000Z'), createBundle());
    controller.handle(event('avatar.user.leave', {}), createBundle());
    controller.reset();

    expect(projection.setSignal).toHaveBeenCalledWith('ParamAngleX', 0, 0.2);
    expect(projection.setSignal).toHaveBeenCalledWith('ParamAngleY', 0, 0.2);
    expect(projection.setSignal).toHaveBeenCalledWith('ParamBodyAngleX', 0, 0.2);
    expect(projection.setSignal).toHaveBeenCalledWith('ParamBodyAngleZ', 0, 0.2);
  });

  it('admits only exact avatar.user event names', () => {
    expect(isAvatarUserInteractionEvent('avatar.user.click')).toBe(true);
    expect(isAvatarUserInteractionEvent('avatar.user.drag.move')).toBe(true);
    expect(isAvatarUserInteractionEvent('avatar.user.*')).toBe(false);
    expect(isAvatarUserInteractionEvent('avatar.user.poke')).toBe(false);
  });
});
