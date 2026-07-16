import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import { startRealmFixtureServer } from '../../../apps/desktop/e2e/fixtures/realm-fixture-server.mjs';
import { createRealmFixtureManifest } from '../../../apps/desktop/scripts/explore-materialization-acceptance/acceptance-fixture.mjs';
import {
  beginObservedProcess,
  createObservedProcessLedger,
  resolveHostRustToolchainHomes,
  waitForObservedProcessConnection,
} from './dev-kernel-contract.mjs';
import { startProcess, terminateProcessTree } from './cross-app-driver.mjs';
import {
  browserAuthSafeChildEnvironment,
  createDevKernelBrowserAuthDriver,
  probeDevKernelRealmPolicy,
} from './dev-kernel-browser-auth-driver.mjs';
import { repoRoot } from './registry.mjs';
import { registerTrialProcessIdentity } from './sandbox-hygiene.mjs';

import {
  PRODUCT_CONTROL_RECORD_METHOD,
  acquireFixedServiceLock,
  connectCdp,
  createEarlyCdpObserver,
  invokeDesktop,
  probeRealRealmBrowserLoginAuthority,
  readAcceptanceFixture,
  readFixedServiceStatus,
  readProductControlJSONProjection,
  requireCheckpointDataRootProposal,
  reservePort,
  setWindowBounds,
  sha256,
  waitForTestId,
  waitUntil,
  writeJson,
} from './dev-kernel-host-driver.mjs';
import {
  captureReusedReadyFirstRun,
  completeDesktopFirstRun,
  loginDesktop,
  prepareDesktopFixedServiceBaseline,
  readDesktopRuntimeDiagnostics,
  setFixtureAccount,
} from './dev-kernel-first-run-driver.mjs';
import {
  approveLocalDevelopment,
  grantConversationOperations,
  grantOpenConversation,
  openConversation,
  readRememberedAuthorization,
  revokeOperationGrant,
  sendTurnWithKeyboard,
  setDeveloperMode,
  startRawMismatchedZhiyu,
  startZhiyuDev,
  summarizeProviderRequests,
  waitForRebuiltZhiyu,
  waitZhiyuEvidence,
} from './dev-kernel-local-development-driver.mjs';
import { persistOwnerMinimalResult } from './dev-kernel-result-driver.mjs';
import { persistDevKernelFailureBundle } from './dev-kernel-failure-bundle.mjs';
import { runCoreReactivationJourney } from './dev-kernel-core-reactivation-driver.mjs';

const FIXTURE_ORIGIN = 'http://127.0.0.1:19443';
const OPEN_OPERATION = 'runtime_agent.conversation.open';
const ACCOUNT_REALM_ORIGIN = 'http://localhost:3002';
const ACCOUNT_WEB_ORIGIN = 'http://localhost:3000';
const OWNER_MINIMAL_BROWSER_AUTH_PLAN = Object.freeze([
  'primary-login',
  'run-once-local-development',
  'run-once-open-grant',
]);
const CORE_BROWSER_AUTH_PLAN = Object.freeze([
  ...OWNER_MINIMAL_BROWSER_AUTH_PLAN,
  'remembered-local-development',
  'remembered-open-grant',
  'remembered-conversation-turn-send-grant',
  'remembered-conversation-turn-subscribe-grant',
  'remembered-reactivation',
  'secondary-login',
  'primary-login-restored',
  'final-local-development',
]);

export {
  acquireFixedServiceLock,
  classifyFirstRunStorageRecoverySnapshot,
  classifyFirstRunTerminalSnapshot,
  connectCdp,
  createEarlyCdpObserver,
  decodeDesktopRuntimeUnaryResponse,
  invokeDesktop,
  invokeDesktopRuntimeUnary,
  probeRealRealmBrowserLoginAuthority,
  readFixedServiceStatus,
  readProductControlJSONProjection,
  requireCheckpointDataRootProposal,
  reservePort,
  setWindowBounds,
  waitUntil,
} from './dev-kernel-host-driver.mjs';
export {
  completeDesktopFirstRun,
  loginDesktop,
  prepareDesktopFixedServiceBaseline,
  selectLatestBlockingFirstRunDependencyJob,
} from './dev-kernel-first-run-driver.mjs';
export { pageAudit } from './dev-kernel-local-development-driver.mjs';

