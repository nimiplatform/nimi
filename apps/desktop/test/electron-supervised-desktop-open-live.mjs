import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { _electron as electron, chromium } from 'playwright';

import { startRealmFixtureServer } from '../e2e/fixtures/realm-fixture-server.mjs';
import { createRealmFixtureManifest } from '../scripts/explore-materialization-acceptance/acceptance-fixture.mjs';

const desktopRoot = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(desktopRoot, '../..');
const evidenceRoot = path.resolve(
  process.env.NIMI_DESKTOP_OPEN_LIVE_EVIDENCE_ROOT
    || path.join(repoRoot, '.nimi/local/acceptance/desktop-open-electron-playwright'),
);
const desktopDataRoot = path.join(evidenceRoot, 'desktop-data');
const zhiyuDataRoot = path.join(evidenceRoot, 'zhiyu-data');
const desktopRequire = createRequire(path.join(desktopRoot, 'package.json'));
const electronVersion = desktopRequire('electron/package.json').version;
const executablePath = path.join(
  repoRoot,
  '.nimi/local/electron-desktop-runtime',
  electronVersion,
  'Nimi Desktop Runtime.exe',
);
const mainEntry = path.join(desktopRoot, 'dist-electron/main.js');
const zhiyuCdpPort = 19472;
const zhiyuCdpTimeoutMs = Number(process.env.NIMI_DESKTOP_OPEN_LIVE_CDP_TIMEOUT_MS || 90_000);
const desktopReadyTimeoutMs = Number(
  process.env.NIMI_DESKTOP_OPEN_LIVE_READY_TIMEOUT_MS || 45 * 60_000,
);
const expectedDataRoot = String(
  process.env.NIMI_DESKTOP_OPEN_LIVE_EXPECTED_DATA_ROOT || '',
).trim();

fs.mkdirSync(desktopDataRoot, { recursive: true });
fs.mkdirSync(zhiyuDataRoot, { recursive: true });
runBundleMode('--acceptance');

let launcher;
let app;
let fixture;
let zhiyuBrowser;
const launcherOutput = [];
const desktopConsoleErrors = [];
const zhiyuConsoleErrors = [];
let acceptanceError;

