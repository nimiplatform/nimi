import { describe, expect, it, vi } from 'vitest';
import type { AgentDataBundle, AgentDataDriver, AgentEvent, DriverStatus } from '../driver/types.js';
import type { BackendProjection } from '../carrier/backend-branch.js';
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
      void this.emitCancelable?.(event);
    },
    emitCancelable(event) {
      const agentEvent: AgentEvent = {
        event_id: `emitted-${emitted.length + 1}`,
        name: event.name,
        timestamp: '2026-04-26T00:00:00.000Z',
        detail: { ...event.detail },
      };
      emitted.push({
        name: agentEvent.name,
        detail: agentEvent.detail,
      });
      return agentEvent;
    },
    trigger(event) {
      handlers.forEach((handler) => handler(event));
    },
    emitted,
  };
  return driver;
}

function createProjection(): BackendProjection {
  return {
    applyActivity: vi.fn(),
    applyEmotion: vi.fn(),
    applyMotion: vi.fn(),
    applyExpression: vi.fn(),
    reset: vi.fn(),
  };
}

function admissionDetail(): Record<string, string> {
  return {
    agent_id: 'local-agent:owner-1:agent-1',
    conversation_anchor_id: 'anchor-1',
    turn_id: 'turn-1',
    stream_id: 'stream-1',
    runtime_admission_ref: 'runtime.admission/avatar-presentation-1',
    gateway_verdict_ref: 'runtime.gateway/avatar-presentation-1',
    firewall_verdict_ref: 'runtime.firewall/avatar-presentation-1',
    audit_ref: 'runtime.audit/avatar-presentation-1',
    credential_verdict_ref: 'runtime.credential/avatar-presentation-1',
  };
}

