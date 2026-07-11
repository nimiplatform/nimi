import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { buildWithTsc } from './tsc-build.mjs';

const root = path.resolve(import.meta.dirname, '..');

let buildDir = null;

function buildModule() {
  if (buildDir) return buildDir;
  mkdirSync(path.join(root, '.tmp'), { recursive: true });
  buildDir = mkdtempSync(path.join(root, '.tmp', 'runtime-account-auth-'));
  buildWithTsc([
    '--outDir', buildDir,
    '--rootDir', 'src',
    '--module', 'NodeNext',
    '--moduleResolution', 'NodeNext',
    '--target', 'ES2022',
    '--skipLibCheck', 'true',
    '--types', 'node',
    '--noEmit', 'false',
    'src/shell/auth/runtime-platform.ts',
    'src/shell/installed-app-bootstrap.ts',
  ], {
    cwd: root,
    stdio: 'pipe',
  });
  return buildDir;
}

async function importRuntimePlatform() {
  const moduleUrl = pathToFileURL(path.join(buildModule(), 'shell/auth/runtime-platform.js')).href;
  return import(moduleUrl);
}

async function importInstalledAppBootstrap() {
  const moduleUrl = pathToFileURL(path.join(buildModule(), 'shell/installed-app-bootstrap.js')).href;
  return import(moduleUrl);
}

test.after(() => {
  if (buildDir) {
    rmSync(buildDir, { recursive: true, force: true });
  }
});

test('Tester app-host projection fails closed before protected session admission', async () => {
  const runtimePlatform = await importRuntimePlatform();

  assert.equal(runtimePlatform.runtimeAccountLoginEnabled, false);
  const projection = await runtimePlatform.getRuntimePlatformProjection();
  assert.equal(projection.status, 'action-required');
  assert.equal(projection.mode, 'third-party-nimi-app');
  assert.equal(projection.reasonCode, 'renderer-standard-shell-host-unavailable');
  assert.equal(projection.actionHint, 'open_nimi_desktop_and_retry');

  runtimePlatform.clearRuntimePlatformProjection();
  const refreshed = await runtimePlatform.getRuntimePlatformProjection();
  assert.equal('client' in refreshed, false);
  assert.equal('accountCaller' in refreshed, false);
  assert.equal('accountRuntime' in refreshed, false);
});

test('Tester proves admitted app-host bootstrap and Runtime artifact read without generic authority', async () => {
  const previousElectronTest = globalThis.__NIMI_ELECTRON_TEST__;
  const calls = [];
  globalThis.__NIMI_ELECTRON_TEST__ = {
    async invoke(command, payload) {
      calls.push({ command, payload });
      if (command === 'nimi.app-host.bootstrap') {
        return {
          state: 'ready',
          trustClass: 'local-development',
          appId: 'nimi.tester',
          bootstrapArtifactId: 'bootstrap-artifact',
          expiresAtUnixMs: Date.now() + 60_000,
        };
      }
      if (command === 'nimi.shell.artifacts.readRuntimeBytes') {
        return {
          dataBase64: 'AQIDBA==',
          mimeType: 'application/octet-stream',
          sizeBytes: 4,
          mimeInferred: false,
        };
      }
      throw new Error(`unexpected command: ${command}`);
    },
    listen() {
      return () => {};
    },
  };
  try {
    const runtimePlatform = await importRuntimePlatform();
    runtimePlatform.clearRuntimePlatformProjection();
    const projection = await runtimePlatform.getRuntimePlatformProjection();
    assert.deepEqual(projection, {
      status: 'ready',
      mode: 'third-party-nimi-app',
      appHost: {
        state: 'ready',
        trustClass: 'local-development',
        appId: 'nimi.tester',
        bootstrapArtifactId: 'bootstrap-artifact',
        bootstrapArtifact: {
          mimeType: 'application/octet-stream',
          sizeBytes: 4,
        },
      },
    });
    assert.equal('client' in projection, false);
    assert.equal('auth' in projection, false);
    assert.deepEqual(calls.map(({ command }) => command), [
      'nimi.app-host.bootstrap',
      'nimi.shell.artifacts.readRuntimeBytes',
    ]);
  } finally {
    if (previousElectronTest === undefined) {
      delete globalThis.__NIMI_ELECTRON_TEST__;
    } else {
      globalThis.__NIMI_ELECTRON_TEST__ = previousElectronTest;
    }
  }
});

test('Tester media artifact readback crosses the installed SDK and Kit carrier', async () => {
  const previousElectronTest = globalThis.__NIMI_ELECTRON_TEST__;
  const calls = [];
  globalThis.__NIMI_ELECTRON_TEST__ = {
    async invoke(command, payload) {
      calls.push({ command, payload });
      return {
        dataBase64: 'AQIDBA==',
        mimeType: 'image/png',
        sizeBytes: 4,
        mimeInferred: false,
      };
    },
    listen() {
      return () => {};
    },
  };
  try {
    const { testerInstalledRuntimeArtifactReader } = await importInstalledAppBootstrap();
    const result = await testerInstalledRuntimeArtifactReader.readArtifactBytes({
      artifactId: 'runtime-artifact-1',
    });

    assert.deepEqual([...result.bytes], [1, 2, 3, 4]);
    assert.deepEqual({ ...result, bytes: undefined }, {
      bytes: undefined,
      mimeType: 'image/png',
      sizeBytes: '4',
      mimeInferred: false,
    });
    assert.deepEqual(calls, [{
      command: 'nimi.shell.artifacts.readRuntimeBytes',
      payload: { payload: { artifactId: 'runtime-artifact-1' } },
    }]);
  } finally {
    if (previousElectronTest === undefined) {
      delete globalThis.__NIMI_ELECTRON_TEST__;
    } else {
      globalThis.__NIMI_ELECTRON_TEST__ = previousElectronTest;
    }
  }
});
