import { describe, expect, it, vi } from 'vitest';
import type { AgentDataBundle } from '../driver/types.js';
import type { BackendProjection } from '../carrier/backend-branch.js';
import { HandlerExecutor } from './handler-executor.js';
import type { ActivityOrEventHandler } from './handler-types.js';

const bundle = {} as AgentDataBundle;
const projection = {} as BackendProjection;

describe('NAS handler executor results', () => {
  it('reports success and handler errors without placeholder success', async () => {
    const executor = new HandlerExecutor();
    const success: ActivityOrEventHandler = {
      execute: vi.fn(async () => undefined),
    };
    const failure: ActivityOrEventHandler = {
      execute: vi.fn(async () => {
        throw new Error('motion failed');
      }),
    };

    await expect(executor.run('activity:happy', success, bundle, projection)).resolves.toEqual({
      key: 'activity:happy',
      status: 'success',
      error: null,
    });
    await expect(executor.run('activity:sad', failure, bundle, projection)).resolves.toEqual({
      key: 'activity:sad',
      status: 'error',
      error: 'motion failed',
    });
  });

  it('classifies sandbox timeout failures', async () => {
    const executor = new HandlerExecutor();
    const timeout: ActivityOrEventHandler = {
      execute: vi.fn(async () => {
        throw new Error('NAS sandbox request timed out for /model/runtime/nimi/activity/happy.js');
      }),
    };

    await expect(executor.run('activity:happy', timeout, bundle, projection)).resolves.toEqual({
      key: 'activity:happy',
      status: 'timeout',
      error: 'NAS sandbox request timed out for /model/runtime/nimi/activity/happy.js',
    });
  });

  it('passes Live2D extension only to handlers that declared the capability', async () => {
    const executor = new HandlerExecutor();
    const setParameter = vi.fn();
    const handler: ActivityOrEventHandler = {
      execute: vi.fn(async (_ctx, _projection, options) => {
        options.extension?.live2d?.setParameter('ParamMouthOpenY', 0.4);
      }),
    };

    await executor.run('activity:neutral', handler, bundle, projection, {
      extension: { live2d: { setParameter } },
    });
    await executor.run('activity:mouth', handler, bundle, projection, {
      requiresLive2DExtension: true,
      extension: { live2d: { setParameter } },
    });

    expect(setParameter).toHaveBeenCalledOnce();
    expect(setParameter).toHaveBeenCalledWith('ParamMouthOpenY', 0.4);
  });

  it('does not fake a Live2D extension success when capability materialization is missing', async () => {
    const executor = new HandlerExecutor();
    const handler: ActivityOrEventHandler = {
      execute: vi.fn(async (_ctx, _projection, options) => {
        if (!options.extension?.live2d) {
          throw new Error('live2d extension missing');
        }
      }),
    };

    await expect(executor.run('activity:mouth', handler, bundle, projection, {
      requiresLive2DExtension: true,
    })).resolves.toEqual({
      key: 'activity:mouth',
      status: 'error',
      error: 'live2d extension missing',
    });
  });

  it('cancels the previous same-key invocation deterministically', async () => {
    const executor = new HandlerExecutor();
    const observedSignal: { current: AbortSignal | null } = { current: null };
    const releaseFirst: { current: (() => void) | null } = { current: null };
    const first: ActivityOrEventHandler = {
      execute: vi.fn((_ctx, _projection, options) => {
        observedSignal.current = options.signal;
        return new Promise<void>((resolve) => {
          releaseFirst.current = resolve;
        });
      }),
    };
    const second: ActivityOrEventHandler = {
      execute: vi.fn(async () => undefined),
    };

    const firstRun = executor.run('activity:happy', first, bundle, projection);
    await Promise.resolve();
    const secondRun = executor.run('activity:happy', second, bundle, projection);
    expect(observedSignal.current?.aborted).toBe(true);
    releaseFirst.current?.();

    await expect(firstRun).resolves.toEqual({
      key: 'activity:happy',
      status: 'cancelled',
      error: null,
    });
    await expect(secondRun).resolves.toEqual({
      key: 'activity:happy',
      status: 'success',
      error: null,
    });
  });

  it('reports shutdown cancellation from cancelAll', async () => {
    const executor = new HandlerExecutor();
    const observedSignal: { current: AbortSignal | null } = { current: null };
    const release: { current: (() => void) | null } = { current: null };
    const handler: ActivityOrEventHandler = {
      execute: vi.fn((_ctx, _projection, options) => {
        observedSignal.current = options.signal;
        return new Promise<void>((resolve) => {
          release.current = resolve;
        });
      }),
    };

    const run = executor.run('event:runtime.agent.hook.running', handler, bundle, projection);
    await Promise.resolve();
    executor.cancelAll();
    expect(observedSignal.current?.aborted).toBe(true);
    release.current?.();

    await expect(run).resolves.toEqual({
      key: 'event:runtime.agent.hook.running',
      status: 'shutdown',
      error: null,
    });
  });
});