function requireLiveDesktopCheckpoint(handle, connection, stage) {
  const exitCode = handle?.child?.exitCode;
  const pageClosed = connection?.page?.isClosed() !== false;
  if (exitCode === null && !pageClosed) return;
  let livePageCount = 0;
  try {
    livePageCount = connection.context.pages().filter((page) => !page.isClosed()).length;
  } catch {
    livePageCount = 0;
  }
  throw new Error(`Desktop terminal checkpoint failed ${stage}: ${JSON.stringify({ exitCode, pageClosed, livePageCount })}`);
}

export async function runDevKernelCoreTrial(input) {
  return runDevKernelTrial({ ...input, executionMode: 'core' });
}

export async function runDevKernelOwnerMinimalTrial(input) {
  return runDevKernelTrial({ ...input, executionMode: 'owner-minimal' });
}

async function runDevKernelTrial({ architecture, journey, trial, sourceState, outputDir, executionMode }) {
  if (!['core', 'owner-minimal'].includes(executionMode)) {
    throw new Error(`unsupported dev-kernel execution mode ${executionMode || '<missing>'}`);
  }
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    throw new Error(`dev-kernel-core requires Windows x64, got ${process.platform}/${process.arch}`);
  }
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const fixtureConfig = readAcceptanceFixture();
  const lock = acquireFixedServiceLock();
  const artifactsRoot = path.join(trial.paths.artifacts, 'dev-kernel');
  const screenshotsRoot = path.join(artifactsRoot, 'screenshots');
  const processLogsRoot = path.join(artifactsRoot, 'process-logs');
  fs.mkdirSync(screenshotsRoot, { recursive: true });
  fs.mkdirSync(processLogsRoot, { recursive: true });
  const processLogOptions = (label) => {
    if (!/^[a-z0-9-]+$/u.test(label)) throw new Error(`invalid process log label ${label}`);
    return {
      stdoutPath: path.join(processLogsRoot, `${label}.stdout.log`),
      stderrPath: path.join(processLogsRoot, `${label}.stderr.log`),
    };
  };
  const manifestPath = path.join(trial.paths.control, 'realm-fixture-manifest.json');
  const providerRawPath = path.join(trial.paths.providerRaw, 'provider-capture-local-sensitive.json');
  const probePath = path.join(repoRoot, 'apps', 'zhiyu', 'src-electron', 'dev-kernel-restart-probe.ts');
  const originalProbe = fs.readFileSync(probePath);
  const buildMarker = `acceptance-${sha256(trial.identity.journeyTrialId).slice(0, 12)}`;
  let fixture;
  let desktopHandle;
  let runOnceHandle;
  let rememberedHandle;
  let reactivatedHandle;
  let finalHandle;
  let rawHandle;
  let desktopConnection;
  let activeZhiyuConnection;
  let serviceBefore;
  let phase = 'preflight';
  let probeRestored = false;
  const observedPages = [];
  const observer = createEarlyCdpObserver(observedPages);
  const observations = {
    electronArtifactPosture: {
      mode: String(process.env.NIMI_DEV_KERNEL_ELECTRON_BUILD_MODE || 'fresh').trim().toLowerCase(),
      sourceDigest: sourceState.sourceDigest,
      acceptanceEligible: String(process.env.NIMI_DEV_KERNEL_ELECTRON_BUILD_MODE || 'fresh').trim().toLowerCase() !== 'reuse',
    },
  };
  const processLedger = createObservedProcessLedger();
  const observeRegisteredProcess = (role, handle, label) => {
    const registration = registerTrialProcessIdentity(trial, handle, label);
    processLedger.observe(role, `pid:${registration.pid}:created:${registration.creationTime}`, {
      kind: 'process-start',
      pid: registration.pid,
      label,
    });
    return registration;
  };

  try {
    const browserCaptureFile = path.join(trial.paths.control, 'browser-auth.capture');
    phase = 'realm-policy-preflight';
    const realmAuthPolicy = await probeDevKernelRealmPolicy(ACCOUNT_REALM_ORIGIN);
    observations.realmAuthPolicy = realmAuthPolicy;
    const browserAuthPlan = executionMode === 'core' ? CORE_BROWSER_AUTH_PLAN : OWNER_MINIMAL_BROWSER_AUTH_PLAN;
    if (realmAuthPolicy.passwordLoginLimit < browserAuthPlan.length) {
      throw new Error(`formal test-Realm policy cannot admit ${executionMode} browser auth plan`);
    }
    observations.browserAuthPlan = browserAuthPlan;
    const browserAuthDriver = createDevKernelBrowserAuthDriver({
      trialRoot: trial.paths.root,
      captureFile: browserCaptureFile,
      diagnosticsRoot: path.join(artifactsRoot, 'browser-auth'),
      requiredCredentialRoles: executionMode === 'core' ? ['primary', 'secondary'] : ['primary'],
      realmPolicy: realmAuthPolicy,
    });
    phase = 'fixed-service-preflight';
    serviceBefore = readFixedServiceStatus();
    observations.serviceBefore = serviceBefore;
    processLedger.observe('runtime', `pid:${serviceBefore.processId}`, {
      kind: 'fixed-service-process',
      pid: serviceBefore.processId,
      phase: 'initial',
    });

    phase = 'realm-fixture-start';
    const realmManifest = createRealmFixtureManifest(FIXTURE_ORIGIN);
    realmManifest.scenarioId = 'dev-kernel-checkpoint.fixed-service-local-development';
    realmManifest.devKernelCheckpoint = {
      nonRelease: true,
      allowedAccountIds: [fixtureConfig.primaryAccountId, fixtureConfig.secondaryAccountId],
    };
    realmManifest.realmFixture.currentUser = {
      id: fixtureConfig.primaryAccountId,
      displayName: '开发内核主账号',
      handle: '@dev-kernel-primary',
      email: `${fixtureConfig.primaryAccountId}@nimi.local`,
      avatarUrl: '',
    };
    realmManifest.realmFixture.providerRequests = [];
    writeJson(manifestPath, realmManifest);
    fixture = await startRealmFixtureServer({ manifestPath, host: '127.0.0.1', port: 19443 });
    if (fixture.origin !== FIXTURE_ORIGIN) throw new Error(`fixture origin drifted: ${fixture.origin}`);
    observations.accountAuthority = await probeRealRealmBrowserLoginAuthority(
      fixtureConfig.accountRealmBaseUrl,
      fixtureConfig.accountWebBaseUrl,
    );
    processLedger.observe('realm', `fixture-listener:${fixture.origin}`, { kind: 'fixture-listener-start' });
    processLedger.observe('provider', `fixture-provider:${fixture.origin}`, { kind: 'fixture-provider-start' });

    const [desktopCdpPort, zhiyuCdpPort, rawCdpPort] = await Promise.all([reservePort(), reservePort(), reservePort()]);
    const rawUserDataRoot = path.join(trial.paths.root, 'zhiyu-raw-mismatch-user-data');
    fs.mkdirSync(rawUserDataRoot, { recursive: true });
    const hostToolchainHomes = resolveHostRustToolchainHomes({
      env: process.env,
      hostHome: os.homedir(),
    });
    for (const [name, toolchainRoot] of Object.entries(hostToolchainHomes)) {
      if (!fs.existsSync(toolchainRoot) || !fs.statSync(toolchainRoot).isDirectory()) {
        throw new Error(`${name} does not identify an installed host toolchain directory: ${toolchainRoot}`);
      }
      const relativeToTrial = path.relative(path.resolve(trial.paths.root), path.resolve(toolchainRoot));
      if (relativeToTrial === '' || (!relativeToTrial.startsWith(`..${path.sep}`) && relativeToTrial !== '..' && !path.isAbsolute(relativeToTrial))) {
        throw new Error(`${name} must remain outside the isolated product trial root`);
      }
    }
    const baseEnv = {
      ...browserAuthSafeChildEnvironment(process.env),
      NO_COLOR: '1',
      FORCE_COLOR: '0',
      NIMI_REALM_URL: ACCOUNT_REALM_ORIGIN,
      VITE_NIMI_REALM_URL: ACCOUNT_REALM_ORIGIN,
      NIMI_REALM_JWKS_URL: `${ACCOUNT_REALM_ORIGIN}/api/auth/jwks`,
      NIMI_REALM_REVOCATION_URL: `${ACCOUNT_REALM_ORIGIN}/api/auth/sessions/introspect`,
      NIMI_REALM_JWT_ISSUER: ACCOUNT_REALM_ORIGIN,
      NIMI_REALM_JWT_AUDIENCE: 'nimi-runtime',
      NIMI_LOCAL_AGENT_PRODUCT_TRIAL_ROOT: trial.paths.root,
      NIMI_LOCAL_AGENT_PRODUCT_CONTROL_ROOT: trial.paths.control,
      NIMI_LOCAL_AGENT_PRODUCT_DESKTOP_USER_DATA_ROOT: trial.paths.desktopUserData,
      NIMI_LOCAL_AGENT_PRODUCT_ZHIYU_USER_DATA_ROOT: trial.paths.zhiyuUserData,
      NIMI_LOCAL_AGENT_PRODUCT_DESKTOP_CDP_PORT: String(desktopCdpPort),
      NIMI_LOCAL_AGENT_PRODUCT_ZHIYU_CDP_PORT: String(zhiyuCdpPort),
      NIMI_LOCAL_AGENT_PRODUCT_AGENT_ID: fixtureConfig.agent.localAgentRef,
      NIMI_LOCAL_AGENT_PRODUCT_ACCOUNT_ID: fixtureConfig.primaryAccountId,
      NIMI_LOCAL_AGENT_PRODUCT_JOURNEY_ID: 'dev-kernel-core',
      NIMI_LOCAL_AGENT_PRODUCT_TRIAL_ID: trial.identity.journeyTrialId,
      NIMI_LOCAL_AGENT_PRODUCT_SOURCE_DIGEST: sourceState.sourceDigest,
      NIMI_DESKTOP_ELECTRON_OPEN_EXTERNAL_CAPTURE_FILE: browserCaptureFile,
      RUSTUP_HOME: hostToolchainHomes.rustupHome,
      CARGO_HOME: hostToolchainHomes.cargoHome,
      // The harness owns an isolated real-Chrome profile for every fresh auth
      // interaction. Desktop receives only the trial-owned one-URL capture seam.
      HOME: trial.paths.root,
      USERPROFILE: trial.paths.root,
    };

    phase = 'desktop-start';
    const desktopLaunch = beginObservedProcess({
      connect: () => connectCdp(desktopCdpPort, 'Desktop', 300_000, observer),
      start: () => startProcess(process.execPath, [
        path.join(repoRoot, 'apps', 'desktop', 'scripts', 'run-dev-kernel-checkpoint-electron.mjs'),
      ], {
        cwd: repoRoot,
        env: baseEnv,
        ...processLogOptions('desktop-electron-checkpoint-launcher'),
      }),
    });
    desktopHandle = desktopLaunch.handle;
    observeRegisteredProcess('desktop', desktopHandle, 'desktop-electron-checkpoint-launcher');
    const desktop = await waitForObservedProcessConnection({
      connectionPromise: desktopLaunch.connectionPromise,
      handle: desktopHandle,
      label: 'Desktop Electron checkpoint launcher',
    });
    desktopConnection = desktop;
    phase = 'desktop-fixed-service-baseline';
    observations.fixedServicePreflight = await prepareDesktopFixedServiceBaseline(desktop.page);
    const desktopBootstrapOutcome = await waitUntil(async () => {
      if (await desktop.page.getByTestId('login-screen').isVisible().catch(() => false)) return 'anonymous-login';
      if (await desktop.page.getByTestId('main-shell').isVisible().catch(() => false)) return 'unexpected-main-shell';
      if (await desktop.page.getByTestId('desktop-first-run-gate').isVisible().catch(() => false)) {
        return 'unexpected-pre-auth-first-run';
      }
      if (await desktop.page.getByTestId('app-bootstrap-error-screen').isVisible().catch(() => false)) {
        return 'bootstrap-error';
      }
      if (desktopHandle.child.exitCode !== null) throw new Error('Desktop exited before bootstrap');
      return false;
    }, { timeoutMs: 120_000, label: 'Desktop isolated anonymous login shell' });
    if (desktopBootstrapOutcome === 'bootstrap-error') {
      const diagnostics = await readDesktopRuntimeDiagnostics(desktop.page);
      throw new Error(`Desktop bootstrap failed before auth shell: ${JSON.stringify(diagnostics)}`);
    }
    if (desktopBootstrapOutcome !== 'anonymous-login') {
      throw new Error(`isolated Desktop checkpoint entered invalid pre-auth state ${desktopBootstrapOutcome}`);
    }
    const browserAuth = (credentialRole, expectedAccountId, label) => ({
      driver: browserAuthDriver,
      credentialRole,
      expectedAccountId,
      label,
    });
    phase = 'desktop-primary-login';
    const primaryLogin = await loginDesktop(
      desktop,
      fixtureConfig.primaryAccountId,
      browserAuth('primary', fixtureConfig.primaryAccountId, 'primary-login'),
    );
    if (primaryLogin.outcome === 'first-run') {
      const productControl = await readProductControlJSONProjection(
        desktop.page,
        PRODUCT_CONTROL_RECORD_METHOD,
      );
      if (productControl?.state === 'ready_for_use') {
        observations.firstRun = await captureReusedReadyFirstRun(
          desktop.page,
          productControl,
          serviceBefore.runtimeCandidateId,
        );
      } else {
        const proposedDataRoot = requireCheckpointDataRootProposal(
          productControl,
          serviceBefore.runtimeCandidateId,
        );
        observations.firstRun = await completeDesktopFirstRun(desktop, {
          ...trial,
          paths: { ...trial.paths, runtimeData: proposedDataRoot },
        }, screenshotsRoot, {
          reuseReadyCandidateId: serviceBefore.runtimeCandidateId,
        });
        observations.firstRun.reusedReady = false;
      }
    } else if (primaryLogin.outcome === 'main-shell') {
      const productControlRecord = await readProductControlJSONProjection(
        desktop.page,
        PRODUCT_CONTROL_RECORD_METHOD,
      );
      observations.firstRun = await captureReusedReadyFirstRun(
        desktop.page,
        productControlRecord,
        serviceBefore.runtimeCandidateId,
      );
    } else {
      throw new Error(`Desktop login entered unsupported product state ${primaryLogin.outcome}`);
    }
    processLedger.observe('runtime', `pid:${observations.firstRun.serviceAfterStorage.processId}`, {
      kind: 'fixed-service-process',
      pid: observations.firstRun.serviceAfterStorage.processId,
      phase: 'after-storage-selection',
    });
    processLedger.observe('runtime', `pid:${observations.firstRun.serviceAfterReady.processId}`, {
      kind: 'fixed-service-process',
      pid: observations.firstRun.serviceAfterReady.processId,
      phase: 'after-first-run-ready',
    });
    observations.primaryAccountLabel = await desktop.page
      .getByTestId('desktop-account-menu-trigger')
      .textContent();
    observations.primaryAccountSession = await invokeDesktop(
      desktop.page,
      'runtime_account_session_status',
    );
    phase = 'developer-mode-enable';
    observations.developerModeEnabled = await setDeveloperMode(desktop.page, true);

    phase = 'run-once-local-development-start';
    const runOnceLaunch = beginObservedProcess({
      connect: () => connectCdp(zhiyuCdpPort, 'run-once Zhiyu', 180_000, observer),
      start: () => startZhiyuDev(baseEnv, processLogOptions('zhiyu-run-once-launcher')),
    });
    runOnceHandle = runOnceLaunch.handle;
    observeRegisteredProcess('zhiyu', runOnceHandle, 'zhiyu-run-once-launcher');
    phase = 'run-once-local-development-approval';
    observations.runOnceApproval = await approveLocalDevelopment(
      desktop,
      'allow-run-once',
      screenshotsRoot,
      true,
      browserAuth('primary', fixtureConfig.primaryAccountId, 'run-once-local-development'),
    );
    const runOnceZhiyu = await waitForObservedProcessConnection({
      connectionPromise: runOnceLaunch.connectionPromise,
      handle: runOnceHandle,
      label: 'run-once Zhiyu Electron launcher',
    });
    activeZhiyuConnection = runOnceZhiyu;
    phase = 'run-once-zero-grant';
    await waitForTestId(runOnceZhiyu.page, 'zhiyu-dev-kernel-root', 180_000);
    const zeroGrant = await waitZhiyuEvidence(
      runOnceZhiyu.page,
      { state: 'session-bound-zero-grant' },
      'zero-grant session',
      90_000,
      { transientRuntimeUnavailableMs: 15_000 },
    );
    await runOnceZhiyu.page.getByTestId('zhiyu-dev-kernel-attempt-open').click();
    const noGrant = await waitZhiyuEvidence(runOnceZhiyu.page, { errorReason: 'no-grant' }, 'no-grant denial');
    observations.zeroGrant = zeroGrant;
    observations.noGrant = noGrant;
    await runOnceZhiyu.page.screenshot({ path: path.join(screenshotsRoot, 'zhiyu-zero-grant-desktop.png') });
    observations.zhiyuNarrowMethod = await setWindowBounds(runOnceZhiyu, 390, 780);
    await runOnceZhiyu.page.screenshot({ path: path.join(screenshotsRoot, 'zhiyu-zero-grant-narrow.png') });
    observations.zhiyuZeroNarrowMetrics = await runOnceZhiyu.page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    await setWindowBounds(runOnceZhiyu, 1060, 780);

    phase = 'run-once-open-grant';
    await grantOpenConversation(
      desktop.page,
      runOnceZhiyu.page,
      browserAuth('primary', fixtureConfig.primaryAccountId, 'run-once-grant'),
    );
    const ownerOpen = await openConversation(runOnceZhiyu.page);
    observations.ownerSelectedOperation = ownerOpen;

    phase = 'raw-uncarried-process-probe';
    const rawServiceBefore = readFixedServiceStatus();
    const rawLaunch = beginObservedProcess({
      connect: () => connectCdp(rawCdpPort, 'raw mismatched Zhiyu', 90_000, observer),
      start: () => startRawMismatchedZhiyu({
        port: rawCdpPort,
        userDataRoot: rawUserDataRoot,
        agentId: fixtureConfig.agent.localAgentRef,
        env: baseEnv,
        captureOptions: processLogOptions('zhiyu-raw-mismatch-launcher'),
      }),
    });
    rawHandle = rawLaunch.handle;
    observeRegisteredProcess('zhiyu', rawHandle, 'zhiyu-raw-mismatch-launcher');
    const rawZhiyu = await waitForObservedProcessConnection({
      connectionPromise: rawLaunch.connectionPromise,
      handle: rawHandle,
      label: 'raw mismatched Zhiyu Electron launcher',
    });
    await waitForTestId(rawZhiyu.page, 'zhiyu-dev-kernel-root');
    let rawInitial = await waitUntil(
      () => rawZhiyu.page.evaluate(() => window.__nimiZhiyuDevKernelEvidence || null),
      { timeoutMs: 30_000, label: 'raw Zhiyu evidence' },
    );
    if (rawInitial.lastError?.reasonCode === 'runtime-service-unavailable') {
      await rawZhiyu.page.getByTestId('zhiyu-dev-kernel-refresh').click();
      rawInitial = await waitUntil(async () => {
        const value = await rawZhiyu.page.evaluate(() => window.__nimiZhiyuDevKernelEvidence || null);
        return value?.lastError?.reasonCode !== 'runtime-service-unavailable' ? value : null;
      }, { timeoutMs: 30_000, intervalMs: 100, label: 'raw process exact transport recovery' });
    }
    if (!rawInitial.lastError) {
      await rawZhiyu.page.getByTestId('zhiyu-dev-kernel-attempt-open').click();
    }
    const rawDenied = await waitUntil(async () => {
      const value = await rawZhiyu.page.evaluate(() => window.__nimiZhiyuDevKernelEvidence || null);
      return ['runtime-service-untrusted', 'runtime-service-unavailable'].includes(value?.lastError?.reasonCode)
        ? value
        : null;
    }, { timeoutMs: 30_000, label: 'raw process mismatch denial' });
    const rawServiceAfter = readFixedServiceStatus();
    if (rawServiceBefore.state !== 'running'
      || rawServiceAfter.state !== 'running'
      || rawServiceAfter.processId !== rawServiceBefore.processId
      || rawServiceAfter.runtimeCandidateId !== rawServiceBefore.runtimeCandidateId) {
      throw new Error('raw process denial overlapped a fixed Runtime service transition');
    }
    observations.processMismatch = {
      ...rawDenied,
      probeKind: 'raw-uncarried',
      fixedServiceStable: true,
      fixedServiceProcessId: rawServiceAfter.processId,
      runtimeCandidateId: rawServiceAfter.runtimeCandidateId,
    };
    await rawZhiyu.page.screenshot({ path: path.join(screenshotsRoot, 'zhiyu-raw-process-mismatch.png') });
    await terminateProcessTree(rawHandle);
    rawHandle = null;
    requireLiveDesktopCheckpoint(desktopHandle, desktop, 'after raw process mismatch');

    phase = 'grant-revoke';
    await revokeOperationGrant(desktop.page, OPEN_OPERATION);
    requireLiveDesktopCheckpoint(desktopHandle, desktop, 'after grant revoke');
    await runOnceZhiyu.page.getByTestId('zhiyu-dev-kernel-attempt-open').click();
    observations.grantRevoked = await waitUntil(async () => {
      const value = await runOnceZhiyu.page.evaluate(() => window.__nimiZhiyuDevKernelEvidence || null);
      return ['grant-revoked', 'revoked'].includes(value?.lastError?.reasonCode) ? value : null;
    }, { timeoutMs: 30_000, label: 'revoked grant denial' });
    await runOnceZhiyu.page.screenshot({ path: path.join(screenshotsRoot, 'zhiyu-grant-revoked.png') });
    requireLiveDesktopCheckpoint(desktopHandle, desktop, 'after revoked-operation evidence');

    if (executionMode === 'owner-minimal') {
      observations.browserAuthBudget = browserAuthDriver.audit();
      phase = 'owner-minimal-persist';
      return await persistOwnerMinimalResult({
        observer, desktop, runOnceZhiyu, observedPages, observations, trial, serviceBefore,
        artifactsRoot, screenshotsRoot, sourceState, outputDir, started,
      });
    }
    await terminateProcessTree(runOnceHandle);
    runOnceHandle = null;

    phase = 'remembered-local-development-start';
    const rememberedLaunch = beginObservedProcess({
      connect: () => connectCdp(zhiyuCdpPort, 'remembered Zhiyu', 180_000, observer),
      start: () => startZhiyuDev(baseEnv, processLogOptions('zhiyu-remembered-launcher')),
    });
    rememberedHandle = rememberedLaunch.handle;
    observeRegisteredProcess('zhiyu', rememberedHandle, 'zhiyu-remembered-launcher');
    phase = 'remembered-local-development-approval';
    observations.rememberedApproval = await approveLocalDevelopment(
      desktop,
      'allow-remember-project',
      screenshotsRoot,
      false,
      browserAuth('primary', fixtureConfig.primaryAccountId, 'remembered-local-development'),
    );
    phase = 'remembered-local-development-approval';
    let zhiyu = await waitForObservedProcessConnection({
      connectionPromise: rememberedLaunch.connectionPromise,
      handle: rememberedHandle,
      label: 'remembered Zhiyu Electron launcher',
    });
    activeZhiyuConnection = zhiyu;
    await waitForTestId(zhiyu.page, 'zhiyu-dev-kernel-root');
    await waitZhiyuEvidence(zhiyu.page, { state: 'session-bound-zero-grant' }, 'remembered zero-grant session');
    observations.rememberedAuthorization = await waitUntil(
      () => readRememberedAuthorization(desktop.page, {
        accountId: fixtureConfig.primaryAccountId,
        state: 'active',
      }),
      { timeoutMs: 30_000, label: 'active remembered authorization' },
    );
    phase = 'remembered-grant-batch';
    await grantOpenConversation(
      desktop.page,
      zhiyu.page,
      browserAuth('primary', fixtureConfig.primaryAccountId, 'remembered-open-grant'),
    );
    const fullOpen = await openConversation(zhiyu.page);
    await grantConversationOperations(
      desktop.page,
      zhiyu.page,
      browserAuth('primary', fixtureConfig.primaryAccountId, 'remembered-conversation-grant'),
    );
    const firstTurn = await sendTurnWithKeyboard(
      zhiyu.page,
      '第一轮：请确认固定 Windows Runtime 服务、Desktop 授权与知语 local_development carrier 已真实连通。',
      2,
    );
    observations.firstConversation = firstTurn;
    const anchorId = firstTurn.evidence.conversationAnchorId;
    const firstTranscriptCount = firstTurn.evidence.transcript.length;
    await zhiyu.page.screenshot({ path: path.join(screenshotsRoot, 'zhiyu-conversation-desktop.png') });
    const sendButton = zhiyu.page.getByTestId('zhiyu-dev-kernel-send');
    observations.sendDisabledAfterEmptyDraft = await sendButton.isDisabled();

    const editedProbe = originalProbe.toString('utf8').replace(
      "export const DEV_KERNEL_RESTART_PROBE = 'baseline';",
      `export const DEV_KERNEL_RESTART_PROBE = '${buildMarker}';`,
    );
    if (editedProbe === originalProbe.toString('utf8')) throw new Error('restart probe baseline marker is missing');
    phase = 'supervised-process-replacement';
    const rebuiltZhiyuPromise = waitForRebuiltZhiyu(zhiyuCdpPort, buildMarker, observer, zhiyu);
    fs.writeFileSync(probePath, editedProbe, 'utf8');
    const preEditRuns = await invokeDesktop(desktop.page, 'local_development_runs_list');
    zhiyu = await rebuiltZhiyuPromise;
    activeZhiyuConnection = zhiyu;
    await waitForTestId(zhiyu.page, 'zhiyu-dev-kernel-root');
    await zhiyu.page.getByTestId('zhiyu-dev-kernel-refresh').click();
    await waitZhiyuEvidence(zhiyu.page, { openPermission: 'granted', buildMarker }, 'post-edit grants');
    const postEditOpen = await openConversation(zhiyu.page);
    if (postEditOpen.conversationAnchorId !== anchorId) throw new Error('conversation anchor changed after supervised process replacement');
    await waitZhiyuEvidence(zhiyu.page, { conversationGranted: true }, 'post-edit conversation grants');
    const secondTurn = await sendTurnWithKeyboard(
      zhiyu.page,
      '第二轮：这是源码编辑、重新构建和进程替换之后的连续性验证，请回复当前会话仍然连续。',
      firstTranscriptCount + 2,
    );
    const postEditRuns = await invokeDesktop(desktop.page, 'local_development_runs_list');
    const preEditGeneration = Number(preEditRuns[0]?.hostGeneration);
    const postEditGeneration = Number(postEditRuns[0]?.hostGeneration);
    if (Number.isInteger(preEditGeneration)
      && Number.isInteger(postEditGeneration)
      && postEditGeneration > preEditGeneration) {
      processLedger.observe('zhiyu', `host-generation:${postEditGeneration}`, {
        kind: 'supervised-process-replacement',
        previousGeneration: preEditGeneration,
        hostGeneration: postEditGeneration,
      });
    }
    observations.editBuildRestart = {
      buildMarker,
      preEditRuns,
      postEditRuns,
      anchorBefore: anchorId,
      anchorAfter: secondTurn.evidence.conversationAnchorId,
      transcriptBefore: firstTranscriptCount,
      transcriptAfter: secondTurn.evidence.transcript.length,
    };

    phase = 'developer-mode-cycle';
    observations.modeOff = await setDeveloperMode(desktop.page, false);
    await waitUntil(async () => rememberedHandle.child.exitCode !== null || zhiyu.page.isClosed(), {
      timeoutMs: 60_000,
      label: 'mode-off supervised host termination',
    });
    observations.dormantAuthorization = await waitUntil(
      () => readRememberedAuthorization(desktop.page, {
        accountId: fixtureConfig.primaryAccountId,
        selector: observations.rememberedAuthorization.selector,
        state: 'dormant',
      }),
      { timeoutMs: 30_000, label: 'mode-off dormant authorization' },
    );
    if (rememberedHandle.child.exitCode === null) await terminateProcessTree(rememberedHandle);
    rememberedHandle = null;
    fs.writeFileSync(probePath, originalProbe);
    probeRestored = true;
    observations.modeOn = await setDeveloperMode(desktop.page, true);
    return await runCoreReactivationJourney({
      architecture, journey, trial, sourceState, outputDir, fixture, fixtureConfig,
      providerRawPath, observations, artifactsRoot, screenshotsRoot, desktop, observer,
      observedPages, processLedger, processLogOptions, observeRegisteredProcess, browserAuth,
      baseEnv, zhiyuCdpPort, anchorId, firstTurn, secondTurn, serviceBefore, startedAt,
      started, buildMarker,
      setPhase: (value) => { phase = value; },
      setReactivatedHandle: (value) => { reactivatedHandle = value; },
      setFinalHandle: (value) => { finalHandle = value; },
      setActiveZhiyuConnection: (value) => { activeZhiyuConnection = value; },
      auditBrowserAuth: () => browserAuthDriver.audit(),
    });
  } catch (error) {
    try {
      await persistDevKernelFailureBundle({
        artifactsRoot,
        executionMode,
        phase,
        error,
        sourceState,
        desktop: desktopConnection,
        zhiyuConnections: [activeZhiyuConnection].filter(Boolean),
        readDesktopGrantProjection: async () => {
          if (!desktopConnection?.page || desktopConnection.page.isClosed()) return null;
          const [pending, grants] = await Promise.all([
            invokeDesktop(desktopConnection.page, 'local_app_grant_pending_list'),
            invokeDesktop(desktopConnection.page, 'local_app_grant_list'),
          ]);
          return { pending, grants };
        },
        runtimeService: (() => {
          try { return readFixedServiceStatus(); } catch { return serviceBefore; }
        })(),
        processLedger,
        observations,
        observedPages,
      });
    } catch {
      fs.writeFileSync(path.join(artifactsRoot, 'sanitized-failure-bundle-fallback.json'), `${JSON.stringify({
        schemaVersion: 'nimi.dev-kernel-sanitized-failure/v1',
        acceptanceEligible: false,
        executionMode,
        phase,
        errorCode: 'failure-bundle-projection-failed',
      }, null, 2)}\n`, { mode: 0o600 });
    }
    throw error;
  } finally {
    if (!probeRestored) fs.writeFileSync(probePath, originalProbe);
    await Promise.all([
      rawHandle ? terminateProcessTree(rawHandle) : undefined,
      runOnceHandle ? terminateProcessTree(runOnceHandle) : undefined,
      rememberedHandle ? terminateProcessTree(rememberedHandle) : undefined,
      reactivatedHandle ? terminateProcessTree(reactivatedHandle) : undefined,
      finalHandle ? terminateProcessTree(finalHandle) : undefined,
      desktopHandle ? terminateProcessTree(desktopHandle) : undefined,
    ]);
    if (fixture) await fixture.close().catch(() => undefined);
    lock.release();
  }
}
