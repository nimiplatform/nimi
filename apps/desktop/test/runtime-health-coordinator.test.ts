import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import type {
  AIProviderHealthEvent,
  AIProviderHealthSnapshot,
  GetRuntimeHealthResponse,
  RuntimeHealthEvent,
} from '@nimiplatform/sdk/runtime';
import { RuntimeHealthCoordinator } from '../src/shell/renderer/features/runtime-config/runtime-health-coordinator';

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(() => resolve());
  });
}

function createAsyncStream<T>() {
  const queue: Array<IteratorResult<T>> = [];
  const waiters: Array<(value: IteratorResult<T>) => void> = [];

  const iterator: AsyncIterator<T> & AsyncIterable<T> = {
    [Symbol.asyncIterator]() {
      return this;
    },
    next() {
      if (queue.length > 0) {
        return Promise.resolve(queue.shift() as IteratorResult<T>);
      }
      return new Promise<IteratorResult<T>>((resolve) => {
        waiters.push(resolve);
      });
    },
  };

  return {
    stream: iterator,
    push(value: T) {
      const item: IteratorResult<T> = { value, done: false };
      if (waiters.length > 0) {
        const resolve = waiters.shift() as (value: IteratorResult<T>) => void;
        resolve(item);
        return;
      }
      queue.push(item);
    },
    close() {
      const item: IteratorResult<T> = { value: undefined, done: true };
      if (waiters.length > 0) {
        const resolve = waiters.shift() as (value: IteratorResult<T>) => void;
        resolve(item);
        return;
      }
      queue.push(item);
    },
  };
}

function makeRuntimeHealth(status: number, reason = ''): GetRuntimeHealthResponse {
  return {
    status,
    reason,
    queueDepth: 1,
    activeWorkflows: 2,
    activeInferenceJobs: 3,
    cpuMilli: '1000',
    memoryBytes: '2048',
    vramBytes: '4096',
    sampledAt: {
      seconds: '1710000000',
      nanos: 0,
    },
  };
}

function makeProvider(providerName: string, state = 'healthy'): AIProviderHealthSnapshot {
  return {
    providerName,
    state,
    reason: '',
    consecutiveFailures: 0,
    lastChangedAt: {
      seconds: '1710000000',
      nanos: 0,
    },
    lastCheckedAt: {
      seconds: '1710000000',
      nanos: 0,
    },
    subHealth: [],
  };
}

