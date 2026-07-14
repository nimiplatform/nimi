import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildNimiRuntimeBridgeConfigWithLocalEndpoint,
  mergeNimiRuntimeBridgeDataRootConfig,
  mergeNimiRuntimeBridgeRealmJwtConfig,
  NIMI_RUNTIME_BRIDGE_CONFIG_DEFAULTS,
  projectNimiRuntimeBridgeLocalEndpoint,
  resolveNimiRuntimeAppActiveStorageRoots,
  resolveNimiRuntimeAppStorageRoots,
  type NimiRuntimeAppStorageClient,
  type NimiRuntimeAppStorageProjection,
} from './index';
import { ReasonCode } from '../types';

const readyProjection: NimiRuntimeAppStorageProjection = {
  appId: 'nimi.example-app',
  state: 'ready',
  appRoot: '/apps/nimi.example-app',
  activeReleaseRoot: '/apps/nimi.example-app/releases/current',
  durableDataRoot: '/data/nimi.example-app',
  cacheRoot: '/cache/nimi.example-app',
  tempRoot: '/tmp/nimi.example-app',
  activeVersion: '1.0.0',
  storagePolicyRef: 'nimi-data-app-roots',
};

function client(projection: NimiRuntimeAppStorageProjection): NimiRuntimeAppStorageClient {
  return {
    async storage({ appId }) {
      return { ...projection, appId };
    },
  };
}

