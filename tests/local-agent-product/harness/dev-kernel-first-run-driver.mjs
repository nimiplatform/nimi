import fs from 'node:fs';
import path from 'node:path';

import {
  LOCAL_ENVIRONMENT_DEPENDENCY_JOBS_METHOD,
  PRODUCT_CONTROL_RECORD_METHOD,
  PRODUCT_CONTROL_SELECTED_DATA_ROOT_METHOD,
  RUNTIME_STATUS_COMMAND,
  classifyFirstRunTerminalSnapshot,
  comparablePath,
  invokeDesktop,
  invokeDesktopRuntimeUnary,
  readFixedServiceStatus,
  readProductControlJSONProjection,
  setWindowBounds,
  sha256,
  waitForTestId,
  waitUntil,
} from './dev-kernel-host-driver.mjs';

const SECRET_TEXT = /(?:bearer\s+[a-z0-9._~+/=-]+|(?:access|refresh|id)[_-]?token\s*[:=]|eyj[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}\.)/iu;

export async function completeDesktopFirstRun(connection, trial, screenshotsRoot, options = {}) {
  const { page } = connection;
  const startingPhase = await waitUntil(async () => {
    const phase = page.getByTestId('first-run-phase-storage');
    if (await phase.isVisible().catch(() => false)) {
      return await phase.getAttribute('data-phase-transient') === 'false' ? 'storage-ready' : null;
    }
    if (options.resumeFromDevice === true
      && await page.getByTestId('first-run-phase-device-scan').isVisible().catch(() => false)) {
      return 'device-scan-resume';
    }
    if (await page.getByTestId('main-shell').isVisible().catch(() => false)
      && typeof options.reuseReadyCandidateId === 'string') {
      return 'ready-shell-transition';
    }
    if (await page.getByTestId('login-screen').isVisible().catch(() => false)
      || await page.getByTestId('main-shell').isVisible().catch(() => false)) {
      return 'unexpected-auth-shell';
    }
    if (await page.getByTestId('app-bootstrap-error-screen').isVisible().catch(() => false)) {
      return 'bootstrap-error';
    }
    return null;
  }, { timeoutMs: 120_000, intervalMs: 100, label: 'Desktop first-run starting phase' });
  if (startingPhase === 'ready-shell-transition') {
    const productControlRecord = await readProductControlJSONProjection(
      page,
      PRODUCT_CONTROL_RECORD_METHOD,
    );
    return captureReusedReadyFirstRun(
      page,
      productControlRecord,
      options.reuseReadyCandidateId,
    );
  }
  if (startingPhase !== 'storage-ready' && startingPhase !== 'device-scan-resume') {
    throw new Error(startingPhase === 'unexpected-auth-shell'
      ? 'isolated Desktop trial skipped the required first-run gate'
      : 'Desktop entered bootstrap error before first-run');
  }

  const expectedDataRoot = comparablePath(trial.paths.runtimeData);
  let desktopPath = null;
  let narrowMethod = null;
  let narrowPath = null;
  let narrowMetrics = null;
  let selectedDataRoot;
  let serviceAfterStorage;
  if (startingPhase === 'storage-ready') {
    const displayedDataRoot = comparablePath(await page.getByTestId('first-run-storage-path').innerText());
    const hostProfileDataRoot = process.env.USERPROFILE
      ? comparablePath(path.join(process.env.USERPROFILE, 'Nimi'))
      : null;
    if (displayedDataRoot !== expectedDataRoot) {
      throw new Error(`first-run Storage proposed ${displayedDataRoot}, expected Runtime-owned proposal ${expectedDataRoot}`);
    }
    if (hostProfileDataRoot && expectedDataRoot === hostProfileDataRoot) {
      throw new Error(`first-run Storage resolved to the host profile root ${hostProfileDataRoot}`);
    }
    desktopPath = path.join(screenshotsRoot, 'desktop-first-run-storage.png');
    await page.screenshot({ path: desktopPath });
    narrowMethod = await setWindowBounds(connection, 390, 780);
    narrowPath = path.join(screenshotsRoot, 'desktop-first-run-storage-narrow.png');
    await page.screenshot({ path: narrowPath });
    narrowMetrics = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    await setWindowBounds(connection, 1440, 940);

    const serviceBeforeStorage = readFixedServiceStatus();
    const continueStorage = page.getByTestId('first-run-storage-continue');
    if (await continueStorage.isDisabled()) throw new Error('first-run Storage continue is disabled for the isolated proposal');
    const storageContinueHandled = typeof options.beforeStorageContinue === 'function'
      ? await options.beforeStorageContinue({ page, continueStorage }) === true
      : false;
    if (!storageContinueHandled) await continueStorage.click();
    const storageTransition = await waitUntil(async () => {
      if (await page.getByTestId('first-run-phase-device-scan').isVisible().catch(() => false)) {
        return { kind: 'advanced' };
      }
      const error = page.getByTestId('product-first-run-error');
      if (await error.isVisible().catch(() => false)) {
        return { kind: 'error', message: (await error.innerText()).slice(0, 1_000) };
      }
      const workflow = page.getByTestId('product-first-run-workflow');
      const pendingAction = await workflow.getAttribute('data-pending-action').catch(() => '');
      if (!pendingAction && !(await continueStorage.isDisabled().catch(() => true))) {
        return { kind: 'stalled', message: 'Storage mutation returned without advancing product state' };
      }
      return null;
    }, { timeoutMs: 120_000, intervalMs: 100, label: 'first-run Storage mutation completion' });
    if (storageTransition.kind !== 'advanced') {
      throw new Error(`first-run Storage failed: ${storageTransition.message}`);
    }
    serviceAfterStorage = await waitUntil(() => {
      const status = readFixedServiceStatus();
      return status.processId !== serviceBeforeStorage.processId ? status : null;
    }, {
      timeoutMs: 120_000,
      intervalMs: 500,
      label: 'fixed service PID replacement after first-run Storage sync',
    });
    selectedDataRoot = await readProductControlJSONProjection(page, PRODUCT_CONTROL_SELECTED_DATA_ROOT_METHOD);
    if (comparablePath(selectedDataRoot?.dataRoot?.path) !== expectedDataRoot) {
      throw new Error(`Runtime selected data root ${selectedDataRoot?.dataRoot?.path || '<missing>'}, expected ${trial.paths.runtimeData}`);
    }
  } else {
    selectedDataRoot = await readProductControlJSONProjection(page, PRODUCT_CONTROL_SELECTED_DATA_ROOT_METHOD);
    if (comparablePath(selectedDataRoot?.dataRoot?.path) !== expectedDataRoot) {
      throw new Error(`Runtime selected data root ${selectedDataRoot?.dataRoot?.path || '<missing>'}, expected ${trial.paths.runtimeData}`);
    }
    serviceAfterStorage = readFixedServiceStatus();
  }

  await waitForTestId(page, 'first-run-phase-device-scan', 120_000);
  let phaseAcceptance = null;
  if (options.captureAllPhases === true) {
    const initialDeviceControls = await page.evaluate(() => {
      const summary = document.querySelector('[data-testid="first-run-device-summary"]');
      const continueButton = document.querySelector('[data-testid="first-run-device-scan-continue"]');
      return {
        scanState: summary?.getAttribute('data-device-scan') || '',
        continueDisabled: continueButton instanceof HTMLButtonElement
          ? continueButton.disabled
          : null,
      };
    });
    const deviceInitialPath = path.join(screenshotsRoot, 'desktop-first-run-device-initial.png');
    await page.screenshot({ path: deviceInitialPath });
    const deviceNarrowMethod = await setWindowBounds(connection, 390, 780);
    const deviceNarrowPath = path.join(screenshotsRoot, 'desktop-first-run-device-initial-narrow.png');
    await page.screenshot({ path: deviceNarrowPath });
    const deviceNarrowMetrics = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    await setWindowBounds(connection, 1440, 940);
    phaseAcceptance = {
      deviceInitialScanState: initialDeviceControls.scanState,
      deviceContinueInitiallyDisabled: initialDeviceControls.scanState === 'pending'
        ? initialDeviceControls.continueDisabled
        : null,
      deviceInitialPath,
      deviceNarrowPath,
      deviceNarrowMethod,
      deviceNarrowMetrics,
    };
  }
  await waitUntil(async () => {
    const summary = page.getByTestId('first-run-device-summary');
    if (await summary.getAttribute('data-device-scan') !== 'settled') return false;
    const button = page.getByTestId('first-run-device-scan-continue');
    return !(await button.isDisabled()) ? button : false;
  }, { timeoutMs: 120_000, intervalMs: 250, label: 'settled first-run device scan' });
  if (phaseAcceptance) {
    phaseAcceptance.deviceSettledPath = path.join(screenshotsRoot, 'desktop-first-run-device-settled.png');
    await page.screenshot({ path: phaseAcceptance.deviceSettledPath });
  }
  if (options.exerciseDeviceRetry === true) {
    const retry = page.getByTestId('first-run-device-scan-retry');
    if (await retry.isDisabled()) throw new Error('first-run Device retry is disabled after a settled scan');
    await retry.click();
    const pendingControls = await waitUntil(async () => page.evaluate(() => {
      const summary = document.querySelector('[data-testid="first-run-device-summary"]');
      if (summary?.getAttribute('data-device-scan') !== 'pending') return null;
      const retryButton = document.querySelector('[data-testid="first-run-device-scan-retry"]');
      const continueButton = document.querySelector('[data-testid="first-run-device-scan-continue"]');
      if (!(retryButton instanceof HTMLButtonElement) || !(continueButton instanceof HTMLButtonElement)) return null;
      return {
        retryDisabled: retryButton.disabled,
        continueDisabled: continueButton.disabled,
      };
    }), { timeoutMs: 30_000, intervalMs: 10, label: 'first-run Device retry pending controls' });
    const retryDisabledWhilePending = pendingControls.retryDisabled;
    const continueDisabledWhilePending = pendingControls.continueDisabled;
    if (!retryDisabledWhilePending || !continueDisabledWhilePending) {
      throw new Error('first-run Device retry did not disable retry and continue while scan evidence was pending');
    }
    if (phaseAcceptance) {
      phaseAcceptance.deviceRetryPendingPath = path.join(screenshotsRoot, 'desktop-first-run-device-retry-pending.png');
      phaseAcceptance.deviceRetryDisabledWhilePending = retryDisabledWhilePending;
      phaseAcceptance.deviceContinueDisabledWhileRetryPending = continueDisabledWhilePending;
      await page.screenshot({ path: phaseAcceptance.deviceRetryPendingPath });
    }
    await waitUntil(async () => {
      const summary = page.getByTestId('first-run-device-summary');
      if (await summary.getAttribute('data-device-scan') !== 'settled') return false;
      return !(await page.getByTestId('first-run-device-scan-continue').isDisabled());
    }, { timeoutMs: 120_000, intervalMs: 100, label: 'settled first-run Device retry' });
  }
  await page.getByTestId('first-run-device-scan-continue').click();

  await waitForTestId(page, 'first-run-phase-local-ai', 120_000);
  if (phaseAcceptance) {
    phaseAcceptance.localAiContinueInitiallyDisabled = await page.getByTestId('first-run-local-ai-continue').isDisabled();
    phaseAcceptance.localAiPath = path.join(screenshotsRoot, 'desktop-first-run-local-ai.png');
    await page.screenshot({ path: phaseAcceptance.localAiPath });
    const localAiNarrowMethod = await setWindowBounds(connection, 390, 780);
    phaseAcceptance.localAiNarrowPath = path.join(screenshotsRoot, 'desktop-first-run-local-ai-narrow.png');
    await page.screenshot({ path: phaseAcceptance.localAiNarrowPath });
    phaseAcceptance.localAiNarrowMethod = localAiNarrowMethod;
    phaseAcceptance.localAiNarrowMetrics = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    await setWindowBounds(connection, 1440, 940);
  }
  const minimal = page.getByTestId('first-run-install-level-minimal');
  if (await minimal.isDisabled()) throw new Error('first-run Minimal plan is unavailable');
  await minimal.click();
  await waitUntil(async () => await minimal.getAttribute('data-selected') === 'true', {
    timeoutMs: 30_000,
    label: 'first-run Minimal selection',
  });
  const continueLocalAi = page.getByTestId('first-run-local-ai-continue');
  if (await continueLocalAi.isDisabled()) throw new Error('first-run Local AI continue stayed disabled after Minimal selection');
  await continueLocalAi.click();

  if (phaseAcceptance) {
    const setupArrival = await waitUntil(async () => {
      if (await page.getByTestId('first-run-phase-setup').isVisible().catch(() => false)) return 'setup';
      if (await page.getByTestId('login-screen').isVisible().catch(() => false)
        || await page.getByTestId('main-shell').isVisible().catch(() => false)) return 'ready';
      return null;
    }, { timeoutMs: 120_000, intervalMs: 100, label: 'first-run Setup phase' });
    phaseAcceptance.setupObserved = setupArrival === 'setup';
    if (setupArrival === 'setup') {
      phaseAcceptance.setupPath = path.join(screenshotsRoot, 'desktop-first-run-setup.png');
      await page.screenshot({ path: phaseAcceptance.setupPath });
      phaseAcceptance.setupNarrowMethod = await setWindowBounds(connection, 390, 780);
      phaseAcceptance.setupNarrowPath = path.join(screenshotsRoot, 'desktop-first-run-setup-narrow.png');
      await page.screenshot({ path: phaseAcceptance.setupNarrowPath });
      phaseAcceptance.setupNarrowMetrics = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      await setWindowBounds(connection, 1440, 940);
    }
  }

  let setupRuntimeUnavailableObservedAt = 0;
  let setupRuntimeUnavailableCarrierRecovered = false;
  let setupRuntimeUnavailableRetryIssued = false;
  const setupRuntimeUnavailableGraceMs = 360_000;
  let finalizationRuntimeUnavailableObservedAt = 0;
  let finalizationRuntimeUnavailableCarrierRecovered = false;
  let finalizationRuntimeUnavailableRetryIssued = false;
  const finalizationRuntimeUnavailableGraceMs = 360_000;
  const ready = await waitUntil(async () => {
    const authShellVisible = await page.getByTestId('login-screen').isVisible().catch(() => false)
      || await page.getByTestId('main-shell').isVisible().catch(() => false);
    const explicitFailures = [];
    for (const testId of [
      'first-run-setup-error',
      'product-first-run-finalization-error',
      'first-run-repair-reason',
      'app-bootstrap-error-screen',
    ]) {
      const failure = page.getByTestId(testId);
      const visible = await failure.isVisible().catch(() => false);
      explicitFailures.push({
        testId,
        visible,
        text: visible ? await failure.innerText().catch(() => '') : '',
      });
    }
    const setupFailure = explicitFailures.find((failure) => failure.testId === 'first-run-setup-error');
    if (!authShellVisible
      && setupFailure?.visible === true
      && setupFailure.text.trim() === 'runtime-service-unavailable') {
      if (setupRuntimeUnavailableObservedAt === 0) {
        setupRuntimeUnavailableObservedAt = Date.now();
        if (phaseAcceptance) {
          phaseAcceptance.setupRuntimeUnavailableObserved = true;
          phaseAcceptance.setupRuntimeUnavailablePath = path.join(
            screenshotsRoot,
            'desktop-first-run-setup-runtime-unavailable.png',
          );
          await page.screenshot({ path: phaseAcceptance.setupRuntimeUnavailablePath });
        }
      }
      if (Date.now() - setupRuntimeUnavailableObservedAt <= setupRuntimeUnavailableGraceMs) {
        if (!setupRuntimeUnavailableCarrierRecovered) {
          const record = await readProductControlJSONProjection(
            page,
            PRODUCT_CONTROL_RECORD_METHOD,
          ).catch(() => null);
          setupRuntimeUnavailableCarrierRecovered = Boolean(record?.state);
          if (phaseAcceptance && setupRuntimeUnavailableCarrierRecovered) {
            phaseAcceptance.setupRuntimeUnavailableCarrierRecovered = true;
          }
        }
        const setupRetry = page.getByTestId('first-run-setup-retry');
        if (setupRuntimeUnavailableCarrierRecovered
          && !setupRuntimeUnavailableRetryIssued
          && await setupRetry.isVisible().catch(() => false)
          && await setupRetry.isEnabled().catch(() => false)) {
          await setupRetry.click();
          setupRuntimeUnavailableRetryIssued = true;
          if (phaseAcceptance) phaseAcceptance.setupRuntimeUnavailableRetryIssued = true;
        }
        return null;
      }
    }
    const finalizationFailure = explicitFailures.find(
      (failure) => failure.testId === 'product-first-run-finalization-error',
    );
    if (!authShellVisible
      && finalizationFailure?.visible === true
      && finalizationFailure.text.trim() === 'runtime-service-unavailable'
      && !finalizationRuntimeUnavailableRetryIssued) {
      if (finalizationRuntimeUnavailableObservedAt === 0) {
        finalizationRuntimeUnavailableObservedAt = Date.now();
        if (phaseAcceptance) {
          phaseAcceptance.finalizationRuntimeUnavailableObserved = true;
          phaseAcceptance.finalizationRuntimeUnavailablePath = path.join(
            screenshotsRoot,
            'desktop-first-run-finalization-runtime-unavailable.png',
          );
          await page.screenshot({ path: phaseAcceptance.finalizationRuntimeUnavailablePath });
        }
      }
      if (Date.now() - finalizationRuntimeUnavailableObservedAt <= finalizationRuntimeUnavailableGraceMs) {
        if (!finalizationRuntimeUnavailableCarrierRecovered) {
          const [status, record] = await Promise.all([
            invokeDesktop(page, RUNTIME_STATUS_COMMAND).catch(() => null),
            readProductControlJSONProjection(page, PRODUCT_CONTROL_RECORD_METHOD).catch(() => null),
          ]);
          finalizationRuntimeUnavailableCarrierRecovered = Boolean(
            status?.running === true && status?.managed === true && record?.state,
          );
          if (phaseAcceptance && finalizationRuntimeUnavailableCarrierRecovered) {
            phaseAcceptance.finalizationRuntimeUnavailableCarrierRecovered = true;
          }
        }
        const finalizationRetry = page.getByTestId('product-first-run-finalization-retry');
        if (finalizationRuntimeUnavailableCarrierRecovered
          && await finalizationRetry.isVisible().catch(() => false)
          && await finalizationRetry.isEnabled().catch(() => false)) {
          await finalizationRetry.click();
          finalizationRuntimeUnavailableRetryIssued = true;
          if (phaseAcceptance) phaseAcceptance.finalizationRuntimeUnavailableRetryIssued = true;
        }
        return null;
      }
    }
    const setupRetry = page.getByTestId('first-run-setup-retry');
    const setupRetryVisible = await setupRetry.isVisible().catch(() => false);
    return classifyFirstRunTerminalSnapshot({
      authShellVisible,
      explicitFailures,
      setupRetryVisible,
      setupText: setupRetryVisible
        ? await page.getByTestId('first-run-phase-setup').innerText().catch(() => '')
        : '',
    });
  }, { timeoutMs: 600_000, intervalMs: 500, label: 'Desktop first-run backend admission' });
  if (ready.kind === 'failure') {
    const record = await readProductControlJSONProjection(page, PRODUCT_CONTROL_RECORD_METHOD).catch(() => null);
    const dependencyJobs = await readLocalEnvironmentDependencyJobDiagnostics(page).catch(() => []);
    const failedJobs = dependencyJobs.filter((job) => job.state === 'failed' || job.state === 'repair_required');
    const failureEvidence = {
      schemaVersion: 'nimi.dev-kernel-first-run-terminal-failure/v1',
      observedAt: new Date().toISOString(),
      terminal: ready,
      productControl: record,
      failedJobs,
    };
    const failurePath = path.join(path.dirname(screenshotsRoot), 'first-run-terminal-failure.json');
    fs.writeFileSync(failurePath, `${JSON.stringify(failureEvidence, null, 2)}\n`, { mode: 0o600 });
    await page.screenshot({ path: path.join(screenshotsRoot, 'desktop-first-run-terminal-failure.png') });
    const primary = failedJobs.find((job) => job.failureDetail) || failedJobs[0];
    const ownerReason = primary
      ? `${primary.dependencyFamily}/${primary.dependencyId} ${primary.reasonCode || primary.state}: ${primary.failureDetail || '<no detail>'}`
      : ready.text || 'no dependency-job failure projection was returned';
    throw new Error(`Desktop first-run failed at ${ready.testId}: ${ready.text}; Runtime owner reason: ${ownerReason}`);
  }
  const record = await readProductControlJSONProjection(page, PRODUCT_CONTROL_RECORD_METHOD);
  if (ready.kind !== 'auth-shell' || record?.state !== 'ready_for_use') {
    throw new Error(`Desktop first-run did not reach backend-admitted ready_for_use: ${JSON.stringify(record)}`);
  }
  const serviceAfterReady = readFixedServiceStatus();
  return {
    selectedDataRoot,
    productState: record.state,
    productControlRecord: record,
    serviceAfterStorage,
    serviceAfterReady,
    layout: { desktopPath, narrowPath, narrowMethod, narrowMetrics, phaseAcceptance },
  };
}

