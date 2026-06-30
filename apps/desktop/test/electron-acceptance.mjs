import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { _electron as electron } from 'playwright';
import { NIMI_STANDARD_SHELL_COMMANDS } from '@nimiplatform/kit/shell/capabilities';

const root = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const electronExecutablePath = require('electron');
const mainEntry = path.join(root, 'dist-electron', 'main.js');
const rendererAcceptanceUrl = `${pathToFileURL(path.join(root, 'dist', 'index.html')).toString()}?nimiDesktopElectronAcceptance=1`;

test('Desktop Electron shell boots the Desktop renderer with auth and standard shell bridge coverage', { timeout: 90_000 }, async () => {
  await withTempDir('acceptance', async (tmpRoot) => {
    const dataRoot = path.join(tmpRoot, 'data');
    const assetRoot = path.join(tmpRoot, 'assets');
    const openedUrlsPath = path.join(tmpRoot, 'opened-urls.txt');
    const assetPath = path.join(assetRoot, 'preview.txt');
    const runtimeConfigPath = path.join(dataRoot, 'runtime', 'config.json');
    await mkdir(assetRoot, { recursive: true });
    await mkdir(path.dirname(runtimeConfigPath), { recursive: true });
    await writeFile(assetPath, 'desktop asset preview', 'utf8');
    await writeFile(runtimeConfigPath, JSON.stringify({
      schemaVersion: 1,
      grpcAddr: '127.0.0.1:1',
      source: 'desktop-electron-acceptance',
    }, null, 2), 'utf8');

    const app = await electron.launch({
      executablePath: electronExecutablePath,
      args: [mainEntry],
      env: {
        ...process.env,
        NIMI_RUNTIME_GRPC_ADDR: '',
        NIMI_DESKTOP_ELECTRON_RENDERER_URL: rendererAcceptanceUrl,
        NIMI_DESKTOP_ELECTRON_RUNTIME_ENDPOINT: '127.0.0.1:1',
        NIMI_DESKTOP_ELECTRON_STANDARD_DATA_ROOT: dataRoot,
        NIMI_DESKTOP_ELECTRON_STANDARD_LOCAL_ASSET_ROOTS: assetRoot,
        NIMI_DESKTOP_ELECTRON_OPEN_EXTERNAL_CAPTURE_FILE: openedUrlsPath,
        NIMI_REALM_URL: 'http://localhost',
        NIMI_REALM_JWKS_URL: '',
        NIMI_REALM_REVOCATION_URL: '',
        NIMI_REALM_JWT_ISSUER: '',
        NIMI_REALM_JWT_AUDIENCE: '',
        NIMI_REALTIME_URL: 'ws://localhost:3003',
        NIMI_ACCESS_TOKEN: 'desktop-acceptance-token',
        NIMI_TARGET_TYPE: 'local',
        NIMI_TARGET_ACCOUNT_ID: 'desktop-acceptance-account',
        NIMI_AGENT_ID: 'desktop-acceptance-agent',
        NIMI_WORLD_ID: 'desktop-acceptance-world',
        NIMI_USER_CONFIRMED_UPLOAD: '1',
        NIMI_DESKTOP_ELECTRON_LOCAL_AGENT_OWNER_USER_ID: 'desktop-owner',
        NIMI_DESKTOP_ELECTRON_LOCAL_AGENT_RUNTIME_SOURCE_REF: 'desktop-runtime-source',
        NIMI_DESKTOP_ELECTRON_LOCAL_AGENT_REF: 'local-agent:desktop-acceptance-agent',
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

      const rendererBootstrapSurface = await waitForDesktopRendererBootstrapSurface(page);
      assert.equal(rendererBootstrapSurface, 'login');
      const loginScreen = page.getByTestId('login-screen');
      assert.equal(await loginScreen.getAttribute('data-auth-mode'), 'desktop-browser');
      await page.getByTestId('login-logo-trigger').click();
      await page.getByText(/Runtime account service is unavailable|external Runtime daemon/i).waitFor({
        state: 'visible',
        timeout: 10_000,
      });
      assert.doesNotMatch(await page.locator('body').innerText(), /Authentication failed\. Please try again\./);

      const diagnosticsProbe = await invokeShell(page, 'diagnostics.rendererEntryProbe', { stage: 'desktop-electron-acceptance' });
      assert.equal(diagnosticsProbe.ok, true);
      assert.equal(diagnosticsProbe.source, 'electron');
      assert.equal(diagnosticsProbe.appId, 'nimi.desktop');
      assert.equal(diagnosticsProbe.stage, 'desktop-electron-acceptance');
      assert.equal(diagnosticsProbe.origin, 'file://');
      assert.match(String(diagnosticsProbe.url || ''), /dist\/index\.html|dist\\index\.html/);

      const runtimeDefaults = await invokeShell(page, 'runtime-defaults.get', {});
      assert.deepEqual(runtimeDefaults, {
        realm: {
          realmBaseUrl: 'http://localhost:3002',
          realtimeUrl: 'ws://localhost:3003',
          accessToken: 'desktop-acceptance-token',
          jwksUrl: 'http://localhost:3002/api/auth/jwks',
          revocationUrl: 'http://localhost:3002/api/auth/sessions/introspect',
          jwtIssuer: 'http://localhost:3002',
          jwtAudience: 'nimi-runtime',
        },
        runtime: {
          targetType: 'local',
          targetAccountId: 'desktop-acceptance-account',
          agentId: 'desktop-acceptance-agent',
          worldId: 'desktop-acceptance-world',
          userConfirmedUpload: true,
        },
      });

      const statusError = await captureInvokeError(page, 'runtime-lifecycle.status', {});
      assert.equal(statusError.code, 'external-daemon-required');
      assert.equal(statusError.reasonCode, 'electron-runtime-endpoint-unavailable');
      assert.equal(statusError.actionHint, 'start_external_runtime_daemon');

      const runtimeConfig = await invokeShell(page, 'config.get', {});
      assert.deepEqual(runtimeConfig, {
        path: runtimeConfigPath,
        config: {
          schemaVersion: 1,
          grpcAddr: '127.0.0.1:1',
          source: 'desktop-electron-acceptance',
        },
      });

      const localAgentIdentity = await invokeShell(page, 'local-agent.identity', {});
      assert.deepEqual(localAgentIdentity, {
        ownerUserId: 'desktop-owner',
        runtimeSourceRef: 'desktop-runtime-source',
        localAgentRef: 'local-agent:desktop-acceptance-agent',
      });

      const trustedCaller = await invokeShell(page, 'local-agent.runtimeTrustedCaller', {});
      assert.deepEqual(trustedCaller, {
        appId: 'nimi.desktop',
        appInstanceId: 'nimi.desktop.local-first-party',
        deviceId: 'desktop-shell',
        mode: 2,
        scopes: [],
      });

      const spoofedCaller = await captureInvokeError(page, 'local-agent.runtimeTrustedCaller', { appId: 'renderer-spoof' });
      assert.equal(spoofedCaller.code, 'forbidden-renderer-access');
      assert.equal(spoofedCaller.reasonCode, 'electron-renderer-local-agent-caller-field-forbidden');

      const oauthOpen = await invokeShell(page, 'oauth.openExternalUrl', {
        payload: { url: 'https://auth.example.test/authorize' },
      });
      assert.deepEqual(oauthOpen, { opened: true });
      assert.equal(await readFile(openedUrlsPath, 'utf8'), 'https://auth.example.test/authorize\n');

      const oauthForbidden = await captureInvokeError(page, 'oauth.openExternalUrl', {
        payload: { url: 'http://evil.example.test/authorize' },
      });
      assert.equal(oauthForbidden.code, 'forbidden-renderer-access');
      assert.equal(oauthForbidden.reasonCode, 'electron-oauth-external-url-not-allowed');

      for (const commandKey of ['auth.sessionLoad', 'auth.sessionSave', 'auth.sessionClear']) {
        const error = await captureInvokeError(page, commandKey, {});
        assert.equal(error.code, 'external-daemon-required', commandKey);
        assert.equal(error.reasonCode, 'electron-runtime-account-custody-external', commandKey);
        assert.equal(error.source, 'electron', commandKey);
      }

      const dataPath = await invokeShell(page, 'data.pathResolve', { relativePath: 'settings/profile.json' });
      assert.equal(dataPath.path, path.join(dataRoot, 'settings', 'profile.json'));

      const storageWrite = await invokeShell(page, 'storage.writeJson', {
        relativePath: 'settings/profile.json',
        value: { schemaVersion: 1, shell: 'electron-desktop' },
      });
      assert.equal(storageWrite.path, path.join(dataRoot, 'settings', 'profile.json'));
      assert.deepEqual(storageWrite.value, { schemaVersion: 1, shell: 'electron-desktop' });

      const storageRead = await invokeShell(page, 'storage.readJson', { relativePath: 'settings/profile.json' });
      assert.deepEqual(storageRead, {
        path: path.join(dataRoot, 'settings', 'profile.json'),
        value: { schemaVersion: 1, shell: 'electron-desktop' },
      });

      const assetResult = await page.evaluate(async ({ command, assetPath: inputPath }) => {
        const result = await globalThis.window.__NIMI_ELECTRON_RUNTIME__.invoke(command, { path: inputPath });
        const response = await fetch(result.url);
        return {
          path: result.path,
          url: result.url,
          fetchOk: response.ok,
          body: await response.text(),
        };
      }, {
        command: NIMI_STANDARD_SHELL_COMMANDS['local-assets.resolveUrl'],
        assetPath,
      });
      assert.equal(assetResult.path, assetPath);
      assert.match(assetResult.url, /^nimi-shell-file:\//);
      assert.equal(assetResult.fetchOk, true);
      assert.equal(assetResult.body, 'desktop asset preview');

      const avatarAssetResult = await page.evaluate(async ({ command, assetPath: inputPath }) => {
        const result = await globalThis.window.__NIMI_ELECTRON_RUNTIME__.invoke(command, { path: inputPath });
        const response = await fetch(result.url);
        return {
          path: result.path,
          url: result.url,
          fetchOk: response.ok,
          body: await response.text(),
        };
      }, {
        command: NIMI_STANDARD_SHELL_COMMANDS['avatar.assetResolve'],
        assetPath,
      });
      assert.deepEqual(avatarAssetResult, assetResult);

      const missingAiConfig = await captureInvokeError(page, 'ai-config.get', { scopeRef: 'desktop.scope.chat' });
      assert.equal(missingAiConfig.code, 'not-found');
      assert.equal(missingAiConfig.reasonCode, 'electron-ai-config-scope-not-found');

      const aiConfig = {
        schemaVersion: 1,
        scopeRef: 'desktop.scope.chat',
        profileOrigin: { kind: 'factory-profile', alias: 'local-gpu' },
        capabilities: {
          targetRefs: {
            'text.generate': { kind: 'local-runtime', readinessRef: 'execution:desktop-electron-acceptance' },
          },
        },
      };
      const aiConfigSet = await invokeShell(page, 'ai-config.set', {
        scopeRef: 'desktop.scope.chat',
        config: aiConfig,
      });
      assert.deepEqual(aiConfigSet, {
        scopeRef: 'desktop.scope.chat',
        config: aiConfig,
      });
      const aiConfigGet = await invokeShell(page, 'ai-config.get', { scopeRef: 'desktop.scope.chat' });
      assert.deepEqual(aiConfigGet, {
        scopeRef: 'desktop.scope.chat',
        config: aiConfig,
      });

      const focusResult = await invokeShell(page, 'shell-ui.focusMainWindow', {});
      assert.deepEqual(focusResult, {});
    } finally {
      await app.close();
    }
  });
});

test('Desktop Electron config.get fails closed with standard not-found when runtime config is absent', { timeout: 90_000 }, async () => {
  await withTempDir('missing-config', async (tmpRoot) => {
    const dataRoot = path.join(tmpRoot, 'data');
    const app = await electron.launch({
      executablePath: electronExecutablePath,
      args: [mainEntry],
      env: {
        ...process.env,
        NIMI_RUNTIME_GRPC_ADDR: '',
        NIMI_DESKTOP_ELECTRON_RENDERER_URL: rendererAcceptanceUrl,
        NIMI_DESKTOP_ELECTRON_RUNTIME_ENDPOINT: '127.0.0.1:1',
        NIMI_DESKTOP_ELECTRON_STANDARD_DATA_ROOT: dataRoot,
      },
    });
    try {
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForFunction(() => Boolean(globalThis.window?.__NIMI_ELECTRON_RUNTIME__));

      const missingConfig = await captureInvokeError(page, 'config.get', {});
      assert.equal(missingConfig.code, 'not-found');
      assert.equal(missingConfig.reasonCode, 'electron-runtime-config-not-found');
      assert.equal(missingConfig.actionHint, 'create_or_select_runtime_config');
      assert.equal(missingConfig.source, 'electron');
    } finally {
      await app.close();
    }
  });
});

async function invokeShell(page, commandKey, payload) {
  return page.evaluate(async ({ command, commandPayload }) => {
    return globalThis.window.__NIMI_ELECTRON_RUNTIME__.invoke(command, commandPayload);
  }, {
    command: NIMI_STANDARD_SHELL_COMMANDS[commandKey],
    commandPayload: payload,
  });
}

async function captureInvokeError(page, commandKey, payload) {
  const errorPayload = await page.evaluate(async ({ command, commandPayload }) => {
    try {
      await globalThis.window.__NIMI_ELECTRON_RUNTIME__.invoke(command, commandPayload);
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
  }, {
    command: NIMI_STANDARD_SHELL_COMMANDS[commandKey],
    commandPayload: payload,
  });
  assert.notEqual(errorPayload, null);
  return errorPayload;
}

async function waitForDesktopRendererBootstrapSurface(page) {
  const handle = await page.waitForFunction((selectors) => {
    for (const [surface, selector] of Object.entries(selectors)) {
      if (document.querySelector(selector)) {
        return surface;
      }
    }
    return null;
  }, {
    error: '[data-testid="app-bootstrap-error-screen"]',
    login: '[data-testid="login-screen"]',
    main: '[data-testid="main-shell"]',
    firstRun: '[data-testid="desktop-first-run-gate"]',
    admissionFailed: '[data-testid="desktop-admission-failed"]',
  }, { timeout: 45_000 });
  const surface = await handle.jsonValue();
  if (surface === 'error') {
    const bodyText = await page.locator('body').innerText().catch(() => '');
    assert.fail(`Desktop Electron renderer bootstrap failed:\n${bodyText}`);
  }
  return surface;
}

async function withTempDir(prefix, run) {
  const dir = await mkdtemp(path.join(tmpdir(), `nimi-desktop-electron-${prefix}-`));
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
