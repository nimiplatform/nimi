#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';

import {
  acceptanceError,
  captureEnvironment,
  captureGitState,
  createAcceptanceContext,
  parseAcceptanceArguments,
  preserveBlockedEvidence,
  projectError,
  publishAcceptanceEvidence,
  REPO_ROOT,
  resolveRealmRoot,
  writeJson,
} from './macos-dev-acceptance/acceptance-contract.mjs';
import {
  approvePendingLocalAppThroughUI,
  beginNormalRealmLogin,
  connectObservedApplication,
  inspectRendererSecurity,
  invokeBridge,
  navigateToDeveloperSettings,
  requireAnonymousRuntimeAccount,
  revokeActiveLocalAppThroughUI,
  setDeveloperModeThroughUI,
  snapshotObservedApplication,
  waitForAuthenticatedAccount,
  waitForDesktopSurface,
  waitForAllowProjectAuthorization,
  waitForLocalDevelopmentRun,
} from './macos-dev-acceptance/browser-evidence.mjs';
import {
  captureDesktopProjectionAbsence,
  captureDesktopProjectionSet,
} from './macos-dev-acceptance/desktop-projection-evidence.mjs';
import {
  captureLaunchdAndSocketEvidence,
  captureRealmConnectivity,
  captureSigningEvidence,
  exerciseViteHMR,
  inspectZhiyuSQLite,
} from './macos-dev-acceptance/machine-evidence.mjs';
import { runMacOSNegativeTests } from './macos-dev-acceptance/negative-tests.mjs';
import {
  AcceptanceProcessSupervisor,
  assertPortsFree,
  processRows,
  processTree,
  relevantProcessRows,
  runBoundedCommand,
  waitForHTTP,
  waitForProcessesGone,
  waitForTCP,
} from './macos-dev-acceptance/process-supervisor.mjs';
import {
  assertHealthyInstalledStatus,
  runMacOSDevRuntimeService,
} from './macos-dev-runtime-service.mjs';

const PORTS = Object.freeze({
  web: 3000,
  realm: 3002,
  realtime: 3003,
  desktopRenderer: 1420,
  zhiyuRenderer: 1472,
  desktopCDP: 19470,
  zhiyuCDP: 19471,
  unsupervisedCDP: 19472,
});
const ZHIYU_ROOT = path.join(REPO_ROOT, 'apps', 'zhiyu');
const DESKTOP_ROOT = path.join(REPO_ROOT, 'apps', 'desktop');
let context;
let supervisor;
let desktopObserved;
let zhiyuObserved;
let loginBrowser;

