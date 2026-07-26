#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { _electron as electron } from 'playwright';
import {
  completeDesktopAccountLogin,
  validateRealmDisconnectRecovery,
  validateShortJwtRefreshRotation,
} from './lib/electron-live-acceptance-account.mjs';
import { resolvePersistentDesktopDevProfile } from './lib/electron-dev-carrier.mjs';
import {
  OFFLINE_STRIP_TEST_ID,
  captureAccountSessionSnapshot,
  captureRendererDiagnostics,
  invokeOptionalCommand,
  invokeRealmProbe,
  invokeShell,
  normalizeText,
  retryUntil,
  summarizeAuthorizations,
} from './lib/electron-live-acceptance-runtime.mjs';
import {
  completeDesktopFirstRun,
  readOptionalDomAttribute,
  resolveElectronExecutablePath,
  validateResponsiveMainShell,
  waitForDesktopRendererSurface,
} from './lib/electron-live-acceptance-ui.mjs';

const appRoot = path.resolve(import.meta.dirname, '..');
const workspaceRoot = path.resolve(appRoot, '../..');
const require = createRequire(import.meta.url);
const electronExecutablePath = resolveElectronExecutablePath(require);
const mainEntry = path.join(appRoot, 'dist-electron', 'main.js');
const rendererLiveUrl = `${pathToFileURL(path.join(appRoot, 'dist', 'index.html')).toString()}?nimiDesktopElectronLiveAcceptance=1`;
const expectedSurface = normalizeText(process.env.NIMI_DESKTOP_ELECTRON_LIVE_EXPECT_SURFACE) || 'main';
const completeFirstRun = process.env.NIMI_DESKTOP_ELECTRON_LIVE_COMPLETE_FIRST_RUN === '1';
const restartRuntime = process.env.NIMI_DESKTOP_ELECTRON_LIVE_RESTART_RUNTIME === '1';
const validateRealmRecovery = process.env.NIMI_DESKTOP_ELECTRON_LIVE_REALM_RECOVERY === '1';
const validateRefreshRotation = process.env.NIMI_DESKTOP_ELECTRON_LIVE_REFRESH_ROTATION === '1';
const completeAccountLogin = process.env.NIMI_DESKTOP_ELECTRON_LIVE_ACCOUNT_LOGIN === '1';
const openCapturedExternal = process.env.NIMI_DESKTOP_ELECTRON_LIVE_OPEN_CAPTURED_EXTERNAL === '1';
const visualEvidenceRoot = normalizeText(process.env.NIMI_DESKTOP_ELECTRON_LIVE_VISUAL_EVIDENCE_ROOT);
const protectedRuntimeTransportRef = 'protected-desktop-control';
const offlineStripTestId = OFFLINE_STRIP_TEST_ID;
const profileRoot = resolvePersistentDesktopDevProfile(workspaceRoot);
const localAssetRoot = path.join(profileRoot, 'local-assets');
mkdirSync(localAssetRoot, { recursive: true });
const acceptanceStartedAt = performance.now();
const timings = {};
const markTiming = (label) => {
  timings[label] = Number((performance.now() - acceptanceStartedAt).toFixed(2));
};

const app = await electron.launch({
  executablePath: electronExecutablePath,
  args: [`--user-data-dir=${profileRoot}`, mainEntry],
  env: {
    ...process.env,
    NIMI_DESKTOP_ELECTRON_RENDERER_URL: normalizeText(process.env.NIMI_DESKTOP_ELECTRON_RENDERER_URL) || rendererLiveUrl,
    NIMI_DESKTOP_ELECTRON_STANDARD_LOCAL_ASSET_ROOTS: localAssetRoot,
  },
});
markTiming('electronLaunchedMs');
const hostStderr = [];
app.process().stderr?.on('data', (chunk) => {
  const text = String(chunk);
  hostStderr.push(text);
  if (process.env.NIMI_PROTECTED_LOCAL_DIAGNOSTICS === '1') process.stderr.write(text);
});

