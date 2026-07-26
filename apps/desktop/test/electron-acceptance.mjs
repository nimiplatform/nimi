import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
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

test('unsigned Desktop Electron fails closed without the protected carrier while non-authorizing app-owned surfaces remain available', {
  timeout: 90_000,
  skip: process.platform === 'darwin'
    ? 'macOS CDP is admitted only on the installed signed acceptance carrier'
    : false,
}, async () => {
  await withTempDir('acceptance', async (tmpRoot) => {
    const staleAppOwnedDataRoot = path.join(tmpRoot, 'stale-app-owned-data');
    const assetRoot = path.join(tmpRoot, 'assets');
    const assetPath = path.join(assetRoot, 'preview.txt');
    // Deliberate negative canary: this retired app-owned path must never become
    // Runtime config or Product Control authority.
    const runtimeConfigPath = path.join(staleAppOwnedDataRoot, 'runtime', 'config.json');
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
      env: acceptanceEnvironment({
        NIMI_DESKTOP_ELECTRON_RENDERER_URL: rendererAcceptanceUrl,
        NIMI_DESKTOP_ELECTRON_STANDARD_LOCAL_ASSET_ROOTS: assetRoot,
        NIMI_REALM_URL: 'http://localhost',
        NIMI_REALTIME_URL: 'ws://localhost:3003',
      }),
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
      assert.equal(rendererBootstrapSurface, 'error');
      assert.match(await page.locator('body').innerText(), /Startup failed[\s\S]*protected-carrier-required/u);

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
          jwksUrl: 'http://localhost:3002/api/auth/jwks',
          revocationUrl: 'http://localhost:3002/api/auth/sessions/introspect',
          jwtIssuer: 'http://localhost:3002',
          jwtAudience: 'nimi-runtime',
        },
        runtime: {
          targetType: '',
          targetAccountId: '',
          agentId: '',
          worldId: '',
          userConfirmedUpload: false,
        },
      });

      const statusError = await captureInvokeError(page, 'runtime-lifecycle.status', {});
      assert.equal(statusError.code, 'protected-carrier-required');
      assert.equal(statusError.reasonCode, 'protected-carrier-required');
      assert.equal(statusError.actionHint, 'repair_fixed_runtime_service');

      const runtimeConfigError = await captureInvokeError(page, 'config.get', {});
      assert.equal(runtimeConfigError.code, 'capability-unavailable');
      assert.equal(runtimeConfigError.reasonCode, 'electron-standard-capability-unavailable');

      const localAgentIdentityError = await captureInvokeError(page, 'local-agent.identity', {});
      assert.equal(localAgentIdentityError.code, 'capability-unavailable');
      assert.equal(localAgentIdentityError.reasonCode, 'electron-standard-capability-unavailable');

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

      const oauthForbidden = await captureInvokeError(page, 'oauth.openExternalUrl', {
        payload: { url: 'http://evil.example.test/authorize' },
      });
      assert.equal(oauthForbidden.code, 'forbidden-renderer-access');
      assert.equal(oauthForbidden.reasonCode, 'electron-oauth-external-url-not-allowed');

      for (const command of [
        'nimi.shell.auth.session.load',
        'nimi.shell.auth.session.save',
        'nimi.shell.auth.session.clear',
      ]) {
        const error = await page.evaluate(async ({ retiredCommand }) => {
          try {
            await globalThis.window.__NIMI_ELECTRON_RUNTIME__.invoke(retiredCommand, {});
            return null;
          } catch (caught) {
            return {
              code: caught?.code,
              reasonCode: caught?.reasonCode,
              source: caught?.source,
            };
          }
        }, { retiredCommand: command });
        assert.equal(error.code, 'invalid-payload', command);
        assert.equal(error.reasonCode, 'unsupported-electron-shell-command', command);
        assert.equal(error.source, 'electron', command);
      }

      const dataPathError = await captureInvokeError(page, 'data.pathResolve', {
        relativePath: 'settings/profile.json',
      });
      assert.equal(dataPathError.code, 'capability-unavailable');
      assert.equal(dataPathError.reasonCode, 'electron-product-control-data-root-unavailable');
      assert.equal(dataPathError.actionHint, 'complete_or_repair_canonical_product_control');

      const storageWriteError = await captureInvokeError(page, 'storage.writeJson', {
        relativePath: 'settings/profile.json',
        value: { schemaVersion: 1, shell: 'electron-desktop' },
      });
      assert.equal(storageWriteError.code, 'capability-unavailable');
      assert.equal(storageWriteError.reasonCode, 'electron-product-control-data-root-unavailable');

      const storageReadError = await captureInvokeError(page, 'storage.readJson', {
        relativePath: 'settings/profile.json',
      });
      assert.equal(storageReadError.code, 'capability-unavailable');
      assert.equal(storageReadError.reasonCode, 'electron-product-control-data-root-unavailable');

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

      const aiConfigError = await captureInvokeError(page, 'ai-config.get', {
        scopeRef: 'desktop.scope.chat',
      });
      assert.equal(aiConfigError.code, 'capability-unavailable');
      assert.equal(aiConfigError.reasonCode, 'electron-product-control-data-root-unavailable');

      const focusResult = await invokeShell(page, 'shell-ui.focusMainWindow', {});
      assert.deepEqual(focusResult, {});
    } finally {
      await app.close();
    }
  });
});

test('Desktop Electron config.get cannot fall back to an app-owned runtime config file', {
  timeout: 90_000,
  skip: process.platform === 'darwin'
    ? 'macOS CDP is admitted only on the installed signed acceptance carrier'
    : false,
}, async () => {
  await withTempDir('missing-config', async () => {
    const app = await electron.launch({
      executablePath: electronExecutablePath,
      args: [mainEntry],
      env: acceptanceEnvironment({
        NIMI_DESKTOP_ELECTRON_RENDERER_URL: rendererAcceptanceUrl,
      }),
    });
    try {
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForFunction(() => Boolean(globalThis.window?.__NIMI_ELECTRON_RUNTIME__));

      const missingConfig = await captureInvokeError(page, 'config.get', {});
      assert.equal(missingConfig.code, 'capability-unavailable');
      assert.equal(missingConfig.reasonCode, 'electron-standard-capability-unavailable');
      assert.equal(missingConfig.actionHint, 'provide_electron_standard_shell_capability_handler');
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
  return surface;
}

function acceptanceEnvironment(overrides) {
  return Object.fromEntries(Object.entries({
    HOME: process.env.HOME,
    LANG: process.env.LANG || 'en_US.UTF-8',
    PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
    TMPDIR: '/private/tmp',
    ...overrides,
  }).filter(([, value]) => typeof value === 'string' && value.length > 0));
}

async function withTempDir(prefix, run) {
  // Canonicalize the temp root so assertions match the kit standard shell host,
  // which resolves the Runtime-attested data root through realpath (on macOS
  // tmpdir() is the /var -> /private/var symlink).
  const dir = await realpath(await mkdtemp(path.join(tmpdir(), `nimi-desktop-electron-${prefix}-`)));
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