try {
  requireNativeMacOS();
  const arguments_ = parseAcceptanceArguments(process.argv.slice(2));
  const realmRoot = await resolveRealmRoot(arguments_.realmRoot);
  const initialStatus = await runMacOSDevRuntimeService({ mode: 'status' });
  assertHealthyInstalledStatus(initialStatus);

  context = await createAcceptanceContext(realmRoot);
  supervisor = new AcceptanceProcessSupervisor(path.join(context.workRoot, 'logs'));
  await writeJson(path.join(context.workRoot, 'environment.json'), await captureEnvironment());
  await writeJson(path.join(context.workRoot, 'commits-and-worktree.json'), {
    nimi: captureGitState(REPO_ROOT),
    realm: captureGitState(realmRoot),
  });
  const processTreeBefore = relevantProcessRows();
  await writeJson(path.join(context.workRoot, 'process-tree-before.json'), processTreeBefore);

  const signing = await captureSigningEvidence(initialStatus);
  const launchd = await captureLaunchdAndSocketEvidence(initialStatus);
  await writeJson(path.join(context.workRoot, 'signing-and-entitlements.json'), signing);
  await writeJson(path.join(context.workRoot, 'launchd-and-sockets.json'), launchd);
  if (!signing.passed || !launchd.passed) {
    throw acceptanceError('runtime-service-untrusted', 'repair_the_installed_macos_development_candidate', 'Installed signing, launchd, process, or socket evidence is not trusted.');
  }

  await assertPortsFree(Object.values(PORTS));
  await startRealmAndWeb(supervisor, realmRoot, context.workRoot);
  const realmConnectivity = await captureRealmConnectivity();
  if (!realmConnectivity.passed) throw new Error('Realm API or Nimi Web did not reach exact local readiness');

  await startDesktop(supervisor, 'desktop', context.workRoot, PORTS.desktopCDP);
  desktopObserved = await connectObservedApplication(PORTS.desktopCDP, 'desktop');
  const initialSurface = await waitForDesktopSurface(desktopObserved.page);
  const initialAccountState = await requireAnonymousRuntimeAccount(desktopObserved.page);
  const login = await beginNormalRealmLogin(
    desktopObserved.page,
    path.join(context.workRoot, 'oauth-authorization-url.txt'),
  );
  let account;
  if (login.alreadyAuthenticated) {
    account = login.current;
  } else {
    loginBrowser = login.loginBrowser;
    await requireInteractiveCheckpoint(
      'REALM LOGIN COMPLETE',
      '请在刚打开的真实 Realm 页面完成注册或登录；不要粘贴 token，也不要修改数据库。完成后输入确认短语。',
    );
    await loginBrowser.close();
    loginBrowser = undefined;
    account = await waitForAuthenticatedAccount(desktopObserved.page);
  }
  await unlink(path.join(context.workRoot, 'oauth-authorization-url.txt')).catch((error) => {
    if (error?.code !== 'ENOENT') throw error;
  });
  if (!account.ok || account.value?.state !== 'authenticated') throw new Error('Desktop has no authenticated Runtime account binding');

  const desktopSnapshot = await snapshotObservedApplication(desktopObserved, {
    evidenceRoot: context.workRoot,
    prefix: 'desktop',
  });
  const desktopSecurity = await inspectRendererSecurity(desktopObserved.page);
  const desktopRuntimeStatus = await invokeBridge(desktopObserved.page, 'nimi.shell.runtimeLifecycle.status', {});
  if (!desktopRuntimeStatus.ok) throw new Error(`Desktop Runtime status failed: ${JSON.stringify(desktopRuntimeStatus)}`);

  const developerModeDisabled = await setDeveloperModeThroughUI(desktopObserved.page, false);
  const disabledLaunch = await runBoundedCommand({
    label: 'zhiyu-disabled',
    command: '/usr/bin/env',
    args: ['corepack', 'pnpm', 'dev:electron'],
    cwd: ZHIYU_ROOT,
    env: toolEnvironment(),
    logRoot: path.join(context.workRoot, 'logs'),
    timeoutMs: 20_000,
  });
  const disabledOutput = `${disabledLaunch.stdout}\n${disabledLaunch.stderr}`;
  if (disabledLaunch.timedOut || disabledLaunch.exitCode === 0 || !/local-app-developer-mode-disabled/u.test(disabledOutput)) {
    throw new Error(`Developer Mode disabled did not fail explicitly: ${disabledOutput.slice(-2000)}`);
  }
  const tauriLaunch = await runBoundedCommand({
    label: 'zhiyu-tauri-fail-closed',
    command: '/usr/bin/env',
    args: ['corepack', 'pnpm', 'dev:shell'],
    cwd: ZHIYU_ROOT,
    env: toolEnvironment(),
    logRoot: path.join(context.workRoot, 'logs'),
    timeoutMs: 20_000,
  });
  const tauriOutput = `${tauriLaunch.stdout}\n${tauriLaunch.stderr}`;
  if (tauriLaunch.timedOut || tauriLaunch.exitCode === 0 || !/local-development-platform-unsupported/u.test(tauriOutput)) {
    throw new Error(`Tauri did not remain independently fail-closed: ${tauriOutput.slice(-2000)}`);
  }

  const developerModeEnabled = await setDeveloperModeThroughUI(desktopObserved.page, true);
  const zhiyuLauncher = await supervisor.start({
    label: 'zhiyu-launcher',
    command: '/usr/bin/env',
    args: ['corepack', 'pnpm', 'dev:electron'],
    cwd: ZHIYU_ROOT,
    env: toolEnvironment(),
  });
  const approval = await approvePendingLocalAppThroughUI(desktopObserved.page);
  if (approval.publicPermissionCount !== 0) {
    throw new Error(`Zhiyu unexpectedly requested Nimi public permissions: ${JSON.stringify(approval.permissionRows)}`);
  }
  const running = await waitForLocalDevelopmentRun(desktopObserved.page, 'running');
  const allowProjectAuthorization = await waitForAllowProjectAuthorization(desktopObserved.page, {
    accountId: account.value.accountProjection.accountId,
  });
  if (allowProjectAuthorization.permissionRequirements.length !== 0) {
    throw new Error(`Zhiyu allow-project authorization unexpectedly contains public permissions: ${JSON.stringify(allowProjectAuthorization)}`);
  }
  await supervisor.waitForOutput('zhiyu-launcher', /\[nimi-app dev\] running/u, 120_000);
  zhiyuObserved = await connectObservedApplication(PORTS.zhiyuCDP, 'zhiyu', 120_000);
  await zhiyuObserved.page.waitForFunction(() => Boolean(globalThis.window?.__NIMI_ELECTRON_RUNTIME__), undefined, { timeout: 60_000 });
  const zhiyuSession = await invokeBridge(zhiyuObserved.page, 'nimi.shell.localApp.sessionStatus', {});
  if (!zhiyuSession.ok || zhiyuSession.value?.state !== 'ready') {
    throw new Error(`Zhiyu protected local-app session is not ready: ${JSON.stringify(zhiyuSession)}`);
  }
  const storageRoundTrip = await appPrivateStorageRoundTrip(zhiyuObserved.page);
  const reservedPermission = await invokeBridge(zhiyuObserved.page, 'nimi.shell.localApp.permissionStatus', { permissionId: 'agents.interact' });
  if (!reservedPermission.ok || reservedPermission.value?.state !== 'unavailable' || reservedPermission.value?.canRequest !== false) {
    throw new Error(`Reserved public permission did not remain fail-closed: ${JSON.stringify(reservedPermission)}`);
  }
  const zhiyuSnapshot = await snapshotObservedApplication(zhiyuObserved, {
    evidenceRoot: context.workRoot,
    prefix: 'zhiyu',
  });
  const zhiyuSecurity = await inspectRendererSecurity(zhiyuObserved.page);
  const permissionPromptCount = await zhiyuObserved.page.locator('[role="dialog"]').count();
  const sqliteBeforeRestart = await inspectZhiyuSQLite(path.join(context.workRoot, 'zhiyu-user-data'));
  if (!sqliteBeforeRestart.passed || permissionPromptCount !== 0) {
    throw new Error('Zhiyu app-owned SQLite or zero-permission-prompt evidence failed');
  }

  const hmr = {
    desktop: await exerciseViteHMR(desktopObserved.page, context.workRoot, 'desktop'),
    zhiyu: await exerciseViteHMR(zhiyuObserved.page, context.workRoot, 'zhiyu'),
  };
  if (!hmr.desktop.passed || !hmr.zhiyu.passed) throw new Error('Desktop or Zhiyu renderer HMR did not execute a real accepted update');

  const negativeTests = await runMacOSNegativeTests({
    evidenceRoot: context.workRoot,
    unsupervisedCDPPort: PORTS.unsupervisedCDP,
    zhiyuRoot: ZHIYU_ROOT,
  });
  await writeJson(path.join(context.workRoot, 'negative-tests.json'), negativeTests);
  if (!negativeTests.passed) throw new Error('One or more macOS protected carrier negative tests failed');

  const restartRotation = await exerciseRuntimeRestart({
    desktopPage: desktopObserved.page,
    initialStatus,
    initialRun: running,
    initialAuthorization: allowProjectAuthorization,
    zhiyuPage: zhiyuObserved.page,
  });
  await writeJson(path.join(context.workRoot, 'restart-session-rotation.json'), restartRotation);
  if (!restartRotation.passed) throw new Error('Runtime restart did not produce exact session rotation and recovery evidence');

  const hostRestart = await restartZhiyuHost(
    desktopObserved.page,
    zhiyuObserved,
    restartRotation.localAppRunRecovered.hostGeneration,
  );
  zhiyuObserved = hostRestart.observed;
  const sqliteAfterRestart = await inspectZhiyuSQLite(path.join(context.workRoot, 'zhiyu-user-data'));
  if (!sqliteAfterRestart.passed || sqliteAfterRestart.bootCount <= sqliteBeforeRestart.bootCount) {
    throw new Error('Zhiyu app-owned SQLite did not persist across verified Host restart');
  }

  const systemCheckpoints = {
    sleepWake: await attemptSystemCheckpoint(() => sleepWakeCheckpoint(desktopObserved.page, zhiyuObserved.page)),
    fastUserSwitch: await attemptSystemCheckpoint(() => fastUserSwitchCheckpoint(desktopObserved.page)),
  };

  const hostPidsBeforeRevoke = exactHostProcesses().map((row) => row.pid);
  const revoked = await exerciseRevocation(desktopObserved.page, zhiyuObserved.page);
  if (!revoked.passed) throw new Error(`Revocation did not produce exact denial evidence: ${JSON.stringify(revoked)}`);
  await waitForProcessesGone(hostPidsBeforeRevoke, 30_000);
  const liveHostPidsAfterRevoke = exactHostProcesses().map((row) => row.pid);
  if (liveHostPidsAfterRevoke.length > 0) throw new Error(`Revoked Host processes remain: ${liveHostPidsAfterRevoke.join(', ')}`);

  const runtimeRealmEvidence = {
    schemaVersion: 'nimi.macos-dev-chain-runtime-realm-session/v1',
    initialSurface,
    initialAccountState,
    account,
    realmConnectivity,
    desktopRuntimeStatus,
    developerModeDisabled,
    disabledLaunch: {
      exitCode: disabledLaunch.exitCode,
      output: disabledOutput.slice(-4000),
    },
    tauriLaunch: { exitCode: tauriLaunch.exitCode, output: tauriOutput.slice(-4000), admitted: false },
    developerModeEnabled,
    approval,
    allowProjectAuthorization,
    running,
    zhiyuSession,
    storageRoundTrip,
    reservedPermission,
    sqliteBeforeRestart,
    sqliteAfterRestart,
    permissionPromptCount,
    hmr,
    hostRestart: hostRestart.evidence,
    revoked,
    systemCheckpoints,
  };
  await writeJson(path.join(context.workRoot, 'runtime-realm-session-evidence.json'), runtimeRealmEvidence);
  await writeJson(path.join(context.workRoot, 'dom-accessibility-summary.json'), {
    desktop: desktopSnapshot,
    zhiyu: zhiyuSnapshot,
    rendererSecurity: { desktop: desktopSecurity, zhiyu: zhiyuSecurity },
  });
  const capturedProblems = { desktop: desktopObserved.problems, zhiyu: zhiyuObserved.problems };
  await writeJson(path.join(context.workRoot, 'console-page-network-errors.json'), capturedProblems);

  const shutdown = await shutdownDesktopAndVerify(supervisor, desktopObserved, zhiyuLauncher.child.pid);
  desktopObserved = undefined;
  zhiyuObserved = undefined;
  const signedReplacement = await attemptSignedReplacement(supervisor, context, initialStatus.generation);
  const processTreeAfter = relevantProcessRows();
  await writeJson(path.join(context.workRoot, 'process-tree-after.json'), {
    processes: processTreeAfter,
    shutdown,
    signedReplacement,
  });

  const blockers = [
    ...Object.entries(systemCheckpoints).filter(([, value]) => !value.passed).map(([name, value]) => ({ name, ...value })),
    ...(!signedReplacement.passed ? [{ name: 'signedReplacement', ...signedReplacement }] : []),
  ];
  const consoleClean = desktopObservedProblemsClean(capturedProblems.desktop)
    && desktopObservedProblemsClean(capturedProblems.zhiyu);
  const structuralPassed = structuralEvidencePassed(desktopSnapshot, desktopSecurity)
    && structuralEvidencePassed(zhiyuSnapshot, zhiyuSecurity)
    && Math.max(desktopSnapshot.longChineseText.length, zhiyuSnapshot.longChineseText.length) >= 12;
  const passed = blockers.length === 0 && shutdown.passed && restartRotation.passed
    && negativeTests.passed && sqliteAfterRestart.passed && hmr.desktop.passed && hmr.zhiyu.passed
    && signing.passed && launchd.passed && consoleClean && structuralPassed;
  const summary = {
    schemaVersion: 'nimi.macos-dev-chain-acceptance/v1',
    capturedAt: new Date().toISOString(),
    status: passed ? 'passed' : 'blocked',
    profile: 'macos_local_development_v1',
    macOSNonProductAdmission: passed,
    macOSProductionAdmission: false,
    electronDevelopmentCarrierAdmission: passed,
    tauriAdmission: false,
    blockers,
    assertions: {
      signing: signing.passed,
      launchd: launchd.passed,
      runtimeRestart: restartRotation.passed,
      allowProjectContinuity: restartRotation.allowProjectContinuity,
      negativeTests: negativeTests.passed,
      appOwnedSQLite: sqliteAfterRestart.passed,
      rendererHMR: hmr.desktop.passed && hmr.zhiyu.passed,
      desktopQuitNoOrphans: shutdown.passed,
      signedMainPreloadReplacement: signedReplacement.passed,
      consolePageNetworkClean: consoleClean,
      domAccessibilityResponsiveSecurity: structuralPassed,
    },
  };
  await writeJson(path.join(context.workRoot, 'acceptance-summary.json'), summary);
  if (!passed) {
    const blockedRoot = await preserveBlockedEvidence(context, acceptanceError(
      'macos-dev-acceptance-external-checkpoint-incomplete',
      'complete_every_reported_system_checkpoint_then_rerun',
      'Repository and live-chain evidence completed, but one or more required external checkpoints remain.',
      { blockers },
    ));
    context = undefined;
    process.stdout.write(`${JSON.stringify({ status: 'blocked', evidenceRoot: blockedRoot, blockers })}\n`);
    process.exitCode = 1;
  } else {
    const evidenceRoot = await publishAcceptanceEvidence(context);
    context = undefined;
    process.stdout.write(`${JSON.stringify({ status: 'passed', evidenceRoot, profile: 'macos_local_development_v1', productionAdmission: false, tauriAdmission: false })}\n`);
  }
} catch (error) {
  const failure = projectError(error);
  try { await loginBrowser?.close(); } catch { /* cleanup only */ }
  try { await supervisor?.stopAll(); } catch { /* retained in process evidence when available */ }
  let evidenceRoot;
  if (context) {
    try { evidenceRoot = await preserveBlockedEvidence(context, error); } catch { /* original failure remains authoritative */ }
  }
  process.stderr.write(`${JSON.stringify({ status: 'failed', ...failure, ...(evidenceRoot ? { evidenceRoot } : {}) })}\n`);
  process.exitCode = 1;
} finally {
  try { await loginBrowser?.close(); } catch { /* cleanup only */ }
  try { await supervisor?.stopAll(); } catch { /* cleanup failure is represented by nonzero outcome above */ }
}

