import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const TYPES_PATH = resolve(import.meta.dirname, '../src/runtime/offline/types.ts');
const typesSource = readFileSync(TYPES_PATH, 'utf-8');

const MONITOR_PATH = resolve(import.meta.dirname, '../src/runtime/offline/connectivity-monitor.ts');
const monitorSource = readFileSync(MONITOR_PATH, 'utf-8');

const MANAGER_PATH = resolve(import.meta.dirname, '../src/runtime/offline/offline-state-manager.ts');
const managerSource = readFileSync(MANAGER_PATH, 'utf-8');

describe('D-OFFLINE-004: reconnect strategy constants', () => {
  test('D-OFFLINE-004: initial reconnect delay is 1000ms', () => {
    assert.match(
      typesSource,
      /RECONNECT_INITIAL_DELAY_MS\s*=\s*1000/,
      'RECONNECT_INITIAL_DELAY_MS must equal 1000',
    );
  });

  test('D-OFFLINE-004: max reconnect delay is 30000ms', () => {
    assert.match(
      typesSource,
      /RECONNECT_MAX_DELAY_MS\s*=\s*(30[_]?000)/,
      'RECONNECT_MAX_DELAY_MS must equal 30000 or 30_000',
    );
  });

  test('D-OFFLINE-004: ConnectivityMonitor source has setRealmSocketConnected method', () => {
    assert.match(
      monitorSource,
      /setRealmSocketConnected\s*\(/,
      'ConnectivityMonitor must expose setRealmSocketConnected method',
    );
  });

  test('D-OFFLINE-004: ConnectivityMonitor source has setRuntimeReachable method', () => {
    assert.match(
      monitorSource,
      /setRuntimeReachable\s*\(/,
      'ConnectivityMonitor must expose setRuntimeReachable method',
    );
  });

  test('D-OFFLINE-004: OfflineStateManager recalculates tier on connectivity change', () => {
    assert.match(
      managerSource,
      /onChange\s*\(\s*\(\)\s*=>\s*this\.recalculateTier\(\)\s*\)/,
      'OfflineStateManager must call recalculateTier in onChange subscription',
    );
  });

  test('D-OFFLINE-004: failed outbox entries have status field', () => {
    assert.match(
      typesSource,
      /status\s*:\s*'pending'\s*\|\s*'failed'/,
      "PersistentOutboxEntry must have status: 'pending' | 'failed'",
    );
  });

  test('D-OFFLINE-004: failed outbox entries have failReason field', () => {
    assert.match(
      typesSource,
      /failReason\?\s*:\s*string/,
      'PersistentOutboxEntry must have failReason?: string',
    );
  });
});
