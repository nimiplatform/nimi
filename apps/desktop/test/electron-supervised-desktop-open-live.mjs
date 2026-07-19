import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { _electron as electron, chromium } from 'playwright';

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

fs.mkdirSync(desktopDataRoot, { recursive: true });
fs.mkdirSync(zhiyuDataRoot, { recursive: true });
runBundleMode('--acceptance');

let launcher;
let app;
let zhiyuBrowser;
const launcherOutput = [];
const desktopConsoleErrors = [];
const zhiyuConsoleErrors = [];
let acceptanceError;

try {
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
  await desktopPage.getByRole('button', { name: 'Explore', exact: true }).waitFor({ timeout: 30_000 });

  launcher = spawn('cmd.exe', ['/d', '/s', '/c', 'pnpm dev:electron:zhiyu'], {
    cwd: repoRoot,
    env: process.env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (const stream of [launcher.stdout, launcher.stderr]) {
    stream.on('data', (chunk) => launcherOutput.push(chunk.toString('utf8')));
  }

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
  assert.deepEqual(desktopConsoleErrors, []);
  assert.deepEqual(zhiyuConsoleErrors, []);
  await desktopPage.screenshot({ path: path.join(evidenceRoot, 'desktop-personas.png') });
  await zhiyuPage.screenshot({ path: path.join(evidenceRoot, 'zhiyu-accepted.png') });

  const result = {
    status: 'passed',
    desktop: {
      windows,
      heading: await personasHeading.innerText(),
    },
    zhiyu: {
      feedback: await feedback.innerText(),
    },
    console: {
      desktopErrors: desktopConsoleErrors,
      zhiyuErrors: zhiyuConsoleErrors,
    },
  };
  fs.writeFileSync(path.join(evidenceRoot, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  acceptanceError = error;
} finally {
  await zhiyuBrowser?.close().catch(() => undefined);
  await app?.close().catch(() => undefined);
  terminateProcessTree(launcher);
  const restore = runBundleMode();
  if (restore.status !== 0 && !acceptanceError) {
    acceptanceError = new Error('failed to restore ordinary Electron main bundle');
  }
}

if (acceptanceError) throw acceptanceError;

function collectConsoleErrors(page, output) {
  page.on('console', (message) => {
    if (message.type() === 'error') output.push(message.text());
  });
  page.on('pageerror', (error) => output.push(`pageerror:${error.message}`));
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
