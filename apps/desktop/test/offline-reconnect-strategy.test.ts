import { beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { OfflineCoordinator, type OfflineCoordinatorTimer } from '../src/runtime/offline/coordinator.js';
import { attachOfflineCoordinatorBindings } from '../src/shell/renderer/infra/bootstrap/runtime-bootstrap-offline.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const RUNTIME_BOOTSTRAP_SOURCE = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/infra/bootstrap/runtime-bootstrap.ts'),
  'utf8',
);
const APP_BOOTSTRAP_SOURCE = readFileSync(
  resolve(import.meta.dirname, '../src-tauri/src/main_parts/app_bootstrap.rs'),
  'utf8',
);

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
  for (let index = 0; index < 4; index += 1) {
    await Promise.resolve();
  }
}

describe('D-OFFLINE-004: reconnect backoff behavior', () => {
  let timer: FakeTimer;
  let coordinator: OfflineCoordinator;

  beforeEach(() => {
    timer = new FakeTimer();
    coordinator = new OfflineCoordinator({ timer });
  });

  test('realm reconnect backoff doubles on failure and resets after success', async () => {
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
    assert.equal(timer.nextDelay(), 1000);

    assert.equal(await timer.runNext(), 1000);
    assert.equal(timer.nextDelay(), 2000);

    assert.equal(await timer.runNext(), 2000);
    assert.equal(timer.nextDelay(), 4000);

    assert.equal(await timer.runNext(), 4000);
    assert.equal(reconnects.length, 1);

    coordinator.markRealmRestReachable(false);
    await flushAsyncWork();
    assert.equal(timer.nextDelay(), 1000);
  });

  test('socket disconnect schedules reconnect but does not project realm success from REST alone', async () => {
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
    assert.equal(coordinator.getTier(), 'L1');
    assert.equal(timer.nextDelay(), 1000);

    assert.equal(await timer.runNext(), 1000);
    assert.equal(reconnects.length, 0);
    assert.equal(coordinator.getTier(), 'L1');
    assert.equal(timer.nextDelay(), 2000);

    coordinator.markRealmSocketReachable(true);
    await flushAsyncWork();
    assert.equal(reconnects.length, 1);
    assert.equal(coordinator.getTier(), 'L0');
    assert.equal(timer.pendingCount(), 0);
  });

  test('rest outage schedules realm reconnect even without pending recovery work', async () => {
    coordinator.configureReconnectHandlers({
      hasPendingRealmRecoveryWork: async () => false,
      probeRealmReachability: async () => false,
    });

    coordinator.markRealmRestReachable(false);
    await flushAsyncWork();
    assert.equal(timer.nextDelay(), 1000);
  });

  test('markCacheFallbackUsed forces realm reconnect scheduling when only cache fallback needs recovery', async () => {
    coordinator.configureReconnectHandlers({
      hasPendingRealmRecoveryWork: async () => false,
      probeRealmReachability: async () => false,
    });

    coordinator.markRealmSocketReachable(false);
    await flushAsyncWork();
    assert.equal(timer.nextDelay(), 1000);
    await timer.runNext();
    assert.equal(timer.nextDelay(), 2000);

    coordinator.markCacheFallbackUsed();
    await flushAsyncWork();
    assert.equal(timer.pendingCount(), 1);
  });

  test('runtime reconnect backoff doubles on failure and resets after success', async () => {
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
    assert.equal(timer.nextDelay(), 1000);

    assert.equal(await timer.runNext(), 1000);
    assert.equal(timer.nextDelay(), 2000);

    assert.equal(await timer.runNext(), 2000);
    assert.equal(timer.nextDelay(), 4000);

    assert.equal(await timer.runNext(), 4000);
    assert.equal(reconnects.length, 1);

    coordinator.markRuntimeReachable(false);
    await flushAsyncWork();
    assert.equal(timer.nextDelay(), 1000);
  });
});

describe('D-OFFLINE-004: bootstrap reconnect bindings', () => {
  test('realm_reconnect flushes outboxes and invalidates queries', async () => {
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
      flushChatOutbox: async () => { effects.push('flushChatOutbox'); },
      flushSocialOutbox: async () => { effects.push('flushSocialOutbox'); },
      invalidateRealmQueries: async () => { effects.push('invalidateQueries'); },
      rebootstrapRuntime: async () => { effects.push('rebootstrapRuntime'); },
    });

    coordinator.markRealmRestReachable(false);
    await flushAsyncWork();
    assert.equal(timer.nextDelay(), 1000);

    await timer.runNext();
    assert.ok(effects.includes('flushChatOutbox'));
    assert.ok(effects.includes('flushSocialOutbox'));
    assert.ok(effects.includes('invalidateQueries'));
    assert.ok(!effects.includes('rebootstrapRuntime'));
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
      flushChatOutbox: async () => { effects.push('flushChatOutbox'); },
      flushSocialOutbox: async () => { effects.push('flushSocialOutbox'); },
      invalidateRealmQueries: async () => { effects.push('invalidateQueries'); },
      rebootstrapRuntime: async () => { effects.push('rebootstrapRuntime'); },
    });

    coordinator.markRuntimeReachable(false);
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
      flushChatOutbox: async () => { effects.push('flushChatOutbox'); },
      flushSocialOutbox: async () => { effects.push('flushSocialOutbox'); },
      invalidateRealmQueries: async () => { effects.push('invalidateQueries'); },
      rebootstrapRuntime: async () => { effects.push('rebootstrapRuntime'); },
    });

    coordinator.markRuntimeReachable(false);
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
      flushChatOutbox: async () => { effects.push('flushChatOutbox'); },
      flushSocialOutbox: async () => { effects.push('flushSocialOutbox'); },
      invalidateRealmQueries: async () => { effects.push('invalidateQueries'); },
      rebootstrapRuntime: async () => {
        rebootstrapAttempts += 1;
        effects.push(`rebootstrapRuntime:${rebootstrapAttempts}`);
        if (rebootstrapAttempts === 1) {
          throw new Error('bootstrap not ready');
        }
      },
    });

    coordinator.markRuntimeReachable(false);
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

  test('D-OFFLINE-003: Agent Chat has no separate native offline transcript gate', () => {
    assert.doesNotMatch(RUNTIME_BOOTSTRAP_SOURCE, /chatAgentStoreClient\.setOfflineTier\(tier\)/);
    assert.doesNotMatch(APP_BOOTSTRAP_SOURCE, /chat_agent_store::chat_agent_set_offline_tier/);
    assert.doesNotMatch(APP_BOOTSTRAP_SOURCE, /chat_agent_store/);
  });
});
