import assert from 'node:assert/strict';
import test from 'node:test';

import { ReasonCode } from '@nimiplatform/sdk/types';
import type { RuntimeBridgeDaemonStatus } from '../src/shell/renderer/bridge/runtime-bridge/types';
import {
  mergeRuntimeLocalModelsConfig,
  syncRuntimeLocalModelsConfig,
} from '../src/shell/renderer/infra/bootstrap/runtime-bootstrap-local-models-sync';

function createDaemonStatus(overrides: Partial<RuntimeBridgeDaemonStatus> = {}): RuntimeBridgeDaemonStatus {
  return {
    running: true,
    managed: true,
    launchMode: 'RUNTIME',
    grpcAddr: '127.0.0.1:46371',
    ...overrides,
  };
}

test('mergeRuntimeLocalModelsConfig writes dataRootRef, managedRoots, and localStatePath when they differ', () => {
  const { nextConfig, changed } = mergeRuntimeLocalModelsConfig(
    {
      schemaVersion: 1,
      localModelsPath: 'C:\\Users\\Eric\\.nimi\\data\\models',
      localStatePath: 'C:\\Users\\Eric\\.nimi\\runtime\\local-state.json',
    },
    'D:\\nimi_data',
    'D:\\nimi_data\\models',
    'D:\\nimi_data\\state.json',
  );

  assert.equal(changed, true);
  assert.equal(nextConfig.localModelsPath, undefined);
  assert.equal(nextConfig.dataRootRef, 'D:\\nimi_data');
  assert.deepEqual(nextConfig.managedRoots, {
    models: 'D:\\nimi_data\\models',
    dependencies: 'D:\\nimi_data/dependencies',
    environments: 'D:\\nimi_data/environments',
    logs: 'D:\\nimi_data/logs',
    audit: 'D:\\nimi_data/audit',
  });
  assert.equal(nextConfig.localStatePath, 'D:\\nimi_data\\state.json');
});

test('syncRuntimeLocalModelsConfig restarts managed running daemon on CONFIG_RESTART_REQUIRED', async () => {
  let setCalls = 0;
  let restartCalls = 0;
  let writtenConfig = '';

  const result = await syncRuntimeLocalModelsConfig({
    daemonStatus: createDaemonStatus({ running: true, managed: true, pid: 1001 }),
    dataRootPath: 'D:\\nimi_data',
    localModelsPath: 'D:\\nimi_data\\models',
    localStatePath: 'D:\\nimi_data\\state.json',
    bridge: {
      async getRuntimeBridgeConfig() {
        return {
          path: '/tmp/config.json',
          config: {
            schemaVersion: 1,
            localModelsPath: 'C:\\Users\\Eric\\.nimi\\data\\models',
            localStatePath: 'C:\\Users\\Eric\\.nimi\\runtime\\local-state.json',
          },
        };
      },
      async setRuntimeBridgeConfig(configJson: string) {
        setCalls += 1;
        writtenConfig = configJson;
        return {
          path: '/tmp/config.json',
          reasonCode: ReasonCode.CONFIG_RESTART_REQUIRED,
          actionHint: 'restart runtime to apply config changes',
          config: JSON.parse(configJson) as Record<string, unknown>,
        };
      },
      async restartRuntimeBridge() {
        restartCalls += 1;
        return createDaemonStatus({ running: true, managed: true, pid: 2002 });
      },
    },
  });

  assert.equal(setCalls, 1);
  assert.equal(restartCalls, 1);
  assert.equal(result.pid, 2002);

  const parsed = JSON.parse(writtenConfig) as Record<string, unknown>;
  assert.equal(parsed.localModelsPath, undefined);
  assert.equal(parsed.dataRootRef, 'D:\\nimi_data');
  assert.equal((parsed.managedRoots as Record<string, unknown>).models, 'D:\\nimi_data\\models');
  assert.equal(parsed.localStatePath, 'D:\\nimi_data\\state.json');
});