describe('Runtime app storage helpers', () => {
  it('resolves active storage roots from Runtime-owned projection', async () => {
    const roots = await resolveNimiRuntimeAppActiveStorageRoots({
      appLifecycle: client(readyProjection),
      appId: 'nimi.example-app',
    });
    assert.deepEqual(roots, {
      releaseRoot: '/apps/nimi.example-app/releases/current',
      dataRoot: '/data/nimi.example-app',
      cacheRoot: '/cache/nimi.example-app',
      tempRoot: '/tmp/nimi.example-app',
    });
  });

  it('returns undefined when Runtime has no active release root', async () => {
    const roots = await resolveNimiRuntimeAppActiveStorageRoots({
      appLifecycle: client({ ...readyProjection, activeReleaseRoot: undefined }),
      appId: 'nimi.example-app',
    });
    assert.equal(roots, undefined);
  });

  it('resolves durable storage roots without requiring an active release', async () => {
    const roots = await resolveNimiRuntimeAppStorageRoots({
      appLifecycle: client({ ...readyProjection, activeReleaseRoot: undefined }),
      appId: 'nimi.example-app',
    });
    assert.deepEqual(roots, {
      dataRoot: '/data/nimi.example-app',
      cacheRoot: '/cache/nimi.example-app',
      tempRoot: '/tmp/nimi.example-app',
    });
  });

  it('fails closed on unavailable Runtime storage projection', async () => {
    await assert.rejects(
      resolveNimiRuntimeAppActiveStorageRoots({
        appLifecycle: client({
          ...readyProjection,
          state: 'repair_required',
          detail: 'storage policy is corrupt',
        }),
        appId: 'nimi.example-app',
        label: 'desktop Apps app',
      }),
      (error: unknown) => {
        const candidate = error as { reasonCode?: string; message?: string };
        assert.equal(candidate.reasonCode, 'ACTION_INPUT_INVALID');
        assert.match(candidate.message ?? '', /storage policy is corrupt/);
        return true;
      },
    );
  });

  it('resolves storage roots with forwarded call options and trimmed app id', async () => {
    const calls: unknown[] = [];
    const appLifecycle: NimiRuntimeAppStorageClient = {
      async storage(input, options) {
        calls.push({ input, options });
        return { ...readyProjection, appId: input.appId };
      },
    };
    const options = { metadata: { callerId: 'storage-test' } };

    const roots = await resolveNimiRuntimeAppStorageRoots({
      appLifecycle,
      appId: ' nimi.example-app ',
      options,
    });
    assert.deepEqual(roots, {
      dataRoot: '/data/nimi.example-app',
      cacheRoot: '/cache/nimi.example-app',
      tempRoot: '/tmp/nimi.example-app',
    });
    assert.deepEqual(calls, [{ input: { appId: 'nimi.example-app' }, options }]);
  });

  it('fails closed on missing app ids roots and unavailable storage defaults', async () => {
    await assert.rejects(
      resolveNimiRuntimeAppStorageRoots({
        appLifecycle: client(readyProjection),
        appId: ' ',
      }),
      (error: unknown) => (error as { reasonCode?: string }).reasonCode === ReasonCode.ACTION_INPUT_INVALID,
    );
    await assert.rejects(
      resolveNimiRuntimeAppStorageRoots({
        appLifecycle: client({ ...readyProjection, durableDataRoot: '' }),
        appId: 'nimi.example-app',
      }),
      (error: unknown) => {
        const candidate = error as { reasonCode?: string; message?: string };
        assert.equal(candidate.reasonCode, 'ACTION_INPUT_INVALID');
        assert.match(candidate.message ?? '', /durableDataRoot is required/);
        return true;
      },
    );
    await assert.rejects(
      resolveNimiRuntimeAppActiveStorageRoots({
        appLifecycle: client({ ...readyProjection, activeReleaseRoot: ' ' }),
        appId: 'nimi.example-app',
      }),
      (error: unknown) => {
        const candidate = error as { reasonCode?: string; message?: string };
        assert.equal(candidate.reasonCode, 'ACTION_INPUT_INVALID');
        assert.match(candidate.message ?? '', /activeReleaseRoot is required/);
        return true;
      },
    );
    await assert.rejects(
      resolveNimiRuntimeAppStorageRoots({
        appLifecycle: client({
          ...readyProjection,
          state: 'storage_unavailable',
          detail: undefined,
        }),
        appId: 'nimi.example-app',
        label: 'profile',
      }),
      (error: unknown) => {
        const candidate = error as { reasonCode?: string; message?: string };
        assert.equal(candidate.reasonCode, 'ACTION_INPUT_INVALID');
        assert.match(candidate.message ?? '', /profile storage projection for nimi.example-app is storage_unavailable/);
        return true;
      },
    );
  });

  it('exports canonical Runtime bridge config defaults', () => {
    assert.deepEqual(NIMI_RUNTIME_BRIDGE_CONFIG_DEFAULTS, {
      schemaVersion: 1,
      grpcAddr: '127.0.0.1:46371',
      httpAddr: '127.0.0.1:46372',
    });
  });

  it('projects local endpoint and bridge config defaults without connector leakage', () => {
    const config = buildNimiRuntimeBridgeConfigWithLocalEndpoint(
      { providers: { local: { endpoint: 'retired' }, cloud: { endpoint: 'https://example.test' } } },
      'http://127.0.0.1:8080/v1/',
    );
    assert.equal(config.schemaVersion, 1);
    assert.equal(config.grpcAddr, '127.0.0.1:46371');
    assert.equal(config.httpAddr, '127.0.0.1:46372');
    assert.deepEqual(config.providers, { cloud: { endpoint: 'https://example.test' } });
    assert.equal(projectNimiRuntimeBridgeLocalEndpoint(config), 'http://127.0.0.1:8080/v1');
  });

  it('merges Runtime bridge data root and JWT config', () => {
    const dataRoot = mergeNimiRuntimeBridgeDataRootConfig(
      { localModelsPath: '/legacy/models' },
      '/nimi-data',
      '/nimi-data/models',
      '/nimi-data/state.json',
    );
    assert.equal(dataRoot.changed, true);
    assert.equal(dataRoot.nextConfig.localModelsPath, undefined);
    assert.equal(dataRoot.nextConfig.dataRootRef, '/nimi-data');
    assert.deepEqual(dataRoot.nextConfig.managedRoots, {
      models: '/nimi-data/models',
      dependencies: '/nimi-data/dependencies',
      environments: '/nimi-data/environments',
      logs: '/nimi-data/logs',
      audit: '/nimi-data/audit',
    });

    const jwt = mergeNimiRuntimeBridgeRealmJwtConfig({}, {
      realmBaseUrl: 'https://realm.example',
      jwtIssuer: 'https://realm.example',
      jwtAudience: 'nimi-runtime',
      jwksUrl: 'https://realm.example/jwks',
      revocationUrl: 'https://realm.example/introspect',
    });
    assert.equal(jwt.changed, true);
    assert.deepEqual(jwt.nextConfig.auth, {
      account: {
        realmBaseUrl: 'https://realm.example',
        authorizationUrl: 'https://realm.example/api/auth/oauth/authorize',
        tokenUrl: 'https://realm.example/api/auth/oauth/token',
      },
      jwt: {
        issuer: 'https://realm.example',
        audience: 'nimi-runtime',
        jwksUrl: 'https://realm.example/jwks',
        revocationUrl: 'https://realm.example/introspect',
      },
    });

    const accountAuth = mergeNimiRuntimeBridgeRealmJwtConfig({
      auth: {
        account: {
          realmBaseUrl: 'http://127.0.0.1:51860',
          authorizationUrl: 'http://127.0.0.1:51860/api/auth/oauth/authorize',
          tokenUrl: 'http://127.0.0.1:51860/api/auth/oauth/token',
        },
      },
    }, {
      realmBaseUrl: 'https://realm.example',
      jwtIssuer: 'https://realm.example',
      jwtAudience: 'nimi-runtime',
      jwksUrl: 'https://realm.example/jwks',
      revocationUrl: 'https://realm.example/introspect',
    });
    assert.equal(accountAuth.changed, true);
    assert.deepEqual((accountAuth.nextConfig.auth as Record<string, unknown>).account, {
      realmBaseUrl: 'https://realm.example',
      authorizationUrl: 'https://realm.example/api/auth/oauth/authorize',
      tokenUrl: 'https://realm.example/api/auth/oauth/token',
    });
  });
});