export async function captureReusedReadyFirstRun(page, productControlRecord, candidateId) {
  if (productControlRecord?.state !== 'ready_for_use') {
    throw new Error(`Desktop cannot reuse non-ready Product Control: ${JSON.stringify(productControlRecord)}`);
  }
  const expectedDataRoot = requireCheckpointDataRootProposal(productControlRecord, candidateId);
  let rendererReloadedForReadyContinuity = false;
  try {
    await waitForTestId(page, 'main-shell', 15_000);
  } catch {
    const current = await readProductControlJSONProjection(page, PRODUCT_CONTROL_RECORD_METHOD);
    if (current?.state !== 'ready_for_use') {
      throw new Error(`Desktop ready transition regressed before renderer reload: ${JSON.stringify(current)}`);
    }
    rendererReloadedForReadyContinuity = true;
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
    try {
      await waitForTestId(page, 'main-shell', 30_000);
    } catch (error) {
      const diagnostics = await readDesktopRuntimeDiagnostics(page);
      const surface = await page.evaluate(() => {
        const visible = (testId) => {
          const element = document.querySelector(`[data-testid="${testId}"]`);
          return element instanceof HTMLElement && element.offsetParent !== null;
        };
        const workflow = document.querySelector('[data-testid="product-first-run-workflow"]');
        return {
          pathname: location.pathname,
          loginVisible: visible('login-screen'),
          mainShellVisible: visible('main-shell'),
          firstRunGateVisible: visible('desktop-first-run-gate'),
          bootstrapErrorVisible: visible('app-bootstrap-error-screen'),
          admissionFailureVisible: visible('desktop-admission-failed'),
          productState: workflow?.getAttribute('data-product-state') || '',
        };
      });
      throw new Error(`Desktop renderer reload did not restore the ready shell: ${JSON.stringify({ surface, diagnostics })}`, { cause: error });
    }
  }
  const selectedDataRoot = await readProductControlJSONProjection(
    page,
    PRODUCT_CONTROL_SELECTED_DATA_ROOT_METHOD,
  );
  if (comparablePath(selectedDataRoot?.dataRoot?.path) !== comparablePath(expectedDataRoot)) {
    throw new Error(`ready Product Control selected data root ${selectedDataRoot?.dataRoot?.path || '<missing>'}, expected ${expectedDataRoot}`);
  }
  const serviceAtReady = readFixedServiceStatus();
  return {
    selectedDataRoot,
    productState: productControlRecord.state,
    productControlRecord,
    serviceAfterStorage: serviceAtReady,
    serviceAfterReady: serviceAtReady,
    reusedReady: true,
    rendererReloadedForReadyContinuity,
    layout: { narrowMetrics: null, phaseAcceptance: null },
  };
}

