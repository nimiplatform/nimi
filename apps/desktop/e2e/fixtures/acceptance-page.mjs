/* global window, document */
import { delay } from './acceptance-files.mjs';

export async function openExploreWorlds(page) {
  await page.getByTestId('nav-tab:explore').click();
  await page.getByTestId('explore-section-tab-worlds').click();
  await page.getByTestId('world-atlas-selected-panel').waitFor({ state: 'visible', timeout: 30_000 });
  await page.getByTestId('world-atlas-preview-people').waitFor({ state: 'visible', timeout: 30_000 });
}

export async function readAIConfigStorageSnapshot(page) {
  return page.evaluate(() => {
    const entries = {};
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key || !key.startsWith('nimi.ai-config')) {
        continue;
      }
      const raw = window.localStorage.getItem(key);
      try {
        entries[key] = raw ? JSON.parse(raw) : null;
      } catch {
        entries[key] = raw;
      }
    }
    return entries;
  });
}

export function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export async function waitForDesktopSurface(page) {
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
  }, { timeout: 90_000 });
  return handle.jsonValue();
}

export async function inspectLayout(page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const overflowing = [];
    for (const element of document.querySelectorAll('button, [data-testid="world-character-source-detail-page"], [data-testid="world-atlas-selected-panel"], [data-testid="world-atlas-preview-people"]')) {
      const rect = element.getBoundingClientRect();
      if (rect.left < -1 || rect.right > window.innerWidth + 1) {
        overflowing.push({
          testId: element.getAttribute('data-testid') || '',
          text: element.textContent?.trim().slice(0, 80) || '',
          left: rect.left,
          right: rect.right,
          width: rect.width,
        });
      }
    }
    return {
      viewportWidth: window.innerWidth,
      scrollWidth: root.scrollWidth,
      clientWidth: root.clientWidth,
      hasHorizontalOverflow: root.scrollWidth > root.clientWidth + 2 || overflowing.length > 0,
      overflowing,
    };
  });
}

export async function inspectAccessibility(page) {
  const session = await page.context().newCDPSession(page);
  const tree = await session.send('Accessibility.getFullAXTree');
  const interactiveRoles = new Set([
    'button',
    'checkbox',
    'combobox',
    'link',
    'menuitem',
    'radio',
    'searchbox',
    'slider',
    'switch',
    'tab',
    'textbox',
  ]);
  const controls = tree.nodes
    .filter((node) => !node.ignored && interactiveRoles.has(String(node.role?.value || '')))
    .map((node) => ({
      role: String(node.role?.value || ''),
      name: normalizeWhitespace(node.name?.value),
      disabled: Boolean(node.disabled?.value),
    }));
  return {
    nodeCount: tree.nodes.length,
    interactiveControlCount: controls.length,
    unnamedInteractiveControls: controls.filter((node) => !node.name).slice(0, 20),
  };
}

export async function captureScreenshot(page, screenshotPath) {
  await page.screenshot({
    path: screenshotPath,
    animations: 'disabled',
    caret: 'hide',
    fullPage: false,
    timeout: 60_000,
  });
}

export async function setElectronWindowSize(app, width, height) {
  await app.evaluate(({ BrowserWindow }, size) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setSize(size.width, size.height);
  }, { width, height });
  await delay(500);
}
