/* global window, document */
import { delay } from './acceptance-files.mjs';

export async function openExplorePersonas(page) {
  await page.getByTestId('nav-tab:explore').click();
  await page.getByTestId('explore-section-tab-personas').click();
  await page.getByTestId('explore-personas-section').waitFor({ state: 'visible', timeout: 30_000 });
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

function findTextGenerateTargetRefInAIConfigStorage(snapshot) {
  for (const value of Object.values(snapshot || {})) {
    if (!value || typeof value !== 'object') {
      continue;
    }
    const targetRef = value?.capabilities?.targetRefs?.['text.generate'];
    if (targetRef && typeof targetRef === 'object') {
      return targetRef;
    }
  }
  return null;
}

export async function waitForTextGenerateTargetRef(page) {
  await page.waitForFunction(() => {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key || !key.startsWith('nimi.ai-config.scope.')) {
        continue;
      }
      const raw = window.localStorage.getItem(key);
      if (!raw) {
        continue;
      }
      try {
        const parsed = JSON.parse(raw);
        const targetRef = parsed?.capabilities?.targetRefs?.['text.generate'];
        if (targetRef?.kind === 'local-runtime' || targetRef?.kind === 'cloud-connector') {
          return true;
        }
      } catch {
        continue;
      }
    }
    return false;
  }, null, { timeout: 30_000 });
  return findTextGenerateTargetRefInAIConfigStorage(await readAIConfigStorageSnapshot(page));
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

export async function waitForAttribute(locator, name, expected) {
  const deadline = Date.now() + 30_000;
  let last = null;
  while (Date.now() < deadline) {
    last = await locator.getAttribute(name).catch(() => null);
    if (last === expected) {
      return;
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${name}=${expected}; last=${last}`);
}

export async function inspectLayout(page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const overflowing = [];
    for (const element of document.querySelectorAll('button, [data-testid^="explore-persona-source-card:"]')) {
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
