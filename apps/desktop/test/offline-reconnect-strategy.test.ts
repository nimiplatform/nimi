import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  OfflineCoordinator,
  type OfflineCoordinatorTimer,
} from '@nimiplatform/kit/core/offline-coordinator';
import { attachOfflineCoordinatorBindings } from '../src/shell/renderer/infra/bootstrap/runtime-bootstrap-offline.js';

type ScheduledTask = {
  callback: () => void;
  cancelled: boolean;
  delayMs: number;
};

class FakeTimer implements OfflineCoordinatorTimer {
  private readonly tasks: ScheduledTask[] = [];

  setTimeout(callback: () => void, delayMs: number): ScheduledTask {
    const task = {
      callback,
      cancelled: false,
      delayMs,
    };
    this.tasks.push(task);
    return task;
  }

  clearTimeout(handle: unknown): void {
    const task = handle as ScheduledTask | null;
    if (task) {
      task.cancelled = true;
    }
  }

  nextDelay(): number | null {
    return this.tasks.find((task) => !task.cancelled)?.delayMs ?? null;
  }

  pendingCount(): number {
    return this.tasks.filter((task) => !task.cancelled).length;
  }

  async runNext(): Promise<number> {
    const index = this.tasks.findIndex((task) => !task.cancelled);
    assert.notEqual(index, -1, 'expected a scheduled reconnect task');
    const [task] = this.tasks.splice(index, 1);
    assert.ok(task, 'scheduled task should exist');
    task.cancelled = true;
    task.callback();
    await flushAsyncWork();
    return task.delayMs;
  }
}

async function flushAsyncWork(): Promise<void> {
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve();
  }
}

