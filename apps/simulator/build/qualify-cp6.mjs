#!/usr/bin/env node

import { createServer } from 'node:http';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { sha256Digest, stableJsonDigest } from '@nimiplatform/app-tools/simulator-conformance';
import { createBrowserTraceQualification, installQualificationBindings } from './browser-trace-qualification.mjs';
import {
  assertDesktopAuthenticatedShells,
  assertNoBrowserAuthPersistence,
  exerciseDesktopAuthIsolation,
  observeDesktopAuthRequests,
} from './desktop-auth-browser-acceptance.mjs';
import { DIST_ROOT, REPO_ROOT } from './paths.mjs';

const require = createRequire(import.meta.url);
const playwrightVersion = require('playwright/package.json').version;
const CHECKPOINT = 'CP6';
const evidenceSlug = 'simulator-cp6';
const EVIDENCE_ROOT = path.join(REPO_ROOT, '.nimi', 'local', 'state', evidenceSlug);
const RECEIPT_PATH = path.join(EVIDENCE_ROOT, 'qualification.json');
const SCREENSHOT_PATH = path.join(EVIDENCE_ROOT, 'qualified.png');
function contentType(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  return 'application/octet-stream';
}

function isShellDocumentPath(pathname) {
  if (pathname === '/diagnostics') return true;
  const matched = /^\/instance\/([^/]+)(?:\/.*)?$/u.exec(pathname);
  if (!matched) return false;
  try {
    return /^[0-9]+:instance:[0-9]+$/u.test(decodeURIComponent(matched[1]));
  } catch {
    return false;
  }
}

