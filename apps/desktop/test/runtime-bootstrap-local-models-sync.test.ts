import assert from 'node:assert/strict';
import test from 'node:test';

import { ReasonCode } from '@nimiplatform/sdk/types';
import type { RuntimeBridgeDaemonStatus } from '../src/shell/renderer/bridge/runtime-bridge/types';
import type { DesktopStorageDirs } from '../src/shell/renderer/bridge/runtime-bridge/desktop-storage';
import {
  mergeRuntimeLocalModelsConfig,
  syncRuntimeLocalModelsConfig,
  syncRuntimeStorageConfig,
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

function storageDirs(overrides: Partial<DesktopStorageDirs> = {}): DesktopStorageDirs {
  return {
    nimiDir: '/Users/eric/.nimi',
    nimiDataDir: '/Users/eric/Nimi',
    mediaCacheDir: '/Users/eric/Nimi/cache/media',
    localModelsDir: '/Users/eric/Nimi/models',
    localRuntimeStatePath: '/Users/eric/.nimi/runtime/local-state.json',
    ...overrides,
  };
}

// Regression (Part 1): after the first-run Storage selection records the
// user-selected nimi_data root, syncRuntimeStorageConfig must resolve the
// storage dirs and write dataRootRef + managedRoots.models into the runtime
// config so the runtime resolves `<dataRoot>/models` before materialization.
test('syncRuntimeStorageConfig writes dataRootRef and managedRoots from the selected nimi_data root', async () => {
  let writtenConfig = '';
  let restartCalls = 0;

  const result = await syncRuntimeStorageConfig({
    daemonStatus: createDaemonStatus({ running: true, managed: true, pid: 7001 }),
    bridge: {
      async getRuntimeBridgeStatus() {
        return createDaemonStatus({ running: true, managed: true, pid: 7001 });
      },
      async getDesktopStorageDirs() {
        return storageDirs();
      },
      async getRuntimeBridgeConfig() {
        return { path: '/tmp/config.json', config: { schemaVersion: 1 } };
      },
      async setRuntimeBridgeConfig(configJson: string) {
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
        return createDaemonStatus({ running: true, managed: true, pid: 7002 });
      },
    },
  });

  assert.equal(restartCalls, 1);
  assert.equal(result.pid, 7002);
  const parsed = JSON.parse(writtenConfig) as Record<string, unknown>;
  assert.equal(parsed.dataRootRef, '/Users/eric/Nimi');
  assert.equal((parsed.managedRoots as Record<string, unknown>).models, '/Users/eric/Nimi/models');
  assert.equal(parsed.localStatePath, '/Users/eric/.nimi/runtime/local-state.json');
});

// Regression (Part 1): syncRuntimeStorageConfig fetches the daemon status when
// the caller does not supply one (the first-run path).
test('syncRuntimeStorageConfig fetches daemon status when not supplied', async () => {
  let statusCalls = 0;

  await syncRuntimeStorageConfig({
    bridge: {
      async getRuntimeBridgeStatus() {
        statusCalls += 1;
        return createDaemonStatus({ running: true, managed: true });
      },
      async getDesktopStorageDirs() {
        return storageDirs();
      },
      async getRuntimeBridgeConfig() {
        return { path: '/tmp/config.json', config: { schemaVersion: 1 } };
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
        return createDaemonStatus({ running: true, managed: true });
      },
    },
  });

  assert.equal(statusCalls, 1);
});

// Regression (Part 1): on a fresh install the data root is not yet selected, so
// getDesktopStorageDirs throws; syncRuntimeStorageConfig must propagate that
// failure (fail closed) rather than writing an empty/partial runtime config.
test('syncRuntimeStorageConfig fails closed when no data root is selected yet', async () => {
  let setCalls = 0;

  await assert.rejects(
    async () => syncRuntimeStorageConfig({
      daemonStatus: createDaemonStatus({ running: true, managed: true }),
      bridge: {
        async getRuntimeBridgeStatus() {
          return createDaemonStatus({ running: true, managed: true });
        },
        async getDesktopStorageDirs() {
          throw new Error('~/.nimi/nimi.json is missing');
        },
        async getRuntimeBridgeConfig() {
          return { path: '/tmp/config.json', config: { schemaVersion: 1 } };
        },
        async setRuntimeBridgeConfig(configJson: string) {
          setCalls += 1;
          return {
            path: '/tmp/config.json',
            reasonCode: ReasonCode.CONFIG_APPLIED,
            config: JSON.parse(configJson) as Record<string, unknown>,
          };
        },
        async restartRuntimeBridge() {
          return createDaemonStatus();
        },
      },
    }),
    /nimi\.json is missing/,
  );

  assert.equal(setCalls, 0);
});
