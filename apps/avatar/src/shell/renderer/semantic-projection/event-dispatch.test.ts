import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentDataBundle, AgentDataDriver, AgentEvent, DriverStatus } from '../driver/types.js';
import type { BackendProjection } from '../carrier/backend-branch.js';
import type {
  BackendActivityProjectionSettlement,
  BackendPendingActivityProjectionResult,
} from '../carrier/backend-branch.js';
import { setAvatarLocalQuiet } from '../local-quiet-state.js';
import { wireEventDispatch } from './event-dispatch.js';

afterEach(() => setAvatarLocalQuiet(false));

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
    active_agent_handle: 'agent-1',
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
    custom: runtimeEnvelope(),
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
      return () => handlers.delete(handler);
    },
    onBundleChange: () => () => {},
    onStatusChange: () => () => {},
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
      emitted.push({ name: agentEvent.name, detail: agentEvent.detail });
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
    applyActivity: vi.fn(() => 'applied' as const),
    applyEmotion: vi.fn(),
    applyMotion: vi.fn(),
    applyExpression: vi.fn(),
    reset: vi.fn(),
  };
}

function runtimeEnvelope(): Record<string, string> {
  return {
    agent_handle: 'local-agent:owner-1:agent-1',
    conversation_anchor_id: 'anchor-1',
  };
}

function runtimeActivity(detail: Record<string, unknown>): AgentEvent {
  return {
    event_id: 'activity-1',
    name: 'runtime.agent.presentation.activity_requested',
    timestamp: '2026-04-26T00:00:01.000Z',
    detail,
  };
}

function pendingActivityProjection(): Readonly<{
  result: BackendPendingActivityProjectionResult;
  settle(value: BackendActivityProjectionSettlement): void;
}> {
  let settle: (value: BackendActivityProjectionSettlement) => void = () => {};
  const completion = new Promise<BackendActivityProjectionSettlement>((resolve) => {
    settle = resolve;
  });
  return {
    result: { status: 'pending', completion },
    settle,
  };
}

