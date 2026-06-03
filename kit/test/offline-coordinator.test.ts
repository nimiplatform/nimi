import { beforeEach, describe, expect, it } from 'vitest';

import {
  ConnectivityMonitor,
  OfflineCoordinator,
  OfflineStateManager,
  type OfflineCoordinatorTimer,
  type OfflineTierChange,
} from '../core/src/offline-coordinator.js';

type ScheduledTask = {
  callback: () => void;
  cancelled: boolean;
  delayMs: number;
};

class FakeTimer implements OfflineCoordinatorTimer {
  readonly tasks: ScheduledTask[] = [];

  setTimeout(callback: () => void, delayMs: number): ScheduledTask {
    const task = { callback, cancelled: false, delayMs };
    this.tasks.push(task);
    return task;
  }

  clearTimeout(handle: unknown): void {
    const task = handle as ScheduledTask | null;
    if (task) task.cancelled = true;
  }

  nextDelay(): number | null {
    return this.tasks.find((task) => !task.cancelled)?.delayMs ?? null;
  }

  pendingCount(): number {
    return this.tasks.filter((task) => !task.cancelled).length;
  }

  async runNext(): Promise<number> {
    const task = this.tasks.find((candidate) => !candidate.cancelled);
    expect(task).toBeTruthy();
    if (!task) return 0;
    task.cancelled = true;
    task.callback();
    await flushAsyncWork();
    return task.delayMs;
  }
}

async function flushAsyncWork(): Promise<void> {
  for (let index = 0; index < 4; index += 1) {
    await Promise.resolve();
  }
}

