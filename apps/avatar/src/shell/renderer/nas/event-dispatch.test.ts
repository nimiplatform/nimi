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
});
