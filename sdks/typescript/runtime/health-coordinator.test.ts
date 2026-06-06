import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  AIProviderHealthEvent,
  AIProviderHealthSnapshot,
  GetRuntimeHealthResponse,
  RuntimeHealthEvent,
} from '../core-generated/runtime-typed-client';
import { RuntimeHealthStatus } from '../core-generated/runtime-typed-client';
import {
  NimiRuntimeHealthCoordinator,
  projectNimiRuntimeHealthStatus,
  projectNimiRuntimeHealthStatusName,
  projectNimiRuntimeHealthSummary,
  type NimiRuntimeHealthCoordinatorDeps,
} from './index';

class PushStream<T> implements AsyncIterable<T> {
  private readonly values: Array<IteratorResult<T>> = [];
  private readonly waiters: Array<{
    readonly resolve: (result: IteratorResult<T>) => void;
    readonly reject: (error: unknown) => void;
  }> = [];
  private failure: unknown;

  push(value: T): void {
    this.deliver({ done: false, value });
  }

  close(): void {
    this.deliver({ done: true, value: undefined });
  }

  fail(error: unknown): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter.reject(error);
      return;
    }
    this.failure = error;
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    while (true) {
      if (this.failure) {
        throw this.failure;
      }
      const queued = this.values.shift() ?? await new Promise<IteratorResult<T>>((resolve, reject) => {
        this.waiters.push({ resolve, reject });
      });
      if (queued.done) {
        return;
      }
      yield queued.value;
    }
  }

  private deliver(result: IteratorResult<T>): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter.resolve(result);
      return;
    }
    this.values.push(result);
  }
}

test('Runtime health projection maps generated statuses to SDK-readable summaries', () => {
  assert.equal(projectNimiRuntimeHealthStatus(RuntimeHealthStatus.READY), 'healthy');
  assert.equal(projectNimiRuntimeHealthStatus(RuntimeHealthStatus.DEGRADED), 'degraded');
  assert.equal(projectNimiRuntimeHealthStatus(RuntimeHealthStatus.STOPPED), 'unreachable');
  assert.equal(projectNimiRuntimeHealthStatus(RuntimeHealthStatus.STOPPING), 'unreachable');
  assert.equal(projectNimiRuntimeHealthStatus(RuntimeHealthStatus.STARTING), 'idle');
  assert.equal(projectNimiRuntimeHealthStatusName(RuntimeHealthStatus.STARTING), 'STARTING');
  assert.equal(projectNimiRuntimeHealthStatusName(999), undefined);

  const summary = projectNimiRuntimeHealthSummary(runtimeHealth({
    status: RuntimeHealthStatus.STARTING,
    reason: '',
    sampledAt: timestamp('2026-06-05T00:00:00.000Z'),
  }));
  assert.equal(summary.normalizedStatus, 'idle');
  assert.equal(summary.health.status, 'healthy');
  assert.equal(summary.health.detail, 'runtime health idle');
  assert.equal(summary.health.checkedAt, '2026-06-05T00:00:00.000Z');
});

test('Runtime health coordinator fetches, merges streams, reconnects, refreshes stale state, and stops by ref count', async () => {
  let now = Date.parse('2026-06-05T00:00:00.000Z');
  let runtimeFetches = 0;
  let providerFetches = 0;
  let runtimeStreamSubscribes = 0;
  let providerStreamSubscribes = 0;
  const intervals: Array<() => void> = [];
  const runtimeConnectedListeners = new Set<() => void>();
  const runtimeDisconnectedListeners = new Set<() => void>();
  const runtimeStreams = [
    new PushStream<RuntimeHealthEvent>(),
    new PushStream<RuntimeHealthEvent>(),
  ];
  const providerStreams = [
    new PushStream<AIProviderHealthEvent>(),
    new PushStream<AIProviderHealthEvent>(),
  ];
  const deps: NimiRuntimeHealthCoordinatorDeps = {
    now: () => now,
    setInterval(callback) {
      intervals.push(callback);
      return callback;
    },
    clearInterval(handle) {
      const index = intervals.indexOf(handle as () => void);
      if (index >= 0) {
        intervals.splice(index, 1);
      }
    },
    async fetchRuntimeHealth() {
      runtimeFetches += 1;
      return runtimeHealth({
        status: RuntimeHealthStatus.READY,
        reason: `fetch-${runtimeFetches}`,
      });
    },
    async fetchProviderHealth() {
      providerFetches += 1;
      return {
        providers: [
          providerSnapshot('openai', 'healthy'),
          providerSnapshot('anthropic', 'degraded'),
        ],
      };
    },
    async subscribeRuntimeHealth() {
      return runtimeStreams[runtimeStreamSubscribes++] ?? new PushStream<RuntimeHealthEvent>();
    },
    async subscribeProviderHealth() {
      return providerStreams[providerStreamSubscribes++] ?? new PushStream<AIProviderHealthEvent>();
    },
    subscribeRuntimeConnected(listener) {
      runtimeConnectedListeners.add(listener);
      return () => runtimeConnectedListeners.delete(listener);
    },
    subscribeRuntimeDisconnected(listener) {
      runtimeDisconnectedListeners.add(listener);
      return () => runtimeDisconnectedListeners.delete(listener);
    },
  };
  const coordinator = new NimiRuntimeHealthCoordinator(deps);
  let notifications = 0;
  const unsubscribe = coordinator.subscribe(() => {
    notifications += 1;
  });

  coordinator.start();
  coordinator.start();
  await coordinator.forceRefresh();
  await flushAsyncWork();

  assert.equal(coordinator.getSnapshot().started, true);
  assert.equal(coordinator.getSnapshot().streamConnected, true);
  assert.equal(coordinator.getSnapshot().stale, false);
  assert.deepEqual(coordinator.getSnapshot().providerHealth.map((item) => item.providerName), ['anthropic', 'openai']);
  assert.equal(runtimeFetches, 1);
  assert.equal(providerFetches, 1);
  assert.equal(intervals.length, 1);

  runtimeStreams[0]?.push(runtimeHealthEvent({
    status: RuntimeHealthStatus.DEGRADED,
    reason: 'queue pressure',
  }));
  providerStreams[0]?.push(providerEvent('openai', 'unreachable'));
  await flushAsyncWork();

  assert.equal(coordinator.getSnapshot().runtimeHealth?.status, RuntimeHealthStatus.DEGRADED);
  assert.equal(coordinator.getSnapshot().runtimeHealth?.reason, 'queue pressure');
  assert.equal(coordinator.getSnapshot().providerHealth.find((item) => item.providerName === 'openai')?.state, 'unreachable');
  assert.equal(coordinator.getSnapshot().lastStreamAt, '2026-06-05T00:00:00.000Z');

  now = Date.parse('2026-06-05T00:01:01.000Z');
  intervals[0]?.();
  await flushAsyncWork();

  assert.equal(runtimeFetches, 2);
  assert.equal(providerFetches, 2);
  assert.equal(coordinator.getSnapshot().lastFetchedAt, '2026-06-05T00:01:01.000Z');
  assert.equal(coordinator.getSnapshot().stale, false);

  for (const listener of runtimeDisconnectedListeners) {
    listener();
  }
  await flushAsyncWork();
  assert.equal(coordinator.getSnapshot().streamConnected, false);
  intervals[0]?.();
  await flushAsyncWork();
  assert.equal(runtimeStreamSubscribes, 1);

  for (const listener of runtimeConnectedListeners) {
    listener();
  }
  await flushAsyncWork();
  assert.equal(runtimeStreamSubscribes, 2);
  assert.equal(providerStreamSubscribes, 2);
  assert.equal(runtimeFetches, 3);

  coordinator.stop();
  assert.equal(coordinator.getSnapshot().started, true);
  coordinator.stop();
  assert.equal(coordinator.getSnapshot().started, false);
  assert.equal(coordinator.getSnapshot().streamConnected, false);
  assert.equal(intervals.length, 0);
  unsubscribe();
  assert.ok(notifications > 0);
});