describe('Kit offline coordinator', () => {
  let monitor: ConnectivityMonitor;
  let manager: OfflineStateManager;

  beforeEach(() => {
    monitor = new ConnectivityMonitor();
    manager = new OfflineStateManager(monitor);
  });

  it('projects L0/L1/L2 from Realm and Runtime connectivity', () => {
    manager.start();
    expect(manager.getCurrentTier()).toBe('L0');
    monitor.setRealmRestReachable(false);
    expect(manager.getCurrentTier()).toBe('L1');
    monitor.setRuntimeReachable(false);
    expect(manager.getCurrentTier()).toBe('L2');
    monitor.setRuntimeReachable(true);
    expect(manager.getCurrentTier()).toBe('L1');
    monitor.setRealmRestReachable(true);
    expect(manager.getCurrentTier()).toBe('L0');
  });

  it('emits typed tier-change reasons without owning connectivity truth', () => {
    const changes: OfflineTierChange[] = [];
    manager.onChange((change) => changes.push(change));
    manager.start();
    monitor.setRealmSocketConnected(false);
    monitor.setRuntimeReachable(false);
    monitor.setRuntimeReachable(true);
    monitor.setRealmSocketConnected(true);

    expect(changes.map((change) => change.reason)).toEqual([
      'realm_offline',
      'runtime_offline',
      'runtime_reconnect',
      'realm_reconnect',
    ]);
  });

  it('coordinates injected reconnect probes with exponential retry', async () => {
    const timer = new FakeTimer();
    const coordinator = new OfflineCoordinator({ timer });
    let probes = 0;
    coordinator.configureReconnectHandlers({
      probeRuntimeReachability: async () => {
        probes += 1;
        return probes >= 2;
      },
    });

    coordinator.markRuntimeReachable(false);
    expect(coordinator.getTier()).toBe('L2');
    expect(timer.tasks[0]?.delayMs).toBe(1000);

    await timer.runNext();
    expect(coordinator.getTier()).toBe('L2');
    expect(timer.tasks[1]?.delayMs).toBe(2000);

    await timer.runNext();
    expect(coordinator.getTier()).toBe('L0');
  });

  it('treats socket disconnect as L1 until the socket reconnects', () => {
    manager.start();
    monitor.setRealmSocketConnected(false);
    expect(manager.getCurrentTier()).toBe('L1');

    monitor.setRealmSocketConnected(true);
    expect(manager.getCurrentTier()).toBe('L0');
  });

  it('keeps L2 when runtime is unreachable regardless of Realm state', () => {
    manager.start();
    monitor.setRuntimeReachable(false);

    expect(manager.getCurrentTier()).toBe('L2');

    monitor.setRealmRestReachable(true);
    expect(manager.getCurrentTier()).toBe('L2');
  });

  it('stop prevents further tier recalculation', () => {
    manager.start();
    expect(manager.getCurrentTier()).toBe('L0');

    manager.stop();
    monitor.setRealmRestReachable(false);
    monitor.setRuntimeReachable(false);

    expect(manager.getCurrentTier()).toBe('L0');
  });

  it('realm reconnect backoff doubles on failure and resets after success', async () => {
    const timer = new FakeTimer();
    const coordinator = new OfflineCoordinator({ timer });
    const reconnects: string[] = [];
    let probeCount = 0;
    coordinator.configureReconnectHandlers({
      hasPendingRealmRecoveryWork: async () => true,
      probeRealmReachability: async () => {
        probeCount += 1;
        return probeCount >= 3;
      },
    });
    coordinator.subscribeRealmReconnect(() => {
      reconnects.push('realm');
    });

    coordinator.markRealmRestReachable(false);
    await flushAsyncWork();
    expect(timer.nextDelay()).toBe(1000);

    expect(await timer.runNext()).toBe(1000);
    expect(timer.nextDelay()).toBe(2000);

    expect(await timer.runNext()).toBe(2000);
    expect(timer.nextDelay()).toBe(4000);

    expect(await timer.runNext()).toBe(4000);
    expect(reconnects.length).toBe(1);

    coordinator.markRealmRestReachable(false);
    await flushAsyncWork();
    expect(timer.nextDelay()).toBe(1000);
  });

  it('socket disconnect schedules reconnect without projecting REST-only success', async () => {
    const timer = new FakeTimer();
    const coordinator = new OfflineCoordinator({ timer });
    const reconnects: string[] = [];
    coordinator.configureReconnectHandlers({
      hasPendingRealmRecoveryWork: async () => true,
      probeRealmReachability: async () => true,
    });
    coordinator.subscribeRealmReconnect(() => {
      reconnects.push('realm');
    });

    coordinator.markRealmSocketReachable(false);
    await flushAsyncWork();
    expect(coordinator.getTier()).toBe('L1');
    expect(timer.nextDelay()).toBe(1000);

    expect(await timer.runNext()).toBe(1000);
    expect(reconnects.length).toBe(0);
    expect(coordinator.getTier()).toBe('L1');
    expect(timer.nextDelay()).toBe(2000);

    coordinator.markRealmSocketReachable(true);
    await flushAsyncWork();
    expect(reconnects.length).toBe(1);
    expect(coordinator.getTier()).toBe('L0');
    expect(timer.pendingCount()).toBe(0);
  });

  it('rest outage schedules realm reconnect even without pending recovery work', async () => {
    const timer = new FakeTimer();
    const coordinator = new OfflineCoordinator({ timer });
    coordinator.configureReconnectHandlers({
      hasPendingRealmRecoveryWork: async () => false,
      probeRealmReachability: async () => false,
    });

    coordinator.markRealmRestReachable(false);
    await flushAsyncWork();
    expect(timer.nextDelay()).toBe(1000);
  });

  it('cache fallback forces realm reconnect scheduling when cache needs recovery', async () => {
    const timer = new FakeTimer();
    const coordinator = new OfflineCoordinator({ timer });
    coordinator.configureReconnectHandlers({
      hasPendingRealmRecoveryWork: async () => false,
      probeRealmReachability: async () => false,
    });

    coordinator.markRealmSocketReachable(false);
    await flushAsyncWork();
    expect(timer.nextDelay()).toBe(1000);
    await timer.runNext();
    expect(timer.nextDelay()).toBe(2000);

    coordinator.markCacheFallbackUsed();
    await flushAsyncWork();
    expect(timer.pendingCount()).toBe(1);
  });

  it('runtime reconnect backoff doubles on failure and resets after success', async () => {
    const timer = new FakeTimer();
    const coordinator = new OfflineCoordinator({ timer });
    const reconnects: string[] = [];
    let probeCount = 0;
    coordinator.configureReconnectHandlers({
      probeRuntimeReachability: async () => {
        probeCount += 1;
        return probeCount >= 3;
      },
    });
    coordinator.subscribeRuntimeReconnect(() => {
      reconnects.push('runtime');
    });

    coordinator.markRuntimeReachable(false);
    await flushAsyncWork();
    expect(timer.nextDelay()).toBe(1000);

    expect(await timer.runNext()).toBe(1000);
    expect(timer.nextDelay()).toBe(2000);

    expect(await timer.runNext()).toBe(2000);
    expect(timer.nextDelay()).toBe(4000);

    expect(await timer.runNext()).toBe(4000);
    expect(reconnects.length).toBe(1);

    coordinator.markRuntimeReachable(false);
    await flushAsyncWork();
    expect(timer.nextDelay()).toBe(1000);
  });
});