async function startRealmAndWeb(processes, realmRoot, evidenceRoot) {
  const common = {
    ...process.env,
    NIMI_WEB_URL: 'http://127.0.0.1:3000',
  };
  const realmOutput = {
    transformOutput: redactSensitiveOutput,
    onRawOutput: surfaceDevelopmentOTP,
  };
  await processes.start({
    label: 'realm-api', command: '/usr/bin/env', args: ['corepack', 'pnpm', 'dev:api'], cwd: realmRoot, env: common, ...realmOutput,
  });
  await waitForHTTP('http://127.0.0.1:3002/api/auth/jwks', {
    timeoutMs: 180_000,
    validate: (_response, body) => {
      try { return JSON.parse(body)?.keys?.length > 0; } catch { return false; }
    },
  });
  await processes.start({
    label: 'realm-realtime', command: '/usr/bin/env', args: ['corepack', 'pnpm', 'dev:realtime'], cwd: realmRoot, env: common, ...realmOutput,
  });
  await waitForTCP(PORTS.realtime, 120_000);
  await processes.start({
    label: 'nimi-web',
    command: '/usr/bin/env',
    args: ['corepack', 'pnpm', 'dev:web'],
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      NIMI_REALM_URL: 'http://127.0.0.1:3002',
      NIMI_REALTIME_URL: 'ws://127.0.0.1:3003',
    },
  });
  await waitForHTTP('http://127.0.0.1:3000/', { timeoutMs: 120_000 });
  await mkdir(path.join(evidenceRoot, 'realm-ready'), { mode: 0o700 });
}

