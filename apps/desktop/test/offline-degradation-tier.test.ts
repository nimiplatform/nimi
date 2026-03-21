import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ConnectivityMonitor } from '../src/runtime/offline/connectivity-monitor.js';
import { OfflineStateManager } from '../src/runtime/offline/offline-state-manager.js';
import type { OfflineTierChange } from '../src/runtime/offline/types.js';

describe('D-OFFLINE-001: offline degradation tier system', () => {
  let monitor: ConnectivityMonitor;
  let manager: OfflineStateManager;

  beforeEach(() => {
    monitor = new ConnectivityMonitor();
    manager = new OfflineStateManager(monitor);
  });

  test('D-OFFLINE-001: L0 when both realm and runtime reachable', () => {
    manager.start();
    assert.equal(manager.getCurrentTier(), 'L0');
  });

  test('D-OFFLINE-001: L1 when runtime reachable but realm unreachable', () => {
    manager.start();
    monitor.setRealmSocketConnected(false);
    assert.equal(manager.getCurrentTier(), 'L1');
  });

  test('D-OFFLINE-001: L2 when runtime unreachable', () => {
    manager.start();
    monitor.setRuntimeReachable(false);
    assert.equal(manager.getCurrentTier(), 'L2');
  });

  test('D-OFFLINE-001: transition L0→L1 emits correct change event', () => {
    manager.start();
    const changes: OfflineTierChange[] = [];
    manager.onChange((change) => changes.push(change));

    monitor.setRealmSocketConnected(false);

    assert.equal(changes.length, 1);
    assert.equal(changes[0]!.from, 'L0');
    assert.equal(changes[0]!.to, 'L1');
    assert.equal(changes[0]!.reason, 'realm_offline');
  });

  test('D-OFFLINE-001: transition L0→L2 emits correct change event', () => {
    manager.start();
    const changes: OfflineTierChange[] = [];
    manager.onChange((change) => changes.push(change));

    monitor.setRuntimeReachable(false);

    assert.equal(changes.length, 1);
    assert.equal(changes[0]!.from, 'L0');
    assert.equal(changes[0]!.to, 'L2');
    assert.equal(changes[0]!.reason, 'runtime_offline');
  });

  test('D-OFFLINE-001: transition L1→L0 on realm reconnect', () => {
    manager.start();
    monitor.setRealmSocketConnected(false);
    assert.equal(manager.getCurrentTier(), 'L1');

    const changes: OfflineTierChange[] = [];
    manager.onChange((change) => changes.push(change));

    monitor.setRealmSocketConnected(true);

    assert.equal(manager.getCurrentTier(), 'L0');
    assert.equal(changes.length, 1);
    assert.equal(changes[0]!.from, 'L1');
    assert.equal(changes[0]!.to, 'L0');
    assert.equal(changes[0]!.reason, 'realm_reconnect');
  });

  test('D-OFFLINE-001: transition L2→L0 on runtime reconnect', () => {
    manager.start();
    monitor.setRuntimeReachable(false);
    monitor.setRealmSocketConnected(false);
    assert.equal(manager.getCurrentTier(), 'L2');

    const changes: OfflineTierChange[] = [];
    manager.onChange((change) => changes.push(change));

    monitor.setRealmSocketConnected(true);
    monitor.setRuntimeReachable(true);

    assert.equal(manager.getCurrentTier(), 'L0');
    // First change: L2→L2 would be suppressed (realm reconnect while runtime still down stays L2).
    // Second change: L2→L0 when runtime reconnects.
    const l0Change = changes.find((c) => c.to === 'L0');
    assert.ok(l0Change, 'expected a change to L0');
    assert.equal(l0Change.from, 'L2');
    assert.equal(l0Change.reason, 'runtime_reconnect');
  });

  test('D-OFFLINE-001: stop() prevents further tier recalculation', () => {
    manager.start();
    assert.equal(manager.getCurrentTier(), 'L0');

    manager.stop();

    monitor.setRealmSocketConnected(false);
    monitor.setRuntimeReachable(false);

    assert.equal(manager.getCurrentTier(), 'L0');
  });

  test('D-OFFLINE-001: L2 when runtime unreachable regardless of realm state', () => {
    manager.start();

    // Realm is reachable (default), but runtime is unreachable
    monitor.setRuntimeReachable(false);

    assert.equal(manager.getCurrentTier(), 'L2');

    // Even explicitly setting realm reachable doesn't change L2
    monitor.setRealmRestReachable(true);
    assert.equal(manager.getCurrentTier(), 'L2');
  });
});
