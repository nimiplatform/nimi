import { describe, expect, it, vi } from 'vitest';
import type { AgentDataBundle, AgentDataDriver, AgentEvent, DriverStatus } from '../driver/types.js';
import type { EmbodimentProjectionApi } from './embodiment-projection-api.js';
import { HandlerExecutor } from './handler-executor.js';
import { createHandlerRegistry } from './handler-registry.js';
import { handlerFilenameToEventName } from './activity-naming.js';
import { wireEventDispatch } from './event-dispatch.js';

function createBundle(overrides: Partial<AgentDataBundle> = {}): AgentDataBundle {
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
      window: { x: 0, y: 0, width: 400, height: 600 },
      cursor_x: 0,
      cursor_y: 0,
    },
    runtime: {
      now: '2026-04-26T00:00:00.000Z',
      session_id: 'anchor-1',
      locale: 'en-US',
    },
    ...overrides,
  };
}

function createDriver(bundle = createBundle()) {
  const handlers = new Set<(event: AgentEvent) => void>();
  const emitted: Array<{ name: string; detail: Record<string, unknown> }> = [];
  const driver: AgentDataDriver & { emitted: typeof emitted; trigger(event: AgentEvent): void } = {
    kind: 'sdk',
    status: 'running' as DriverStatus,
    async start() {},
    async stop() {},
    getBundle: () => bundle,
    onEvent(handler) {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
    onBundleChange() {
      return () => {};
    },
    onStatusChange() {
      return () => {};
    },
    emit(event) {
      emitted.push(event);
    },
    trigger(event) {
      handlers.forEach((handler) => handler(event));
    },
    emitted,
  };
  return driver;
}

function createProjection(): EmbodimentProjectionApi & {
  runDefaultActivity: ReturnType<typeof vi.fn>;
  setExpression: ReturnType<typeof vi.fn>;
} {
  return {
    triggerMotion: vi.fn(async () => undefined),
    stopMotion: vi.fn(),
    setSignal: vi.fn(),
    getSignal: vi.fn(() => 0),
    addSignal: vi.fn(),
    setExpression: vi.fn(async () => undefined),
    clearExpression: vi.fn(),
    setPose: vi.fn(),
    clearPose: vi.fn(),
    wait: vi.fn(async () => undefined),
    getSurfaceBounds: vi.fn(() => ({ x: 0, y: 0, width: 400, height: 600 })),
    runDefaultActivity: vi.fn(async () => undefined),
  };
}

function runtimeActivityEvent(detail: Record<string, unknown>): AgentEvent {
  return {
    event_id: 'event-activity',
    name: 'runtime.agent.presentation.activity_requested',
    timestamp: '2026-04-26T00:00:01.000Z',
    detail,
  };
}

describe('Avatar NAS runtime event dispatch', () => {
  it('maps typed runtime activity projection into carrier-local activity fallback', async () => {
    const driver = createDriver();
    const projection = createProjection();
    const registry = createHandlerRegistry();
    const unwire = wireEventDispatch({
      driver,
      registry,
      executor: new HandlerExecutor(),
      projection,
    });

    driver.trigger(runtimeActivityEvent({
      activity_name: 'happy',
      category: 'emotion',
      intensity: 'strong',
      source: 'apml_output',
    }));
    await Promise.resolve();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(projection.runDefaultActivity).toHaveBeenCalledWith(
      'happy',
      expect.objectContaining({
        bundle: expect.objectContaining({
          activity: {
            name: 'happy',
            category: 'emotion',
            intensity: 'strong',
            source: 'runtime_projection',
          },
        }),
      }),
    );
    expect(driver.emitted).toContainEqual({
      name: 'avatar.activity.start',
      detail: {
        activity_name: 'happy',
        category: 'emotion',
        intensity: 'strong',
        source: 'runtime_projection',
        runtime_source: 'apml_output',
      },
    });
    expect(driver.emitted.find((event) => event.name === 'avatar.activity.end')).toEqual({
      name: 'avatar.activity.end',
      detail: {
        activity_name: 'happy',
        source: 'default_fallback',
      },
    });

    unwire();
  });

  it('does not run missing-handler fallback when a registered activity handler fails', async () => {
    const handler = {
      execute: vi.fn(async () => {
        throw new Error('custom motion failed');
      }),
    };
    const registry = createHandlerRegistry();
    registry.activity.set('happy', {
      kind: 'activity',
      activityId: 'happy',
      handler,
      sourcePath: '/model/runtime/nimi/activity/happy.js',
    });
    const driver = createDriver();
    const projection = createProjection();
    const unwire = wireEventDispatch({
      driver,
      registry,
      executor: new HandlerExecutor(),
      projection,
    });

    driver.trigger(runtimeActivityEvent({
      activity_name: 'happy',
      category: 'emotion',
      intensity: 'strong',
      source: 'apml_output',
    }));
    await Promise.resolve();
    await Promise.resolve();

    expect(handler.execute).toHaveBeenCalledOnce();
    expect(projection.runDefaultActivity).not.toHaveBeenCalled();
    expect(driver.emitted).toContainEqual({
      name: 'avatar.activity.start',
      detail: {
        activity_name: 'happy',
        category: 'emotion',
        intensity: 'strong',
        source: 'runtime_projection',
        runtime_source: 'apml_output',
      },
    });
    expect(driver.emitted.find((event) => event.name === 'avatar.activity.end')).toBeUndefined();

    unwire();
  });

  it('keeps explicit mock fixture activity events on the same carrier fallback path', async () => {
    const driver = createDriver();
    const projection = createProjection();
    const unwire = wireEventDispatch({
      driver,
      registry: createHandlerRegistry(),
      executor: new HandlerExecutor(),
      projection,
    });

    driver.trigger(runtimeActivityEvent({
      activity_name: 'greet',
      category: 'interaction',
      intensity: null,
      source: 'mock',
    }));
    await Promise.resolve();

    expect(projection.runDefaultActivity).toHaveBeenCalledWith(
      'greet',
      expect.objectContaining({
        bundle: expect.objectContaining({
          activity: {
            name: 'greet',
            category: 'interaction',
            intensity: null,
            source: 'runtime_projection',
          },
        }),
      }),
    );
    expect(driver.emitted).toContainEqual({
      name: 'avatar.activity.start',
      detail: {
        activity_name: 'greet',
        category: 'interaction',
        intensity: null,
        source: 'runtime_projection',
        runtime_source: 'mock',
      },
    });

    unwire();
  });

  it('rejects malformed runtime activity projection before NAS fallback', async () => {
    const driver = createDriver(createBundle({
      activity: {
        name: 'previous',
        category: 'state',
        intensity: null,
        source: 'runtime_projection',
      },
    }));
    const projection = createProjection();
    const unwire = wireEventDispatch({
      driver,
      registry: createHandlerRegistry(),
      executor: new HandlerExecutor(),
      projection,
    });

    driver.trigger(runtimeActivityEvent({
      activity_name: 'happy',
      category: 'renderer-local',
      intensity: 'strong',
      source: 'apml_output',
    }));
    await Promise.resolve();

    expect(projection.runDefaultActivity).not.toHaveBeenCalled();
    expect(driver.emitted).toEqual([]);

    unwire();
  });

  it('maps runtime expression projection into the backend expression API when no NAS handler exists', async () => {
    const driver = createDriver();
    const projection = createProjection();
    const unwire = wireEventDispatch({
      driver,
      registry: createHandlerRegistry(),
      executor: new HandlerExecutor(),
      projection,
    });

    driver.trigger({
      event_id: 'event-expression',
      name: 'runtime.agent.presentation.expression_requested',
      timestamp: '2026-04-26T00:00:02.000Z',
      detail: {
        expression_id: 'smile.default',
      },
    });
    await Promise.resolve();

    expect(projection.setExpression).toHaveBeenCalledWith('smile.default');
    expect(driver.emitted).toContainEqual({
      name: 'avatar.expression.change',
      detail: {
        expression_id: 'smile.default',
        source: 'runtime_projection',
      },
    });

    unwire();
  });

  it('admits NAS event handlers for runtime emotion projection without treating emotion as activity', async () => {
    const handler = {
      execute: vi.fn(async (ctx: AgentDataBundle, projection: EmbodimentProjectionApi) => {
        expect(ctx.activity).toBeUndefined();
        expect(ctx.emotion).toEqual({
          current: 'joy',
          previous: 'neutral',
          source: 'chat_status_cue',
        });
        await projection.setExpression('smile.default');
      }),
    };
    const registry = createHandlerRegistry();
    registry.event.set('runtime.agent.state.emotion_changed', {
      kind: 'event',
      eventName: 'runtime.agent.state.emotion_changed',
      handler,
      sourcePath: '/model/runtime/nimi/event/runtime_agent_state_emotion_changed.js',
    });
    const driver = createDriver(createBundle({
      emotion: {
        current: 'joy',
        previous: 'neutral',
        source: 'chat_status_cue',
      },
    }));
    const projection = createProjection();
    const unwire = wireEventDispatch({
      driver,
      registry,
      executor: new HandlerExecutor(),
      projection,
    });

    driver.trigger({
      event_id: 'event-emotion',
      name: 'runtime.agent.state.emotion_changed',
      timestamp: '2026-04-26T00:00:03.000Z',
      detail: {
        current_emotion: 'joy',
        previous_emotion: 'neutral',
        source: 'chat_status_cue',
      },
    });
    await Promise.resolve();

    expect(handler.execute).toHaveBeenCalledOnce();
    expect(projection.setExpression).toHaveBeenCalledWith('smile.default');
    expect(handlerFilenameToEventName('runtime_agent_state_emotion_changed.js')).toBe('runtime.agent.state.emotion_changed');
    expect(handlerFilenameToEventName('runtime_agent_presentation_expression_requested.js')).toBe('runtime.agent.presentation.expression_requested');

    unwire();
  });

  it('routes admitted avatar.user events to renderer-local physics and exact NAS handlers', async () => {
    const handler = {
      execute: vi.fn(async (ctx: AgentDataBundle, projection: EmbodimentProjectionApi) => {
        expect(ctx.event).toMatchObject({
          event_name: 'avatar.user.click',
          detail: { region: 'face', x: 24, y: 48, button: 'left' },
        });
        projection.setSignal('ParamInteractionSmile', 1);
      }),
    };
    const registry = createHandlerRegistry();
    registry.event.set('avatar.user.click', {
      kind: 'event',
      eventName: 'avatar.user.click',
      handler,
      sourcePath: '/model/runtime/nimi/event/avatar_user_click.js',
    });
    const interactionPhysics = { handle: vi.fn(), reset: vi.fn() };
    const driver = createDriver();
    const projection = createProjection();
    const unwire = wireEventDispatch({
      driver,
      registry,
      executor: new HandlerExecutor(),
      projection,
      interactionPhysics,
    });

    const event: AgentEvent = {
      event_id: 'event-avatar-click',
      name: 'avatar.user.click',
      timestamp: '2026-04-26T00:00:04.000Z',
      detail: { region: 'face', x: 24, y: 48, button: 'left' },
    };
    driver.trigger(event);
    await Promise.resolve();

    expect(interactionPhysics.handle).toHaveBeenCalledWith(event, driver.getBundle());
    expect(handler.execute).toHaveBeenCalledOnce();
    expect(projection.setSignal).toHaveBeenCalledWith('ParamInteractionSmile', 1);
    expect(handlerFilenameToEventName('avatar_user_click.js')).toBe('avatar.user.click');
    expect(handlerFilenameToEventName('avatar_user_drag_end.js')).toBe('avatar.user.drag.end');

    unwire();
  });

  it('skips missing and unsupported avatar.user handlers without wildcard fallback', async () => {
    const driver = createDriver();
    const projection = createProjection();
    const interactionPhysics = { handle: vi.fn(), reset: vi.fn() };
    const unwire = wireEventDispatch({
      driver,
      registry: createHandlerRegistry(),
      executor: new HandlerExecutor(),
      projection,
      interactionPhysics,
    });

    driver.trigger({
      event_id: 'event-avatar-click-missing',
      name: 'avatar.user.click',
      timestamp: '2026-04-26T00:00:04.000Z',
      detail: { region: 'body', x: 50, y: 80, button: 'left' },
    });
    driver.trigger({
      event_id: 'event-avatar-poke-unsupported',
      name: 'avatar.user.poke',
      timestamp: '2026-04-26T00:00:05.000Z',
      detail: { x: 50, y: 80 },
    });
    await Promise.resolve();

    expect(interactionPhysics.handle).toHaveBeenCalledTimes(1);
    expect(projection.setSignal).not.toHaveBeenCalled();
    expect(driver.emitted).toEqual([]);
    expect(handlerFilenameToEventName('avatar_user_poke.js')).toBeNull();

    unwire();
  });

  it('cancels the prior in-flight handler for the same avatar.user event key', async () => {
    const startedSignals: AbortSignal[] = [];
    const handler = {
      execute: vi.fn(async (_ctx: AgentDataBundle, _projection: EmbodimentProjectionApi, options: { signal: AbortSignal }) => {
        startedSignals.push(options.signal);
        if (startedSignals.length === 1) {
          await new Promise<void>((resolve) => {
            options.signal.addEventListener('abort', () => resolve(), { once: true });
          });
        }
      }),
    };
    const registry = createHandlerRegistry();
    registry.event.set('avatar.user.drag.move', {
      kind: 'event',
      eventName: 'avatar.user.drag.move',
      handler,
      sourcePath: '/model/runtime/nimi/event/avatar_user_drag_move.js',
    });
    const driver = createDriver();
    const unwire = wireEventDispatch({
      driver,
      registry,
      executor: new HandlerExecutor(),
      projection: createProjection(),
    });

    driver.trigger({
      event_id: 'event-avatar-drag-move-1',
      name: 'avatar.user.drag.move',
      timestamp: '2026-04-26T00:00:06.000Z',
      detail: { x: 50, y: 80, delta_x: 4, delta_y: 0 },
    });
    await Promise.resolve();
    driver.trigger({
      event_id: 'event-avatar-drag-move-2',
      name: 'avatar.user.drag.move',
      timestamp: '2026-04-26T00:00:06.050Z',
      detail: { x: 54, y: 80, delta_x: 4, delta_y: 0 },
    });
    await Promise.resolve();

    expect(handler.execute).toHaveBeenCalledTimes(2);
    expect(startedSignals[0]?.aborted).toBe(true);
    expect(startedSignals[1]?.aborted).toBe(false);

    unwire();
  });
});
