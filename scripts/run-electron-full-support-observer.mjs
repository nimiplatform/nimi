#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');
const requireFromDesktop = createRequire(path.join(repoRoot, 'apps', 'desktop', 'package.json'));
const { chromium } = requireFromDesktop('playwright');

const options = parseArguments(process.argv.slice(2));
const evidenceRoot = requireEvidenceRoot(options.evidenceRoot);
fs.mkdirSync(evidenceRoot, { recursive: true });

observerStage('connect-cdp');
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${options.cdpPort}`);
observerStage('connected-cdp');
const consoleEntries = [];
const pageErrors = [];
const requestFailures = [];
const screenshotCaptures = [];
let result;
let observedPage;
let observedCdp;
let screenshotCaptureFailed = false;

try {
  const pages = browser.contexts().flatMap((context) => context.pages());
  assert.equal(pages.length, 1, `${options.app} acceptance requires exactly one renderer page`);
  const page = pages[0];
  observedPage = page;
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      consoleEntries.push({
        source: 'playwright',
        level: message.type(),
        text: sanitizeText(message.text()),
        location: sanitizeLocation(message.location()),
      });
    }
  });
  page.on('pageerror', (error) => pageErrors.push(sanitizeText(error.message)));
  page.on('requestfailed', (request) => requestFailures.push({
    url: sanitizeUrl(request.url()),
    errorText: sanitizeText(request.failure()?.errorText || ''),
  }));

  const cdp = await page.context().newCDPSession(page);
  observedCdp = cdp;
  cdp.on('Log.entryAdded', ({ entry }) => {
    if (entry.level === 'error' || entry.level === 'warning') {
      consoleEntries.push({
        source: 'cdp-log',
        level: entry.level,
        text: sanitizeText(entry.text),
        url: sanitizeUrl(entry.url || ''),
        lineNumber: entry.lineNumber,
      });
    }
  });
  await cdp.send('Log.enable');
  await cdp.send('Runtime.enable');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(750);
  observerStage('renderer-ready');
  await prepareInitialProductState(page, options.app, options.approvalApp);

  const initial = await captureDomSummary(page);
  assert.equal(initial.horizontalOverflow, false, `${options.app} desktop viewport has horizontal overflow`);
  await capturePageScreenshot(cdp, path.join(evidenceRoot, 'desktop.png'));

  const product = options.app === 'desktop' || options.approvalApp
    ? await observeDesktopProduct(page)
    : await observeLocalAppProduct(page, cdp, options.app);
  if (options.approvalApp) {
    const expectedAppId = `nimi.${options.approvalApp}`;
    assert.equal(product.interaction.approvalRequired, true, `${expectedAppId} approval dialog must be visible`);
    assert.equal(
      product.pendingProjectApprovals.apps.includes(expectedAppId),
      true,
      `${expectedAppId} must be present in the protected pending approval projection`,
    );
  }

  const accessibility = await captureAccessibilitySummary(cdp);
  const originalViewport = initial.viewport;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  const narrow = await captureDomSummary(page);
  assert.equal(narrow.horizontalOverflow, false, `${options.app} 390px viewport has horizontal overflow`);
  await capturePageScreenshot(cdp, path.join(evidenceRoot, '390px.png'));
  await page.setViewportSize({
    width: Math.max(390, originalViewport.innerWidth),
    height: Math.max(600, originalViewport.innerHeight),
  });

  result = {
    schemaVersion: 1,
    app: options.app,
    observedAt: new Date().toISOString(),
    launcher: 'official-supervisor-or-launcher',
    observedSurface: options.approvalApp ? 'desktop-protected-project-approval' : 'app-electron-renderer',
    cdpPort: options.cdpPort,
    renderer: {
      title: sanitizeText(await page.title()),
      url: sanitizeUrl(page.url()),
      initial,
      narrow,
      accessibility,
      screenshotCaptures,
    },
    product,
    diagnostics: {
      consoleEntries: deduplicate(consoleEntries),
      pageErrors: deduplicate(pageErrors),
      requestFailures: deduplicate(requestFailures),
    },
  };
  fs.writeFileSync(path.join(evidenceRoot, 'evidence.json'), `${JSON.stringify(result, null, 2)}\n`);
  fs.writeFileSync(path.join(evidenceRoot, 'dom-summary.json'), `${JSON.stringify({ initial, narrow, accessibility }, null, 2)}\n`);
  fs.writeFileSync(path.join(evidenceRoot, 'console-page-errors.json'), `${JSON.stringify(result.diagnostics, null, 2)}\n`);
  for (const staleFailure of ['observer-failure.json', 'failure.png']) {
    fs.rmSync(path.join(evidenceRoot, staleFailure), { force: true });
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  const failure = {
    schemaVersion: 1,
    app: options.app,
    observedAt: new Date().toISOString(),
    error: sanitizeError({
      name: error instanceof Error ? error.name : '',
      message: error instanceof Error ? error.message : String(error),
    }),
    diagnostics: {
      consoleEntries: deduplicate(consoleEntries),
      pageErrors: deduplicate(pageErrors),
      requestFailures: deduplicate(requestFailures),
    },
  };
  if (observedPage && observedCdp && !screenshotCaptureFailed) {
    await capturePageScreenshot(observedCdp, path.join(evidenceRoot, 'failure.png'))
      .catch(() => undefined);
  }
  fs.writeFileSync(path.join(evidenceRoot, 'observer-failure.json'), `${JSON.stringify(failure, null, 2)}\n`);
  fs.writeFileSync(path.join(evidenceRoot, 'console-page-errors.json'), `${JSON.stringify(failure.diagnostics, null, 2)}\n`);
  throw error;
} finally {
  await browser.close().catch(() => undefined);
}

async function observeDesktopProduct(page) {
  await page.getByTestId('main-shell').waitFor({ state: 'visible', timeout: 30_000 });
  const runtimeStatus = await invokeRenderer(page, 'nimi.shell.runtimeLifecycle.status', {});
  const account = await captureDesktopAccountSession(page);
  const realm = await invokeRenderer(page, 'runtime_account_invoke_realm_unary', {
    payload: {
      methodId: 'WorldCoreController_listPersonaCharacters',
      requestJson: '{}',
      timeoutMs: 10_000,
      idempotencyKey: `desktop-full-support-${Date.now()}`,
    },
  });
  const authorizations = await invokeRenderer(page, 'local_development_authorizations_list', {});
  const pendingApprovals = await invokeRenderer(page, 'local_development_pending_approvals', {});
  const localDevelopmentRuns = await invokeRenderer(page, 'local_development_runs_list', {});
  const developerMode = await invokeRenderer(page, 'developer_mode_status', {});
  const rendererProbe = await invokeRenderer(page, 'nimi.shell.diagnostics.rendererEntryProbe', {});

  const approvalDialog = page.getByTestId('local-development-approval-dialog');
  const approvalRequired = await approvalDialog.count() > 0 && await approvalDialog.isVisible();
  const approvalDialogDigest = approvalRequired
    ? digestText((await approvalDialog.innerText()).slice(0, 8_000))
    : null;
  const navigation = [];
  let accountMenuVisible = false;
  if (!approvalRequired) {
    for (const target of ['nav-tab:apps', 'nav-tab:runtime', 'nav-tab:chat']) {
      const control = page.getByTestId(target);
      if (await control.count()) {
        assert.equal(await control.isEnabled(), true, `${target} must be enabled`);
        await control.click();
        await page.waitForTimeout(250);
        navigation.push({ target, visibleTextDigest: digestText((await page.locator('body').innerText()).slice(0, 8_000)) });
      }
    }
    const accountMenu = page.getByTestId('desktop-account-menu-trigger');
    assert.equal(await accountMenu.isEnabled(), true, 'Desktop account menu must be enabled');
    await accountMenu.click();
    accountMenuVisible = await page.locator('[role="menu"], [data-testid*="account-menu"]').count() > 0;
    await page.keyboard.press('Escape');
  }

  return {
    runtimeStatus: projectRuntimeStatus(runtimeStatus),
    account,
    realm: projectRealmProof(realm),
    durableProjectAuthorizations: projectAuthorizations(authorizations),
    pendingProjectApprovals: projectPendingApprovals(pendingApprovals),
    localDevelopmentRuns: projectLocalDevelopmentRuns(localDevelopmentRuns),
    developerMode: projectDeveloperMode(developerMode),
    rendererProbe: projectRendererProbe(rendererProbe),
    interaction: { navigation, accountMenuVisible, approvalRequired, approvalDialogDigest },
  };
}

async function prepareInitialProductState(page, app, approvalApp) {
  if (app !== 'tester' || approvalApp) return;
  await page.getByTestId('nimi-tester-workbench').waitFor({ state: 'visible', timeout: 30_000 });
  await page.getByRole('button', { name: 'Text Studio', exact: true }).click();
  await page.getByRole('heading', { name: 'Test text generation', exact: true })
    .waitFor({ state: 'visible', timeout: 10_000 });
}

async function observeLocalAppProduct(page, cdp, app) {
  const session = await invokeRenderer(page, 'nimi.shell.localApp.sessionStatus', {});
  assert.equal(session.ok, true, `${app} protected local-app session status must be readable`);
  assert.equal(session.value?.state, 'ready', `${app} protected local-app session must be ready`);
  const forbiddenAuthorityKeys = [
    'accountGeneration', 'runtimeBootEpoch', 'sessionId', 'sessionProof', 'launchLease',
    'authorization', 'accountId', 'endpoint', 'token', 'trustClass',
  ].filter((key) => Object.hasOwn(session.value || {}, key));
  assert.deepEqual(forbiddenAuthorityKeys, [], `${app} session status projected protected authority material`);
  const rendererBridge = await page.evaluate(() => ({
    invoke: typeof globalThis.window.__NIMI_ELECTRON_RUNTIME__?.invoke,
    listen: typeof globalThis.window.__NIMI_ELECTRON_RUNTIME__?.listen,
  }));
  assert.deepEqual(rendererBridge, { invoke: 'function', listen: 'function' }, `${app} preload bridge is incomplete`);
  const controls = await captureInteractiveControls(page);
  assert.ok(controls.length > 0, `${app} must expose at least one interactive control`);
  const common = {
    protectedLocalAppSession: projectLocalAppSession(session),
    rendererBridge,
    interaction: {
      enabledControlCount: controls.filter((control) => !control.disabled).length,
      disabledControlCount: controls.filter((control) => control.disabled).length,
    },
  };
  if (app === 'tester') return { ...common, tester: await observeTesterProduct(page, cdp) };
  if (app === 'zhiyu') return { ...common, zhiyu: await observeZhiyuProduct(page, cdp) };
  return common;
}

async function observeTesterProduct(page, cdp) {
  await page.getByTestId('nimi-tester-workbench').waitFor({ state: 'visible', timeout: 30_000 });
  await page.getByRole('button', { name: 'Text Studio', exact: true }).click();
  await page.getByRole('heading', { name: 'Test text generation', exact: true })
    .waitFor({ state: 'visible', timeout: 10_000 });
  await page.waitForFunction(() => {
    const text = document.body.innerText;
    return text.includes('Runtime · Connected') && text.includes('Model: Not admitted');
  }, undefined, { timeout: 30_000 });
  const admissionText = (await page.getByTestId('nimi-tester-workbench').innerText()).slice(0, 12_000);
  assert.match(admissionText, /Runtime · Connected/u, 'Tester must render the connected Runtime carrier separately');
  assert.match(admissionText, /Not admitted/u, 'Tester must render the zero-permission capability posture');
  assert.doesNotMatch(admissionText, /Runtime unavailable/u, 'Tester must not classify an unadmitted capability as Runtime unavailable');
  const generateText = page.getByRole('button', { name: 'Generate text', exact: true });
  assert.equal(await generateText.count(), 1, 'Tester Text Studio must expose one generate control');
  assert.equal(await generateText.isDisabled(), true, 'Tester must fail closed while text generation is not admitted');
  const referenceSurfaceLabels = [
    'Text Studio',
    'Chat Stream',
    'Embeddings',
    'Image Generate',
    'Video Generate',
    'Speech Synthesis',
    'Speech Transcribe',
    'Speech Bundle',
    'World Tour',
    'UI Recipes',
  ];
  const referenceSurfaces = [];
  for (const label of referenceSurfaceLabels) {
    const control = page.getByRole('button', { name: label, exact: true });
    assert.equal(await control.count(), 1, `${label} reference surface must have one navigation control`);
    assert.equal(await control.isEnabled(), true, `${label} reference surface navigation must be enabled`);
    await control.click();
    await page.waitForTimeout(150);
    const bodyText = (await page.getByTestId('nimi-tester-workbench').innerText()).slice(0, 12_000);
    assert.ok(bodyText.includes(label), `${label} reference surface must render its product label`);
    referenceSurfaces.push({ label, contentDigest: digestText(bodyText) });
  }

  await page.getByRole('button', { name: 'Text Studio', exact: true }).click();
  const permissionLabTrigger = page.getByRole('button', { name: '打开 Local App 权限测试', exact: true });
  await permissionLabTrigger.waitFor({ state: 'visible', timeout: 10_000 });
  assert.equal(await permissionLabTrigger.isEnabled(), true, 'Tester local-app permission lab trigger must be enabled');
  await permissionLabTrigger.click();

  const drawer = page.getByTestId('tester-local-app-permission-drawer');
  const lab = page.getByTestId('tester-local-app-permission-lab');
  await drawer.waitFor({ state: 'visible', timeout: 10_000 });
  await lab.waitFor({ state: 'visible', timeout: 10_000 });
  const refresh = lab.getByRole('button', { name: '刷新真实状态', exact: true });
  await refresh.click();
  await waitForEnabled(refresh);

  const beforeRequest = await invokeRenderer(page, 'nimi.shell.localApp.permissionStatus', {
    permissionId: 'agents.interact',
  });
  assert.equal(beforeRequest.ok, true, 'reserved permission status must return a protected projection');
  assert.equal(beforeRequest.value?.state, 'unavailable', 'reserved permission must be unavailable before request');
  assert.equal(beforeRequest.value?.canRequest, false, 'reserved permission must not be requestable');

  const request = lab.getByRole('button', { name: '请求保留权限（应拒绝）', exact: true });
  assert.equal(await request.isEnabled(), true, 'reserved permission negative probe must be enabled in a bound session');
  await request.click();
  await lab.getByText('保留权限按设计被拒绝；没有创建 owner decision、grant 或可携带凭据。', { exact: true })
    .waitFor({ state: 'visible', timeout: 10_000 });
  const afterRequest = await invokeRenderer(page, 'nimi.shell.localApp.permissionStatus', {
    permissionId: 'agents.interact',
  });
  assert.equal(afterRequest.ok, true, 'reserved permission status must remain readable after rejection');
  assert.equal(afterRequest.value?.state, 'unavailable', 'reserved permission rejection must not create a grant');
  assert.equal(afterRequest.value?.canRequest, false, 'reserved permission rejection must remain non-requestable');

  const storage = lab.getByRole('button', { name: '验证私有存储（应成功）', exact: true });
  assert.equal(await storage.isEnabled(), true, 'app-private storage probe must be enabled in a bound session');
  await storage.click();
  await lab.getByText(/写入、读取和清理成功（\d+ bytes）；全程没有权限请求。/u)
    .waitFor({ state: 'visible', timeout: 10_000 });

  const labText = (await lab.innerText()).slice(0, 12_000);
  assert.match(labText, /Session：session-bound · Identity：bound/u, 'Tester must show a bound protected local-app session');
  assert.match(labText, /Reserved \/ unavailable/u, 'Tester must render the reserved permission posture');
  await capturePageScreenshot(cdp, path.join(evidenceRoot, 'local-app-permission-lab.png'));
  const originalViewport = page.viewportSize();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  const narrowLab = await captureDomSummary(page);
  assert.equal(narrowLab.horizontalOverflow, false, 'Tester permission lab has horizontal overflow at 390px');
  await capturePageScreenshot(cdp, path.join(evidenceRoot, 'local-app-permission-lab-390px.png'));
  await page.setViewportSize(originalViewport || { width: 1280, height: 800 });

  await drawer.getByRole('button', { name: '关闭', exact: true }).click();
  await drawer.waitFor({ state: 'hidden', timeout: 10_000 });
  await page.getByRole('button', { name: 'UI Recipes', exact: true }).click();
  await page.getByRole('heading', { name: 'UI Recipes', exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
  await page.getByRole('button', { name: 'Text Studio', exact: true }).click();
  await page.getByRole('heading', { name: 'Test text generation', exact: true })
    .waitFor({ state: 'visible', timeout: 10_000 });

  return {
    admission: {
      runtimeCarrier: 'connected',
      capability: 'not-admitted',
      generateEnabled: false,
    },
    referenceSurfaces,
    reservedPermission: {
      before: projectPermissionStatus(beforeRequest),
      after: projectPermissionStatus(afterRequest),
      rejectionRendered: true,
    },
    appPrivateStorage: {
      roundTripRendered: true,
      cleanedUp: true,
      labTextDigest: digestText(labText),
    },
    narrowPermissionLab: narrowLab,
  };
}

async function observeZhiyuProduct(page, cdp) {
  const root = page.getByTestId('zhiyu-dev-kernel-root');
  await root.waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForFunction(() => {
    const evidence = globalThis.window.__nimiZhiyuDevKernelEvidence;
    return evidence && evidence.state !== 'loading';
  }, undefined, { timeout: 10_000 });

  const before = await invokeRenderer(page, 'nimi.shell.localApp.permissionStatus', {
    permissionId: 'agents.interact',
  });
  assert.equal(before.ok, true, 'Zhiyu reserved permission status must return a protected projection');
  assert.equal(before.value?.state, 'unavailable', 'Zhiyu reserved permission must be unavailable');
  assert.equal(before.value?.canRequest, false, 'Zhiyu reserved permission must not be requestable');

  const initialEvidence = await captureZhiyuDevKernelEvidence(page);
  assert.equal(initialEvidence.state, 'session-bound', 'Zhiyu local development session must be bound');
  assert.equal(initialEvidence.sessionBound, true, 'Zhiyu local development identity must be bound');
  assert.equal(initialEvidence.permissionPosture, 'unavailable', 'Zhiyu must render reserved permission as unavailable');
  assert.equal(initialEvidence.permissionCanRequest, false, 'Zhiyu must render reserved permission as non-requestable');
  const send = page.getByTestId('zhiyu-dev-kernel-send');
  assert.equal(await send.isDisabled(), true, 'unadmitted Zhiyu Runtime Agent interaction must remain disabled');

  const storage = page.getByTestId('zhiyu-dev-kernel-verify-private-storage');
  assert.equal(await storage.isEnabled(), true, 'Zhiyu app-private storage probe must be enabled');
  await storage.click();
  await page.waitForFunction(() => (
    globalThis.window.__nimiZhiyuDevKernelEvidence?.appPrivateStorage?.state === 'succeeded'
  ), undefined, { timeout: 10_000 });

  const permission = page.getByTestId('zhiyu-dev-kernel-verify-reserved-permission');
  assert.equal(await permission.isEnabled(), true, 'Zhiyu reserved permission negative probe must be enabled');
  await permission.click();
  await page.waitForFunction(() => (
    globalThis.window.__nimiZhiyuDevKernelEvidence?.permissionRequest?.state === 'rejected'
  ), undefined, { timeout: 10_000 });

  const after = await invokeRenderer(page, 'nimi.shell.localApp.permissionStatus', {
    permissionId: 'agents.interact',
  });
  assert.equal(after.ok, true, 'Zhiyu reserved permission status must remain readable after rejection');
  assert.equal(after.value?.state, 'unavailable', 'Zhiyu reserved permission rejection must not create a grant');
  assert.equal(after.value?.canRequest, false, 'Zhiyu reserved permission must remain non-requestable');
  const completedEvidence = await captureZhiyuDevKernelEvidence(page);
  assert.equal(completedEvidence.storageState, 'succeeded', 'Zhiyu app-private storage round trip must succeed');
  assert.equal(completedEvidence.permissionRequestState, 'rejected', 'Zhiyu reserved permission request must fail closed');

  await capturePageScreenshot(cdp, path.join(evidenceRoot, 'local-development-boundary.png'));
  const originalViewport = page.viewportSize();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  const narrow = await captureDomSummary(page);
  assert.equal(narrow.horizontalOverflow, false, 'Zhiyu local development boundary has horizontal overflow at 390px');
  await capturePageScreenshot(cdp, path.join(evidenceRoot, 'local-development-boundary-390px.png'));
  await page.setViewportSize(originalViewport || { width: 1280, height: 800 });

  return {
    initial: initialEvidence,
    completed: completedEvidence,
    reservedPermission: {
      before: projectPermissionStatus(before),
      after: projectPermissionStatus(after),
      grantCreated: false,
    },
    runtimeAgentProductRoute: {
      admitted: false,
      disabledControlVerified: true,
      reasonCode: completedEvidence.productRouteReasonCode,
    },
    narrow,
  };
}

async function captureZhiyuDevKernelEvidence(page) {
  const raw = await page.evaluate(() => globalThis.window.__nimiZhiyuDevKernelEvidence);
  assert.ok(raw && typeof raw === 'object', 'Zhiyu local development evidence projection must be present');
  return {
    profile: String(raw.profile || ''),
    state: String(raw.state || ''),
    buildMarker: sanitizeText(String(raw.buildMarker || '')),
    agentIdPresent: Boolean(raw.agentId),
    agentIdDigest: raw.agentId ? digestText(String(raw.agentId)) : null,
    sessionState: String(raw.session?.state || ''),
    sessionBound: raw.session?.sessionBound === true,
    sessionReasonCode: String(raw.session?.reasonCode || ''),
    permissionPosture: String(raw.permission?.posture || ''),
    permissionCanRequest: raw.permission?.canRequest === true,
    permissionRequestState: String(raw.permissionRequest?.state || ''),
    permissionRequestReasonCode: String(raw.permissionRequest?.reasonCode || ''),
    storageState: String(raw.appPrivateStorage?.state || ''),
    storageReasonCode: String(raw.appPrivateStorage?.reasonCode || ''),
    productRouteAvailable: raw.productRoute?.available === true,
    productRouteReasonCode: String(raw.productRoute?.reasonCode || ''),
    lastErrorPresent: Boolean(raw.lastError),
  };
}

async function waitForEnabled(control) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await control.isEnabled()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('control did not return to enabled state');
}

async function captureDesktopAccountSession(page) {
  const captured = await page.evaluate(async () => {
    const hook = globalThis.window.__NIMI_ELECTRON_RUNTIME__;
    const status = await hook.invoke('runtime_account_session_status', {});
    const captureOnce = async (afterSequence) => {
      const pending = [];
      const unsubscribe = hook.listen('runtime_account_session_events', ({ payload }) => pending.push(payload));
      let streamId = '';
      try {
        const opened = await hook.invoke('runtime_account_session_events_open', { afterSequence });
        streamId = opened.streamId;
        const deadline = Date.now() + 10_000;
        while (Date.now() < deadline) {
          const envelope = pending.find((candidate) => candidate?.streamId === streamId);
          if (envelope) return envelope;
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        throw new Error('account stream did not deliver a snapshot or replay event');
      } finally {
        if (streamId) await hook.invoke('runtime_account_session_events_close', { streamId });
        unsubscribe();
      }
    };
    const first = await captureOnce(status.sequence);
    const replayCursor = BigInt(status.sequence) > 0n ? (BigInt(status.sequence) - 1n).toString() : '0';
    const reconnected = await captureOnce(replayCursor);
    return { status, first, reconnected };
  });
  return {
    status: projectAccountStatus(captured.status),
    firstDelivery: projectAccountEventEnvelope(captured.first),
    reconnectedDelivery: projectAccountEventEnvelope(captured.reconnected),
  };
}

async function invokeRenderer(page, command, payload) {
  return await page.evaluate(async ({ commandName, commandPayload }) => {
    try {
      return { ok: true, value: await globalThis.window.__NIMI_ELECTRON_RUNTIME__.invoke(commandName, commandPayload) };
    } catch (error) {
      const record = error && typeof error === 'object' ? error : {};
      return {
        ok: false,
        error: {
          name: typeof record.name === 'string' ? record.name : '',
          message: typeof record.message === 'string' ? record.message : String(error),
          code: typeof record.code === 'string' ? record.code : '',
          reasonCode: typeof record.reasonCode === 'string' || typeof record.reasonCode === 'number' ? record.reasonCode : '',
          actionHint: typeof record.actionHint === 'string' ? record.actionHint : '',
        },
      };
    }
  }, { commandName: command, commandPayload: payload });
}

async function capturePageScreenshot(cdp, outputPath) {
  observerStage(`screenshot-start:${path.basename(outputPath)}`);
  await cdp.send('Page.bringToFront');
  const metrics = await cdp.send('Page.getLayoutMetrics');
  const viewport = metrics.cssVisualViewport || metrics.visualViewport;
  const width = Math.max(1, Math.ceil(Number(viewport?.clientWidth || 1)));
  const height = Math.max(1, Math.ceil(Number(viewport?.clientHeight || 1)));
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await cdp.send('Emulation.setVisibleSize', { width, height });
  try {
    const captured = await withObserverTimeout(
      cdp.send('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
        captureBeyondViewport: false,
      }),
      15_000,
      `CDP screenshot timed out: ${path.basename(outputPath)}`,
    );
    fs.writeFileSync(outputPath, Buffer.from(captured.data, 'base64'));
    const evidence = {
      file: path.basename(outputPath),
      width,
      height,
      method: 'cdp-page-capture-emulated-visible-size',
    };
    screenshotCaptures.push(evidence);
    observerStage(`screenshot-complete:${path.basename(outputPath)}`);
    return evidence;
  } catch (error) {
    screenshotCaptureFailed = true;
    throw error;
  } finally {
    await cdp.send('Emulation.clearDeviceMetricsOverride').catch(() => undefined);
  }
}

function withObserverTimeout(promise, timeoutMs, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

function observerStage(stage) {
  process.stderr.write(`[electron-full-support-observer] stage=${stage}\n`);
}

async function captureDomSummary(page) {
  return await page.evaluate(() => {
    const root = document.documentElement;
    const visibleTestIds = [...document.querySelectorAll('[data-testid]')]
      .filter((element) => element instanceof HTMLElement && element.offsetParent !== null)
      .map((element) => element.getAttribute('data-testid'))
      .filter(Boolean)
      .slice(0, 160);
    const controls = [...document.querySelectorAll('button, input, textarea, select, [role="button"], [role="tab"], a[href]')]
      .filter((element) => element instanceof HTMLElement && element.offsetParent !== null)
      .slice(0, 160)
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        role: element.getAttribute('role') || '',
        type: element.getAttribute('type') || '',
        testId: element.getAttribute('data-testid') || '',
        disabled: element instanceof HTMLButtonElement || element instanceof HTMLInputElement
          ? element.disabled
          : element.getAttribute('aria-disabled') === 'true',
        name: (element.getAttribute('aria-label') || element.textContent || '').trim().slice(0, 160),
      }));
    return {
      readyState: document.readyState,
      language: document.documentElement.lang || '',
      viewport: { innerWidth, innerHeight, scrollWidth: root.scrollWidth, scrollHeight: root.scrollHeight },
      horizontalOverflow: root.scrollWidth > innerWidth + 1,
      visibleTestIds,
      controls,
    };
  }).then((summary) => ({ ...summary, controls: summary.controls.map((control) => ({ ...control, name: sanitizeText(control.name) })) }));
}

async function captureInteractiveControls(page) {
  return (await captureDomSummary(page)).controls;
}

async function captureAccessibilitySummary(cdp) {
  const tree = await cdp.send('Accessibility.getFullAXTree');
  const nodes = Array.isArray(tree.nodes) ? tree.nodes : [];
  const byRole = {};
  const namedControls = [];
  for (const node of nodes) {
    const role = String(node.role?.value || 'unknown');
    byRole[role] = (byRole[role] || 0) + 1;
    if (['button', 'textbox', 'tab', 'link', 'checkbox', 'combobox'].includes(role)) {
      namedControls.push({ role, name: sanitizeText(String(node.name?.value || '')).slice(0, 160) });
    }
  }
  return { nodeCount: nodes.length, byRole, namedControls: namedControls.slice(0, 160) };
}

function projectAccountStatus(value) {
  return {
    sequence: String(value?.sequence || ''),
    state: String(value?.state || ''),
    reasonCode: value?.reasonCode ?? null,
    accountReasonCode: value?.accountReasonCode ?? null,
    hasAccountProjection: Boolean(value?.accountProjection),
    accountProjectionDigest: value?.accountProjection ? digestText(JSON.stringify(value.accountProjection)) : null,
  };
}

function projectAccountEventEnvelope(value) {
  return {
    streamIdPresent: Boolean(value?.streamId),
    eventType: String(value?.eventType || ''),
    event: value?.event ? {
      ...projectAccountStatus(value.event),
      deliveryKind: String(value.event.deliveryKind || ''),
      replayTruncated: value.event.replayTruncated === true,
    } : null,
    error: value?.error ? sanitizeText(JSON.stringify(value.error)) : null,
  };
}

function projectRealmProof(outcome) {
  if (!outcome.ok) return { ok: false, error: sanitizeError(outcome.error) };
  const responseJson = String(outcome.value?.responseJson || '');
  return {
    ok: true,
    accepted: outcome.value?.accepted === true,
    httpStatus: Number(outcome.value?.httpStatus || 0),
    reasonCode: outcome.value?.reasonCode ?? null,
    accountReasonCode: outcome.value?.accountReasonCode ?? null,
    responseBytes: Buffer.byteLength(responseJson),
    responseDigest: responseJson ? digestText(responseJson) : null,
  };
}

function projectAuthorizations(outcome) {
  if (!outcome.ok || !Array.isArray(outcome.value)) return { available: false, error: sanitizeError(outcome.error) };
  return {
    available: true,
    count: outcome.value.length,
    activeCount: outcome.value.filter((entry) => entry?.state === 'active').length,
    apps: [...new Set(outcome.value.map((entry) => String(entry?.appId || '')).filter(Boolean))].sort(),
    states: [...new Set(outcome.value.map((entry) => String(entry?.state || '')).filter(Boolean))].sort(),
    persistence: [...new Set(outcome.value.map((entry) => String(entry?.persistence || '')).filter(Boolean))].sort(),
  };
}

function projectPendingApprovals(outcome) {
  if (!outcome.ok || !Array.isArray(outcome.value)) return { available: false, error: sanitizeError(outcome.error) };
  return {
    available: true,
    count: outcome.value.length,
    apps: [...new Set(outcome.value.map((entry) => String(entry?.appId || '')).filter(Boolean))].sort(),
    states: [...new Set(outcome.value.map((entry) => String(entry?.approvalState || '')).filter(Boolean))].sort(),
  };
}

function projectLocalDevelopmentRuns(outcome) {
  if (!outcome.ok || !Array.isArray(outcome.value)) return { available: false, error: sanitizeError(outcome.error) };
  return {
    available: true,
    count: outcome.value.length,
    apps: [...new Set(outcome.value.map((entry) => String(entry?.appId || '')).filter(Boolean))].sort(),
    states: [...new Set(outcome.value.map((entry) => String(entry?.state || '')).filter(Boolean))].sort(),
  };
}

function projectDeveloperMode(outcome) {
  if (!outcome.ok) return { available: false, error: sanitizeError(outcome.error) };
  return {
    available: true,
    enabled: outcome.value?.enabled === true,
    reasonCode: String(outcome.value?.reasonCode || ''),
  };
}

function projectRuntimeStatus(outcome) {
  if (!outcome.ok) return { available: false, error: sanitizeError(outcome.error) };
  return {
    available: true,
    running: outcome.value?.running === true,
    managed: outcome.value?.managed === true,
    launchMode: String(outcome.value?.launchMode || ''),
    version: sanitizeText(String(outcome.value?.version || '')),
  };
}

function projectRendererProbe(outcome) {
  if (!outcome.ok) return { available: false, error: sanitizeError(outcome.error) };
  return {
    available: true,
    appId: String(outcome.value?.appId || ''),
    rendererUrl: sanitizeUrl(String(outcome.value?.rendererUrl || outcome.value?.url || '')),
  };
}

function projectLocalAppSession(outcome) {
  if (!outcome.ok) return { available: false, error: sanitizeError(outcome.error) };
  return {
    available: true,
    state: String(outcome.value?.state || ''),
    reasonCode: String(outcome.value?.reasonCode || ''),
    sessionBound: outcome.value?.sessionBound === true || outcome.value?.state === 'ready',
    protectedAuthorityMaterialProjected: false,
  };
}

function projectPermissionStatus(outcome) {
  if (!outcome.ok) return { available: false, error: sanitizeError(outcome.error) };
  return {
    available: true,
    permissionId: String(outcome.value?.permissionId || ''),
    posture: String(outcome.value?.posture || outcome.value?.state || ''),
    canRequest: outcome.value?.canRequest === true,
    detail: sanitizeText(String(outcome.value?.detail || outcome.value?.reasonCode || '')),
  };
}

function sanitizeError(error) {
  return error ? {
    name: sanitizeText(error.name || ''),
    message: sanitizeText(error.message || ''),
    code: String(error.code || ''),
    reasonCode: String(error.reasonCode || ''),
    actionHint: String(error.actionHint || ''),
  } : null;
}

function sanitizeText(value) {
  return String(value || '')
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+=*/giu, 'Bearer [REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}(?:\.[A-Za-z0-9_-]{12,})?\b/gu, '[REDACTED_JWT]')
    .replace(/(?:access|refresh|session)[_-]?token\s*[:=]\s*[^\s,;]+/giu, '[REDACTED_TOKEN]')
    .slice(0, 4_000);
}

function sanitizeUrl(value) {
  try {
    const url = new URL(value);
    url.search = '';
    url.hash = '';
    return url.href;
  } catch {
    return sanitizeText(value);
  }
}

function sanitizeLocation(value) {
  return {
    url: sanitizeUrl(String(value?.url || '')),
    lineNumber: Number(value?.lineNumber || 0),
    columnNumber: Number(value?.columnNumber || 0),
  };
}

function digestText(value) {
  return `sha256:${createHash('sha256').update(String(value), 'utf8').digest('hex')}`;
}

function deduplicate(values) {
  const seen = new Set();
  return values.filter((value) => {
    const key = JSON.stringify(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseArguments(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith('--') || value === undefined || value.startsWith('--')) {
      throw new Error(`invalid observer argument: ${key || '<missing>'}`);
    }
    parsed[key.slice(2)] = value;
    index += 1;
  }
  const app = String(parsed.app || '');
  if (!['desktop', 'tester', 'zhiyu', 'avatar'].includes(app)) throw new Error(`unsupported app: ${app}`);
  const cdpPort = Number(parsed['cdp-port']);
  if (!Number.isInteger(cdpPort) || cdpPort < 1024 || cdpPort > 65535) throw new Error('invalid --cdp-port');
  const approvalApp = String(parsed['approval-app'] || '');
  if (approvalApp && (approvalApp !== app || app === 'desktop' || app === 'avatar')) {
    throw new Error('--approval-app must match tester or zhiyu');
  }
  return { app, approvalApp, cdpPort, evidenceRoot: String(parsed['evidence-root'] || '') };
}

function requireEvidenceRoot(value) {
  const resolved = path.resolve(value);
  const authority = path.join(repoRoot, '.nimi', 'local', 'acceptance');
  const relative = path.relative(authority, resolved);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('observer evidence root must be below .nimi/local/acceptance');
  }
  return resolved;
}
