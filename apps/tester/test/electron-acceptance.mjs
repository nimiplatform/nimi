import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
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
const localAppNegativeMatrix = [
  { command: NIMI_STANDARD_SHELL_COMMANDS['local-app.sessionStatus'], payload: {} },
  { command: NIMI_STANDARD_SHELL_COMMANDS['local-app.permissionPosture'], payload: { payload: { operationId: 'runtime_agent.conversation.turn.send', resourceRef: 'agent:tester/conversation:acceptance' } } },
  { command: NIMI_STANDARD_SHELL_COMMANDS['local-app.permissionRequest'], payload: { payload: { operationId: 'runtime_agent.conversation.turn.send', resourceRef: 'agent:tester/conversation:acceptance', purpose: 'Plain Electron negative acceptance' } } },
  { command: NIMI_STANDARD_SHELL_COMMANDS['local-app.agentOpenConversation'], payload: { payload: { agentId: 'tester', requestedAnchorDisposition: 'create-or-resume' } } },
  { command: NIMI_STANDARD_SHELL_COMMANDS['local-app.agentSendTurn'], payload: { payload: { agentId: 'tester', conversationAnchorId: 'anchor', clientTurnId: 'turn', userText: 'hello' } } },
  { command: NIMI_STANDARD_SHELL_COMMANDS['local-app.agentSubscribeTurn'], payload: { payload: { agentId: 'tester', conversationAnchorId: 'anchor', cursor: '' } } },
  { command: NIMI_STANDARD_SHELL_COMMANDS['local-app.agentGetConversationSnapshot'], payload: { payload: { agentId: 'tester', conversationAnchorId: 'anchor' } } },
  { command: NIMI_STANDARD_SHELL_COMMANDS['storage.readJson'], payload: { relativePath: 'settings/profile.json' } },
  { command: NIMI_STANDARD_SHELL_COMMANDS['storage.writeJson'], payload: { relativePath: 'settings/profile.json', value: {} } },
  { command: NIMI_STANDARD_SHELL_COMMANDS['storage.removeJson'], payload: { relativePath: 'settings/profile.json' } },
  { command: NIMI_STANDARD_SHELL_COMMANDS['local-app.agentInventory'], payload: {} },
  { command: NIMI_STANDARD_SHELL_COMMANDS['local-app.agentTranscribeVoice'], payload: { payload: { agentId: 'tester', clientRequestId: 'voice-acceptance', audioBase64: 'YQ==', mimeType: 'audio/wav' } } },
  { command: NIMI_STANDARD_SHELL_COMMANDS['local-app.agentSubscribeVoiceStream'], payload: { payload: { agentId: 'tester', conversationAnchorId: 'anchor', turnId: 'turn', voiceStreamId: 'voice-stream', cursor: '' } } },
];