describe('D-OFFLINE-004: bootstrap reconnect bindings', () => {
  test('realm_reconnect revalidates queries and rereads the account profile without replaying work', async () => {
    const timer = new FakeTimer();
    const coordinator = new OfflineCoordinator({ timer });
    const effects: string[] = [];

    attachOfflineCoordinatorBindings({
      coordinator,
      setOfflineTier: (tier) => effects.push(`tier:${tier}`),
      suspendRuntimeCallbacksForL2: () => effects.push('suspendRuntimeCallbacksForL2'),
      probeRealmReachability: async () => true,
      probeRuntimeReachability: async () => true,
      hasPendingRealmRecoveryWork: async () => true,
      invalidateRealmQueries: async () => { effects.push('invalidateQueries'); },
      refreshAccountProfile: async () => { effects.push('readAccountProfile'); },
      rebootstrapRuntime: async () => { effects.push('rebootstrapRuntime'); },
    });

    coordinator.markRealmRestReachability('unreachable');
    await flushAsyncWork();
    assert.equal(timer.nextDelay(), 1000);

    await timer.runNext();
    assert.deepEqual(effects.filter((effect) => !effect.startsWith('tier:')), ['invalidateQueries', 'readAccountProfile']);
  });

  test('runtime_reconnect reboots runtime state', async () => {
    const timer = new FakeTimer();
    const coordinator = new OfflineCoordinator({ timer });
    const effects: string[] = [];

    attachOfflineCoordinatorBindings({
      coordinator,
      setOfflineTier: (tier) => effects.push(`tier:${tier}`),
      suspendRuntimeCallbacksForL2: () => effects.push('suspendRuntimeCallbacksForL2'),
      probeRealmReachability: async () => true,
      probeRuntimeReachability: async () => true,
      hasPendingRealmRecoveryWork: async () => true,
      invalidateRealmQueries: async () => { effects.push('invalidateQueries'); },
      refreshAccountProfile: async () => { effects.push('readAccountProfile'); },
      rebootstrapRuntime: async () => { effects.push('rebootstrapRuntime'); },
    });

    coordinator.markRuntimeReachability('unreachable');
    await flushAsyncWork();
    assert.equal(timer.nextDelay(), 1000);

    await timer.runNext();
    assert.ok(effects.includes('rebootstrapRuntime'));
  });

  test('runtime probe failure does not emit runtime_reconnect bootstrap effects', async () => {
    const timer = new FakeTimer();
    const coordinator = new OfflineCoordinator({ timer });
    const effects: string[] = [];

    attachOfflineCoordinatorBindings({
      coordinator,
      setOfflineTier: (tier) => effects.push(`tier:${tier}`),
      suspendRuntimeCallbacksForL2: () => effects.push('suspendRuntimeCallbacksForL2'),
      probeRealmReachability: async () => true,
      probeRuntimeReachability: async () => false,
      hasPendingRealmRecoveryWork: async () => true,
      invalidateRealmQueries: async () => { effects.push('invalidateQueries'); },
      refreshAccountProfile: async () => { effects.push('readAccountProfile'); },
      rebootstrapRuntime: async () => { effects.push('rebootstrapRuntime'); },
    });

    coordinator.markRuntimeReachability('unreachable');
    await flushAsyncWork();
    assert.equal(timer.nextDelay(), 1000);

    await timer.runNext();
    assert.ok(!effects.includes('rebootstrapRuntime'));
    assert.equal(timer.nextDelay(), 2000);
  });

  test('runtime probe success waits for rebootstrap before projecting reconnect success', async () => {
    const timer = new FakeTimer();
    const coordinator = new OfflineCoordinator({ timer });
    const effects: string[] = [];
    let rebootstrapAttempts = 0;

    coordinator.subscribeRuntimeReconnect(() => {
      effects.push('runtimeReconnectEvent');
    });

    attachOfflineCoordinatorBindings({
      coordinator,
      setOfflineTier: (tier) => effects.push(`tier:${tier}`),
      suspendRuntimeCallbacksForL2: () => effects.push('suspendRuntimeCallbacksForL2'),
      probeRealmReachability: async () => true,
      probeRuntimeReachability: async () => true,
      hasPendingRealmRecoveryWork: async () => true,
      invalidateRealmQueries: async () => { effects.push('invalidateQueries'); },
      refreshAccountProfile: async () => { effects.push('readAccountProfile'); },
      rebootstrapRuntime: async () => {
        rebootstrapAttempts += 1;
        effects.push(`rebootstrapRuntime:${rebootstrapAttempts}`);
        if (rebootstrapAttempts === 1) {
          throw new Error('bootstrap not ready');
        }
      },
    });

    coordinator.markRuntimeReachability('unreachable');
    await flushAsyncWork();
    assert.equal(timer.nextDelay(), 1000);

    assert.equal(await timer.runNext(), 1000);
    assert.equal(coordinator.getTier(), 'L2');
    assert.ok(effects.includes('rebootstrapRuntime:1'));
    assert.ok(!effects.includes('runtimeReconnectEvent'));
    assert.equal(timer.nextDelay(), 2000);

    assert.equal(await timer.runNext(), 2000);
    assert.equal(coordinator.getTier(), 'L0');
    assert.ok(effects.includes('rebootstrapRuntime:2'));
    assert.ok(effects.includes('runtimeReconnectEvent'));
  });

  test('a disposed binding ignores a late successful probe and later reconnect events', async () => {
    const timer = new FakeTimer();
    const coordinator = new OfflineCoordinator({ timer });
    const effects: string[] = [];
    let finish!: (reachable: boolean) => void;
    const probe = new Promise<boolean>(resolve => { finish = resolve; });
    const detach = attachOfflineCoordinatorBindings({
      coordinator,
      setOfflineTier: () => {},
      suspendRuntimeCallbacksForL2: () => {},
      probeRealmReachability: () => probe,
      probeRuntimeReachability: async () => true,
      hasPendingRealmRecoveryWork: async () => true,
      invalidateRealmQueries: async () => { effects.push('invalidateQueries'); },
      refreshAccountProfile: async () => { effects.push('readAccountProfile'); },
      rebootstrapRuntime: async () => { effects.push('rebootstrapRuntime'); },
    });
    coordinator.markRealmRestReachability('unreachable');
    await flushAsyncWork();
    await timer.runNext();
    detach();
    finish(true);
    await flushAsyncWork();
    assert.equal(coordinator.getStatus().realm.rest, 'unreachable');
    coordinator.markRealmRestReachability('reachable');
    await flushAsyncWork();
    assert.deepEqual(effects, []);
  });
});
