#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { _electron as electron } from 'playwright';
import { NIMI_STANDARD_SHELL_COMMANDS } from '@nimiplatform/kit/shell/capabilities';

const appRoot = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const electronExecutablePath = require('electron');
const mainEntry = path.join(appRoot, 'dist-electron', 'main.js');
const rendererLiveUrl = `${pathToFileURL(path.join(appRoot, 'dist', 'index.html')).toString()}?nimiDesktopElectronLiveAcceptance=1`;
const expectedSurface = normalizeText(process.env.NIMI_DESKTOP_ELECTRON_LIVE_EXPECT_SURFACE) || 'main';
const runtimeEndpoint = normalizeText(process.env.NIMI_RUNTIME_GRPC_ADDR)
  || normalizeText(process.env.NIMI_DESKTOP_ELECTRON_RUNTIME_ENDPOINT)
  || '127.0.0.1:46371';

const app = await electron.launch({
  executablePath: electronExecutablePath,
  args: [mainEntry],
  env: {
    ...process.env,
    NIMI_DESKTOP_ELECTRON_RENDERER_URL: normalizeText(process.env.NIMI_DESKTOP_ELECTRON_RENDERER_URL) || rendererLiveUrl,
    NIMI_DESKTOP_ELECTRON_RUNTIME_ENDPOINT: runtimeEndpoint,
  },
});

try {
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => Boolean(globalThis.window?.__NIMI_ELECTRON_RUNTIME__));

  const status = await invokeShell(page, 'runtime-lifecycle.status', {});
  assert.equal(status.running, true);
  assert.equal(status.grpcAddr, runtimeEndpoint);

  const surface = await waitForDesktopRendererSurface(page);
  if (surface === 'error') {
    const bodyText = await page.locator('body').innerText().catch(() => '');
    assert.fail(`Desktop Electron live Runtime bootstrap failed:\n${bodyText}`);
  }
  assert.equal(
    surface,
    expectedSurface,
    `Desktop Electron live Runtime expected ${expectedSurface}; got ${surface}. ` +
      'Set NIMI_DESKTOP_ELECTRON_LIVE_EXPECT_SURFACE when intentionally validating another admitted surface.',
  );
} finally {
  await app.close();
}

async function invokeShell(page, commandKey, payload) {
  return page.evaluate(async ({ command, commandPayload }) => {
    return globalThis.window.__NIMI_ELECTRON_RUNTIME__.invoke(command, commandPayload);
  }, {
    command: NIMI_STANDARD_SHELL_COMMANDS[commandKey],
    commandPayload: payload,
  });
}

async function waitForDesktopRendererSurface(page) {
  const handle = await page.waitForFunction((selectors) => {
    for (const [surface, selector] of Object.entries(selectors)) {
      // eslint-disable-next-line no-undef
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
  }, { timeout: 60_000 });
  return handle.jsonValue();
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}
