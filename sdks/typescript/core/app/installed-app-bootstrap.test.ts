import assert from 'node:assert/strict';
import test from 'node:test';

import { createNimiError } from '../../types';
import { createInstalledNimiAppBootstrap } from './installed-app-bootstrap';

test('app bootstrap exposes typed status and the admitted artifact reader only', async () => {
  const calls: string[] = [];
  const bootstrap = createInstalledNimiAppBootstrap({
    standardShell: {
      appHost: appHostSurface(),
      artifacts: {
        async readRuntimeBytes(artifactId: string) {
          calls.push(artifactId);
          return {
            bytes: Uint8Array.from([97, 114, 116, 105, 102, 97, 99, 116]),
            mimeType: 'text/plain',
            sizeBytes: 8,
            mimeInferred: false,
          };
        },
      },
    },
  } as never);

  assert.deepEqual(Object.keys(bootstrap), ['appHost', 'artifacts']);
  assert.deepEqual(Object.keys(bootstrap.appHost), ['bootstrap']);
  assert.deepEqual(Object.keys(bootstrap.artifacts), ['readRuntimeBytes']);
  assert.equal('runtime' in bootstrap, false);
  assert.equal('realm' in bootstrap, false);
  assert.equal('accountCaller' in bootstrap, false);
  assert.equal('launchBinding' in bootstrap, false);
  assert.deepEqual(await bootstrap.appHost.bootstrap(), localDevelopmentBootstrap());
  assert.deepEqual(await bootstrap.artifacts.readRuntimeBytes('artifact-one'), {
    bytes: Uint8Array.from([97, 114, 116, 105, 102, 97, 99, 116]),
    mimeType: 'text/plain',
    sizeBytes: 8,
    mimeInferred: false,
  });
  assert.deepEqual(calls, ['artifact-one']);
});

test('installed app bootstrap rejects renderer authority and missing carriers', () => {
  const standardShell = {
    appHost: appHostSurface(),
    artifacts: {
      readRuntimeBytes: async () => ({
        bytes: new Uint8Array(),
        mimeType: 'application/octet-stream',
        sizeBytes: 0,
        mimeInferred: true,
      }),
    },
  };

  for (const forbidden of [
    { launchBinding: { launchNonce: 'forged' } },
    { runtime: { endpoint: '127.0.0.1:46371' } },
    { authorization: 'Bearer forged' },
    { accountCaller: { mode: 'DESKTOP_LAUNCHED_NIMI_APP' } },
  ]) {
    assert.throws(
      () => createInstalledNimiAppBootstrap({ standardShell, ...forbidden } as never),
      { reasonCode: 'SDK_INSTALLED_APP_BOOTSTRAP_INPUT_FORBIDDEN' },
    );
  }

  assert.throws(
    () => createInstalledNimiAppBootstrap({ standardShell: {} } as never),
    { reasonCode: 'SDK_INSTALLED_APP_PROTECTED_CARRIER_REQUIRED' },
  );
});

test('installed artifact reads validate input and host projections', async () => {
  let calls = 0;
  const bootstrap = createInstalledNimiAppBootstrap({
    standardShell: {
      appHost: appHostSurface(),
      artifacts: {
        async readRuntimeBytes() {
          calls += 1;
          return {
            bytes: Uint8Array.from([1, 2]),
            mimeType: 'application/octet-stream',
            sizeBytes: 1,
            mimeInferred: false,
          };
        },
      },
    },
  } as never);

  await assert.rejects(
    bootstrap.artifacts.readRuntimeBytes(' artifact-one'),
    { reasonCode: 'SDK_INSTALLED_ARTIFACT_ID_INVALID' },
  );
  assert.equal(calls, 0);
  await assert.rejects(
    bootstrap.artifacts.readRuntimeBytes('artifact-one'),
    { reasonCode: 'SDK_INSTALLED_ARTIFACT_PROJECTION_INVALID' },
  );
});

test('installed artifact reads preserve typed carrier failures', async () => {
  const expected = createNimiError({
    message: 'Runtime service is unavailable.',
    reasonCode: 'runtime-service-unavailable',
    actionHint: 'start_verified_runtime_service',
    source: 'runtime',
  });
  const bootstrap = createInstalledNimiAppBootstrap({
    standardShell: {
      appHost: appHostSurface(),
      artifacts: {
        async readRuntimeBytes() {
          throw expected;
        },
      },
    },
  } as never);

  await assert.rejects(bootstrap.artifacts.readRuntimeBytes('artifact-one'), (error) => error === expected);
});

test('app-host bootstrap rejects technical material and malformed trust projections', async () => {
  const bootstrap = createInstalledNimiAppBootstrap({
    standardShell: {
      appHost: {
        async bootstrap() {
          return {
            ...localDevelopmentBootstrap(),
            sessionId: 'forbidden',
          };
        },
      },
      artifacts: {
        async readRuntimeBytes() {
          throw new Error('not used');
        },
      },
    },
  } as never);

  await assert.rejects(bootstrap.appHost.bootstrap(), {
    reasonCode: 'SDK_APP_HOST_BOOTSTRAP_PROJECTION_INVALID',
  });
});

function appHostSurface() {
  return {
    bootstrap: async () => localDevelopmentBootstrap(),
  };
}

function localDevelopmentBootstrap() {
  return {
    state: 'ready' as const,
    trustClass: 'local-development' as const,
    appId: 'nimi.thirdparty.fixture',
    bootstrapArtifactId: 'bootstrap-artifact',
    expiresAtUnixMs: 1_800_000_000_000,
  };
}