test('syncRuntimeLocalModelsConfig does not restart when daemon is stopped', async () => {
  let restartCalls = 0;

  const result = await syncRuntimeLocalModelsConfig({
    daemonStatus: createDaemonStatus({ running: false, managed: true }),
    dataRootPath: 'D:\\nimi_data',
    localModelsPath: 'D:\\nimi_data\\models',
    bridge: {
      async getRuntimeBridgeConfig() {
        return {
          path: '/tmp/config.json',
          config: { schemaVersion: 1, localModelsPath: 'C:\\Users\\Eric\\.nimi\\data\\models' },
        };
      },
      async setRuntimeBridgeConfig(configJson: string) {
        return {
          path: '/tmp/config.json',
          reasonCode: ReasonCode.CONFIG_RESTART_REQUIRED,
          actionHint: 'restart runtime to apply config changes',
          config: JSON.parse(configJson) as Record<string, unknown>,
        };
      },
      async restartRuntimeBridge() {
        restartCalls += 1;
        return createDaemonStatus();
      },
    },
  });

  assert.equal(restartCalls, 0);
  assert.equal(result.running, false);
});

test('syncRuntimeLocalModelsConfig throws for unmanaged running daemon when restart required', async () => {
  let restartCalls = 0;

  await assert.rejects(
    async () => syncRuntimeLocalModelsConfig({
      daemonStatus: createDaemonStatus({ running: true, managed: false }),
      dataRootPath: 'D:\\nimi_data',
      localModelsPath: 'D:\\nimi_data\\models',
      bridge: {
        async getRuntimeBridgeConfig() {
          return {
            path: '/tmp/config.json',
            config: { schemaVersion: 1, localModelsPath: 'C:\\Users\\Eric\\.nimi\\data\\models' },
          };
        },
        async setRuntimeBridgeConfig(configJson: string) {
          return {
            path: '/tmp/config.json',
            reasonCode: ReasonCode.CONFIG_RESTART_REQUIRED,
            actionHint: 'please restart external runtime manually',
            config: JSON.parse(configJson) as Record<string, unknown>,
          };
        },
        async restartRuntimeBridge() {
          restartCalls += 1;
          return createDaemonStatus();
        },
      },
    }),
    {
      name: 'RuntimeConfigManualRestartRequiredError',
      code: 'RUNTIME_CONFIG_MANUAL_RESTART_REQUIRED',
      message: /restart external runtime manually/i,
    },
  );

  assert.equal(restartCalls, 0);
});

test('syncRuntimeLocalModelsConfig skips write when product data root and managed roots already match', async () => {
  let setCalls = 0;

  const result = await syncRuntimeLocalModelsConfig({
    daemonStatus: createDaemonStatus({ running: true, managed: true, pid: 3003 }),
    dataRootPath: 'D:\\nimi_data',
    localModelsPath: 'D:\\nimi_data\\models',
    localStatePath: 'D:\\nimi_data\\state.json',
    bridge: {
      async getRuntimeBridgeConfig() {
        return {
          path: '/tmp/config.json',
          config: {
            schemaVersion: 1,
            dataRootRef: 'D:\\nimi_data',
            managedRoots: {
              models: 'D:\\nimi_data\\models',
              dependencies: 'D:\\nimi_data/dependencies',
              environments: 'D:\\nimi_data/environments',
              logs: 'D:\\nimi_data/logs',
              audit: 'D:\\nimi_data/audit',
            },
            localStatePath: 'D:\\nimi_data\\state.json',
          },
        };
      },
      async setRuntimeBridgeConfig(configJson: string) {
        void configJson;
        setCalls += 1;
        return {
          path: '/tmp/config.json',
          reasonCode: ReasonCode.CONFIG_APPLIED,
          config: {},
        };
      },
      async restartRuntimeBridge() {
        return createDaemonStatus();
      },
    },
  });

  assert.equal(setCalls, 0);
  assert.equal(result.pid, 3003);
});
