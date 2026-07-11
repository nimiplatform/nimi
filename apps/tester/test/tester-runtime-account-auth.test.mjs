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

test('Tester exposes only the installed app projection and fails closed before protected session admission', async () => {
  const runtimePlatform = await importRuntimePlatform();

  assert.equal(runtimePlatform.runtimeAccountLoginEnabled, false);
  assert.deepEqual(await runtimePlatform.getRuntimePlatformProjection(), {
    status: 'action-required',
    mode: 'third-party-nimi-app',
    reasonCode: 'SDK_RUNTIME_METHOD_UNAVAILABLE',
    actionHint: 'use_admitted_protected_runtime_carrier',
    message: 'Tester installed account, Realm, and AI access requires a Runtime-issued protected app session.',
  });

  runtimePlatform.clearRuntimePlatformProjection();
  const refreshed = await runtimePlatform.getRuntimePlatformProjection();
  assert.equal('client' in refreshed, false);
  assert.equal('accountCaller' in refreshed, false);
  assert.equal('accountRuntime' in refreshed, false);
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
