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

test('Tester preserves a bound identity session without conflating permission state', async () => {
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

test('Tester app-private storage crosses the final SDK and Kit local-app carrier without a permission request', async () => {
  const previousElectronTest = globalThis.__NIMI_ELECTRON_TEST__;
  const calls = [];
  globalThis.__NIMI_ELECTRON_TEST__ = {
    async invoke(command, payload) {
      calls.push({ command, payload });
      return {
        value: { theme: 'calm' },
        sizeBytes: 16,
      };
    },
    listen() { return () => {}; },
  };
  try {
    const { testerLocalAppClient } = await importLocalAppRuntimePlatform();
    const result = await testerLocalAppClient.storage.writeJson('settings/profile.json', { theme: 'calm' });

    assert.deepEqual(result, { value: { theme: 'calm' }, sizeBytes: 16 });
    assert.deepEqual(calls, [{
      command: 'nimi.shell.storage.writeJson',
      payload: { payload: { relativePath: 'settings/profile.json', value: { theme: 'calm' } } },
    }]);
  } finally {
    if (previousElectronTest === undefined) delete globalThis.__NIMI_ELECTRON_TEST__;
    else globalThis.__NIMI_ELECTRON_TEST__ = previousElectronTest;
  }
});

test('Tester text generation crosses the protected SDK and Kit carrier after permission is granted', async () => {
  const previousElectronTest = globalThis.__NIMI_ELECTRON_TEST__;
  const calls = [];
  globalThis.__NIMI_ELECTRON_TEST__ = {
    async invoke(command, payload) {
      calls.push({ command, payload });
      switch (command) {
        case 'nimi.shell.localApp.sessionStatus':
          return { state: 'ready', reasonCode: ReasonCode.ACTION_EXECUTED, retryable: false };
        case 'nimi.shell.localApp.permissionStatus':
          return {
            state: 'granted',
            permissionId: 'ai.text.generate',
            canRequest: false,
            reasonCode: ReasonCode.ACTION_EXECUTED,
            agents: [],
          };
        case 'nimi.shell.localApp.textGenerateCandidate':
          return { text: 'Runtime candidate', finishReason: 'stop', traceId: 'trace-tester-text-1' };
        default:
          throw new Error(`Unexpected command: ${command}`);
      }
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

    assert.deepEqual(result, {
      ok: true,
      capabilityId: 'text.generate',
      capabilityLabel: 'Text Studio',
      message: 'Runtime completed the protected foreground text candidate request.',
      output: {
        kind: 'text',
        text: 'Runtime candidate',
        finishReason: 'stop',
        streamed: false,
      },
      trace: {
        traceId: 'trace-tester-text-1',
      },
    });
    assert.deepEqual(calls, [
      { command: 'nimi.shell.localApp.sessionStatus', payload: {} },
      {
        command: 'nimi.shell.localApp.permissionStatus',
        payload: { payload: { permissionId: 'ai.text.generate' } },
      },
      {
        command: 'nimi.shell.localApp.textGenerateCandidate',
        payload: { payload: {
          messages: [{ role: 'user', text: 'Write an acceptance note.' }],
          temperature: 0.7,
          topP: 0.9,
          maxTokens: 1024,
        } },
      },
    ]);
  } finally {
    if (previousElectronTest === undefined) delete globalThis.__NIMI_ELECTRON_TEST__;
    else globalThis.__NIMI_ELECTRON_TEST__ = previousElectronTest;
  }
});

test('Tester requests ai.text.generate once and never fabricates output while owner approval is pending', async () => {
  const previousElectronTest = globalThis.__NIMI_ELECTRON_TEST__;
  const calls = [];
  globalThis.__NIMI_ELECTRON_TEST__ = {
    async invoke(command, payload) {
      calls.push({ command, payload });
      switch (command) {
        case 'nimi.shell.localApp.sessionStatus':
          return { state: 'ready', reasonCode: ReasonCode.ACTION_EXECUTED, retryable: false };
        case 'nimi.shell.localApp.permissionStatus':
          return {
            state: 'prompt',
            permissionId: 'ai.text.generate',
            canRequest: true,
            reasonCode: ReasonCode.ACTION_EXECUTED,
            agents: [],
          };
        case 'nimi.shell.localApp.permissionRequest':
          return {
            state: 'pending',
            permissionId: 'ai.text.generate',
            canRequest: false,
            reasonCode: ReasonCode.ACTION_EXECUTED,
            agents: [],
          };
        default:
          throw new Error(`Unexpected command: ${command}`);
      }
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
    assert.equal(result.reason, 'permission-required');
    assert.match(result.message, /pending/u);
    assert.equal(calls.some(({ command }) => command === 'nimi.shell.localApp.textGenerateCandidate'), false);
    const requestCall = calls.find(({ command }) => command === 'nimi.shell.localApp.permissionRequest');
    assert.equal(requestCall.payload.payload.permissionId, 'ai.text.generate');
    assert.match(requestCall.payload.payload.reason, /foreground text generation/u);
    assert.equal(typeof requestCall.payload.payload.requestId, 'string');
    assert.ok(requestCall.payload.payload.requestId.length > 0);
  } finally {
    if (previousElectronTest === undefined) delete globalThis.__NIMI_ELECTRON_TEST__;
    else globalThis.__NIMI_ELECTRON_TEST__ = previousElectronTest;
  }
});