async function startDesktop(processes, label, acceptanceRoot, cdpPort) {
  await processes.start({
    label,
    command: '/usr/bin/env',
    args: ['corepack', 'pnpm', 'dev:electron'],
    cwd: DESKTOP_ROOT,
    env: {
      ...toolEnvironment(),
      NIMI_MACOS_DEV_ACCEPTANCE: '1',
      NIMI_MACOS_DEV_ACCEPTANCE_ROOT: acceptanceRoot,
      NIMI_DESKTOP_DEV_CDP_PORT: String(cdpPort),
      NIMI_MACOS_DEV_ACCEPTANCE_ZHIYU_CDP_PORT: String(PORTS.zhiyuCDP),
    },
  });
  await waitForTCP(PORTS.desktopRenderer, 90_000);
  await waitForTCP(cdpPort, 90_000);
}

async function appPrivateStorageRoundTrip(page) {
  const relativePath = 'acceptance/runtime-desktop-zhiyu.json';
  const value = { schemaVersion: 1, text: '应用自有数据不需要 Nimi 公共权限。' };
  const write = await invokeBridge(page, 'nimi.shell.storage.writeJson', { relativePath, value });
  const read = await invokeBridge(page, 'nimi.shell.storage.readJson', { relativePath });
  const remove = await invokeBridge(page, 'nimi.shell.storage.removeJson', { relativePath });
  if (!write.ok || !read.ok || !remove.ok || JSON.stringify(read.value?.value) !== JSON.stringify(value)) {
    throw new Error(`Protected app-private storage round trip failed: ${JSON.stringify({ write, read, remove })}`);
  }
  return { write, read, remove };
}