test('Runtime health coordinator fails closed on fetch and stream errors', async () => {
  const runtimeStream = new PushStream<RuntimeHealthEvent>();
  const coordinator = new NimiRuntimeHealthCoordinator({
    now: () => Date.parse('2026-06-05T00:00:00.000Z'),
    setInterval: () => undefined,
    clearInterval: () => undefined,
    async fetchRuntimeHealth() {
      throw new Error('runtime unavailable');
    },
    async fetchProviderHealth() {
      return { providers: [] };
    },
    async subscribeRuntimeHealth() {
      return runtimeStream;
    },
    async subscribeProviderHealth() {
      throw new Error('provider stream unavailable');
    },
    subscribeRuntimeConnected() {
      return () => undefined;
    },
    subscribeRuntimeDisconnected() {
      return () => undefined;
    },
  });

  await assert.rejects(
    () => coordinator.forceRefresh(),
    /runtime unavailable/,
  );
  await flushAsyncWork();

  assert.equal(coordinator.getSnapshot().error, 'runtime unavailable');
  assert.equal(coordinator.getSnapshot().streamError, 'provider stream unavailable');
  assert.equal(coordinator.getSnapshot().providerStreamConnected, false);
});

async function flushAsyncWork(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  await Promise.resolve();
}

function timestamp(iso: string): { readonly seconds: string; readonly nanos: number } {
  const millis = Date.parse(iso);
  return {
    seconds: String(Math.floor(millis / 1000)),
    nanos: (millis % 1000) * 1_000_000,
  };
}

function runtimeHealth(overrides: Partial<GetRuntimeHealthResponse> = {}): GetRuntimeHealthResponse {
  return {
    status: RuntimeHealthStatus.READY,
    reason: 'ok',
    queueDepth: 0,
    activeWorkflows: 0,
    activeInferenceJobs: 0,
    cpuMilli: '100',
    memoryBytes: '1024',
    vramBytes: '2048',
    sampledAt: timestamp('2026-06-05T00:00:00.000Z'),
    ...overrides,
  };
}

function runtimeHealthEvent(overrides: Partial<RuntimeHealthEvent> = {}): RuntimeHealthEvent {
  return {
    sequence: '1',
    status: RuntimeHealthStatus.READY,
    reason: 'ok',
    queueDepth: 0,
    activeWorkflows: 0,
    activeInferenceJobs: 0,
    cpuMilli: '100',
    memoryBytes: '1024',
    vramBytes: '2048',
    sampledAt: timestamp('2026-06-05T00:00:00.000Z'),
    ...overrides,
  };
}

function providerSnapshot(providerName: string, state: string): AIProviderHealthSnapshot {
  return {
    providerName,
    state,
    reason: state,
    consecutiveFailures: state === 'healthy' ? 0 : 1,
    lastChangedAt: timestamp('2026-06-05T00:00:00.000Z'),
    lastCheckedAt: timestamp('2026-06-05T00:00:00.000Z'),
    subHealth: [],
  };
}

function providerEvent(providerName: string, state: string): AIProviderHealthEvent {
  return {
    sequence: '1',
    ...providerSnapshot(providerName, state),
  };
}
