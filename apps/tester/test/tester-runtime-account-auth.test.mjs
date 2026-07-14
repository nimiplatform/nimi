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
    'src/shell/local-app-runtime-platform.ts',
  ], {
    cwd: root,
    stdio: 'pipe',
  });
  return buildDir;
}

async function importRuntimePlatform() {
  return import(pathToFileURL(path.join(buildModule(), 'shell/auth/runtime-platform.js')).href);
}

async function importLocalAppRuntimePlatform() {
  return import(pathToFileURL(path.join(buildModule(), 'shell/local-app-runtime-platform.js')).href);
}

test.after(() => {
  if (buildDir) rmSync(buildDir, { recursive: true, force: true });
});

test('Tester local-app projection fails closed before a protected carrier is available', async () => {
  const runtimePlatform = await importRuntimePlatform();

  assert.equal(runtimePlatform.runtimeAccountLoginEnabled, false);
  const projection = await runtimePlatform.getRuntimePlatformProjection();
  assert.equal(projection.status, 'action-required');
  assert.equal(projection.mode, 'local-app');
  assert.equal(projection.reasonCode, 'renderer-standard-shell-host-unavailable');
  assert.equal(projection.actionHint, 'start_fixed_runtime_service');
  assert.equal('client' in projection, false);
  assert.equal('accountCaller' in projection, false);
  assert.equal('accountRuntime' in projection, false);
});

test('Tester preserves a zero-grant identity session without implying operation authorization', async () => {
  const previousElectronTest = globalThis.__NIMI_ELECTRON_TEST__;
  const calls = [];
  globalThis.__NIMI_ELECTRON_TEST__ = {
    async invoke(command, payload) {
      calls.push({ command, payload });
      assert.equal(command, 'nimi.shell.localApp.sessionStatus');
      return { state: 'zero-grant', reasonCode: 'no-grant', retryable: false };
    },
    listen() { return () => {}; },
  };
  try {
    const runtimePlatform = await importRuntimePlatform();
    runtimePlatform.clearRuntimePlatformProjection();
    const projection = await runtimePlatform.getRuntimePlatformProjection();
    assert.equal(projection.status, 'ready');
    assert.equal(projection.mode, 'local-app');
    assert.deepEqual(projection.localAppSession, {
      mode: 'local-app',
      state: 'session-bound-zero-grant',
      sessionBound: true,
      operationAllowed: false,
      reasonCode: 'no-grant',
      actionHint: 'request_local_app_operation_grant',
      retryable: false,
    });
    assert.deepEqual(calls, [{ command: 'nimi.shell.localApp.sessionStatus', payload: {} }]);
  } finally {
    if (previousElectronTest === undefined) delete globalThis.__NIMI_ELECTRON_TEST__;
    else globalThis.__NIMI_ELECTRON_TEST__ = previousElectronTest;
  }
});

test('Tester Runtime artifact readback crosses the final SDK and Kit local-app carrier', async () => {
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
    listen() { return () => {}; },
  };
  try {
    const { testerLocalRuntimeArtifactReader } = await importLocalAppRuntimePlatform();
    const result = await testerLocalRuntimeArtifactReader.readArtifactBytes({ artifactId: 'runtime-artifact-1' });

    assert.deepEqual([...result.bytes], [1, 2, 3, 4]);
    assert.deepEqual({ ...result, bytes: undefined }, {
      bytes: undefined,
      mimeType: 'image/png',
      sizeBytes: '4',
      mimeInferred: false,
    });
    assert.deepEqual(calls, [{
      command: 'nimi.shell.localApp.artifacts.readRuntimeBytes',
      payload: { payload: { artifactId: 'runtime-artifact-1' } },
    }]);
  } finally {
    if (previousElectronTest === undefined) delete globalThis.__NIMI_ELECTRON_TEST__;
    else globalThis.__NIMI_ELECTRON_TEST__ = previousElectronTest;
  }
});