async function exerciseRuntimeRestart(input) {
  const before = await runMacOSDevRuntimeService({ mode: 'status' });
  const failures = [];
  const approvalSamples = [];
  let approvalDialogObserved = false;
  let sample = true;
  const sampling = (async () => {
    while (sample) {
      const [developerMode, localAppSession, pendingApprovals, dialogVisible] = await Promise.all([
        invokeBridge(input.desktopPage, 'developer_mode_status', {}).catch((error) => ({ ok: false, error: projectError(error) })),
        invokeBridge(input.zhiyuPage, 'nimi.shell.localApp.sessionStatus', {}).catch((error) => ({ ok: false, error: projectError(error) })),
        invokeBridge(input.desktopPage, 'local_development_pending_approvals', {}).catch((error) => ({ ok: false, error: projectError(error) })),
        input.desktopPage.locator('[data-testid="local-development-approval-dialog"]').isVisible().catch(() => false),
      ]);
      failures.push(...[developerMode, localAppSession].filter((row) => !row.ok));
      if (pendingApprovals.ok && Array.isArray(pendingApprovals.value) && pendingApprovals.value.length > 0) {
        approvalSamples.push(pendingApprovals.value);
      }
      approvalDialogObserved ||= dialogVisible;
      await delay(50);
    }
  })();
  let receipt;
  try {
    receipt = await runMacOSDevRuntimeService({ mode: 'restart' });
  } finally {
    await delay(1_000);
    sample = false;
    await sampling;
  }
  const after = await waitForHealthyRuntime();
  const desktopRecovered = await waitForBridgeSuccess(input.desktopPage, 'nimi.shell.runtimeLifecycle.status', {}, 60_000);
  const newRun = await waitForLocalDevelopmentRun(input.desktopPage, 'running', 120_000);
  const authorizationAfterRestart = await waitForAllowProjectAuthorization(input.desktopPage, {
    accountId: input.initialAuthorization.accountId,
  });
  const pendingAfterRestart = await invokeBridge(input.desktopPage, 'local_development_pending_approvals', {});
  const dialogVisibleAfterRestart = await input.desktopPage
    .locator('[data-testid="local-development-approval-dialog"]')
    .isVisible()
    .catch(() => false);
  const exactRestartFailure = failures.find((row) => row.error?.reasonCode === 'runtime-restarted'
    || row.error?.message === 'runtime-restarted');
  const allowProjectContinuity = authorizationAfterRestart.selector === input.initialAuthorization.selector
    && authorizationAfterRestart.accountId === input.initialAuthorization.accountId
    && authorizationAfterRestart.canonicalProjectRoot === input.initialAuthorization.canonicalProjectRoot
    && authorizationAfterRestart.persistence === 'allow-project'
    && authorizationAfterRestart.state === 'active'
    && approvalSamples.length === 0
    && pendingAfterRestart.ok
    && Array.isArray(pendingAfterRestart.value)
    && pendingAfterRestart.value.length === 0
    && !approvalDialogObserved
    && !dialogVisibleAfterRestart;
  return Object.freeze({
    before: projectRuntimeIdentity(before),
    after: projectRuntimeIdentity(after),
    receipt,
    exactOldSessionFailure: exactRestartFailure ?? null,
    desktopRecovered,
    localAppRunRecovered: newRun,
    authorizationBeforeRestart: input.initialAuthorization,
    authorizationAfterRestart,
    approvalSamples,
    approvalDialogObserved,
    pendingAfterRestart,
    dialogVisibleAfterRestart,
    allowProjectContinuity,
    passed: before.runtimeProcessStartIdentity !== after.runtimeProcessStartIdentity
      && Boolean(exactRestartFailure)
      && desktopRecovered.ok
      && newRun.hostGeneration > input.initialRun.hostGeneration
      && allowProjectContinuity,
  });
}

