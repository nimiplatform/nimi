import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { ReasonCode, type JsonObject } from '@nimiplatform/sdk/types';
import type { RuntimeBridgeDaemonStatus } from '../src/shell/renderer/bridge/runtime-bridge/types';
import {
  syncDeveloperModeRuntimeGate,
  type DeveloperModeRuntimeSyncBridge,
} from '../src/shell/renderer/features/developer/developer-mode-runtime-sync';

function createDaemonStatus(overrides: Partial<RuntimeBridgeDaemonStatus> = {}): RuntimeBridgeDaemonStatus {
  return {
    running: true,
    managed: true,
    launchMode: 'RUNTIME',
    grpcAddr: '127.0.0.1:46371',
    ...overrides,
  };
}

test('syncDeveloperModeRuntimeGate enables runtime developer-registration and restarts managed runtime', async () => {
  let statusReads = 0;
  let setCalls = 0;
  let restartCalls = 0;
  let writtenConfig = '';

  const bridge: DeveloperModeRuntimeSyncBridge = {
    hasTauriInvoke: () => true,
    async getRuntimeBridgeStatus() {
      statusReads += 1;
      return createDaemonStatus({ pid: 101 });
    },
    async getRuntimeBridgeConfig() {
      return { path: '/tmp/runtime-config.json', config: { schemaVersion: 1 } };
    },
    async setRuntimeBridgeConfig(configJson: string) {
      setCalls += 1;
      writtenConfig = configJson;
      return {
        path: '/tmp/runtime-config.json',
        reasonCode: ReasonCode.CONFIG_RESTART_REQUIRED,
        actionHint: 'restart runtime to apply developer-registration',
        config: JSON.parse(configJson) as JsonObject,
      };
    },
    async restartRuntimeBridge() {
      restartCalls += 1;
      return createDaemonStatus({ pid: 202 });
    },
  };

  const status = await syncDeveloperModeRuntimeGate({
    enabled: true,
    flowId: 'test-developer-mode-runtime-sync',
    bridge,
  });

  assert.equal(statusReads, 1);
  assert.equal(setCalls, 1);
  assert.equal(restartCalls, 1);
  assert.equal(status?.pid, 202);
  const parsed = JSON.parse(writtenConfig) as Record<string, unknown>;
  const auth = (parsed.auth ?? {}) as Record<string, unknown>;
  const developerRegistration = (auth.developerRegistration ?? {}) as Record<string, unknown>;
  assert.equal(developerRegistration.enabled, true);
});

test('syncDeveloperModeRuntimeGate skips runtime config writes outside Tauri', async () => {
  let statusReads = 0;
  let setCalls = 0;

  const bridge: DeveloperModeRuntimeSyncBridge = {
    hasTauriInvoke: () => false,
    async getRuntimeBridgeStatus() {
      statusReads += 1;
      return createDaemonStatus();
    },
    async getRuntimeBridgeConfig() {
      return { path: '/tmp/runtime-config.json', config: { schemaVersion: 1 } };
    },
    async setRuntimeBridgeConfig(configJson: string) {
      void configJson;
      setCalls += 1;
      return { path: '/tmp/runtime-config.json', reasonCode: ReasonCode.CONFIG_APPLIED, config: {} };
    },
    async restartRuntimeBridge() {
      return createDaemonStatus();
    },
  };

  const status = await syncDeveloperModeRuntimeGate({
    enabled: true,
    flowId: 'test-developer-mode-runtime-sync-web',
    bridge,
  });

  assert.equal(status, null);
  assert.equal(statusReads, 0);
  assert.equal(setCalls, 0);
});

test('Developer Mode toggle reconciles Runtime gate when already enabled', () => {
  const source = readFileSync(
    new URL('../src/shell/renderer/features/developer/developer-mode-toggle.tsx', import.meta.url),
    'utf8',
  );

  assert.match(source, /developer-mode-reconcile-/);
  assert.match(source, /if \(!enabled\) \{\s*return;\s*\}/s);
  assert.match(source, /syncDeveloperModeRuntimeGate\(\{\s*enabled: true,\s*flowId\s*\}\)/s);
});
