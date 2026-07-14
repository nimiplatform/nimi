#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { _electron as electron } from 'playwright';
import { NIMI_STANDARD_SHELL_COMMANDS } from '@nimiplatform/kit/shell/capabilities';

const appRoot = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const electronExecutablePath = resolveElectronExecutablePath();
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
const hostStderr = [];
app.process().stderr?.on('data', (chunk) => {
  const text = String(chunk);
  hostStderr.push(text);
  if (process.env.NIMI_PROTECTED_LOCAL_DIAGNOSTICS === '1') process.stderr.write(text);
});

try {
  const page = await app.firstWindow();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
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
  let productState = await page.locator('[data-product-state]').first()
    .getAttribute('data-product-state')
    .catch(() => null);
  const errorLocator = page.locator('[data-testid="product-first-run-error"], [data-testid="first-run-terminal-error"], [data-testid="product-first-run-finalization-error"]');
  if (surface === 'firstRun' && productState === 'config_missing') {
    await page.waitForFunction(() => {
      const state = globalThis.document.querySelector('[data-product-state]')?.getAttribute('data-product-state');
      const error = globalThis.document.querySelector(
        '[data-testid="product-first-run-error"], [data-testid="first-run-terminal-error"], [data-testid="product-first-run-finalization-error"]',
      );
      return (state && state !== 'config_missing') || Boolean(error);
    }, undefined, { timeout: 20_000 }).catch(() => null);
    productState = await page.locator('[data-product-state]').first()
      .getAttribute('data-product-state')
      .catch(() => null);
  }
  const firstRunError = await errorLocator.count() > 0
    ? await errorLocator.first().innerText()
    : null;
  const firstRunText = surface === 'firstRun'
    ? await page.locator('[data-testid="desktop-first-run-gate"]').innerText()
    : null;
  process.stdout.write(`${JSON.stringify({
    status,
    surface,
    productState,
    firstRunError,
    firstRunText,
    consoleErrors,
    pageErrors,
    hostStderr,
  }, null, 2)}\n`);
} finally {
  await app.close();
}

async function invokeShell(page, commandKey, payload) {
  const outcome = await page.evaluate(async ({ command, commandPayload }) => {
    try {
      return {
        ok: true,
        value: await globalThis.window.__NIMI_ELECTRON_RUNTIME__.invoke(command, commandPayload),
      };
    } catch (error) {
      const record = error && typeof error === 'object' ? error : {};
      return {
        ok: false,
        error: {
          name: typeof record.name === 'string' ? record.name : '',
          message: typeof record.message === 'string' ? record.message : String(error),
          code: typeof record.code === 'string' ? record.code : '',
          reasonCode: typeof record.reasonCode === 'string' ? record.reasonCode : '',
          actionHint: typeof record.actionHint === 'string' ? record.actionHint : '',
        },
      };
    }
  }, {
    command: NIMI_STANDARD_SHELL_COMMANDS[commandKey],
    commandPayload: payload,
  });
  if (!outcome.ok) {
    throw new Error(`Electron shell command ${commandKey} failed: ${JSON.stringify(outcome.error)}`);
  }
  return outcome.value;
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

function resolveElectronExecutablePath() {
  const explicit = normalizeText(process.env.NIMI_DESKTOP_ELECTRON_EXECUTABLE_PATH);
  if (explicit) return path.resolve(explicit);
  if (process.platform === 'win32') {
    throw new Error(
      'Windows fixed-service acceptance requires NIMI_DESKTOP_ELECTRON_EXECUTABLE_PATH ' +
      'pointing at the signed exact-name Desktop Electron host candidate.',
    );
  }
  return require('electron');
}