async function readLocalEnvironmentDependencyJobDiagnostics(page) {
  const response = await invokeDesktopRuntimeUnary(page, LOCAL_ENVIRONMENT_DEPENDENCY_JOBS_METHOD);
  return (response?.jobs || []).map((job) => ({
    jobId: String(job.jobId || ''),
    environmentKey: String(job.environmentKey || ''),
    dependencyFamily: String(job.dependencyFamily || ''),
    dependencyId: String(job.dependencyId || ''),
    state: String(job.state || ''),
    sourceKind: String(job.sourceKind || ''),
    canonicalRoot: String(job.canonicalRoot || ''),
    selectedSourceRecordId: String(job.selectedSourceRecordId || ''),
    failureDetail: String(job.failureDetail || '').slice(0, 4_096),
    retryable: job.retryable === true,
    reasonCode: String(job.reasonCode || ''),
    recoveryDisposition: String(job.recoveryDisposition || ''),
    consumerScope: String(job.consumerScope || ''),
  }));
}

export async function prepareDesktopFixedServiceBaseline(page) {
  const service = readFixedServiceStatus();
  await waitUntil(async () => {
    const status = await invokeDesktop(page, RUNTIME_STATUS_COMMAND);
    return status?.running === true && status?.managed === true ? status : null;
  }, { timeoutMs: 60_000, intervalMs: 250, label: 'fixed-service preflight protected carrier' });

  let account = await waitUntil(async () => {
    const status = await invokeDesktop(page, 'runtime_account_session_status');
    return status?.state ? status : null;
  }, { timeoutMs: 30_000, intervalMs: 250, label: 'fixed-service preflight account status' });
  const initialAccountState = account.state;
  if (account.state !== 'anonymous') {
    const loggedOut = await invokeDesktop(page, 'runtime_account_logout', {
      payload: { reason: 'dev_kernel_preflight_reset' },
    });
    if (loggedOut?.accepted !== true) {
      throw new Error(`fixed-service preflight account reset was rejected: ${JSON.stringify(loggedOut)}`);
    }
    account = await waitUntil(async () => {
      const status = await invokeDesktop(page, 'runtime_account_session_status');
      return status?.state === 'anonymous' ? status : null;
    }, { timeoutMs: 30_000, intervalMs: 250, label: 'fixed-service anonymous account baseline' });
  }
  if (account.state !== 'anonymous') {
    throw new Error(`fixed-service preflight retained non-anonymous account state: ${JSON.stringify(account)}`);
  }
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
  return { service, initialAccountState, accountState: account.state };
}