function runtimeEnvelopeDetail(): Record<string, string> {
  return {
    agent_id: 'local-agent:owner-1:agent-1',
    conversation_anchor_id: 'anchor-1',
    turn_id: 'turn-1',
    stream_id: 'stream-1',
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

function fixtureActivityEvent(detail: Record<string, unknown>): AgentEvent {
  return {
    event_id: 'event-fixture-activity',
    name: 'avatar.fixture.presentation.activity_requested',
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
      ...admissionDetail(),
    }));
    await Promise.resolve();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(projection.applyActivity).toHaveBeenCalledWith({ name: 'happy', intensity: 0.85 });
    expect(driver.emitted).toContainEqual({
      name: 'avatar.activity.start',
      detail: {
        activity_name: 'happy',
        category: 'emotion',
        intensity: 'strong',
        source: 'apml_output',
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

  it('accepts runtime activity projection with envelope evidence but no admission refs', async () => {
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
      ...runtimeEnvelopeDetail(),
    }));
    await Promise.resolve();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(projection.applyActivity).toHaveBeenCalledWith({ name: 'happy', intensity: 0.85 });
    expect(driver.emitted.map((event) => event.name)).toContain('avatar.activity.start');

    unwire();
  });

  it('honors avatar.before.activity.start cancellation before running activity fallback', async () => {
    const driver = createDriver();
    const projection = createProjection();
    const originalEmitCancelable = driver.emitCancelable?.bind(driver);
    driver.emitCancelable = (event) => {
      const emitted = originalEmitCancelable?.(event);
      if (!emitted) {
        throw new Error('test driver must support cancelable emit');
      }
      if (emitted.name === 'avatar.before.activity.start') {
        emitted.detail['cancelled'] = true;
      }
      return emitted;
    };
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
      ...admissionDetail(),
    }));
    await Promise.resolve();

    expect(projection.applyActivity).not.toHaveBeenCalled();
    expect(driver.emitted.map((event) => event.name)).toEqual([
      'avatar.before.activity.start',
      'avatar.activity.cancel',
    ]);
    expect(driver.emitted.at(-1)?.detail).toMatchObject({
      activity_name: 'happy',
      reason: 'before_event_cancelled',
    });

    unwire();
  });

  it('cancels production activity start while runtime execution is suspended', async () => {
    const driver = createDriver(createBundle({ execution_state: 'SUSPENDED' }));
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
      ...admissionDetail(),
    }));
    await Promise.resolve();

    expect(projection.applyActivity).not.toHaveBeenCalled();
    expect(driver.emitted).toEqual([
      {
        name: 'avatar.before.activity.start',
        detail: {
          activity_name: 'happy',
          category: 'emotion',
          intensity: 'strong',
          source: 'apml_output',
          cancelled: true,
          cancel_reason: 'runtime_execution_suspended',
        },
      },
      {
        name: 'avatar.activity.cancel',
        detail: {
          activity_name: 'happy',
          reason: 'runtime_execution_suspended',
        },
      },
    ]);

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
      ...admissionDetail(),
    }));
    await Promise.resolve();
    await Promise.resolve();

    expect(handler.execute).toHaveBeenCalledOnce();
    expect(projection.applyActivity).not.toHaveBeenCalled();
    expect(driver.emitted).toContainEqual({
      name: 'avatar.activity.start',
      detail: {
        activity_name: 'happy',
        category: 'emotion',
        intensity: 'strong',
        source: 'apml_output',
      },
    });
    expect(driver.emitted.find((event) => event.name === 'avatar.activity.end')).toBeUndefined();

    unwire();
  });

  it('rejects mock source on the runtime activity namespace before carrier fallback', async () => {
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
      ...admissionDetail(),
    }));
    await Promise.resolve();

    expect(projection.applyActivity).not.toHaveBeenCalled();
    expect(driver.emitted).toEqual([]);

    unwire();
  });

  it('maps fixture activity projections into the carrier fallback without runtime admission', async () => {
    const driver = createDriver();
    const projection = createProjection();
    const unwire = wireEventDispatch({
      driver,
      registry: createHandlerRegistry(),
      executor: new HandlerExecutor(),
      projection,
    });

    driver.trigger(fixtureActivityEvent({
      activity_name: 'greet',
      category: 'interaction',
      intensity: null,
      source: 'mock',
    }));
    await Promise.resolve();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(projection.applyActivity).toHaveBeenCalledWith({ name: 'greet', intensity: null });
    expect(driver.emitted).toContainEqual({
      name: 'avatar.activity.start',
      detail: {
        activity_name: 'greet',
        category: 'interaction',
        intensity: null,
        source: 'mock',
      },
    });
    expect(driver.emitted.find((event) => event.name === 'avatar.activity.end')).toEqual({
      name: 'avatar.activity.end',
      detail: {
        activity_name: 'greet',
        source: 'default_fallback',
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
        source: 'apml_output',
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
      ...admissionDetail(),
    }));
    await Promise.resolve();

    expect(projection.applyActivity).not.toHaveBeenCalled();
    expect(driver.emitted).toEqual([]);

    unwire();
  });

  it('rejects unknown runtime activity projection before NAS fallback', async () => {
    const driver = createDriver();
    const projection = createProjection();
    const unwire = wireEventDispatch({
      driver,
      registry: createHandlerRegistry(),
      executor: new HandlerExecutor(),
      projection,
    });

    driver.trigger(runtimeActivityEvent({
      activity_name: 'mystery_activity',
      category: 'emotion',
      intensity: 'strong',
      source: 'apml_output',
      ...admissionDetail(),
    }));
    await Promise.resolve();

    expect(projection.applyActivity).not.toHaveBeenCalled();
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
        source: 'apml_output',
        ...admissionDetail(),
      },
    });
    await Promise.resolve();

    expect(projection.applyExpression).toHaveBeenCalledWith({ name: 'smile.default' });
    expect(driver.emitted).toContainEqual({
      name: 'avatar.expression.change',
      detail: {
        expression_id: 'smile.default',
        source: 'apml_output',
      },
    });

    unwire();
  });

  it('admits NAS event handlers for runtime emotion projection without treating emotion as activity', async () => {
    const handler = {
      execute: vi.fn(async (ctx: AgentDataBundle, projection: BackendProjection) => {
        expect(ctx.activity).toBeUndefined();
        expect(ctx.emotion).toEqual({
          current: 'happy',
          previous: 'neutral',
          source: 'chat_status_cue',
        });
        projection.applyExpression({ name: 'smile.default' });
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
        current: 'happy',
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
        current_emotion: 'happy',
        previous_emotion: 'neutral',
        source: 'chat_status_cue',
      },
    });
    await Promise.resolve();

    expect(handler.execute).toHaveBeenCalledOnce();
    expect(projection.applyExpression).toHaveBeenCalledWith({ name: 'smile.default' });
    expect(handlerFilenameToEventName('runtime_agent_state_emotion_changed.js')).toBe('runtime.agent.state.emotion_changed');
    expect(handlerFilenameToEventName('runtime_agent_presentation_expression_requested.js')).toBe('runtime.agent.presentation.expression_requested');

    unwire();
  });

  it('routes admitted avatar.user events to renderer-local physics and exact NAS handlers', async () => {
    const handler = {
      execute: vi.fn(async (ctx: AgentDataBundle, projection: BackendProjection) => {
        expect(ctx.event).toMatchObject({
          event_name: 'avatar.user.click',
          detail: { region: 'face', x: 24, y: 48, button: 'left' },
        });
        projection.applyExpression({ name: 'interaction_smile' });
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
    expect(projection.applyExpression).toHaveBeenCalledWith({ name: 'interaction_smile' });
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
    expect(projection.applyExpression).not.toHaveBeenCalled();
    expect(driver.emitted).toEqual([]);
    expect(handlerFilenameToEventName('avatar_user_poke.js')).toBeNull();

    unwire();
  });

  it('cancels the prior in-flight handler for the same avatar.user event key', async () => {
    const startedSignals: AbortSignal[] = [];
    const handler = {
      execute: vi.fn(async (_ctx: AgentDataBundle, _projection: BackendProjection, options: { signal: AbortSignal }) => {
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