try {
  const page = await app.firstWindow();
  markTiming('firstWindowMs');
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.waitForLoadState('domcontentloaded');
  markTiming('domContentLoadedMs');
  await page.waitForFunction(() => Boolean(globalThis.window?.__NIMI_ELECTRON_RUNTIME__));
  markTiming('protectedHostReadyMs');

  const status = await retryUntil(
    () => invokeShell(page, 'runtime-lifecycle.status', {}),
    () => true,
    10,
    500,
  );
  assert.equal(status.running, true);
  assert.equal(status.grpcAddr, protectedRuntimeTransportRef);
  markTiming('runtimeStatusReadyMs');
  const accountSession = await captureAccountSessionSnapshot(page);
  markTiming('accountSnapshotReadyMs');
  assert.match(accountSession.status.sequence, /^(0|[1-9][0-9]*)$/u);
  assert.equal(accountSession.event.eventType, 'next');
  assert.equal(accountSession.event.event.deliveryKind, 'snapshot');
  assert.equal(accountSession.event.event.sequence, accountSession.status.sequence);
  // Short-JWT acceptance must first establish the ordinary shell. Its first
  // Realm probe intentionally triggers reactive refresh after the alternate
  // access-verification key is active; probing here would create the refresh
  // before there is a mounted shell to preserve.
  const realmProbe = accountSession.status.state === 'authenticated' && !validateRefreshRotation
    ? await invokeRealmProbe(page)
    : null;
  if (realmProbe) {
    assert.equal(realmProbe.ok, true, JSON.stringify(realmProbe));
    assert.equal(realmProbe.value.accepted, true, JSON.stringify(realmProbe));
    assert.equal(realmProbe.value.httpStatus, 200);
    assert.doesNotThrow(() => JSON.parse(realmProbe.value.responseJson));
  }

  let surface = await waitForDesktopRendererSurface(page);
  markTiming('rendererSurfaceReadyMs');
  const initialSurface = surface;
  const initialProductState = await readOptionalDomAttribute(
    page,
    '[data-product-state]',
    'data-product-state',
  );
  const initialFirstRunText = surface === 'firstRun'
    ? await page.locator('[data-testid="desktop-first-run-gate"]').innerText()
    : null;
  if (surface === 'firstRun' && completeFirstRun) {
    await completeDesktopFirstRun(page);
    surface = 'main';
  }
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
  let productState = await readOptionalDomAttribute(
    page,
    '[data-product-state]',
    'data-product-state',
  );
  const errorLocator = page.locator('[data-testid="product-first-run-error"], [data-testid="first-run-terminal-error"], [data-testid="product-first-run-finalization-error"]');
  if (surface === 'firstRun' && productState === 'config_missing') {
    await page.waitForFunction(() => {
      const state = globalThis.document.querySelector('[data-product-state]')?.getAttribute('data-product-state');
      const error = globalThis.document.querySelector(
        '[data-testid="product-first-run-error"], [data-testid="first-run-terminal-error"], [data-testid="product-first-run-finalization-error"]',
      );
      return (state && state !== 'config_missing') || Boolean(error);
    }, undefined, { timeout: 20_000 }).catch(() => null);
    productState = await readOptionalDomAttribute(
      page,
      '[data-product-state]',
      'data-product-state',
    );
  }
  const firstRunError = await errorLocator.count() > 0
    ? await errorLocator.first().innerText()
    : null;
  const firstRunText = surface === 'firstRun'
    ? await page.locator('[data-testid="desktop-first-run-gate"]').innerText()
    : null;
  const authorizationsBefore = await invokeOptionalCommand(
    page,
    'local_development_authorizations_list',
    {},
  );
  markTiming('localAuthorizationsReadyMs');
  const accountStatusAfterAuthorizationProbe = await invokeOptionalCommand(
    page,
    'runtime_account_session_status',
    {},
  );
  markTiming('accountStatusAfterAuthorizationProbeMs');
  assert.equal(
    accountStatusAfterAuthorizationProbe.ok,
    true,
    `Local authorization disposition poisoned the protected account channel: ${JSON.stringify(accountStatusAfterAuthorizationProbe)}`,
  );
  markTiming('authorizationProbeCompleteMs');
  const accountLogin = completeAccountLogin
    ? await completeDesktopAccountLogin(page, { app, openCapturedExternal })
    : null;
  markTiming('accountFlowCompleteMs');
  if (accountLogin) {
    surface = 'main';
    productState = await readOptionalDomAttribute(
      page,
      '[data-product-state]',
      'data-product-state',
    );
  }
  let runtimeRestart = null;
  if (restartRuntime) {
    assert.equal(surface, 'main', 'Runtime restart acceptance requires the ordinary main shell');
    const restarted = await invokeShell(page, 'runtime-lifecycle.restart', {});
    assert.equal(restarted.running, true);
    assert.equal(restarted.grpcAddr, protectedRuntimeTransportRef);
    const accountAfterRestart = await retryUntil(
      () => captureAccountSessionSnapshot(page),
      (candidate) => candidate.status.state === 'authenticated',
      30,
      1_000,
    );
    const realmAfterRestart = await retryUntil(
      () => invokeRealmProbe(page),
      (candidate) => candidate.ok === true
        && candidate.value?.accepted === true
        && candidate.value?.httpStatus === 200,
      30,
      1_000,
    );
    try {
      await page.getByTestId('main-shell').waitFor({ state: 'visible', timeout: 60_000 });
      await page.getByTestId(offlineStripTestId).waitFor({ state: 'hidden', timeout: 60_000 });
    } catch (error) {
      const diagnostics = await captureRendererDiagnostics(page);
      throw new Error(
        `Desktop renderer did not recover after Runtime restart: ${error instanceof Error ? error.message : String(error)}\n`
        + JSON.stringify(diagnostics, null, 2),
        { cause: error },
      );
    }
    assert.equal(await page.getByTestId('login-screen').count(), 0);
    const authorizationsAfter = await invokeOptionalCommand(
      page,
      'local_development_authorizations_list',
      {},
    );
    if (authorizationsBefore.ok && authorizationsAfter.ok) {
      assert.deepEqual(authorizationsAfter.value, authorizationsBefore.value);
    }
    runtimeRestart = {
      running: restarted.running,
      accountSequenceBefore: accountSession.status.sequence,
      accountSequenceAfter: accountAfterRestart.status.sequence,
      accountStateAfter: accountAfterRestart.status.state,
      realmHttpStatusAfter: realmAfterRestart.value.httpStatus,
      authorizationsPreserved: authorizationsBefore.ok && authorizationsAfter.ok,
    };
  }
  const realmRecovery = validateRealmRecovery
    ? await validateRealmDisconnectRecovery(page, accountSession.status.sequence)
    : null;
  const refreshRotation = validateRefreshRotation
    ? await validateShortJwtRefreshRotation(page, accountSession.status.sequence)
    : null;
  const visualAcceptance = surface === 'main' && visualEvidenceRoot
    ? await validateResponsiveMainShell(app, page, visualEvidenceRoot)
    : null;
  process.stdout.write(`${JSON.stringify({
    timings,
    status,
    accountSession: {
      sequence: accountSession.status.sequence,
      state: accountSession.status.state,
      reasonCode: accountSession.status.reasonCode,
      accountReasonCode: accountSession.status.accountReasonCode,
      snapshotDeliveryKind: accountSession.event.event.deliveryKind,
      snapshotSequence: accountSession.event.event.sequence,
    },
    realmProbe: realmProbe
      ? {
        accepted: realmProbe.value.accepted,
        httpStatus: realmProbe.value.httpStatus,
        reasonCode: realmProbe.value.reasonCode,
        accountReasonCode: realmProbe.value.accountReasonCode,
        responseBytes: Buffer.byteLength(realmProbe.value.responseJson, 'utf8'),
      }
      : null,
    surface,
    initialSurface,
    initialProductState,
    productState,
    firstRunError,
    firstRunText: firstRunText ?? initialFirstRunText,
    localProjectAuthorizations: summarizeAuthorizations(authorizationsBefore),
    accountStatusAfterAuthorizationProbe: {
      sequence: accountStatusAfterAuthorizationProbe.value.sequence,
      state: accountStatusAfterAuthorizationProbe.value.state,
    },
    accountLogin,
    runtimeRestart,
    realmRecovery,
    refreshRotation,
    visualAcceptance,
    consoleErrors,
    pageErrors,
    hostStderr,
  }, null, 2)}\n`);
  assert.deepEqual(
    consoleErrors,
    [],
    `Desktop renderer emitted console errors:\n${consoleErrors.join('\n')}`,
  );
  assert.deepEqual(
    pageErrors,
    [],
    `Desktop renderer emitted uncaught page errors:\n${pageErrors.join('\n')}`,
  );
} finally {
  await app.close();
}
