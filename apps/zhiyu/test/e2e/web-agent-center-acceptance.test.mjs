import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..', '..');
const repoRoot = path.resolve(root, '..', '..');
const port = Number(process.env.NIMI_ZHIYU_WEB_ACCEPTANCE_PORT || 1473);
const previewUrl = `http://127.0.0.1:${port}/?nimiWebAgentCenterAcceptance=1`;

test('zhiyu web Agent Center fails closed without standard shell bridge', { timeout: 120_000 }, async () => {
  await withVitePreview(async () => {
    const browser = await launchBrowser();
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const pageProblems = trackPageProblems(page);
    try {
      await page.goto(previewUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('[data-zhiyu-screen="home"]', { timeout: 30_000 });
      await page.waitForFunction(() => Boolean(globalThis.window.__nimiZhiyuEvidence), undefined, { timeout: 30_000 });

      const privateBridgePresence = await page.evaluate(() => ({
        electronRuntime: Boolean(globalThis.window.__NIMI_ELECTRON_RUNTIME__),
        localConfig: Boolean(globalThis.window.__nimiZhiyuAgentCenterLocalConfig),
        ipcRenderer: 'ipcRenderer' in globalThis.window,
        electron: 'electron' in globalThis.window,
        require: 'require' in globalThis.window,
        process: 'process' in globalThis.window,
      }));
      assert.deepEqual(privateBridgePresence, {
        electronRuntime: false,
        localConfig: false,
        ipcRenderer: false,
        electron: false,
        require: false,
        process: false,
      });

      await page.locator('[data-zhiyu-settings-entry="presence-rail"]').click();
      await page.locator('[data-zhiyu-agent-panel-mode="agent"]').waitFor({ state: 'visible', timeout: 15_000 });
      await page.locator('[data-testid="chat-agent-center-section:appearance"]').click();
      await page.locator('[data-zhiyu-agent-panel-tab="appearance"]').waitFor({ state: 'visible', timeout: 15_000 });
      await page.locator('[data-agent-center-appearance-surface="blocked"]').waitFor({ state: 'visible', timeout: 15_000 });
      assert.equal(
        await page.locator('[data-agent-center-appearance-blocked="configuration-unavailable"]').count(),
        1,
        'web Agent Center must expose a fail-closed blocked appearance state when Runtime/standard shell is unavailable',
      );
      assert.equal(await page.locator('button:has-text("瀵煎叆 Live2D")').count(), 0);
      assert.equal(await page.evaluate(() => Boolean(globalThis.window.__nimiZhiyuAgentCenterLocalConfig)), false);

      await captureWebAgentCenterEvidence(page, pageProblems, { privateBridgePresence });
      assertNoPageProblems(pageProblems);
    } finally {
      await browser.close();
    }
  });
});

async function launchBrowser() {
  try {
    return await chromium.launch();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('Executable doesn\'t exist')) {
      throw error;
    }
    return chromium.launch({ channel: 'chrome' });
  }
}

async function withVitePreview(run) {
  const child = spawn(
    process.platform === 'win32' ? 'corepack.cmd' : 'corepack',
    ['pnpm', 'exec', 'vite', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    {
      cwd: root,
      env: { ...process.env, BROWSER: 'none' },
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    output += chunk.toString();
  });
  try {
    await waitForPreview(child, () => output);
    await run();
  } finally {
    child.kill();
  }
}

async function waitForPreview(child, readOutput) {
  const started = Date.now();
  while (Date.now() - started < 30_000) {
    assert.equal(child.exitCode, null, `vite preview exited early:\n${readOutput()}`);
    try {
      const response = await fetch(previewUrl);
      if (response.ok) {
        return;
      }
    } catch {
      // Retry until the preview server is ready.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`vite preview did not start:\n${readOutput()}`);
}

function trackPageProblems(page) {
  const problems = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      problems.push(`console error: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => {
    problems.push(`pageerror: ${error instanceof Error ? error.message : String(error)}`);
  });
  return problems;
}

function assertNoPageProblems(problems) {
  assert.deepEqual(problems, []);
}

async function captureWebAgentCenterEvidence(page, pageProblems, extra) {
  const evidenceRoot = path.join(repoRoot, '.nimi', 'local', 'evidence', 'zhiyu', 'agent-center-web-hardcut');
  await mkdir(evidenceRoot, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({
    path: path.join(evidenceRoot, 'web-agent-center-desktop.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 900 });
  await page.screenshot({
    path: path.join(evidenceRoot, 'web-agent-center-narrow.png'),
    fullPage: true,
  });
  const domEvidence = await page.evaluate(() => ({
    url: globalThis.location.href,
    title: globalThis.document.title,
    sidePanelState: globalThis.document.querySelector('[data-zhiyu-side-panel-state]')?.getAttribute('data-zhiyu-side-panel-state') ?? null,
    activeTab: globalThis.document.querySelector('[data-zhiyu-agent-panel-tab]')?.getAttribute('data-zhiyu-agent-panel-tab') ?? null,
    appearanceSurface: globalThis.document.querySelector('[data-agent-center-appearance-surface]')?.getAttribute('data-agent-center-appearance-surface') ?? null,
    appearanceBlocked: globalThis.document.querySelector('[data-agent-center-appearance-blocked]')?.getAttribute('data-agent-center-appearance-blocked') ?? null,
    horizontalOverflow: globalThis.document.documentElement.scrollWidth - globalThis.document.documentElement.clientWidth,
    zhiyuEvidence: globalThis.window.__nimiZhiyuEvidence ?? null,
  }));
  assert.ok(domEvidence.horizontalOverflow <= 2, `web Agent Center narrow layout overflows by ${domEvidence.horizontalOverflow}px`);
  await writeFile(
    path.join(evidenceRoot, 'web-agent-center-evidence.json'),
    `${JSON.stringify({
      scenario: 'web-agent-center-standard-shell-unavailable',
      screenshots: {
        desktop: 'web-agent-center-desktop.png',
        narrow: 'web-agent-center-narrow.png',
      },
      pageProblems: [...pageProblems],
      ...extra,
      domEvidence,
    }, null, 2)}\n`,
    'utf8',
  );
}