async function restartZhiyuHost(desktopPage, currentObserved, previousGeneration) {
  const hosts = exactHostProcesses();
  if (hosts.length !== 1) throw new Error(`Expected one supervised Host before restart, found ${hosts.length}`);
  const prior = hosts[0];
  process.kill(prior.pid, 'SIGTERM');
  await waitForProcessesGone([prior.pid], 20_000);
  const run = await waitForLocalDevelopmentRun(desktopPage, 'running', 120_000);
  if (run.hostGeneration <= previousGeneration) throw new Error('Zhiyu Host generation did not rotate');
  const observed = await connectObservedApplication(PORTS.zhiyuCDP, 'zhiyu-restarted', 120_000);
  const session = await invokeBridge(observed.page, 'nimi.shell.localApp.sessionStatus', {});
  if (!session.ok || session.value?.state !== 'ready') throw new Error('Restarted Zhiyu Host has no ready session');
  return {
    observed,
    evidence: { priorProcess: prior, nextProcesses: exactHostProcesses(), run, session, passed: true },
  };
}

async function exerciseRevocation(desktopPage, zhiyuPage) {
  const samples = [];
  let active = true;
  const sample = async () => {
    while (active) {
      try { samples.push(await invokeBridge(zhiyuPage, 'nimi.shell.localApp.sessionStatus', {})); } catch (error) {
        samples.push({ transportClosed: true, message: error instanceof Error ? error.message : String(error) });
      }
      await delay(50);
    }
  };
  const sampling = sample();
  const selector = await revokeActiveLocalAppThroughUI(desktopPage);
  await delay(1_000);
  active = false;
  await sampling;
  const exactDenial = samples.find((row) => !row.ok && ['session-revoked', 'local-development-session-revoked']
    .includes(row.error?.reasonCode || row.error?.message));
  const transportClosed = samples.some((row) => row.transportClosed);
  const authorizations = await invokeBridge(desktopPage, 'local_development_authorizations_list', {});
  return Object.freeze({
    selector,
    exactDenial: exactDenial ?? null,
    transportClosed,
    authorizationProjection: authorizations,
    passed: Boolean(exactDenial || transportClosed)
      && authorizations.ok
      && Array.isArray(authorizations.value)
      && authorizations.value.every((row) => row.state !== 'active'),
  });
}