export async function setFixtureAccount(fixtureOrigin, accountId, displayName) {
  const response = await fetch(`${fixtureOrigin}/__fixture/control/current-user`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accountId, displayName }),
  });
  if (!response.ok) throw new Error(`fixture account switch failed with ${response.status}`);
  return response.json();
}

export async function loginDesktop(connection, expectedAccountId) {
  const { page } = connection;
  const mainShell = page.getByTestId('main-shell');
  if (await mainShell.isVisible().catch(() => false)) {
    await page.getByTestId('desktop-account-menu-trigger').click();
    await page.getByTestId('desktop-account-switch').click();
  }
  await waitForTestId(page, 'login-screen', 60_000);
  await page.getByTestId('login-logo-trigger').click();
  let outcome;
  try {
    outcome = await waitUntil(async () => {
      if (await page.getByTestId('main-shell').isVisible().catch(() => false)) return 'main-shell';
      if (await page.getByTestId('desktop-first-run-gate').isVisible().catch(() => false)) return 'first-run';
      const bodyText = await page.locator('body').innerText().catch(() => '');
      return /Authorization failed|授权失败|App is still starting|Runtime account service is unavailable/iu.test(bodyText)
        ? 'auth-error'
        : false;
    }, { timeoutMs: 300_000, label: 'Desktop login completion after real browser authentication' });
  } catch (error) {
    const diagnostics = await readDesktopRuntimeDiagnostics(page);
    let cleanup;
    try {
      cleanup = await invokeDesktop(page, 'runtime_account_logout', {
        payload: { reason: 'dev_kernel_login_timeout_cleanup' },
      });
    } catch (cleanupError) {
      cleanup = { error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError) };
    }
    throw new Error(`Desktop login did not converge before timeout: ${JSON.stringify({ diagnostics, cleanup })}`, { cause: error });
  }
  if (outcome === 'auth-error') {
    const diagnostics = await readDesktopRuntimeDiagnostics(page);
    throw new Error(`Desktop login failed before main shell: ${JSON.stringify(diagnostics)}`);
  }
  const account = await waitUntil(async () => {
    const status = await invokeDesktop(page, 'runtime_account_session_status').catch(() => null);
    return status?.state === 'authenticated' ? status : null;
  }, { timeoutMs: 30_000, intervalMs: 250, label: 'Runtime-owned authenticated account projection' });
  if (account.accountProjection?.accountId !== expectedAccountId) {
    throw new Error(`Desktop login resolved unexpected account ${account.accountProjection?.accountId || '<missing>'}`);
  }
  return {
    outcome,
    accountId: account.accountProjection.accountId,
    accountLabel: outcome === 'main-shell'
      ? await page.getByTestId('desktop-account-menu-trigger').textContent()
      : '',
  };
}

export async function readDesktopRuntimeDiagnostics(page) {
  const read = async (command) => {
    try {
      return { ok: true, value: await invokeDesktop(page, command) };
    } catch (error) {
      return {
        ok: false,
        error: {
          message: error instanceof Error ? error.message : String(error || 'unknown'),
          code: typeof error === 'object' && error ? String(error.code || '') : '',
          reasonCode: typeof error === 'object' && error ? String(error.reasonCode || '') : '',
        },
      };
    }
  };
  const visibleText = await page.locator('body').innerText().catch(() => '');
  const boundedVisibleText = visibleText.trim().slice(0, 4_000);
  return {
    runtimeBridge: await read(RUNTIME_STATUS_COMMAND),
    accountSession: await read('runtime_account_session_status'),
    page: await page.evaluate(() => ({ title: document.title, pathname: location.pathname })),
    visibleText: SECRET_TEXT.test(boundedVisibleText)
      ? { redacted: true, sha256: sha256(boundedVisibleText), bytes: Buffer.byteLength(boundedVisibleText) }
      : { redacted: false, text: boundedVisibleText },
  };
}