describe('RuntimeHealthCoordinator', () => {
  test('hydrates shared state once on startup', async () => {
    const healthStream = createAsyncStream<RuntimeHealthEvent>();
    const providerStream = createAsyncStream<AIProviderHealthEvent>();
    const now = 1710000000000;
    let healthCalls = 0;
    let providerCalls = 0;

    const coordinator = new RuntimeHealthCoordinator({
      fetchRuntimeHealth: async () => {
        healthCalls += 1;
        return makeRuntimeHealth(3, 'ready');
      },
      fetchProviderHealth: async () => {
        providerCalls += 1;
        return { providers: [makeProvider('openai')] };
      },
      subscribeRuntimeHealth: async () => healthStream.stream,
      subscribeProviderHealth: async () => providerStream.stream,
      now: () => now,
      setInterval: () => 1,
      clearInterval: () => undefined,
    });

    coordinator.start();
    await flushMicrotasks();

    const snapshot = coordinator.getSnapshot();
    assert.equal(healthCalls, 1);
    assert.equal(providerCalls, 1);
    assert.equal(snapshot.runtimeHealth?.reason, 'ready');
    assert.equal(snapshot.providerHealth.length, 1);
    assert.equal(snapshot.streamConnected, true);
    assert.equal(snapshot.stale, false);

    coordinator.stop();
    healthStream.close();
    providerStream.close();
  });

  test('deduplicates concurrent forceRefresh calls', async () => {
    const healthStream = createAsyncStream<RuntimeHealthEvent>();
    const providerStream = createAsyncStream<AIProviderHealthEvent>();
    let healthCalls = 0;
    let providerCalls = 0;

    const coordinator = new RuntimeHealthCoordinator({
      fetchRuntimeHealth: async () => {
        healthCalls += 1;
        await flushMicrotasks();
        return makeRuntimeHealth(3, 'ready');
      },
      fetchProviderHealth: async () => {
        providerCalls += 1;
        await flushMicrotasks();
        return { providers: [makeProvider('openai')] };
      },
      subscribeRuntimeHealth: async () => healthStream.stream,
      subscribeProviderHealth: async () => providerStream.stream,
      now: () => 1710000000000,
      setInterval: () => 1,
      clearInterval: () => undefined,
    });

    await Promise.all([
      coordinator.forceRefresh('manual-a'),
      coordinator.forceRefresh('manual-b'),
    ]);

    assert.equal(healthCalls, 1);
    assert.equal(providerCalls, 1);

    coordinator.stop();
    healthStream.close();
    providerStream.close();
  });

  test('applies stream updates without extra unary refresh', async () => {
    const healthStream = createAsyncStream<RuntimeHealthEvent>();
    const providerStream = createAsyncStream<AIProviderHealthEvent>();
    let healthCalls = 0;
    let providerCalls = 0;
    let now = 1710000000000;

    const coordinator = new RuntimeHealthCoordinator({
      fetchRuntimeHealth: async () => {
        healthCalls += 1;
        return makeRuntimeHealth(3, 'ready');
      },
      fetchProviderHealth: async () => {
        providerCalls += 1;
        return { providers: [makeProvider('openai')] };
      },
      subscribeRuntimeHealth: async () => healthStream.stream,
      subscribeProviderHealth: async () => providerStream.stream,
      now: () => now,
      setInterval: () => 1,
      clearInterval: () => undefined,
    });

    coordinator.start();
    await flushMicrotasks();

    now += 1000;
    healthStream.push({
      sequence: '2',
      status: 4,
      reason: 'degraded',
      queueDepth: 5,
      activeWorkflows: 6,
      activeInferenceJobs: 7,
      cpuMilli: '2000',
      memoryBytes: '4096',
      vramBytes: '8192',
      sampledAt: { seconds: '1710000001', nanos: 0 },
    });
    providerStream.push({
      sequence: '2',
      providerName: 'openai',
      state: 'unhealthy',
      reason: 'bad key',
      consecutiveFailures: 2,
      lastChangedAt: { seconds: '1710000001', nanos: 0 },
      lastCheckedAt: { seconds: '1710000001', nanos: 0 },
      subHealth: [],
    });

    await flushMicrotasks();

    const snapshot = coordinator.getSnapshot();
    assert.equal(snapshot.runtimeHealth?.status, 4);
    assert.equal(snapshot.providerHealth[0]?.state, 'unhealthy');
    assert.equal(healthCalls, 1);
    assert.equal(providerCalls, 1);

    coordinator.stop();
    healthStream.close();
    providerStream.close();
  });

  test('watchdog refreshes stale disconnected state', async () => {
    let watchdog: (() => void) | null = null;
    let now = 1710000000000;
    let healthCalls = 0;
    let providerCalls = 0;
    let runtimeSubscriptions = 0;
    let providerSubscriptions = 0;

    const coordinator = new RuntimeHealthCoordinator({
      fetchRuntimeHealth: async () => {
        healthCalls += 1;
        return makeRuntimeHealth(3, 'ready');
      },
      fetchProviderHealth: async () => {
        providerCalls += 1;
        return { providers: [makeProvider('openai')] };
      },
      subscribeRuntimeHealth: async () => {
        runtimeSubscriptions += 1;
        throw new Error('runtime stream down');
      },
      subscribeProviderHealth: async () => {
        providerSubscriptions += 1;
        throw new Error('provider stream down');
      },
      now: () => now,
      setInterval: (callback) => {
        watchdog = callback;
        return 1;
      },
      clearInterval: () => {
        watchdog = null;
      },
    });

    coordinator.start();
    await flushMicrotasks();

    assert.equal(healthCalls, 1);
    assert.equal(providerCalls, 1);
    assert.equal(coordinator.getSnapshot().streamConnected, false);

    now += 61_000;
    watchdog?.();
    await flushMicrotasks();

    assert.equal(healthCalls, 2);
    assert.equal(providerCalls, 2);
    assert.equal(runtimeSubscriptions, 2);
    assert.equal(providerSubscriptions, 2);

    coordinator.stop();
  });
});
