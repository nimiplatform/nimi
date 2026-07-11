import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { _electron as electron } from 'playwright';
import {
  NIMI_STANDARD_SHELL_CAPABILITIES,
  NIMI_STANDARD_SHELL_COMMANDS,
} from '@nimiplatform/kit/shell/capabilities';

const root = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(root, '..', '..');
const mainEntry = path.join(root, 'dist-electron', 'main.js');
const rendererAcceptanceUrl = `${pathToFileURL(path.join(root, 'dist', 'index.html')).toString()}?nimiElectronSdkAcceptance=1`;

test('Electron acceptance matrix maps every standard shell command to e2e or host-unit coverage', async () => {
  const acceptanceSource = await readFile(new URL('./electron-acceptance.mjs', import.meta.url), 'utf8');
  const mainSource = await readFile(path.join(root, 'src-electron', 'main.ts'), 'utf8');
  const electronHostUnitFiles = [
    'electron-agent-center-content-admission.test.ts',
    'electron-agent-center-custody.test.ts',
    'electron-agent-center.test.ts',
    'electron-shell-bridge-core.test.ts',
    'electron-shell-bridge-guardrails.test.ts',
    'electron-shell-bridge-host-features.test.ts',
    'electron-shell-capabilities.test.ts',
    'electron-shell-file-surfaces.test.ts',
    'electron-shell-preload.test.ts',
    'electron-shell-runtime-hardening.test.ts',
    'electron-shell-source-boundaries.test.ts',
  ];
  const electronHostUnitSource = (await Promise.all(electronHostUnitFiles.map((file) =>
    readFile(path.join(repoRoot, 'kit', 'shell', 'electron', 'test', file), 'utf8')
  ))).join('\n');
  assert.doesNotMatch(mainSource, /local-agent:tester-electron-local/);
  const coverageSource = `${acceptanceSource}\n${electronHostUnitSource}`;
  for (const capability of NIMI_STANDARD_SHELL_CAPABILITIES) {
    for (const operation of capability.operations) {
      const key = `${capability.id}.${operation.id}`;
      assert.match(
        coverageSource,
        new RegExp(`NIMI_STANDARD_SHELL_COMMANDS\\[['"]${escapeRegExp(key)}['"]\\]`),
        `standard shell command ${key} must have Electron acceptance or host-unit coverage`,
      );
    }
  }
});