async function shutdownDesktopAndVerify(processes, observed, launcherPid) {
  const relevantBefore = relevantProcessRows();
  const projectionsBefore = await captureDesktopProjectionSet();
  const launcherPids = [processes.get('desktop')?.child.pid, launcherPid].filter(Boolean);
  const ownedBefore = [...new Map(
    launcherPids.flatMap((pid) => processTree(pid)).map((row) => [row.pid, row]),
  ).values()];
  const ownedPids = ownedBefore.map((row) => row.pid);
  await observed.page.close();
  const processesGone = await waitForProcessesGone(ownedPids, 40_000);
  const projectionsAfter = await captureDesktopProjectionAbsence();
  const remaining = relevantProcessRows().filter((row) => (
    row.command.includes('/Applications/Nimi Dev.app/Contents/MacOS/Nimi Dev')
    || row.command.includes('Nimi Local App Host Dev')
    || (row.command.includes('vite') && /(?:1420|1472)/u.test(row.command))
  ));
  return Object.freeze({
    relevantBefore,
    ownedBefore,
    processesGone,
    projectionsBefore,
    projectionsAfter,
    remaining,
    passed: processesGone && projectionsBefore.passed && projectionsAfter.passed && remaining.length === 0,
  });
}

async function attemptSignedReplacement(processes, parentContext, priorGeneration) {
  const root = path.join(parentContext.workRoot, 'signed-replacement');
  await mkdir(root, { mode: 0o700 });
  await mkdir(path.join(root, 'desktop-user-data'), { mode: 0o700 });
  await mkdir(path.join(root, 'zhiyu-user-data'), { mode: 0o700 });
  try {
    const receipt = await runMacOSDevRuntimeService({ mode: 'update' });
    const status = await waitForHealthyRuntime();
    if (Number(status.generation) !== Number(priorGeneration) + 1) throw new Error('Signed replacement did not advance exactly one installer generation');
    await startDesktop(processes, 'desktop-replacement', root, PORTS.desktopCDP);
    const observed = await connectObservedApplication(PORTS.desktopCDP, 'desktop-replacement');
    const account = await waitForAuthenticatedAccount(observed.page, 60_000);
    const runtime = await invokeBridge(observed.page, 'nimi.shell.runtimeLifecycle.status', {});
    await observed.page.close();
    const signed = await captureSigningEvidence(status);
    return Object.freeze({
      receipt,
      status: projectRuntimeIdentity(status),
      account,
      runtime,
      signed,
      passed: account.ok && runtime.ok && signed.passed && Number(status.generation) === Number(priorGeneration) + 1,
    });
  } catch (error) {
    return Object.freeze({ passed: false, blocker: projectError(error) });
  }
}

async function sleepWakeCheckpoint(desktopPage, zhiyuPage) {
  const before = powerEvents();
  await requireInteractiveCheckpoint('SLEEP WAKE COMPLETE', '请让这台 Mac 真实进入睡眠并唤醒，返回同一会话后输入确认短语。');
  const after = powerEvents();
  const newLines = after.filter((line) => !before.includes(line));
  const sleepObserved = newLines.some((line) => /Entering Sleep state|Sleep.*due to/iu.test(line));
  const wakeObserved = newLines.some((line) => /Wake from|DarkWake|Wake.*due to/iu.test(line));
  const desktop = await waitForBridgeSuccess(desktopPage, 'nimi.shell.runtimeLifecycle.status', {}, 60_000);
  const zhiyu = await waitForBridgeSuccess(zhiyuPage, 'nimi.shell.localApp.sessionStatus', {}, 60_000);
  return Object.freeze({ passed: sleepObserved && wakeObserved && desktop.ok && zhiyu.ok, newPowerEvents: newLines.slice(-100), desktop, zhiyu });
}

async function fastUserSwitchCheckpoint(desktopPage) {
  const observations = [];
  let active = true;
  const observer = (async () => {
    while (active) {
      try { observations.push(consoleUser()); } catch { /* observation continues */ }
      await delay(250);
    }
  })();
  await requireInteractiveCheckpoint('FAST USER SWITCH COMPLETE', '请切换到另一个 macOS 用户，再切回当前用户；返回后输入确认短语。');
  active = false;
  await observer;
  const current = consoleUser();
  const distinct = [...new Set(observations.filter(Boolean))];
  const desktop = await waitForBridgeSuccess(desktopPage, 'nimi.shell.runtimeLifecycle.status', {}, 60_000);
  return Object.freeze({ passed: distinct.some((user) => user !== current) && desktop.ok, current, observedConsoleUsers: distinct, desktop });
}