try {
  const fixtureManifest = createRealmFixtureManifest('http://127.0.0.1:19443');
  fixtureManifest.scenarioId = 'dev-kernel-checkpoint.supervised-desktop-open';
  const fixtureManifestPath = path.join(evidenceRoot, 'realm-fixture-manifest.json');
  fs.writeFileSync(fixtureManifestPath, `${JSON.stringify(fixtureManifest, null, 2)}\n`, { mode: 0o600 });
  fixture = await startRealmFixtureServer({
    manifestPath: fixtureManifestPath,
    host: '127.0.0.1',
    port: 19443,
  });
  app = await electron.launch({
    executablePath,
    args: [mainEntry],
    cwd: desktopRoot,
    env: {
      ...process.env,
      NIMI_DEV_KERNEL_CHECKPOINT: '1',
      NIMI_LOCAL_AGENT_PRODUCT_ZHIYU_CDP_PORT: String(zhiyuCdpPort),
      NIMI_LOCAL_AGENT_PRODUCT_ZHIYU_USER_DATA_ROOT: zhiyuDataRoot,
      NIMI_DESKTOP_ELECTRON_STANDARD_DATA_ROOT: path.join(desktopDataRoot, 'standard-shell-data'),
      NIMI_DESKTOP_ELECTRON_STANDARD_LOCAL_ASSET_ROOTS: path.join(desktopDataRoot, 'standard-shell-data'),
    },
  });
  const desktopPage = await app.firstWindow();
  collectConsoleErrors(desktopPage, desktopConsoleErrors);
  await desktopPage.waitForLoadState('domcontentloaded');
  await waitForDesktopReady(desktopPage);
  const developerMode = await ensureDeveloperModeEnabled(desktopPage);

  launcher = spawn('cmd.exe', ['/d', '/s', '/c', 'pnpm dev:electron:zhiyu'], {
    cwd: repoRoot,
    env: process.env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (const stream of [launcher.stdout, launcher.stderr]) {
    stream.on('data', (chunk) => launcherOutput.push(chunk.toString('utf8')));
  }

  const approval = await approveLocalDevelopmentIfRequested(
    desktopPage,
    zhiyuCdpPort,
    launcher,
    launcherOutput,
  );
  await waitForCdp(zhiyuCdpPort, launcher, launcherOutput, zhiyuCdpTimeoutMs, desktopPage);
  zhiyuBrowser = await chromium.connectOverCDP(`http://127.0.0.1:${zhiyuCdpPort}`);
  const zhiyuPages = zhiyuBrowser.contexts().flatMap((context) => context.pages());
  assert.equal(zhiyuPages.length, 1, `expected one Zhiyu page, got ${zhiyuPages.length}`);
  const zhiyuPage = zhiyuPages[0];
  collectConsoleErrors(zhiyuPage, zhiyuConsoleErrors);
  await zhiyuPage.getByRole('button', { name: '去探索伙伴', exact: true }).waitFor({ timeout: 30_000 });

  await desktopPage.getByRole('button', { name: 'Explore', exact: true }).click();
  await desktopPage.getByRole('tab', { name: 'Worlds', exact: true }).click();
  await desktopPage.getByRole('heading', { name: 'Explore worlds', exact: true }).waitFor();
  await zhiyuPage.bringToFront();
  await zhiyuPage.getByRole('button', { name: '去探索伙伴', exact: true }).click();

  const feedback = zhiyuPage.getByText(/Nimi 桌面端已接收请求/u);
  await feedback.waitFor({ timeout: 15_000 });
  const personasHeading = desktopPage.getByRole('heading', { name: 'Personas', exact: true });
  await personasHeading.waitFor({ timeout: 15_000 });
  await desktopPage.getByText('Realm Database Persona Witness', { exact: true }).waitFor({ timeout: 15_000 });
  const windows = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((window) => ({
    title: window.getTitle(),
    focused: window.isFocused(),
    visible: window.isVisible(),
    minimized: window.isMinimized(),
  })));

  assert.equal(windows.length, 1);
  assert.equal(windows[0].focused, true, JSON.stringify(windows));
  await desktopPage.screenshot({ path: path.join(evidenceRoot, 'desktop-personas.png') });
  await zhiyuPage.screenshot({ path: path.join(evidenceRoot, 'zhiyu-accepted.png') });

  const result = {
    status: desktopConsoleErrors.length === 0 && zhiyuConsoleErrors.length === 0
      ? 'passed'
      : 'failed-console-cleanliness',
    desktop: {
      windows,
      heading: await personasHeading.innerText(),
      developerMode,
    },
    zhiyu: {
      feedback: await feedback.innerText(),
      approval,
    },
    console: {
      desktopErrors: desktopConsoleErrors,
      zhiyuErrors: zhiyuConsoleErrors,
    },
  };
  fs.writeFileSync(path.join(evidenceRoot, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  assert.deepEqual(desktopConsoleErrors, []);
  assert.deepEqual(zhiyuConsoleErrors, []);
} catch (error) {
  acceptanceError = error;
} finally {
  await zhiyuBrowser?.close().catch(() => undefined);
  await app?.close().catch(() => undefined);
  await fixture?.close().catch(() => undefined);
  terminateProcessTree(launcher);
  const restore = runBundleMode();
  if (restore.status !== 0 && !acceptanceError) {
    acceptanceError = new Error('failed to restore ordinary Electron main bundle');
  }
}

if (acceptanceError) throw acceptanceError;

function collectConsoleErrors(page, output) {
  page.on('console', (message) => {
    if (message.type() === 'error') {
      output.push(JSON.stringify({
        kind: 'console',
        text: message.text(),
        location: message.location(),
      }));
    }
  });
  page.on('pageerror', (error) => output.push(`pageerror:${error.message}`));
  page.on('requestfailed', (request) => output.push(JSON.stringify({
    kind: 'requestfailed',
    url: request.url(),
    failure: request.failure(),
  })));
}

async function waitForDesktopReady(desktopPage) {
  try {
    await completeFirstRunIfNeeded(desktopPage);
    await desktopPage.getByRole('button', { name: 'Explore', exact: true }).waitFor({
      timeout: desktopReadyTimeoutMs,
    });
  } catch (error) {
    const screenshotPath = path.join(evidenceRoot, 'desktop-not-ready.png');
    await desktopPage.screenshot({ path: screenshotPath, fullPage: true });
    const diagnostic = await desktopPage.evaluate(async () => ({
      title: document.title,
      bodyText: document.body?.innerText || '',
      location: globalThis.location.href,
      productControl: await globalThis.window.__NIMI_ELECTRON_RUNTIME__.invoke(
        'product_control_record_get',
        {},
      ).catch((invokeError) => ({ error: String(invokeError) })),
      localAuthorizations: await globalThis.window.__NIMI_ELECTRON_RUNTIME__.invoke(
        'local_development_authorizations_list',
        {},
      ).catch((invokeError) => ({ error: String(invokeError) })),
    }));
    fs.writeFileSync(
      path.join(evidenceRoot, 'desktop-not-ready.json'),
      `${JSON.stringify(diagnostic, null, 2)}\n`,
    );
    throw new Error(
      `Desktop did not reach the ordinary shell: ${error.message}\n`
      + `Diagnostic: ${JSON.stringify(diagnostic, null, 2)}\n`
      + `Screenshot: ${screenshotPath}`,
      { cause: error },
    );
  }
}

async function completeFirstRunIfNeeded(desktopPage) {
  await desktopPage.waitForFunction(() => {
    const visible = (testId) => {
      const element = document.querySelector(`[data-testid="${testId}"]`);
      return element instanceof HTMLElement && element.offsetParent !== null;
    };
    return visible('first-run-phase-storage')
      || visible('first-run-phase-setup')
      || visible('login-screen')
      || visible('main-shell');
  }, undefined, { timeout: 60_000 });
  const storagePhase = desktopPage.getByTestId('first-run-phase-storage');
  if (await storagePhase.isVisible().catch(() => false)) {
    await desktopPage.screenshot({ path: path.join(evidenceRoot, 'desktop-first-run-storage.png') });
    assert.notEqual(
      expectedDataRoot,
      '',
      'First Run storage requires NIMI_DESKTOP_OPEN_LIVE_EXPECTED_DATA_ROOT; refusing to accept an unknown proposal',
    );
    const proposedDataRoot = (await desktopPage.getByTestId('first-run-storage-path').innerText()).trim();
    assert.equal(
      comparableDataRoot(proposedDataRoot),
      comparableDataRoot(expectedDataRoot),
      `refusing unexpected First Run data-root proposal ${proposedDataRoot}`,
    );
    const storageContinue = desktopPage.getByTestId('first-run-storage-continue');
    await storageContinue.waitFor({ state: 'visible', timeout: 30_000 });
    assert.equal(await storageContinue.isEnabled(), true, 'First Run storage proposal must be selectable');
    await storageContinue.click();

    const devicePhase = desktopPage.getByTestId('first-run-phase-device-scan');
    await devicePhase.waitFor({ state: 'visible', timeout: 120_000 });
    await desktopPage.waitForFunction(() => {
      const summary = document.querySelector('[data-testid="first-run-device-summary"]');
      const continueButton = document.querySelector('[data-testid="first-run-device-scan-continue"]');
      return summary?.getAttribute('data-device-scan') === 'settled'
        && continueButton instanceof HTMLButtonElement
        && !continueButton.disabled;
    }, undefined, { timeout: 120_000 });
    await desktopPage.screenshot({ path: path.join(evidenceRoot, 'desktop-first-run-device.png') });
    await desktopPage.getByTestId('first-run-device-scan-continue').click();

    const localAiPhase = desktopPage.getByTestId('first-run-phase-local-ai');
    await localAiPhase.waitFor({ state: 'visible', timeout: 120_000 });
    const minimal = desktopPage.getByTestId('first-run-install-level-minimal');
    assert.equal(await minimal.isEnabled(), true, 'First Run minimal plan must be selectable');
    await minimal.click();
    await desktopPage.waitForFunction(() => (
      document.querySelector('[data-testid="first-run-install-level-minimal"]')
        ?.getAttribute('data-selected') === 'true'
    ), undefined, { timeout: 30_000 });
    await desktopPage.screenshot({ path: path.join(evidenceRoot, 'desktop-first-run-local-ai.png') });
    const localAiContinue = desktopPage.getByTestId('first-run-local-ai-continue');
    assert.equal(await localAiContinue.isEnabled(), true, 'First Run Local AI continue must be enabled');
    await localAiContinue.click();
  }

  const setup = desktopPage.getByTestId('first-run-phase-setup');
  const setupDeadline = Date.now() + desktopReadyTimeoutMs;
  while (await setup.isVisible().catch(() => false)) {
    if (Date.now() >= setupDeadline) throw new Error('First Run setup did not complete before the live acceptance deadline');
    const retry = desktopPage.getByTestId('first-run-setup-retry');
    if (await retry.isVisible().catch(() => false) && await retry.isEnabled()) await retry.click();
    const recheck = desktopPage.getByTestId('first-run-setup-recheck');
    if (await recheck.isVisible().catch(() => false) && await recheck.isEnabled()) await recheck.click();
    await desktopPage.waitForTimeout(5_000);
  }
}

async function ensureDeveloperModeEnabled(desktopPage) {
  await desktopPage.getByTestId('desktop-account-menu-trigger').click();
  await desktopPage.getByRole('button', { name: 'Settings', exact: true }).click();
  await desktopPage.getByTestId('panel:settings-body').waitFor({ timeout: 30_000 });
  await desktopPage.getByTestId('settings-nav:performance').click();
  const toggle = desktopPage.getByTestId('developer-mode-toggle');
  await toggle.waitFor({ state: 'visible', timeout: 30_000 });
  await desktopPage.waitForFunction(() => {
    const status = document.querySelector('[data-testid="developer-mode-status"]');
    return status instanceof HTMLElement && !/loading/iu.test(status.innerText);
  }, undefined, { timeout: 30_000 });
  const before = await toggle.getAttribute('data-developer-mode');
  assert.match(String(before), /^(on|off)$/u, 'Developer Mode must expose a closed state');
  if (before === 'off') {
    const button = desktopPage.getByTestId('developer-mode-toggle-button');
    assert.equal(await button.isEnabled(), true, 'Developer Mode must be enableable from Settings');
    await button.click();
    await desktopPage.waitForFunction(() => (
      document.querySelector('[data-testid="developer-mode-toggle"]')
        ?.getAttribute('data-developer-mode') === 'on'
    ), undefined, { timeout: 30_000 });
  }
  const after = await toggle.getAttribute('data-developer-mode');
  assert.equal(after, 'on');
  await desktopPage.screenshot({ path: path.join(evidenceRoot, 'desktop-developer-mode-enabled.png') });
  return { before, after };
}

function comparableDataRoot(value) {
  const normalized = process.platform === 'win32'
    ? path.win32.resolve(String(value).trim()).toLowerCase()
    : path.resolve(String(value).trim());
  return normalized.replace(/[\\/]+$/u, '');
}

async function approveLocalDevelopmentIfRequested(desktopPage, port, child, output) {
  const deadline = Date.now() + zhiyuCdpTimeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Zhiyu launcher exited before approval or CDP:\n${output.join('').slice(-4_000)}`);
    }
    if (await cdpReady(port)) return 'reused-existing-project-consent';
    const dialog = desktopPage.getByTestId('local-development-approval-dialog');
    if (await dialog.isVisible().catch(() => false)) {
      const remember = desktopPage.getByTestId('local-development-remember');
      assert.equal(await remember.isDisabled(), true, 'allow-project must require native risk acknowledgement');
      await desktopPage.screenshot({ path: path.join(evidenceRoot, 'desktop-local-development-approval.png') });
      await desktopPage.getByTestId('local-development-native-risk-ack').check();
      assert.equal(await remember.isEnabled(), true, 'allow-project must enable after native risk acknowledgement');
      await remember.click();
      await dialog.waitFor({ state: 'hidden', timeout: 30_000 });
      return 'approved-allow-project';
    }
    await desktopPage.waitForTimeout(250);
  }
  const diagnostic = await desktopPage.evaluate(async () => ({
    bodyText: document.body?.innerText || '',
    pending: await globalThis.window.__NIMI_ELECTRON_RUNTIME__.invoke(
      'local_development_pending_approvals',
      {},
    ).catch((error) => ({ error: String(error) })),
    authorizations: await globalThis.window.__NIMI_ELECTRON_RUNTIME__.invoke(
      'local_development_authorizations_list',
      {},
    ).catch((error) => ({ error: String(error) })),
    runs: await globalThis.window.__NIMI_ELECTRON_RUNTIME__.invoke(
      'local_development_runs_list',
      {},
    ).catch((error) => ({ error: String(error) })),
  }));
  throw new Error(
    'neither Zhiyu CDP nor the Desktop approval dialog became ready:\n'
    + `${output.join('').slice(-4_000)}\n`
    + JSON.stringify(diagnostic, null, 2),
  );
}

async function cdpReady(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    return response.ok && (await response.json()).length > 0;
  } catch {
    return false;
  }
}

async function waitForCdp(port, child, output, timeoutMs, desktopPage) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Zhiyu launcher exited before CDP was ready:\n${output.join('').slice(-4_000)}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (response.ok && (await response.json()).length > 0) return;
    } catch {
      // The CDP endpoint is expected to reject connections until Electron has bound the port.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const authority = await desktopPage.evaluate(async () => ({
    pending: await globalThis.window.__NIMI_ELECTRON_RUNTIME__.invoke(
      'local_development_pending_approvals',
      {},
    ),
    authorizations: await globalThis.window.__NIMI_ELECTRON_RUNTIME__.invoke(
      'local_development_authorizations_list',
      {},
    ),
  }));
  throw new Error(
    `Zhiyu CDP did not become ready:\n${output.join('').slice(-4_000)}\n`
    + `Desktop authority projection:\n${JSON.stringify(authority, null, 2)}`,
  );
}

function runBundleMode(mode) {
  const args = ['scripts/bundle-electron-main.mjs', ...(mode ? [mode] : [])];
  const result = spawnSync(process.execPath, args, {
    cwd: desktopRoot,
    env: process.env,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && mode) {
    throw new Error(`Electron main ${mode} bundle failed with ${result.status ?? result.signal}`);
  }
  return result;
}

function terminateProcessTree(child) {
  if (!child?.pid || child.exitCode !== null) return;
  spawnSync('taskkill.exe', ['/pid', String(child.pid), '/t'], {
    stdio: 'ignore',
    windowsHide: true,
  });
}
