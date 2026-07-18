import path from 'node:path';

import {
  beginObservedProcess,
  waitForObservedProcessConnection,
} from './dev-kernel-contract.mjs';
import { terminateProcessTree } from './cross-app-driver.mjs';
import {
  connectCdp,
  invokeDesktop,
  readFixedServiceStatus,
  setWindowBounds,
  waitForCdpEndpointRelease,
  waitForTestId,
  waitUntil,
} from './dev-kernel-host-driver.mjs';
import { loginDesktop, setFixtureAccount } from './dev-kernel-first-run-driver.mjs';
import {
  approveLocalDevelopment,
  pageAudit,
  projectRuntimeUiEvidence,
  readRememberedAuthorization,
  revokeProjectAuthorization,
  setDeveloperMode,
  startZhiyuDev,
  verifyAppPrivateStorage,
  waitZhiyuEvidence,
} from './dev-kernel-local-development-driver.mjs';
import { persistCoreResult } from './dev-kernel-result-driver.mjs';

export async function runCoreReactivationJourney({
  architecture,
  journey,
  trial,
  sourceState,
  outputDir,
  fixture,
  fixtureConfig,
  providerRawPath,
  observations,
  artifactsRoot,
  screenshotsRoot,
  desktop,
  observer,
  observedPages,
  processLedger,
  processLogOptions,
  observeRegisteredProcess,
  browserAuth,
  baseEnv,
  zhiyuCdpPort,
  firstStorage,
  secondStorage,
  serviceBefore,
  startedAt,
  started,
  buildMarker,
  setPhase,
  setReactivatedHandle,
  setFinalHandle,
  setActiveZhiyuConnection,
  auditBrowserAuth,
}) {
  setPhase('remembered-reactivation');
  const reactivatedLaunch = beginObservedProcess({
    connect: () => connectCdp(zhiyuCdpPort, 'reactivated Zhiyu', 180_000, observer),
    start: () => startZhiyuDev(baseEnv, processLogOptions('zhiyu-reactivated-launcher')),
  });
  let reactivatedHandle = reactivatedLaunch.handle;
  setReactivatedHandle(reactivatedHandle);
  observeRegisteredProcess('zhiyu', reactivatedHandle, 'zhiyu-reactivated-launcher');
  observations.reactivationApproval = await approveLocalDevelopment(
    desktop,
    'allow-remember-project',
    screenshotsRoot,
    false,
    browserAuth('primary', fixtureConfig.primaryAccountId, 'reactivated-local-development'),
  );
  const zhiyu = await waitForObservedProcessConnection({
    connectionPromise: reactivatedLaunch.connectionPromise,
    handle: reactivatedHandle,
    label: 'reactivated Zhiyu Electron launcher',
  });
  setActiveZhiyuConnection(zhiyu);
  await waitForTestId(zhiyu.page, 'zhiyu-dev-kernel-root');
  await zhiyu.page.getByTestId('zhiyu-dev-kernel-refresh').click();
  await waitZhiyuEvidence(
    zhiyu.page,
    { sessionBound: true, permissionPosture: 'unavailable', buildMarker: 'baseline' },
    'reactivated authority boundary',
  );
  const reactivatedStorage = await verifyAppPrivateStorage(zhiyu.page);
  observations.reactivatedAppPrivateStorage = reactivatedStorage;
  observations.reactivatedAuthorization = await waitUntil(
    () => readRememberedAuthorization(desktop.page, {
      accountId: fixtureConfig.primaryAccountId,
      selector: observations.rememberedAuthorization.selector,
      state: 'active',
    }),
    { timeoutMs: 30_000, label: 'reactivated remembered authorization' },
  );

  setPhase('fixed-service-restart');
  const runtimeBeforeRestart = readFixedServiceStatus();
  await desktop.page.getByTestId('nav-tab:runtime').click();
  const restartButton = await waitForTestId(desktop.page, 'runtime-service-restart');
  const restart = restartButton.click();
  const runtimeUnavailableEvidence = await waitUntil(async () => {
    await zhiyu.page.getByTestId('zhiyu-dev-kernel-refresh').click().catch(() => undefined);
    return zhiyu.page.evaluate(() => {
      const evidence = window.__nimiZhiyuDevKernelEvidence;
      return evidence?.state === 'runtime-unavailable' ? evidence : null;
    }).catch(() => null);
  }, { timeoutMs: 60_000, intervalMs: 50, label: 'Zhiyu Runtime-unavailable UI during fixed-service restart' });
  await zhiyu.page.screenshot({ path: path.join(screenshotsRoot, 'zhiyu-runtime-unavailable.png') });
  await restart;
  const runtimeAfterRestart = await waitUntil(() => {
    const status = readFixedServiceStatus();
    return status.processId !== runtimeBeforeRestart.processId ? status : null;
  }, { timeoutMs: 60_000, intervalMs: 500, label: 'fixed service PID rotation' });
  processLedger.observe('runtime', `pid:${runtimeAfterRestart.processId}`, {
    kind: 'fixed-service-process',
    pid: runtimeAfterRestart.processId,
    phase: 'explicit-runtime-restart',
  });
  await zhiyu.page.getByTestId('zhiyu-dev-kernel-refresh').click();
  const runtimeRecoveredEvidence = await waitZhiyuEvidence(
    zhiyu.page,
    { sessionBound: true, permissionPosture: 'unavailable' },
    'post-Runtime-restart authority boundary',
    90_000,
  );
  const postRuntimeStorage = await verifyAppPrivateStorage(zhiyu.page);
  await zhiyu.page.screenshot({ path: path.join(screenshotsRoot, 'zhiyu-runtime-recovered.png') });
  observations.runtimeRestart = {
    before: runtimeBeforeRestart,
    after: runtimeAfterRestart,
    unavailableUi: projectRuntimeUiEvidence(runtimeUnavailableEvidence),
    recoveredUi: projectRuntimeUiEvidence(runtimeRecoveredEvidence),
    storageBefore: reactivatedStorage.appPrivateStorage,
    storageAfter: postRuntimeStorage.appPrivateStorage,
  };

  const desktopAuditBeforeSwitch = await pageAudit(desktop, 'desktop-before-account-switch');
  const zhiyuAuditBeforeSwitch = await pageAudit(zhiyu, 'zhiyu-before-account-switch');
  setPhase('secondary-account-switch');
  const secondaryLogin = await loginDesktop(
    desktop,
    fixtureConfig.secondaryAccountId,
    browserAuth('secondary', fixtureConfig.secondaryAccountId, 'secondary-login'),
  );
  await setFixtureAccount(fixture.origin, fixtureConfig.secondaryAccountId, '开发内核第二账号');
  await zhiyu.page.getByTestId('zhiyu-dev-kernel-refresh').click().catch(() => undefined);
  const accountSwitchEvidence = await waitUntil(async () => {
    const evidence = await zhiyu.page.evaluate(() => window.__nimiZhiyuDevKernelEvidence || null).catch(() => null);
    return evidence?.session?.sessionBound === false
      && ['account-changed', 'revoked', 'process-replaced'].some((reason) => String(evidence.session.reasonCode || '').includes(reason))
      ? evidence
      : null;
  }, { timeoutMs: 30_000, label: 'session invalidation after account switch' });
  const accountSwitchRuns = await invokeDesktop(desktop.page, 'local_development_runs_list');
  const desktopAuditAfterSwitch = await pageAudit(desktop, 'desktop-after-account-switch');
  const zhiyuAuditAfterSwitch = await pageAudit(zhiyu, 'zhiyu-after-account-switch-denial');
  observations.accountSwitch = {
    login: secondaryLogin,
    evidence: accountSwitchEvidence,
    runs: accountSwitchRuns,
    auditLabels: [desktopAuditAfterSwitch.label, zhiyuAuditAfterSwitch.label],
  };
  if (reactivatedHandle.child.exitCode === null) await terminateProcessTree(reactivatedHandle);
  reactivatedHandle = null;
  setReactivatedHandle(null);
  await waitForCdpEndpointRelease(zhiyuCdpPort, 'secondary-account Zhiyu');

  setPhase('primary-account-restore');
  const restoredPrimaryLogin = await loginDesktop(
    desktop,
    fixtureConfig.primaryAccountId,
    browserAuth('primary', fixtureConfig.primaryAccountId, 'primary-login-restored'),
  );
  await setFixtureAccount(fixture.origin, fixtureConfig.primaryAccountId, '开发内核主账号');
  observations.primaryAccountRestored = restoredPrimaryLogin;
  await setDeveloperMode(desktop.page, true);
  setPhase('final-primary-reactivation');
  const finalLaunch = beginObservedProcess({
    connect: () => connectCdp(zhiyuCdpPort, 'final primary Zhiyu', 180_000, observer),
    start: () => startZhiyuDev(baseEnv, processLogOptions('zhiyu-final-primary-launcher')),
  });
  const finalHandle = finalLaunch.handle;
  setFinalHandle(finalHandle);
  observeRegisteredProcess('zhiyu', finalHandle, 'zhiyu-final-primary-launcher');
  observations.finalReactivationApproval = await approveLocalDevelopment(
    desktop,
    'allow-remember-project',
    screenshotsRoot,
    false,
    browserAuth('primary', fixtureConfig.primaryAccountId, 'final-local-development'),
  );
  const finalZhiyu = await waitForObservedProcessConnection({
    connectionPromise: finalLaunch.connectionPromise,
    handle: finalHandle,
    label: 'final primary Zhiyu Electron launcher',
  });
  setActiveZhiyuConnection(finalZhiyu);
  await waitForTestId(finalZhiyu.page, 'zhiyu-dev-kernel-root');
  await finalZhiyu.page.getByTestId('zhiyu-dev-kernel-refresh').click();
  await waitZhiyuEvidence(
    finalZhiyu.page,
    { sessionBound: true, permissionPosture: 'unavailable' },
    'final primary authority boundary',
  );
  observations.finalAppPrivateStorage = await verifyAppPrivateStorage(finalZhiyu.page);

  setPhase('project-authorization-revoke');
  await revokeProjectAuthorization(desktop.page);
  if (finalZhiyu.page.isClosed()) {
    throw new Error('project revoke terminated the renderer before its invalidated session could be observed');
  }
  await finalZhiyu.page.getByTestId('zhiyu-dev-kernel-refresh').click();
  const projectRevokeDenial = await waitUntil(async () => {
    const evidence = await finalZhiyu.page.evaluate(() => window.__nimiZhiyuDevKernelEvidence || null);
    return evidence?.session?.sessionBound === false
      && ['revoked', 'project-changed'].some((reason) => String(evidence.session.reasonCode || '').includes(reason))
      ? evidence
      : null;
  }, { timeoutMs: 30_000, label: 'session invalidation after project revoke' });
  observations.projectRevoke = {
    attempted: true,
    denial: projectRevokeDenial,
  };
  const zhiyuAudit = await pageAudit(finalZhiyu, 'zhiyu-after-project-revoke-denial');
  await finalZhiyu.page.screenshot({ path: path.join(screenshotsRoot, 'zhiyu-project-revoked.png') });
  const zhiyuRevokedNarrowMethod = await setWindowBounds(finalZhiyu, 390, 780);
  await finalZhiyu.page.screenshot({ path: path.join(screenshotsRoot, 'zhiyu-project-revoked-narrow.png') });
  const zhiyuRevokedNarrowMetrics = await finalZhiyu.page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  await setWindowBounds(finalZhiyu, 1060, 780);

  await desktop.page.screenshot({ path: path.join(screenshotsRoot, 'desktop-security-revoked.png') });
  const desktopNarrowMethod = await setWindowBounds(desktop, 390, 780);
  await desktop.page.screenshot({ path: path.join(screenshotsRoot, 'desktop-security-revoked-narrow.png') });
  const desktopNarrowMetrics = await desktop.page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  await setWindowBounds(desktop, 1440, 940);

  observations.browserAuthBudget = auditBrowserAuth();
  setPhase('core-persist');
  return persistCoreResult({
    fixture, providerRawPath, observations, artifactsRoot, desktop, observer, observedPages,
    desktopAuditBeforeSwitch, desktopAuditAfterSwitch, zhiyuAudit, zhiyuAuditBeforeSwitch,
    zhiyuAuditAfterSwitch, zhiyuRevokedNarrowMethod, zhiyuRevokedNarrowMetrics,
    desktopNarrowMethod, desktopNarrowMetrics, screenshotsRoot, serviceBefore, fixtureConfig,
    firstStorage, secondStorage, processLedger, journey, architecture, trial, sourceState, outputDir,
    startedAt, started, buildMarker,
  });
}
