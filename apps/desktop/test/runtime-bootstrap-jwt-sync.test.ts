import assert from 'node:assert/strict';
import test from 'node:test';

import { NIMI_RUNTIME_BRIDGE_CONFIG_DEFAULTS } from '@nimiplatform/sdk/runtime';
import { ReasonCode, type JsonObject } from '@nimiplatform/sdk/types';
import type {
  RealmDefaults,
  RuntimeBridgeDaemonStatus,
} from '../src/shell/renderer/bridge/runtime-bridge/types';
import {
  mergeRuntimeJwtConfig,
  syncRuntimeJwtConfig,
} from '../src/shell/renderer/infra/bootstrap/runtime-bootstrap-jwt-sync';

function createRealmDefaults(): RealmDefaults {
  return {
    realmBaseUrl: 'http://localhost:3002',
    realtimeUrl: 'http://localhost:3003',
    accessToken: 'token-1',
    jwksUrl: 'http://localhost:3002/api/auth/jwks',
    revocationUrl: 'http://localhost:3002/api/auth/sessions/introspect',
    jwtIssuer: 'http://localhost:3002',
    jwtAudience: 'nimi-runtime',
  };
}

function createDaemonStatus(overrides: Partial<RuntimeBridgeDaemonStatus> = {}): RuntimeBridgeDaemonStatus {
  return {
    running: true,
    managed: true,
    launchMode: 'RUNTIME',
    grpcAddr: NIMI_RUNTIME_BRIDGE_CONFIG_DEFAULTS.grpcAddr,
    ...overrides,
  };
}

test('mergeRuntimeJwtConfig injects account realm and auth.jwt fields', () => {
  const realmDefaults = createRealmDefaults();
  const { nextConfig, changed } = mergeRuntimeJwtConfig({ schemaVersion: 1 }, realmDefaults);

  assert.equal(changed, true);
  const auth = (nextConfig.auth ?? {}) as Record<string, unknown>;
  const account = (auth.account ?? {}) as Record<string, unknown>;
  const jwt = (auth.jwt ?? {}) as Record<string, unknown>;
  assert.equal(account.realmBaseUrl, realmDefaults.realmBaseUrl);
  assert.equal(account.authorizationUrl, `${realmDefaults.realmBaseUrl}/api/auth/oauth/authorize`);
  assert.equal(account.tokenUrl, `${realmDefaults.realmBaseUrl}/api/auth/oauth/token`);
  assert.equal(jwt.issuer, realmDefaults.jwtIssuer);
  assert.equal(jwt.audience, realmDefaults.jwtAudience);
  assert.equal(jwt.jwksUrl, realmDefaults.jwksUrl);
  assert.equal(jwt.revocationUrl, realmDefaults.revocationUrl);
});

test('mergeRuntimeJwtConfig overwrites stale account OAuth endpoint overrides', () => {
  const realmDefaults = createRealmDefaults();
  const { nextConfig, changed } = mergeRuntimeJwtConfig({
    schemaVersion: 1,
    auth: {
      account: {
        realmBaseUrl: 'http://127.0.0.1:51860',
        authorizationUrl: 'http://127.0.0.1:51860/api/auth/oauth/authorize',
        tokenUrl: 'http://127.0.0.1:51860/api/auth/oauth/token',
      },
    },
  }, realmDefaults);

  assert.equal(changed, true);
  const auth = (nextConfig.auth ?? {}) as Record<string, unknown>;
  const account = (auth.account ?? {}) as Record<string, unknown>;
  assert.equal(account.realmBaseUrl, realmDefaults.realmBaseUrl);
  assert.equal(account.authorizationUrl, `${realmDefaults.realmBaseUrl}/api/auth/oauth/authorize`);
  assert.equal(account.tokenUrl, `${realmDefaults.realmBaseUrl}/api/auth/oauth/token`);
});