describe('Avatar backend-neutral semantic event dispatch', () => {
  it('accepts the real SdkDriver Runtime source contract and projects it', () => {
    const driver = createDriver();
    const projection = createProjection();
    const unwire = wireEventDispatch({ driver, projection });

    driver.trigger(runtimeActivity({
      activity_name: 'happy',
      category: 'emotion',
      intensity: 'strong',
      source: 'runtime',
      ...runtimeEnvelope(),
    }));

    expect(projection.applyActivity).toHaveBeenCalledWith({ name: 'happy', intensity: 0.85 });
    expect(driver.emitted).toContainEqual({
      name: 'avatar.activity.end',
      detail: { activity_name: 'happy', source: 'default_projection' },
    });
    expect(driver.emitted).toContainEqual({
      name: 'avatar.activity.start',
      detail: {
        activity_name: 'happy',
        category: 'emotion',
        intensity: 'strong',
        source: 'runtime',
      },
    });
    unwire();
  });

  it('honors suspended execution cancellation before projection', () => {
    const driver = createDriver(createBundle({ execution_state: 'SUSPENDED' }));
    const projection = createProjection();
    const unwire = wireEventDispatch({ driver, projection });

    driver.trigger(runtimeActivity({
      activity_name: 'happy',
      category: 'emotion',
      intensity: 'strong',
      source: 'direct_api',
      ...runtimeEnvelope(),
    }));

    expect(projection.applyActivity).not.toHaveBeenCalled();
    expect(driver.emitted.at(-1)).toEqual({
      name: 'avatar.activity.cancel',
      detail: { activity_name: 'happy', reason: 'runtime_execution_suspended' },
    });
    unwire();
  });

  it('rejects malformed or unknown Runtime activity input', () => {
    const driver = createDriver();
    const projection = createProjection();
    const unwire = wireEventDispatch({ driver, projection });

    driver.trigger(runtimeActivity({
      activity_name: 'mystery_activity',
      category: 'emotion',
      intensity: 'strong',
      source: 'apml_output',
      ...runtimeEnvelope(),
    }));
    driver.trigger(runtimeActivity({
      activity_name: 'happy',
      category: 'renderer-local',
      source: 'apml_output',
      ...runtimeEnvelope(),
    }));
    driver.trigger(runtimeActivity({
      activity_name: 'happy',
      category: 'emotion',
      source: 'unknown-runtime-source',
      ...runtimeEnvelope(),
    }));

    expect(projection.applyActivity).not.toHaveBeenCalled();
    expect(driver.emitted).toEqual([]);
    unwire();
  });

  it('does not report activity success when the backend mapping is unsupported', () => {
    const driver = createDriver();
    const projection = createProjection();
    vi.mocked(projection.applyActivity).mockReturnValue('unsupported');
    const unwire = wireEventDispatch({ driver, projection });

    driver.trigger(runtimeActivity({
      activity_name: 'happy',
      category: 'emotion',
      intensity: 'strong',
      source: 'apml_output',
      ...runtimeEnvelope(),
    }));

    expect(projection.applyActivity).toHaveBeenCalledOnce();
    expect(driver.emitted.map((event) => event.name)).toEqual([
      'avatar.before.activity.start',
    ]);
    unwire();
  });

  it('waits for a pending backend result before reporting activity success', async () => {
    const driver = createDriver();
    const projection = createProjection();
    const pending = pendingActivityProjection();
    vi.mocked(projection.applyActivity).mockReturnValue(pending.result);
    const unwire = wireEventDispatch({ driver, projection });

    driver.trigger(runtimeActivity({
      activity_name: 'happy',
      category: 'emotion',
      intensity: 'moderate',
      source: 'runtime',
      ...runtimeEnvelope(),
    }));

    expect(driver.emitted.map((event) => event.name)).toEqual([
      'avatar.before.activity.start',
    ]);
    pending.settle('applied');
    await pending.result.completion;
    await Promise.resolve();
    expect(driver.emitted.map((event) => event.name)).toEqual([
      'avatar.before.activity.start',
      'avatar.activity.start',
      'avatar.activity.end',
    ]);
    unwire();
  });

  it.each(['unsupported', 'canceled'] as const)(
    'does not report success when a pending backend settles %s',
    async (settlement) => {
      const driver = createDriver();
      const projection = createProjection();
      const pending = pendingActivityProjection();
      vi.mocked(projection.applyActivity).mockReturnValue(pending.result);
      const unwire = wireEventDispatch({ driver, projection });

      driver.trigger(runtimeActivity({
        activity_name: 'happy',
        category: 'emotion',
        intensity: 'moderate',
        source: 'runtime',
        ...runtimeEnvelope(),
      }));
      pending.settle(settlement);
      await pending.result.completion;
      await Promise.resolve();

      expect(driver.emitted.map((event) => event.name)).toEqual([
        'avatar.before.activity.start',
      ]);
      unwire();
    },
  );

  it('drops a late pending success after a newer activity generation', async () => {
    const driver = createDriver();
    const projection = createProjection();
    const pending = pendingActivityProjection();
    vi.mocked(projection.applyActivity)
      .mockReturnValueOnce(pending.result)
      .mockReturnValueOnce('applied');
    const unwire = wireEventDispatch({ driver, projection });

    driver.trigger(runtimeActivity({
      activity_name: 'happy', category: 'emotion', source: 'runtime', ...runtimeEnvelope(),
    }));
    driver.trigger(runtimeActivity({
      activity_name: 'thinking', category: 'state', source: 'runtime', ...runtimeEnvelope(),
    }));
    pending.settle('applied');
    await pending.result.completion;
    await Promise.resolve();

    expect(driver.emitted.filter((event) => event.name === 'avatar.activity.start')).toEqual([{
      name: 'avatar.activity.start',
      detail: {
        activity_name: 'thinking',
        category: 'state',
        intensity: null,
        source: 'runtime',
      },
    }]);
    unwire();
  });

  it('drops a late pending success after the Runtime anchor becomes stale', async () => {
    const driver = createDriver();
    const projection = createProjection();
    const pending = pendingActivityProjection();
    vi.mocked(projection.applyActivity).mockReturnValue(pending.result);
    const unwire = wireEventDispatch({ driver, projection });

    driver.trigger(runtimeActivity({
      activity_name: 'happy', category: 'emotion', source: 'runtime', ...runtimeEnvelope(),
    }));
    driver.getBundle().custom!['conversation_anchor_id'] = 'anchor-replaced';
    pending.settle('applied');
    await pending.result.completion;
    await Promise.resolve();

    expect(driver.emitted.map((event) => event.name)).toEqual([
      'avatar.before.activity.start',
    ]);
    unwire();
  });

  it('projects admitted fixture activity and Runtime expression input', () => {
    const driver = createDriver();
    const projection = createProjection();
    const unwire = wireEventDispatch({ driver, projection });

    driver.trigger({
      event_id: 'fixture-1',
      name: 'avatar.fixture.presentation.activity_requested',
      timestamp: '2026-04-26T00:00:01.000Z',
      detail: {
        activity_name: 'greet',
        category: 'interaction',
        intensity: null,
        source: 'mock',
      },
    });
    driver.trigger({
      event_id: 'expression-1',
      name: 'avatar.presentation.expression_requested',
      timestamp: '2026-04-26T00:00:02.000Z',
      detail: {
        expression_id: 'smile.default',
        source: 'direct_api',
        ...runtimeEnvelope(),
      },
    });

    expect(projection.applyActivity).toHaveBeenCalledWith({ name: 'greet', intensity: null });
    expect(projection.applyExpression).toHaveBeenCalledWith({ name: 'smile.default' });
    expect(driver.emitted).toContainEqual({
      name: 'avatar.expression.change',
      detail: { expression_id: 'smile.default', source: 'direct_api' },
    });
    unwire();
  });

  it('keeps interaction physics local and resets it with projection on Quiet', () => {
    const driver = createDriver();
    const projection = createProjection();
    const interactionPhysics = { handle: vi.fn(), reset: vi.fn() };
    const unwire = wireEventDispatch({ driver, projection, interactionPhysics });
    const event: AgentEvent = {
      event_id: 'click-1',
      name: 'avatar.user.click',
      timestamp: new Date().toISOString(),
      detail: { x: 20, y: 40 },
    };

    driver.trigger(event);
    expect(interactionPhysics.handle).toHaveBeenCalledWith(event, driver.getBundle());

    setAvatarLocalQuiet(true);
    expect(interactionPhysics.reset).toHaveBeenCalledOnce();
    expect(projection.reset).toHaveBeenCalledOnce();
    unwire();
  });
});
