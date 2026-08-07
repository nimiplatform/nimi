import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { ReasonCode } from '@nimiplatform/sdk/types';
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
    'src/tester/tester-runtime.ts',
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

async function importTesterRuntime() {
  return import(pathToFileURL(path.join(buildModule(), 'tester/tester-runtime.js')).href);
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

test('Tester preserves a bound identity session without treating it as App Access', async () => {
  const previousElectronTest = globalThis.__NIMI_ELECTRON_TEST__;
  const calls = [];
  globalThis.__NIMI_ELECTRON_TEST__ = {
    async invoke(command, payload) {
      calls.push({ command, payload });
      assert.equal(command, 'nimi.shell.localApp.sessionStatus');
      return { state: 'ready', reasonCode: ReasonCode.ACTION_EXECUTED, retryable: false };
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
      state: 'session-bound',
      sessionBound: true,
      reasonCode: ReasonCode.ACTION_EXECUTED,
      actionHint: 'continue_local_app_session',
      retryable: false,
    });
    assert.deepEqual(calls, [{ command: 'nimi.shell.localApp.sessionStatus', payload: {} }]);
  } finally {
    if (previousElectronTest === undefined) delete globalThis.__NIMI_ELECTRON_TEST__;
    else globalThis.__NIMI_ELECTRON_TEST__ = previousElectronTest;
  }
});

test('Tester app-private storage fails closed before touching a shell carrier', async () => {
  const previousElectronTest = globalThis.__NIMI_ELECTRON_TEST__;
  const calls = [];
  globalThis.__NIMI_ELECTRON_TEST__ = {
    async invoke(command, payload) {
      calls.push({ command, payload });
      throw new Error(`Protected carrier must not be invoked: ${command}`);
    },
    listen() { return () => {}; },
  };
  try {
    const { testerLocalAppClient } = await importLocalAppRuntimePlatform();

    await assert.rejects(
      testerLocalAppClient.storage.writeJson('settings/profile.json', { theme: 'calm' }),
      (error) => {
        assert.equal(error?.code, 'SDK_LOCAL_APP_ACCESS_UNAVAILABLE');
        assert.equal(error?.reasonCode, 'SDK_LOCAL_APP_ACCESS_UNAVAILABLE');
        assert.equal(error?.retryable, false);
        return true;
      },
    );
    assert.deepEqual(calls, []);
  } finally {
    if (previousElectronTest === undefined) delete globalThis.__NIMI_ELECTRON_TEST__;
    else globalThis.__NIMI_ELECTRON_TEST__ = previousElectronTest;
  }
});

test('Tester reports typed App Access unavailability without invoking a protected carrier', async () => {
  const previousElectronTest = globalThis.__NIMI_ELECTRON_TEST__;
  const calls = [];
  globalThis.__NIMI_ELECTRON_TEST__ = {
    async invoke(command, payload) {
      calls.push({ command, payload });
      if (command === 'nimi.shell.localApp.sessionStatus') {
        return { state: 'ready', reasonCode: ReasonCode.ACTION_EXECUTED, retryable: false };
      }
      throw new Error(`Protected carrier must not be invoked: ${command}`);
    },
    listen() { return () => {}; },
  };
  try {
    const runtimePlatform = await importRuntimePlatform();
    const { runTesterCapability } = await importTesterRuntime();
    runtimePlatform.clearRuntimePlatformProjection();

    const result = await runTesterCapability({
      capabilityId: 'text.generate',
      prompt: 'Write an acceptance note.',
    });

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'runtime-call-failed');
    assert.match(result.message, /SDK_LOCAL_APP_ACCESS_UNAVAILABLE/u);
    assert.deepEqual(calls, [
      { command: 'nimi.shell.localApp.sessionStatus', payload: {} },
    ]);
  } finally {
    if (previousElectronTest === undefined) delete globalThis.__NIMI_ELECTRON_TEST__;
    else globalThis.__NIMI_ELECTRON_TEST__ = previousElectronTest;
  }
});