test('Electron acceptance matrix maps every standard shell command to e2e or host-unit coverage', async () => {
  const acceptanceSource = await readFile(new URL('./electron-acceptance.mjs', import.meta.url), 'utf8');
  const mainSource = await readFile(path.join(root, 'src-electron', 'main.ts'), 'utf8');
  const electronHostUnitFiles = (await readdir(path.join(repoRoot, 'kit', 'shell', 'electron', 'test')))
    .filter((file) => file.endsWith('.test.ts'));
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

test('plain Electron boots the narrowed renderer but cannot acquire protected local-app authority', { timeout: 90_000 }, async () => {
  await withTempDir('acceptance', async (tmpRoot) => {
  const app = await electron.launch({
    args: [mainEntry],
    env: {
      ...process.env,
      NIMI_TESTER_ELECTRON_RENDERER_URL: rendererAcceptanceUrl,
    },
  });
  try {
    const page = await app.firstWindow();
    const consoleErrors = [];
    const pageErrors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => pageErrors.push(String(error)));
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
      NIMI_STANDARD_SHELL_COMMANDS['local-app.artifactsReadRuntimeBytes'],
      { payload: { artifactId: 'runtime-artifact-acceptance' } },
    );
    assertUnsupervisedLocalAppDenied(artifactUnavailable);
    for (const row of localAppNegativeMatrix) {
      const denied = await captureInvokeError(page, row.command, row.payload);
      assertUnsupervisedLocalAppDenied(denied);
    }

    await page.waitForFunction(() => Boolean(globalThis.window?.__NIMI_TESTER_ELECTRON_SDK_ACCEPTANCE__));
    const sdkAcceptanceKeys = await page.evaluate(() =>
      Object.keys(globalThis.window.__NIMI_TESTER_ELECTRON_SDK_ACCEPTANCE__).sort(),
    );
    assert.deepEqual(sdkAcceptanceKeys, [
      'localAppArtifactRead',
      'localAppAuthStatus',
      'localAppProjection',
    ]);
    const localAppAuthStatus = await page.evaluate(() =>
      globalThis.window.__NIMI_TESTER_ELECTRON_SDK_ACCEPTANCE__.localAppAuthStatus(),
    );
    assert.equal(localAppAuthStatus.transport, 'electron-ipc');
    assert.equal(localAppAuthStatus.ok, false);
    assertUnsupervisedLocalAppDenied(localAppAuthStatus);
    const sessionReasonCode = localAppAuthStatus.reasonCode;
    const localAppProjection = await page.evaluate(() =>
      globalThis.window.__NIMI_TESTER_ELECTRON_SDK_ACCEPTANCE__.localAppProjection(),
    );
    assert.equal(localAppProjection.transport, 'electron-ipc');
    assert.equal(localAppProjection.ok, true);
    assert.equal(localAppProjection.status, 'action-required');
    assert.deepEqual(localAppProjection.reason, {
      mode: 'local-app',
      reasonCode: sessionReasonCode,
      actionHint: expectedCarrierActionHint(sessionReasonCode),
    });
    const sdkLocalAppArtifact = await page.evaluate(() =>
      globalThis.window.__NIMI_TESTER_ELECTRON_SDK_ACCEPTANCE__.localAppArtifactRead(),
    );
    assert.equal(sdkLocalAppArtifact.transport, 'electron-ipc');
    assert.equal(sdkLocalAppArtifact.ok, false);
    assertUnsupervisedLocalAppDenied(sdkLocalAppArtifact);

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
      await assertLocalAppCapabilityForbidden(page, NIMI_STANDARD_SHELL_COMMANDS[commandKey], commandKey);
    }

    for (const [commandKey, payload] of [
      ['runtime.unary', { payload: { methodId: '/nimi.runtime.v1.RuntimeAuditService/GetRuntimeHealth' } }],
      ['runtime.streamOpen', { payload: { methodId: '/nimi.runtime.v1.RuntimeAccountService/SubscribeAccountSessionEvents' } }],
      ['runtime.streamClose', { streamId: 'acceptance-stream' }],
      ['runtime-lifecycle.start', {}],
      ['runtime-lifecycle.restart', {}],
      ['data.pathResolve', { relativePath: 'settings/profile.json' }],
      ['local-assets.resolveUrl', { relativePath: 'preview.txt' }],
      ['artifacts.write', { relativePath: 'preview.txt', dataBase64: 'YQ==' }],
      ['ai-config.get', { scopeRef: 'tester.scope.chat' }],
      ['ai-config.set', { scopeRef: 'tester.scope.chat', config: {} }],
      ['avatar.assetResolve', {}],
      ['ai-profile.get', {}],
      ['platform-projection.get', {}],
    ]) {
      await assertLocalAppCapabilityForbidden(
        page,
        NIMI_STANDARD_SHELL_COMMANDS[commandKey],
        commandKey,
        payload,
      );
    }
    await assertLocalAppCapabilityForbidden(
      page,
      NIMI_STANDARD_SHELL_COMMANDS['artifacts.readRuntimeBytes'],
      'artifacts.readRuntimeBytes',
      { payload: { artifactId: 'legacy-unadmitted-artifact' } },
    );
    await assertLocalAppCapabilityForbidden(
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
    await page.waitForFunction(() => document.body?.innerText.includes('Nimi Desktop connection required'));
    const visibleCopy = await page.locator('body').innerText();
    assert.match(
      visibleCopy,
      /(?:Open Nimi Desktop, confirm Runtime is available, then retry|Close this process and relaunch the project through Nimi Desktop|Reopen the protected local-app session through Nimi Desktop)\./,
    );
    assert.doesNotMatch(visibleCopy, /open_nimi_desktop_and_retry/);
    const shellProblems = await page.evaluate(() =>
      globalThis.window.__NIMI_TESTER_SHELL_ACCEPTANCE_PROBLEMS__ ?? [],
    );
    assert.deepEqual(shellProblems, []);
    assert.deepEqual(consoleErrors, []);
    assert.deepEqual(pageErrors, []);
    const artifactDir = String(process.env.NIMI_TESTER_ELECTRON_ACCEPTANCE_ARTIFACT_DIR || '').trim();
    await page.setViewportSize({ width: 1280, height: 800 });
    const desktopLayout = await page.evaluate(() => ({
      width: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      buttonEnabled: !document.querySelector('button')?.hasAttribute('disabled'),
    }));
    assert.ok(desktopLayout.scrollWidth <= desktopLayout.width);
    assert.equal(desktopLayout.buttonEnabled, true);
    if (artifactDir) {
      await mkdir(artifactDir, { recursive: true });
      await page.screenshot({ path: path.join(artifactDir, 'tester-electron-desktop.png'), fullPage: true });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    const narrowLayout = await page.evaluate(() => ({
      width: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      bodyText: document.body.innerText,
    }));
    assert.ok(narrowLayout.scrollWidth <= narrowLayout.width);
    assert.match(narrowLayout.bodyText, /Nimi Desktop connection required/);
    if (artifactDir) {
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

function assertUnsupervisedLocalAppDenied(error) {
  assert.ok([
    'runtime-service-unavailable',
    'runtime-service-untrusted',
    'runtime-unauthenticated',
  ].includes(error.reasonCode), `unexpected unsupervised carrier reason: ${error.reasonCode}`);
  assert.equal(error.code, error.reasonCode);
  assert.ok(['electron', 'runtime'].includes(error.source), `unexpected carrier error source: ${error.source}`);
}

function expectedCarrierActionHint(reasonCode) {
  if (reasonCode === 'runtime-service-untrusted') return 'restart_through_verified_desktop_supervisor';
  if (reasonCode === 'runtime-unauthenticated') return 'reopen_local_app_session';
  return 'start_fixed_runtime_service';
}

async function assertLocalAppCapabilityForbidden(page, command, label, payload = {}) {
  const error = await captureInvokeError(page, command, payload);
  assert.equal(error.code, 'capability-unavailable', label);
  assert.equal(error.reasonCode, 'electron-standard-capability-not-in-host-set', label);
  assert.equal(error.source, 'electron', label);
  assert.match(error.message, /local-app-standard-shell-v1/, label);
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
