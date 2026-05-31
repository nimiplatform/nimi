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

  async runNext(): Promise<void> {
    const task = this.tasks.find((candidate) => !candidate.cancelled);
    expect(task).toBeTruthy();
    if (!task) return;
    task.cancelled = true;
    task.callback();
    await Promise.resolve();
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
});