test('syncRuntimeJwtConfig restarts managed running daemon on CONFIG_RESTART_REQUIRED', async () => {
  const realmDefaults = createRealmDefaults();
  let setCalls = 0;
  let restartCalls = 0;
  let writtenConfig = '';

  const result = await syncRuntimeJwtConfig({
    daemonStatus: createDaemonStatus({ running: true, managed: true, pid: 1001 }),
    realmDefaults,
    bridge: {
      async getRuntimeBridgeConfig() {
        return {
          path: '/tmp/config.json',
          config: { schemaVersion: 1 },
        };
      },
      async setRuntimeBridgeConfig(configJson: string) {
        setCalls += 1;
        writtenConfig = configJson;
        return {
          path: '/tmp/config.json',
          reasonCode: ReasonCode.CONFIG_RESTART_REQUIRED,
          actionHint: 'restart runtime to apply config changes',
          config: JSON.parse(configJson) as JsonObject,
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
  const account = (auth.account ?? {}) as Record<string, unknown>;
  const jwt = (auth.jwt ?? {}) as Record<string, unknown>;
  assert.equal(account.realmBaseUrl, realmDefaults.realmBaseUrl);
  assert.equal(account.authorizationUrl, `${realmDefaults.realmBaseUrl}/api/auth/oauth/authorize`);
  assert.equal(account.tokenUrl, `${realmDefaults.realmBaseUrl}/api/auth/oauth/token`);
  assert.equal(jwt.jwksUrl, realmDefaults.jwksUrl);
  assert.equal(jwt.issuer, realmDefaults.jwtIssuer);
  assert.equal(jwt.audience, realmDefaults.jwtAudience);
  assert.equal(jwt.revocationUrl, realmDefaults.revocationUrl);
});

test('syncRuntimeJwtConfig does not restart when daemon is managed but stopped', async () => {
  const realmDefaults = createRealmDefaults();
  let restartCalls = 0;

  const result = await syncRuntimeJwtConfig({
    daemonStatus: createDaemonStatus({ running: false, managed: true }),
    realmDefaults,
    bridge: {
      async getRuntimeBridgeConfig() {
        return {
          path: '/tmp/config.json',
          config: { schemaVersion: 1 },
        };
      },
      async setRuntimeBridgeConfig(configJson: string) {
        return {
          path: '/tmp/config.json',
          reasonCode: ReasonCode.CONFIG_RESTART_REQUIRED,
          actionHint: 'restart runtime to apply config changes',
          config: JSON.parse(configJson) as JsonObject,
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
  assert.equal(result.managed, true);
});

test('syncRuntimeJwtConfig throws for unmanaged running daemon when restart required', async () => {
  const realmDefaults = createRealmDefaults();
  let restartCalls = 0;

  await assert.rejects(
    async () => syncRuntimeJwtConfig({
      daemonStatus: createDaemonStatus({ running: true, managed: false }),
      realmDefaults,
      bridge: {
        async getRuntimeBridgeConfig() {
          return {
            path: '/tmp/config.json',
            config: { schemaVersion: 1 },
          };
        },
        async setRuntimeBridgeConfig(configJson: string) {
          return {
            path: '/tmp/config.json',
            reasonCode: ReasonCode.CONFIG_RESTART_REQUIRED,
            actionHint: 'please restart external runtime manually',
            config: JSON.parse(configJson) as JsonObject,
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

test('syncRuntimeJwtConfig skips write when config already matches', async () => {
  const realmDefaults = createRealmDefaults();
  let setCalls = 0;

  const result = await syncRuntimeJwtConfig({
    daemonStatus: createDaemonStatus({ running: true, managed: true, pid: 3003 }),
    realmDefaults,
    bridge: {
      async getRuntimeBridgeConfig() {
        return {
          path: '/tmp/config.json',
          config: {
            schemaVersion: 1,
            auth: {
              account: {
                realmBaseUrl: realmDefaults.realmBaseUrl,
                authorizationUrl: `${realmDefaults.realmBaseUrl}/api/auth/oauth/authorize`,
                tokenUrl: `${realmDefaults.realmBaseUrl}/api/auth/oauth/token`,
              },
              jwt: {
                issuer: realmDefaults.jwtIssuer,
                audience: realmDefaults.jwtAudience,
                jwksUrl: realmDefaults.jwksUrl,
                revocationUrl: realmDefaults.revocationUrl,
              },
            },
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