async function attemptSystemCheckpoint(operation) {
  try {
    return await operation();
  } catch (error) {
    return Object.freeze({ passed: false, blocker: projectError(error) });
  }
}

async function waitForHealthyRuntime() {
  const deadline = Date.now() + 60_000;
  let status;
  while (Date.now() < deadline) {
    status = await runMacOSDevRuntimeService({ mode: 'status' });
    try {
      assertHealthyInstalledStatus(status);
      return status;
    } catch {
      await delay(300);
    }
  }
  assertHealthyInstalledStatus(status);
}

async function waitForBridgeSuccess(page, command, payload, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await invokeBridge(page, command, payload);
      if (last.ok) return last;
    } catch (error) {
      last = { ok: false, transportError: error instanceof Error ? error.message : String(error) };
    }
    await delay(250);
  }
  return last ?? { ok: false, transportError: 'timeout' };
}

async function requireInteractiveCheckpoint(phrase, message) {
  process.stdout.write(`${JSON.stringify({ status: 'user-checkpoint-required', confirmation: phrase, message })}\n`);
  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    throw acceptanceError('macos-dev-acceptance-user-checkpoint-required', 'rerun_in_an_interactive_terminal_and_complete_the_reported_action', message);
  }
  const terminal = readline.createInterface({ input: process.stdin, output: process.stderr });
  const answer = await terminal.question(`Type ${JSON.stringify(phrase)} to continue: `);
  terminal.close();
  if (answer !== phrase) throw acceptanceError('macos-dev-acceptance-user-checkpoint-cancelled', 'rerun_when_the_external_action_can_be_completed', `${message} Confirmation was not accepted.`);
}

function exactHostProcesses() {
  return processRows().filter((row) => row.command.startsWith('/Applications/Nimi Dev.app/Contents/Frameworks/Nimi Local App Host Dev.app/Contents/MacOS/Nimi Local App Host Dev'));
}

function projectRuntimeIdentity(status) {
  return Object.freeze({
    generation: status.generation,
    releaseId: status.releaseId,
    runtimePID: status.runtimePID,
    runtimeProcessStartIdentity: status.runtimeProcessStartIdentity,
    state: status.state,
    healthy: status.healthy,
  });
}

function desktopObservedProblemsClean(problems) {
  if (!problems) return true;
  return problems.consoleErrors.length === 0 && problems.pageErrors.length === 0
    && problems.failedRequests.length === 0 && problems.httpErrors.length === 0;
}

function structuralEvidencePassed(snapshot, security) {
  return snapshot.accessibility.length > 0
    && snapshot.desktop.visibleControlCount > 0
    && snapshot.narrow.visibleControlCount > 0
    && snapshot.narrow.horizontalOverflow <= 1
    && security.runtimeBridge === true
    && security.electronGlobal === false
    && security.ipcRendererGlobal === false
    && security.nodeProcessGlobal === false
    && security.requireGlobal === false;
}

function redactSensitiveOutput(value) {
  return String(value)
    .replaceAll(/(authorization:\s*bearer\s+)[^\s]+/giu, '$1[REDACTED]')
    .replaceAll(/(["']?(?:access_token|refresh_token|sessionProof|token|otp|verificationCode)["']?\s*[:=]\s*["']?)[^\s,"']+/giu, '$1[REDACTED]')
    .replaceAll(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/gu, '[REDACTED_JWT]');
}

function surfaceDevelopmentOTP(_stream, value) {
  if (!process.stderr.isTTY) return;
  const matches = String(value).match(/(?:otp|verification\s*code)[^0-9]{0,40}([0-9]{6})/giu) ?? [];
  for (const match of matches) {
    const code = match.match(/([0-9]{6})/u)?.[1];
    if (code) process.stderr.write(`[acceptance] Realm local-development one-shot code: ${code}\n`);
  }
}

function toolEnvironment() {
  return Object.fromEntries(Object.entries({
    HOME: process.env.HOME,
    LANG: process.env.LANG || 'en_US.UTF-8',
    PATH: process.env.PATH,
    TMPDIR: process.env.TMPDIR || '/private/tmp',
  }).filter(([, value]) => typeof value === 'string' && value.length > 0));
}

function powerEvents() {
  const output = execFileSync('/usr/bin/pmset', ['-g', 'log'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return output.split(/\r?\n/u).filter((line) => /\b(?:Sleep|Wake|DarkWake)\b/iu.test(line)).slice(-1000);
}

function consoleUser() {
  return execFileSync('/usr/bin/stat', ['-f', '%Su', '/dev/console'], { encoding: 'utf8' }).trim();
}

function requireNativeMacOS() {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') {
    throw acceptanceError('dev-runtime-platform-unsupported', 'use_native_apple_silicon_macos', `macOS development acceptance requires darwin/arm64, received ${process.platform}/${process.arch}.`);
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
