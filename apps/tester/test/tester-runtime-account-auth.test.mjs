import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
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

function ownerUnavailable(command) {
  return Object.assign(new Error('Admitted App operation owner is unavailable'), {
    code: 'runtime-permission-denied',
    reasonCode: 'local-app-owner-unavailable',
    actionHint: 'refresh_local_app_runtime_projection',
    source: 'runtime',
    details: { command, retryable: false },
  });
}

test.after(() => {
  if (buildDir) rmSync(buildDir, { recursive: true, force: true });
});

test('Tester Electron lifecycle has no protected-session termination coupling', () => {
  const electronMain = readFileSync(path.join(root, 'src-electron/main.ts'), 'utf8');
  assert.doesNotMatch(electronMain, /onProtectedSessionFailure|supervised-host-reopen/u);
  assert.match(electronMain, /registerNimiElectronAppBridge\(\{/u);
  assert.match(electronMain, /await createMainWindow\(\)/u);
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

test('Tester presents typed unavailable posture without terminating its App carrier', async () => {
  const previousElectronTest = globalThis.__NIMI_ELECTRON_TEST__;
  const calls = [];
  globalThis.__NIMI_ELECTRON_TEST__ = {
    async invoke(command, payload) {
      calls.push({ command, payload });
      throw Object.assign(new Error('Protected App Access is unavailable'), {
        code: 'runtime-permission-denied',
        reasonCode: 'local-app-operation-unavailable',
        actionHint: 'refresh_local_app_runtime_projection',
        source: 'runtime',
        details: { command, retryable: true },
      });
    },
    listen() { return () => {}; },
  };
  try {
    const runtimePlatform = await importRuntimePlatform();
    runtimePlatform.clearRuntimePlatformProjection();
    const projection = await runtimePlatform.getRuntimePlatformProjection();
    assert.deepEqual(projection, {
      status: 'action-required',
      mode: 'local-app',
      reasonCode: 'local-app-operation-unavailable',
      actionHint: 'wait_for_app_access_admission',
      message: 'Protected App Access is unavailable until Runtime admits a fresh access session.',
    });
    assert.deepEqual(calls, [
      { command: 'nimi.shell.localApp.sessionStatus', payload: {} },
    ]);
  } finally {
    if (previousElectronTest === undefined) delete globalThis.__NIMI_ELECTRON_TEST__;
    else globalThis.__NIMI_ELECTRON_TEST__ = previousElectronTest;
  }
});

test('Tester preserves a bound identity session without treating it as App Access', async () => {
  const previousElectronTest = globalThis.__NIMI_ELECTRON_TEST__;
  const calls = [];
  globalThis.__NIMI_ELECTRON_TEST__ = {
    async invoke(command, payload) {
      calls.push({ command, payload });
      assert.equal(command, 'nimi.shell.localApp.sessionStatus');
      return {
        state: 'ready',
        reasonCode: 'action-executed',
        retryable: false,
        currentUser: {
          state: 'ready',
          value: { handle: '@halliday', displayName: 'Halliday', avatarUrl: null },
          reasonCode: 'action-executed',
          retryable: false,
        },
      };
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
      reasonCode: 'action-executed',
      actionHint: 'continue_local_app_session',
      retryable: false,
    });
    assert.deepEqual(calls, [{ command: 'nimi.shell.localApp.sessionStatus', payload: {} }]);
  } finally {
    if (previousElectronTest === undefined) delete globalThis.__NIMI_ELECTRON_TEST__;
    else globalThis.__NIMI_ELECTRON_TEST__ = previousElectronTest;
  }
});

test('Tester app-private storage reaches typed ingress and preserves owner-unavailable', async () => {
  const previousElectronTest = globalThis.__NIMI_ELECTRON_TEST__;
  const calls = [];
  globalThis.__NIMI_ELECTRON_TEST__ = {
    async invoke(command, payload) {
      calls.push({ command, payload });
      throw ownerUnavailable(command);
    },
    listen() { return () => {}; },
  };
  try {
    const { getTesterLocalAppClient } = await importLocalAppRuntimePlatform();

    await assert.rejects(
      getTesterLocalAppClient().storage.writeJson('settings/profile.json', { theme: 'calm' }),
      (error) => {
        assert.equal(error?.code, 'runtime-permission-denied');
        assert.equal(error?.reasonCode, 'local-app-owner-unavailable');
        return true;
      },
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.command, 'nimi.shell.storage.writeJson');
  } finally {
    if (previousElectronTest === undefined) delete globalThis.__NIMI_ELECTRON_TEST__;
    else globalThis.__NIMI_ELECTRON_TEST__ = previousElectronTest;
  }
});

test('Tester reports typed owner unavailability after protected ingress', async () => {
  const previousElectronTest = globalThis.__NIMI_ELECTRON_TEST__;
  const calls = [];
  globalThis.__NIMI_ELECTRON_TEST__ = {
    async invoke(command, payload) {
      calls.push({ command, payload });
      if (command === 'nimi.shell.localApp.sessionStatus') {
        return {
          state: 'ready',
          reasonCode: 'action-executed',
          retryable: false,
          currentUser: {
            state: 'ready',
            value: { handle: '@halliday', displayName: 'Halliday', avatarUrl: null },
            reasonCode: 'action-executed',
            retryable: false,
          },
        };
      }
      throw ownerUnavailable(command);
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
    assert.match(result.message, /owner is unavailable/u);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0], { command: 'nimi.shell.localApp.sessionStatus', payload: {} });
    assert.equal(calls[1]?.command, 'nimi.shell.localApp.textGenerateCandidate');
  } finally {
    if (previousElectronTest === undefined) delete globalThis.__NIMI_ELECTRON_TEST__;
    else globalThis.__NIMI_ELECTRON_TEST__ = previousElectronTest;
  }
});