async function serveArtifact() {
  const server = createServer((request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      const requested = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
      if (!requested || requested.includes('..') || path.isAbsolute(requested)) {
        response.writeHead(400).end('invalid path');
        return;
      }
      const candidate = path.resolve(DIST_ROOT, ...requested.split('/'));
      if (!candidate.startsWith(`${path.resolve(DIST_ROOT)}${path.sep}`)) {
        response.writeHead(400).end('invalid path');
        return;
      }
      let filePath = null;
      try {
        if (statSync(candidate).isFile()) filePath = candidate;
      } catch {
        // A legal Shell route is a document request; missing assets remain 404.
      }
      if (filePath === null && isShellDocumentPath(url.pathname)) {
        filePath = path.join(DIST_ROOT, 'index.html');
      }
      if (filePath === null) {
        response.writeHead(404).end('not found');
        return;
      }
      const bytes = readFileSync(filePath);
      response.writeHead(200, {
        'content-type': contentType(filePath),
        'cache-control': 'no-store',
        'content-length': bytes.length,
      });
      response.end(bytes);
    } catch {
      response.writeHead(404).end('not found');
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('SIM_CP6_SERVER_ADDRESS');
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

async function waitForQualifiedInstances(page, traceEvidence, pageDiagnostics, expectedCount = 2) {
  try {
    await page.waitForFunction((count) => (
      document.querySelectorAll('.simulator-surface').length === count
      && Number(document.querySelector('.simulator-shell')?.getAttribute('data-usable-active-instance-count')) === count
    ), expectedCount, { timeout: 30_000 });
  } catch (error) {
    const state = await page.evaluate(() => ({
      url: window.location.href,
      surfaces: document.querySelectorAll('.simulator-surface').length,
      usableActiveInstances: Number(document.querySelector('.simulator-shell')?.getAttribute('data-usable-active-instance-count')),
      instances: [...document.querySelectorAll('.simulator-windows__item')].map((node) => ({
        id: node.getAttribute('data-instance-id'),
        status: node.getAttribute('data-instance-status'),
        readiness: node.getAttribute('data-readiness-status'),
      })),
    }));
    let diagnostics = [];
    let homeInstances = [];
    let diagnosticCollectionError = null;
    try {
      const exitFullWindow = page.getByRole('button', { name: 'Exit full window' });
      if (await exitFullWindow.count() === 1) await exitFullWindow.click();
      homeInstances = await page.locator('.simulator-windows__item').evaluateAll((nodes) => nodes.map((node) => ({
        id: node.getAttribute('data-instance-id'),
        status: node.getAttribute('data-instance-status'),
        readiness: node.getAttribute('data-readiness-status'),
      })));
      const diagnosticsLink = page.getByRole('link', { name: 'Diagnostics' });
      if (await diagnosticsLink.count() === 1) {
        await diagnosticsLink.click();
        diagnostics = await page.locator('.simulator-diagnostics__item').allTextContents();
      }
    } catch (diagnosticError) {
      diagnosticCollectionError = String(diagnosticError);
    }
    throw new Error(`SIM_CP6_READINESS_TIMEOUT:${JSON.stringify({ expectedCount, state: { ...state, homeInstances, diagnostics, diagnosticCollectionError }, traceEvidence, pageDiagnostics, cause: String(error) })}`);
  }
}

async function replayDigest(page) {
  const value = await page.locator('.simulator-shell').getAttribute('data-replay-digest');
  if (!value || !/^sha256:[0-9a-f]{64}$/u.test(value)) throw new Error('SIM_CP6_REPLAY_DIGEST_MISSING');
  return value;
}

async function qualify() {
  const artifactManifest = JSON.parse(readFileSync(path.join(DIST_ROOT, 'simulator-artifact-manifest.json'), 'utf8'));
  if (artifactManifest.schema !== 'nimi.simulator.artifact-manifest/v1'
    || artifactManifest.selectedModuleCount !== 3
    || typeof artifactManifest.scenarioDigest !== 'string') {
    throw new Error('SIM_CP6_ARTIFACT_NOT_QUALIFIABLE');
  }

  const server = await serveArtifact();
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
    locale: 'en-US',
    timezoneId: 'UTC',
    colorScheme: 'dark',
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  const pageDiagnostics = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') pageDiagnostics.push(`${message.type()}:${message.text()}`);
  });
  page.on('pageerror', (error) => pageDiagnostics.push(`pageerror:${error.stack ?? error.message}`));
  const requestAudit = observeDesktopAuthRequests(page, server.origin);
  const cdp = await context.newCDPSession(page);
  const traces = createBrowserTraceQualification({
    cdp,
    errorPrefix: 'SIM_CP6',
    tokenPrefix: 'cp6-trace',
  });
  await installQualificationBindings(page, traces);

  try {
    await page.goto(server.origin, { waitUntil: 'load', timeout: 30_000 });
    await waitForQualifiedInstances(page, traces.evidence, pageDiagnostics, 6);
    const initialStateRevision = Number(await page.locator('.simulator-shell').getAttribute('data-state-revision'));
    if (!Number.isSafeInteger(initialStateRevision) || initialStateRevision <= 0) {
      throw new Error('SIM_CP6_INITIAL_REVISION_MISSING');
    }
    const initialInstanceIds = await page.locator('.simulator-windows__item').evaluateAll((nodes) => (
      nodes.map((node) => node.getAttribute('data-instance-id'))
    ));
    const initialTraceInstanceIds = await page.locator('.simulator-surface').evaluateAll((nodes) => (
      nodes.map((node) => node.getAttribute('data-instance-id'))
    ));
    const desktopSurfaces = page.locator('.simulator-surface[data-module-id="desktop"]');
    if (await desktopSurfaces.count() !== 2) throw new Error('SIM_CP6_DESKTOP_INSTANCE_COUNT');
    const firstDesktop = desktopSurfaces.nth(0);
    const secondDesktop = desktopSurfaces.nth(1);
    const firstDesktopRoot = firstDesktop.locator('[data-nimi-semantic-id="desktop-main-root"]');
    const secondDesktopRoot = secondDesktop.locator('[data-nimi-semantic-id="desktop-main-root"]');
    const firstDesktopRootId = await firstDesktopRoot.getAttribute('id');
    const secondDesktopRootId = await secondDesktopRoot.getAttribute('id');
    if (!firstDesktopRootId || !secondDesktopRootId || firstDesktopRootId === secondDesktopRootId) {
      throw new Error('SIM_CP6_DESKTOP_DOM_SCOPE_ISOLATION_FAILED');
    }
    const duplicateIds = await page.locator('.simulator-surface [id]').evaluateAll((nodes) => {
      const counts = new Map();
      for (const node of nodes) counts.set(node.id, (counts.get(node.id) ?? 0) + 1);
      return [...counts.entries()].filter(([, count]) => count > 1);
    });
    if (duplicateIds.length > 0) throw new Error(`SIM_CP6_DOM_ID_COLLISION:${JSON.stringify(duplicateIds)}`);

    const desktopAuth = await exerciseDesktopAuthIsolation(page);
    await assertNoBrowserAuthPersistence(page);
    requestAudit.assertNone();
    await page.waitForFunction(() => (
      document.querySelectorAll('[data-nimi-semantic-id="tester-ecosystem-reference"][data-ecosystem-revision]').length === 2
      && document.querySelectorAll('[data-nimi-semantic-id="tester-persona-reference"][data-persona-id="sim-user-linche"]').length === 2
      && [...document.querySelectorAll('.simulator-surface[data-module-id="zhiyu"]')]
        .every((node) => /模拟居民 林澈/u.test(node.textContent ?? ''))
    ), undefined, { timeout: 30_000 });
    const ecosystemRevisions = await page.locator('[data-nimi-semantic-id="tester-ecosystem-reference"]').evaluateAll((nodes) => (
      nodes.map((node) => Number(node.getAttribute('data-ecosystem-revision')))
    ));
    if (ecosystemRevisions.length !== 2
      || ecosystemRevisions.some((revision) => revision !== ecosystemRevisions[0])) {
      throw new Error(`SIM_CP6_ECOSYSTEM_REVISION_DRIFT:${JSON.stringify(ecosystemRevisions)}`);
    }
    const interactionStateRevision = Number(await page.locator('.simulator-shell').getAttribute('data-state-revision'));

    const firstTesterWindow = page.locator('.simulator-windows__item[data-module-id="tester"]').first();
    const deepLinkInstanceId = await firstTesterWindow.getAttribute('data-instance-id');
    if (!deepLinkInstanceId) throw new Error('SIM_CP6_TESTER_INSTANCE_ID_MISSING');
    await firstTesterWindow.getByRole('button', { name: 'Full window' }).click();
    await page.getByRole('button', { name: 'Exit full window' }).waitFor({ timeout: 30_000 });
    if (await page.locator('.simulator-surface:visible').count() !== 1
      || !/^\/instance\/1%3Ainstance%3A[0-9]+/u.test(new URL(page.url()).pathname)
      || !await page.locator('[data-testid="simulator-status"]').isVisible()) {
      throw new Error('SIM_CP6_FULL_WINDOW_DISCLOSURE_OR_SCOPE');
    }
    await page.getByRole('button', { name: 'Exit full window' }).click();
    await page.waitForFunction(() => document.querySelectorAll('.simulator-surface:not([hidden])').length === 6);

    for (let index = 0; index < 2; index += 1) {
      await page.locator('.simulator-windows__item[data-module-id="zhiyu"]:not([data-instance-status="disposed"])').first().getByRole('button', { name: 'Close' }).click();
    }
    await page.waitForFunction(() => document.querySelectorAll('.simulator-surface[data-module-id="zhiyu"]').length === 0);
    const missingTargetRevision = Number(await page.locator('.simulator-shell').getAttribute('data-state-revision'));
    await secondDesktop.locator('[data-testid="desktop-account-menu-trigger"]').evaluate((node) => node.click());
    await secondDesktop.locator('[data-testid="desktop-account-logout"]').evaluate((node) => node.click());
    await secondDesktop.locator('[data-testid="login-screen"]:visible').waitFor({ timeout: 30_000 });
    const missingTargetLogoutRevision = Number(await page.locator('.simulator-shell').getAttribute('data-state-revision'));
    if (missingTargetLogoutRevision !== missingTargetRevision + 2) {
      throw new Error(`SIM_CP6_MISSING_TARGET_LOGOUT_STATE:${missingTargetRevision}:${missingTargetLogoutRevision}`);
    }
    await secondDesktop.locator('[data-testid="login-logo-trigger"]').evaluate((node) => node.click());
    await secondDesktop.locator('[data-testid="main-shell"]:visible').waitFor({ timeout: 30_000 });
    const missingTargetFinalRevision = Number(await page.locator('.simulator-shell').getAttribute('data-state-revision'));
    if (missingTargetFinalRevision !== missingTargetLogoutRevision + 5) {
      throw new Error(`SIM_CP6_MISSING_TARGET_LOGIN_STATE:${missingTargetLogoutRevision}:${missingTargetFinalRevision}`);
    }

    await page.locator('button[data-simulator-action="reset"]').click();
    await waitForQualifiedInstances(page, traces.evidence, pageDiagnostics, 6);
    const resetInstanceIds = await page.locator('.simulator-windows__item[data-instance-status="active"]').evaluateAll((nodes) => (
      nodes.map((node) => node.getAttribute('data-instance-id'))
    ));
    if (resetInstanceIds.some((id) => initialInstanceIds.includes(id))) throw new Error('SIM_CP6_RESET_INSTANCE_REUSE');
    const resetTraceInstanceIds = await page.locator('.simulator-surface').evaluateAll((nodes) => (
      nodes.map((node) => node.getAttribute('data-instance-id'))
    ));
    if (await page.locator('[data-nimi-semantic-id="tester-ecosystem-reference"]').count() !== 0
      || await page.locator('.simulator-surface[data-module-id="desktop"] [data-testid="login-email-input"]:visible').count() !== 0) {
      throw new Error('SIM_CP6_RESET_VISIBLE_STATE');
    }

    const shellStyle = async () => page.locator('[data-testid="simulator-status"]').evaluate((node) => {
      const style = getComputedStyle(node);
      return [style.color, style.backgroundColor, style.fontFamily, style.minHeight].join('|');
    });
    const closeAll = async () => {
      while (await page.locator('.simulator-windows__item:not([data-instance-status="disposed"])').count() > 0) {
        await page.locator('.simulator-windows__item:not([data-instance-status="disposed"])').first().getByRole('button', { name: 'Close' }).click();
      }
      await page.waitForFunction(() => document.querySelectorAll('.simulator-surface').length === 0);
    };
    const openOrder = async (order) => {
      for (const moduleId of order) {
        const before = await page.locator('.simulator-surface').count();
        await page.locator(`button[data-module-id="${moduleId}"][data-surface-id="main"]`).click();
        await page.waitForFunction((count) => (
          document.querySelectorAll('.simulator-surface').length === count
          && document.querySelectorAll('.simulator-windows__item[data-instance-status="active"][data-readiness-status="usable"]').length >= count
        ), before + 1, { timeout: 30_000 });
      }
      return shellStyle();
    };
    await closeAll();
    const zeroDomSurfaceAndOverlayBaseline = {
      surfaces: await page.locator('.simulator-surface').count(),
      overlays: await page.locator('.simulator-surface__overlays > *').count(),
    };
    if (zeroDomSurfaceAndOverlayBaseline.surfaces !== 0 || zeroDomSurfaceAndOverlayBaseline.overlays !== 0) {
      throw new Error(`SIM_CP6_DOM_BASELINE:${JSON.stringify(zeroDomSurfaceAndOverlayBaseline)}`);
    }
    const forwardStyle = await openOrder(['desktop', 'zhiyu', 'tester']);
    await closeAll();
    const reverseStyle = await openOrder(['tester', 'zhiyu', 'desktop']);
    if (forwardStyle !== reverseStyle) throw new Error('SIM_CP6_PAIRWISE_SHELL_STYLE_ORDER_DRIFT');
    await closeAll();

    const deepLinkPath = `/instance/${encodeURIComponent(deepLinkInstanceId)}/inspect?mode=one&mode=two#result%20panel`;
    await page.goto(`${server.origin}${deepLinkPath}`, { waitUntil: 'load', timeout: 30_000 });
    await waitForQualifiedInstances(page, traces.evidence, pageDiagnostics, 6);
    const deepLinkTraceInstanceIds = await page.locator('.simulator-surface').evaluateAll((nodes) => (
      nodes.map((node) => node.getAttribute('data-instance-id'))
    ));
    if (page.url() !== `${server.origin}${deepLinkPath}`
      || await page.locator('.simulator-shell--full-window').count() !== 1
      || await page.locator(`.simulator-full-window[data-full-window-instance="${deepLinkInstanceId}"]`).count() !== 1
      || await page.locator('.simulator-surface:visible').count() !== 1
      || await page.locator('.simulator-surface[data-module-id="tester"]:visible').count() !== 1
      || !await page.locator('[data-testid="simulator-status"]').isVisible()) {
      throw new Error('SIM_CP6_DEEP_LINK_RELOAD_FAILED');
    }
    const deepLinkLaunchReplayDigest = await replayDigest(page);
    await page.reload({ waitUntil: 'load', timeout: 30_000 });
    await waitForQualifiedInstances(page, traces.evidence, pageDiagnostics, 6);
    if (page.url() !== `${server.origin}${deepLinkPath}`
      || await page.locator('.simulator-surface[data-module-id="tester"]:visible').count() !== 1) {
      throw new Error('SIM_CP6_DEEP_LINK_SECOND_RELOAD_FAILED');
    }
    const reproducedDeepLinkLaunchReplayDigest = await replayDigest(page);
    if (reproducedDeepLinkLaunchReplayDigest !== deepLinkLaunchReplayDigest) {
      throw new Error('SIM_CP6_DEEP_LINK_LAUNCH_NOT_REPRODUCIBLE');
    }
    if (pageDiagnostics.length !== 0) {
      throw new Error(`SIM_CP6_BROWSER_DIAGNOSTICS:${JSON.stringify(pageDiagnostics)}`);
    }
    await page.getByRole('button', { name: 'Exit full window' }).click();
    await page.waitForFunction(() => document.querySelectorAll('.simulator-surface:not([hidden])').length === 6);
    await page.getByRole('link', { name: 'Diagnostics' }).click();
    if (await page.locator('.simulator-diagnostics__item').count() !== 0) {
      throw new Error('SIM_CP6_PRODUCT_DIAGNOSTICS');
    }
    await page.getByRole('link', { name: 'Home' }).click();
    await assertDesktopAuthenticatedShells(page);
    await page.waitForFunction(() => (
      document.querySelectorAll('[data-nimi-semantic-id="tester-persona-reference"][data-persona-id="sim-user-linche"]').length === 2
      && [...document.querySelectorAll('.simulator-surface[data-module-id="zhiyu"]')]
        .every((node) => /模拟居民 林澈/u.test(node.textContent ?? ''))
    ), undefined, { timeout: 30_000 });
    await assertNoBrowserAuthPersistence(page);
    requestAudit.assertNone();
    if (pageDiagnostics.length !== 0) {
      throw new Error(`SIM_CP6_BROWSER_DIAGNOSTICS_AFTER_REPLAY:${JSON.stringify(pageDiagnostics)}`);
    }

    mkdirSync(EVIDENCE_ROOT, { recursive: true });
    const screenshot = await page.screenshot({ fullPage: true });
    writeFileSync(SCREENSHOT_PATH, screenshot);
    const browserExecutable = readFileSync(chromium.executablePath());
    const proof = {
      schema: 'nimi.simulator.cp6-qualification/v1',
      checkpoint: CHECKPOINT,
      artifactRootDigest: artifactManifest.artifactRootDigest,
      selectedModuleRegistryDigest: artifactManifest.selectedModuleRegistryDigest,
      scenarioDigest: artifactManifest.scenarioDigest,
      browser: {
        engine: 'chromium',
        version: browser.version(),
        playwrightVersion,
        executableDigest: sha256Digest(browserExecutable),
        headless: true,
        viewport: { width: 1440, height: 1000, deviceScaleFactor: 1 },
        locale: 'en-US',
        timezoneId: 'UTC',
        colorScheme: 'dark',
        reducedMotion: 'reduce',
        serviceWorkers: 'block',
      },
      interaction: {
        protocol: 'nimi.simulator.interaction/v1',
        type: 'ecosystem.reference.checkpoint',
        scenarioInstanceCount: 6,
        selectedModuleCount: 3,
        desktopAction: 'isolated-logout-and-deterministic-oauth-relogin',
        ecosystemRevision: ecosystemRevisions[0],
        finalInteractionStateRevision: interactionStateRevision,
        orderedEcosystemThenZhiyuThenTesterRevisionDelta: 3,
        testerVisibleInstanceUpdates: 2,
        zhiyuVisibleInstanceUpdates: 2,
        desktopDomScopeIsolated: true,
        secondDesktopLocalStateUnchanged: desktopAuth.secondRendererUnchanged,
        missingTargetCommittedState: false,
        fullWindowDisclosureVisible: true,
        pairwiseLoadOrderShellStyleStable: true,
        browserDiagnosticCount: 0,
        productDiagnosticCount: 0,
        initialStateRevision,
        resetAllocatedFreshInstanceIds: true,
        zeroDomSurfaceAndOverlayBaseline,
        deepLinkReload: {
          path: deepLinkPath,
          instanceId: deepLinkInstanceId,
          selectedModuleId: 'tester',
          disclosureVisible: true,
          orderedQueryEntriesPreserved: true,
          fragmentPreserved: true,
        },
      },
      replay: {
        scope: 'deterministic-deep-link-launch',
        digest: deepLinkLaunchReplayDigest,
        reproducedDigest: reproducedDeepLinkLaunchReplayDigest,
        reproduced: true,
      },
      traces: traces.evidence.filter((row) => new Set([
        ...initialTraceInstanceIds,
        ...resetTraceInstanceIds,
        ...deepLinkTraceInstanceIds,
      ]).has(row.instanceId)),
      screenshot: {
        path: `.nimi/local/state/${evidenceSlug}/qualified.png`,
        digest: sha256Digest(screenshot),
      },
    };
    if (proof.traces.length !== 24 || proof.traces.some((row) => row.ok !== true)) {
      throw new Error('SIM_CP6_TRACE_EVIDENCE_INCOMPLETE');
    }
    const receipt = {
      ...proof,
      receiptDigest: stableJsonDigest('nimi-simulator-cp6-qualification-v1', proof),
    };
    writeFileSync(RECEIPT_PATH, `${JSON.stringify(receipt, null, 2)}\n`);
    process.stdout.write(`${evidenceSlug}: OK (${proof.traces.length} trace windows, receipt ${receipt.receiptDigest})\n`);
  } finally {
    requestAudit.dispose();
    await traces.close();
    await context.close();
    await browser.close();
    await server.close();
  }
}

await qualify();