test('Electron acceptance host boots the tester renderer with the narrowed preload bridge', { timeout: 90_000 }, async () => {
  await withTempDir('acceptance', async (tmpRoot) => {
  const dataRoot = path.join(tmpRoot, 'data');

  const app = await electron.launch({
    args: [mainEntry],
    env: {
      ...process.env,
      NIMI_RUNTIME_GRPC_ADDR: '',
      NIMI_TESTER_ELECTRON_RENDERER_URL: rendererAcceptanceUrl,
      NIMI_TESTER_ELECTRON_RUNTIME_ENDPOINT: '127.0.0.1:1',
      NIMI_TESTER_ELECTRON_STANDARD_DATA_ROOT: dataRoot,
      NIMI_TESTER_ELECTRON_STANDARD_LOCAL_ASSET_ROOTS: dataRoot,
      NIMI_REALM_URL: 'http://localhost',
      NIMI_REALM_JWKS_URL: '',
      NIMI_REALM_REVOCATION_URL: '',
      NIMI_REALM_JWT_ISSUER: '',
      NIMI_REALM_JWT_AUDIENCE: '',
      NIMI_REALTIME_URL: 'ws://localhost:3003',
      NIMI_ACCESS_TOKEN: 'acceptance-token',
      NIMI_TARGET_TYPE: 'local',
      NIMI_TARGET_ACCOUNT_ID: 'acceptance-account',
      NIMI_AGENT_ID: 'acceptance-agent',
      NIMI_WORLD_ID: 'acceptance-world',
      NIMI_USER_CONFIRMED_UPLOAD: '1',
    },
  });
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() => Boolean(globalThis.window?.__NIMI_ELECTRON_RUNTIME__));
    const hookKeys = await page.evaluate(() => Object.keys(globalThis.window.__NIMI_ELECTRON_RUNTIME__).sort());
    assert.deepEqual(hookKeys, ['invoke', 'listen']);
    const rawApiPresence = await page.evaluate(() => ({
      ipcRenderer: 'ipcRenderer' in globalThis.window,
      electron: 'electron' in globalThis.window,
      require: 'require' in globalThis.window,
      process: 'process' in globalThis.window,
    }));
    assert.deepEqual(rawApiPresence, {
      ipcRenderer: false,
      electron: false,
      require: false,
      process: false,
    });

    const artifactUnavailable = await captureInvokeError(
      page,
      NIMI_STANDARD_SHELL_COMMANDS['artifacts.readRuntimeBytes'],
      { payload: { artifactId: 'runtime-artifact-acceptance' } },
    );
    assert.equal(artifactUnavailable.code, 'protected-carrier-required');
    assert.equal(artifactUnavailable.reasonCode, 'protected-carrier-required');
    assert.equal(artifactUnavailable.source, 'electron');

    await page.waitForFunction(() => Boolean(globalThis.window?.__NIMI_TESTER_ELECTRON_SDK_ACCEPTANCE__));
    const sdkAcceptanceKeys = await page.evaluate(() =>
      Object.keys(globalThis.window.__NIMI_TESTER_ELECTRON_SDK_ACCEPTANCE__).sort(),
    );
    assert.deepEqual(sdkAcceptanceKeys, [
      'accountProjection',
      'installedArtifactRead',
      'runtimeReady',
      'sharedAuthBroker',
    ]);
    const sdkRuntimeReady = await page.evaluate(() =>
      globalThis.window.__NIMI_TESTER_ELECTRON_SDK_ACCEPTANCE__.runtimeReady(),
    );
    assert.equal(sdkRuntimeReady.transport, 'electron-ipc');
    assert.equal(sdkRuntimeReady.ok, false);
    assert.equal(sdkRuntimeReady.code, 'capability-unavailable');
    assert.equal(sdkRuntimeReady.reasonCode, 'electron-standard-capability-not-in-host-set');
    assert.equal(sdkRuntimeReady.actionHint, 'use_command_admitted_by_electron_standard_shell_capability_set');
    const sdkInstalledArtifact = await page.evaluate(() =>
      globalThis.window.__NIMI_TESTER_ELECTRON_SDK_ACCEPTANCE__.installedArtifactRead(),
    );
    assert.equal(sdkInstalledArtifact.transport, 'electron-ipc');
    assert.equal(sdkInstalledArtifact.ok, false);
    assert.equal(sdkInstalledArtifact.code, 'protected-carrier-required');
    assert.equal(sdkInstalledArtifact.reasonCode, 'protected-carrier-required');
    assert.equal(sdkInstalledArtifact.source, 'electron');
    const sharedAuthBroker = await page.evaluate(() =>
      globalThis.window.__NIMI_TESTER_ELECTRON_SDK_ACCEPTANCE__.sharedAuthBroker(),
    );
    assert.equal(sharedAuthBroker.transport, 'electron-ipc');
    assert.equal(sharedAuthBroker.ok, false);
    assert.equal(sharedAuthBroker.code, 'SDK_RUNTIME_METHOD_UNAVAILABLE');
    assert.equal(sharedAuthBroker.reasonCode, 'SDK_RUNTIME_METHOD_UNAVAILABLE');
    assert.equal(sharedAuthBroker.actionHint, 'use_admitted_protected_runtime_carrier');
    assert.equal(sharedAuthBroker.source, 'sdk');

    for (const commandKey of [
      'runtime-lifecycle.status',
      'diagnostics.rendererEntryProbe',
      'local-agent.identity',
      'local-agent.runtimeTrustedCaller',
      'oauth.openExternalUrl',
      'oauth.tokenExchange',
      'oauth.listenForCode',
      'runtime-defaults.get',
      'config.get',
      'config.set',
    ]) {
      await assertInstalledCapabilityForbidden(page, NIMI_STANDARD_SHELL_COMMANDS[commandKey], commandKey);
    }

    for (const [commandKey, payload] of [
      ['runtime.unary', { payload: { methodId: '/nimi.runtime.v1.RuntimeAuditService/GetRuntimeHealth' } }],
      ['runtime.streamOpen', { payload: { methodId: '/nimi.runtime.v1.RuntimeAccountService/SubscribeAccountSessionEvents' } }],
      ['runtime.streamClose', { streamId: 'acceptance-stream' }],
      ['runtime-lifecycle.start', {}],
      ['runtime-lifecycle.restart', {}],
      ['data.pathResolve', { relativePath: 'settings/profile.json' }],
      ['storage.readJson', { relativePath: 'settings/profile.json' }],
      ['storage.writeJson', { relativePath: 'settings/profile.json', value: {} }],
      ['storage.removeJson', { relativePath: 'settings/profile.json' }],
      ['local-assets.resolveUrl', { relativePath: 'preview.txt' }],
      ['artifacts.write', { relativePath: 'preview.txt', dataBase64: 'YQ==' }],
      ['ai-config.get', { scopeRef: 'tester.scope.chat' }],
      ['ai-config.set', { scopeRef: 'tester.scope.chat', config: {} }],
      ['avatar.assetResolve', {}],
      ['ai-profile.get', {}],
      ['platform-projection.get', {}],
    ]) {
      await assertInstalledCapabilityForbidden(
        page,
        NIMI_STANDARD_SHELL_COMMANDS[commandKey],
        commandKey,
        payload,
      );
    }
    await assertInstalledCapabilityForbidden(
      page,
      NIMI_STANDARD_SHELL_COMMANDS['floating-window.setIgnoreCursorEvents'],
      'floating-window.setIgnoreCursorEvents',
    );

    for (const command of [
      'nimi.shell.auth.session.load',
      'nimi.shell.auth.session.save',
      'nimi.shell.auth.session.clear',
    ]) {
      const error = await captureInvokeError(page, command, {});
      assert.equal(error.code, 'external-daemon-required', command);
      assert.equal(error.reasonCode, 'electron-runtime-account-custody-external', command);
      assert.equal(error.source, 'electron', command);
    }

    await page.waitForFunction(
      () => Boolean(document.body?.innerText.trim()),
      undefined,
      { timeout: 15_000 },
    );
    const domState = await page.evaluate(() => ({
      bodyText: document.body.innerText.trim(),
      rootChildren: document.querySelector('#root')?.childElementCount ?? 0,
      interactiveCount: document.querySelectorAll('button, input, select, textarea, a[href]').length,
    }));
    assert.ok(domState.bodyText.length > 0);
    assert.ok(domState.rootChildren > 0);
    assert.ok(domState.interactiveCount > 0);
    const retryButton = page.getByRole('button', { name: 'Retry Runtime check' });
    assert.equal(await retryButton.isEnabled(), true);
    await retryButton.click();
    await page.waitForFunction(() => document.body?.innerText.includes('Runtime session unavailable'));
    const shellProblems = await page.evaluate(() =>
      globalThis.window.__NIMI_TESTER_SHELL_ACCEPTANCE_PROBLEMS__ ?? [],
    );
    assert.deepEqual(shellProblems, []);
    const artifactDir = String(process.env.NIMI_TESTER_ELECTRON_ACCEPTANCE_ARTIFACT_DIR || '').trim();
    if (artifactDir) {
      await mkdir(artifactDir, { recursive: true });
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.screenshot({ path: path.join(artifactDir, 'tester-electron-desktop.png'), fullPage: true });
      await page.setViewportSize({ width: 720, height: 760 });
      await page.screenshot({ path: path.join(artifactDir, 'tester-electron-narrow.png'), fullPage: true });
    }
  } finally {
    await app.close();
  }
  });
});

async function captureInvokeError(page, command, payload) {
  const errorPayload = await page.evaluate(async ({ command: commandName, payload: commandPayload }) => {
    try {
      await globalThis.window.__NIMI_ELECTRON_RUNTIME__.invoke(commandName, commandPayload);
      return null;
    } catch (error) {
      return {
        code: error?.code,
        reasonCode: error?.reasonCode,
        actionHint: error?.actionHint,
        source: error?.source,
        envelope: error?.envelope,
        message: String(error?.message || error || ''),
      };
    }
  }, { command, payload });
  assert.notEqual(errorPayload, null);
  return errorPayload;
}

async function assertInstalledCapabilityForbidden(page, command, label, payload = {}) {
  const error = await captureInvokeError(page, command, payload);
  assert.equal(error.code, 'capability-unavailable', label);
  assert.equal(error.reasonCode, 'electron-standard-capability-not-in-host-set', label);
  assert.equal(error.source, 'electron', label);
  assert.match(error.message, /installed-nimi-app-standard-shell-v1/, label);
}

async function withTempDir(prefix, run) {
  const dir = await mkdtemp(path.join(tmpdir(), `nimi-tester-electron-${prefix}-`));
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
