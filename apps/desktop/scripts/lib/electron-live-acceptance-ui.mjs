/* global document, HTMLElement, HTMLButtonElement */
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

import {
  OFFLINE_STRIP_TEST_ID,
  normalizeText,
} from './electron-live-acceptance-runtime.mjs';
import {
  inspectAccessibility,
  setElectronWindowSize,
} from '../explore-materialization-acceptance/acceptance-page.mjs';

export async function readOptionalDomAttribute(page, selector, attribute) {
  return await page.evaluate(({ selectorValue, attributeName }) => (
    globalThis.document.querySelector(selectorValue)?.getAttribute(attributeName) ?? null
  ), { selectorValue: selector, attributeName: attribute });
}

export async function validateResponsiveMainShell(app, page, evidenceRootInput) {
  const evidenceRoot = path.resolve(evidenceRootInput);
  mkdirSync(evidenceRoot, { recursive: true });
  const checkpoints = [];

  for (const viewport of [
    { label: 'desktop', width: 1440, height: 900 },
    { label: 'narrow-390', width: 390, height: 900 },
  ]) {
    await setElectronWindowSize(app, viewport.width, viewport.height);
    const outerWindowSize = await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      const [width, height] = window.getSize();
      return { width, height };
    });
    assert.deepEqual(
      outerWindowSize,
      { width: viewport.width, height: viewport.height },
      `${viewport.label} native window did not reach the requested bounds`,
    );
    await page.getByTestId('main-shell').waitFor({ state: 'visible', timeout: 10_000 });
    await page.getByTestId(OFFLINE_STRIP_TEST_ID).waitFor({ state: 'hidden', timeout: 10_000 });

    const explore = page.getByTestId('nav-tab:explore');
    await explore.waitFor({ state: 'visible', timeout: 10_000 });
    assert.equal(await explore.isEnabled(), true, `${viewport.label} Explore navigation must be enabled`);
    await explore.click();
    await page.getByTestId('panel:explore').first().waitFor({ state: 'visible', timeout: 10_000 });

    const dom = await page.evaluate(() => {
      const main = globalThis.document.querySelector('[data-testid="main-shell"]');
      const rect = main instanceof HTMLElement ? main.getBoundingClientRect() : null;
      const titlebar = globalThis.document.querySelector('[data-shell-titlebar="true"]');
      const titlebarRect = titlebar instanceof HTMLElement ? titlebar.getBoundingClientRect() : null;
      const titlebarContent = globalThis.document.querySelector('[data-titlebar-region="content"]');
      const titlebarContentRect = titlebarContent instanceof HTMLElement
        ? titlebarContent.getBoundingClientRect()
        : null;
      const titlebarActions = globalThis.document.querySelector('[data-titlebar-region="actions"]');
      const titlebarActionsRect = titlebarActions instanceof HTMLElement
        ? titlebarActions.getBoundingClientRect()
        : null;
      const interactiveRects = [...globalThis.document.querySelectorAll('[data-titlebar-interactive="true"]')]
        .filter((element) => element instanceof HTMLElement && element.offsetParent !== null)
        .map((element) => {
          const bounds = element.getBoundingClientRect();
          return {
            name: element.getAttribute('aria-label')
              ?? element.getAttribute('data-testid')
              ?? element.textContent?.trim()
              ?? element.tagName,
            left: Number(bounds.left.toFixed(2)),
            right: Number(bounds.right.toFixed(2)),
            top: Number(bounds.top.toFixed(2)),
            bottom: Number(bounds.bottom.toFixed(2)),
          };
        });
      const overlappingTitlebarControls = [];
      for (let leftIndex = 0; leftIndex < interactiveRects.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < interactiveRects.length; rightIndex += 1) {
          const left = interactiveRects[leftIndex];
          const right = interactiveRects[rightIndex];
          if (Math.min(left.right, right.right) - Math.max(left.left, right.left) > 1
            && Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top) > 1) {
            overlappingTitlebarControls.push([left.name, right.name]);
          }
        }
      }
      return {
        viewportWidth: globalThis.innerWidth,
        viewportHeight: globalThis.innerHeight,
        documentScrollWidth: globalThis.document.documentElement.scrollWidth,
        bodyScrollWidth: globalThis.document.body.scrollWidth,
        mainShellWidth: rect ? Number(rect.width.toFixed(2)) : 0,
        mainShellHeight: rect ? Number(rect.height.toFixed(2)) : 0,
        offlineStripPresent: Boolean(globalThis.document.querySelector('[data-testid="offline-strip"]')),
        explorePanelVisible: Boolean(globalThis.document.querySelector('[data-testid="panel:explore"]')),
        titlebarRect: titlebarRect ? {
          left: Number(titlebarRect.left.toFixed(2)),
          right: Number(titlebarRect.right.toFixed(2)),
        } : null,
        titlebarContentRect: titlebarContentRect ? {
          left: Number(titlebarContentRect.left.toFixed(2)),
          right: Number(titlebarContentRect.right.toFixed(2)),
        } : null,
        titlebarActionsRect: titlebarActionsRect ? {
          left: Number(titlebarActionsRect.left.toFixed(2)),
          right: Number(titlebarActionsRect.right.toFixed(2)),
        } : null,
        interactiveRects,
        overlappingTitlebarControls,
      };
    });
    assert.ok(
      dom.viewportWidth <= viewport.width && dom.viewportWidth >= viewport.width - 48,
      `${viewport.label} content viewport is inconsistent with native window chrome: ${JSON.stringify({ outerWindowSize, dom })}`,
    );
    assert.ok(
      dom.documentScrollWidth <= viewport.width + 1 && dom.bodyScrollWidth <= viewport.width + 1,
      `${viewport.label} shell overflowed horizontally: ${JSON.stringify(dom)}`,
    );
    assert.equal(dom.explorePanelVisible, true);
    assert.ok(dom.titlebarRect && dom.titlebarContentRect && dom.titlebarActionsRect);
    assert.ok(
      dom.titlebarContentRect.right <= dom.titlebarActionsRect.left + 1,
      `${viewport.label} titlebar content overlaps its action region: ${JSON.stringify(dom)}`,
    );
    assert.ok(
      dom.interactiveRects.every((control) => (
        control.left >= dom.titlebarRect.left - 1
        && control.right <= dom.titlebarRect.right + 1
      )),
      `${viewport.label} titlebar controls escape the native content viewport: ${JSON.stringify(dom)}`,
    );
    assert.deepEqual(
      dom.overlappingTitlebarControls,
      [],
      `${viewport.label} titlebar controls overlap: ${JSON.stringify(dom)}`,
    );
    const accessibility = await inspectAccessibility(page);
    assert.equal(
      accessibility.unnamedInteractiveControls.length,
      0,
      `${viewport.label} shell contains interactive controls without accessible names: ${JSON.stringify(accessibility)}`,
    );

    const screenshot = path.join(evidenceRoot, `${viewport.label}-explore.png`);
    await page.screenshot({ path: screenshot, fullPage: true });
    checkpoints.push({ ...viewport, outerWindowSize, ...dom, accessibility, screenshot });

    const chat = page.getByTestId('nav-tab:chat');
    await chat.waitFor({ state: 'visible', timeout: 10_000 });
    assert.equal(await chat.isEnabled(), true, `${viewport.label} Chat navigation must be enabled`);
    await chat.click();
    await page.getByTestId('chat-page').waitFor({ state: 'visible', timeout: 10_000 });
  }

  return { checkpoints };
}

