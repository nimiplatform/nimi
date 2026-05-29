import assert from 'node:assert/strict';
import test from 'node:test';

import { RUNTIME_BRIDGE_CONFIG_DEFAULTS } from '@nimiplatform/sdk/runtime';
import { ReasonCode } from '@nimiplatform/sdk/types';
import type { RuntimeBridgeDaemonStatus } from '../src/shell/renderer/bridge/runtime-bridge/types';
import {
  mergeRuntimeDeveloperRegistrationConfig,
  syncRuntimeDeveloperRegistrationConfig,
} from '../src/shell/renderer/infra/bootstrap/runtime-bootstrap-developer-registration-sync';

function createDaemonStatus(overrides: Partial<RuntimeBridgeDaemonStatus> = {}): RuntimeBridgeDaemonStatus {
  return {
    running: true,
    managed: true,
    launchMode: 'RUNTIME',
    grpcAddr: RUNTIME_BRIDGE_CONFIG_DEFAULTS.grpcAddr,
    ...overrides,
  };
}

test('mergeRuntimeDeveloperRegistrationConfig enables the gate when off', () => {
  const { nextConfig, changed } = mergeRuntimeDeveloperRegistrationConfig({ schemaVersion: 1 }, true);
  assert.equal(changed, true);
  const auth = (nextConfig.auth ?? {}) as Record<string, unknown>;
  const developerRegistration = (auth.developerRegistration ?? {}) as Record<string, unknown>;
  assert.equal(developerRegistration.enabled, true);
});

test('mergeRuntimeDeveloperRegistrationConfig disables the gate when previously on', () => {
  const { nextConfig, changed } = mergeRuntimeDeveloperRegistrationConfig(
    { schemaVersion: 1, auth: { developerRegistration: { enabled: true } } },
    false,
  );
  assert.equal(changed, true);
  const auth = (nextConfig.auth ?? {}) as Record<string, unknown>;
  const developerRegistration = (auth.developerRegistration ?? {}) as Record<string, unknown>;
  assert.equal(developerRegistration.enabled, false);
});

test('mergeRuntimeDeveloperRegistrationConfig is a no-op when already matching', () => {
  const { changed } = mergeRuntimeDeveloperRegistrationConfig(
    { schemaVersion: 1, auth: { developerRegistration: { enabled: false } } },
    false,
  );
  assert.equal(changed, false);
});

test('mergeRuntimeDeveloperRegistrationConfig preserves sibling auth.jwt fields', () => {
  const { nextConfig } = mergeRuntimeDeveloperRegistrationConfig(
    { schemaVersion: 1, auth: { jwt: { issuer: 'https://realm.example' } } },
    true,
  );
  const auth = (nextConfig.auth ?? {}) as Record<string, unknown>;
  const jwt = (auth.jwt ?? {}) as Record<string, unknown>;
  const developerRegistration = (auth.developerRegistration ?? {}) as Record<string, unknown>;
  assert.equal(jwt.issuer, 'https://realm.example');
  assert.equal(developerRegistration.enabled, true);
});

test('syncRuntimeDeveloperRegistrationConfig restarts managed running daemon on CONFIG_RESTART_REQUIRED', async () => {
  let setCalls = 0;
  let restartCalls = 0;
  let writtenConfig = '';

  const result = await syncRuntimeDeveloperRegistrationConfig({
    daemonStatus: createDaemonStatus({ running: true, managed: true, pid: 1001 }),
    enabled: true,
    bridge: {
      async getRuntimeBridgeConfig() {
        return { path: '/tmp/config.json', config: { schemaVersion: 1 } };
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
  const auth = (parsed.auth ?? {}) as Record<string, unknown>;
  const developerRegistration = (auth.developerRegistration ?? {}) as Record<string, unknown>;
  assert.equal(developerRegistration.enabled, true);
});

test('syncRuntimeDeveloperRegistrationConfig skips write when config already matches', async () => {
  let setCalls = 0;

  const result = await syncRuntimeDeveloperRegistrationConfig({
    daemonStatus: createDaemonStatus({ running: true, managed: true, pid: 3003 }),
    enabled: false,
    bridge: {
      async getRuntimeBridgeConfig() {
        return {
          path: '/tmp/config.json',
          config: { schemaVersion: 1, auth: { developerRegistration: { enabled: false } } },
        };
      },
      async setRuntimeBridgeConfig(configJson: string) {
        void configJson;
        setCalls += 1;
        return { path: '/tmp/config.json', reasonCode: ReasonCode.CONFIG_APPLIED, config: {} };
      },
      async restartRuntimeBridge() {
        return createDaemonStatus();
      },
    },
  });

  assert.equal(setCalls, 0);
  assert.equal(result.pid, 3003);
});

test('syncRuntimeDeveloperRegistrationConfig throws for unmanaged running daemon when restart required', async () => {
  await assert.rejects(
    async () => syncRuntimeDeveloperRegistrationConfig({
      daemonStatus: createDaemonStatus({ running: true, managed: false }),
      enabled: true,
      bridge: {
        async getRuntimeBridgeConfig() {
          return { path: '/tmp/config.json', config: { schemaVersion: 1 } };
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
});