export async function completeDesktopFirstRun(page) {
  const expectedDataRoot = normalizeText(process.env.NIMI_DESKTOP_ELECTRON_LIVE_EXPECT_DATA_ROOT);
  assert.notEqual(
    expectedDataRoot,
    '',
    'NIMI_DESKTOP_ELECTRON_LIVE_EXPECT_DATA_ROOT is required before mutating first-run storage state',
  );
  const storage = page.getByTestId('first-run-phase-storage');
  if (await storage.isVisible().catch(() => false)) {
    const proposed = normalizeText(await page.getByTestId('first-run-storage-path').innerText());
    assert.equal(comparablePath(proposed), comparablePath(expectedDataRoot));
    const storageContinue = page.getByTestId('first-run-storage-continue');
    assert.equal(await storageContinue.isEnabled(), true);
    await storageContinue.click();
  }

  await waitForFirstRunPhase(page, [
    'first-run-phase-device-scan',
    'first-run-phase-local-ai',
    'first-run-phase-setup',
    'main-shell',
  ], 180_000);
  const device = page.getByTestId('first-run-phase-device-scan');
  if (await device.isVisible().catch(() => false)) {
    await page.waitForFunction(() => {
      const summary = document.querySelector('[data-testid="first-run-device-summary"]');
      const button = document.querySelector('[data-testid="first-run-device-scan-continue"]');
      return summary?.getAttribute('data-device-scan') === 'settled'
        && button instanceof HTMLButtonElement
        && !button.disabled;
    }, undefined, { timeout: 180_000 });
    await page.getByTestId('first-run-device-scan-continue').click();
  }

  await waitForFirstRunPhase(page, [
    'first-run-phase-local-ai',
    'first-run-phase-setup',
    'main-shell',
  ], 180_000);
  const localAi = page.getByTestId('first-run-phase-local-ai');
  if (await localAi.isVisible().catch(() => false)) {
    const minimal = page.getByTestId('first-run-install-level-minimal');
    await minimal.waitFor({ state: 'visible', timeout: 60_000 });
    assert.equal(await minimal.isEnabled(), true);
    if (await minimal.getAttribute('data-selected') !== 'true') await minimal.click();
    await page.waitForFunction(() => (
      document.querySelector('[data-testid="first-run-install-level-minimal"]')
        ?.getAttribute('data-selected') === 'true'
    ), undefined, { timeout: 30_000 });
    const localAiContinue = page.getByTestId('first-run-local-ai-continue');
    assert.equal(await localAiContinue.isEnabled(), true);
    await localAiContinue.click();
  }

  const deadline = Date.now() + 20 * 60_000;
  while (Date.now() < deadline) {
    if (await page.getByTestId('main-shell').isVisible().catch(() => false)) return;
    const terminalError = page.locator(
      '[data-testid="product-first-run-error"], '
      + '[data-testid="first-run-terminal-error"], '
      + '[data-testid="product-first-run-finalization-error"]',
    );
    if (await terminalError.count() > 0 && await terminalError.first().isVisible().catch(() => false)) {
      throw new Error(`Desktop first-run failed: ${await terminalError.first().innerText()}`);
    }
    for (const testId of ['first-run-setup-retry', 'first-run-setup-recheck']) {
      const action = page.getByTestId(testId);
      if (await action.isVisible().catch(() => false) && await action.isEnabled()) await action.click();
    }
    await page.waitForTimeout(2_000);
  }
  throw new Error(`Desktop first-run did not reach the main shell:\n${await page.locator('body').innerText()}`);
}

export async function waitForDesktopRendererSurface(page) {
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
  }, { timeout: 60_000 });
  return handle.jsonValue();
}

export function resolveElectronExecutablePath(requireElectron) {
  const explicit = normalizeText(process.env.NIMI_DESKTOP_ELECTRON_EXECUTABLE_PATH);
  if (explicit) return path.resolve(explicit);
  if (process.platform === 'win32') {
    throw new Error(
      'Windows fixed-service acceptance requires NIMI_DESKTOP_ELECTRON_EXECUTABLE_PATH '
      + 'pointing at the signed exact-name Desktop Electron host candidate.',
    );
  }
  return requireElectron('electron');
}

async function waitForFirstRunPhase(page, testIds, timeout) {
  await page.waitForFunction((ids) => ids.some((testId) => {
    const element = document.querySelector(`[data-testid="${testId}"]`);
    return element instanceof HTMLElement && element.offsetParent !== null;
  }), testIds, { timeout });
}

function comparablePath(value) {
  const resolved = process.platform === 'win32'
    ? path.win32.resolve(value).toLowerCase()
    : path.resolve(value);
  return resolved.replace(/[\\/]+$/u, '');
}
