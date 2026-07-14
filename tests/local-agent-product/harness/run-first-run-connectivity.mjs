#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

import { createRealmFixtureManifest } from '../../../apps/desktop/scripts/explore-materialization-acceptance/acceptance-fixture.mjs';
import { startRealmFixtureServer } from '../../../apps/desktop/e2e/fixtures/realm-fixture-server.mjs';
import {
  requireWindowsDevSignedFiles,
  requireWindowsDevSigningIdentity,
} from '../../../scripts/lib/windows-dev-signing.mjs';
import {
  assessAccessibilityAudit,
  beginObservedProcess,
  resolveHostRustToolchainHomes,
  waitForObservedProcessConnection,
} from './dev-kernel-contract.mjs';
import {
  acquireFixedServiceLock,
  classifyFirstRunStorageRecoverySnapshot,
  completeDesktopFirstRun,
  connectCdp,
  createEarlyCdpObserver,
  invokeDesktop,
  invokeDesktopRuntimeUnary,
  loginDesktop,
  pageAudit,
  prepareDesktopFixedServiceBaseline,
  probeRealRealmBrowserLoginAuthority,
  readFixedServiceStatus,
  readProductControlJSONProjection,
  requireCheckpointDataRootProposal,
  reservePort,
  setWindowBounds,
  waitUntil,
} from './dev-kernel-cross-app-driver.mjs';
import { validateFirstRunConnectivityObservation } from './dev-kernel-first-run-contract.mjs';
import { startProcess, terminateProcessTree } from './cross-app-driver.mjs';
import { registerTrialProcessIdentity } from './sandbox-hygiene.mjs';
import { createIsolatedJourneyRoot, removeIsolatedTrialRoot } from './trial-root.mjs';
import { repoRoot } from './registry.mjs';

const requireFromDesktop = createRequire(path.join(repoRoot, 'apps', 'desktop', 'package.json'));
const { NIMI_STANDARD_SHELL_COMMANDS } = requireFromDesktop('@nimiplatform/kit/shell/capabilities');
const STATUS_COMMAND = NIMI_STANDARD_SHELL_COMMANDS['runtime-lifecycle.status'];
const RESTART_COMMAND = NIMI_STANDARD_SHELL_COMMANDS['runtime-lifecycle.restart'];
const RUNTIME_UNARY_COMMAND = NIMI_STANDARD_SHELL_COMMANDS['runtime.unary'];
const PRODUCT_CONTROL_RECORD_METHOD = '/nimi.runtime.v1.RuntimeLocalService/GetProductControlRecord';
const FIXTURE_ORIGIN = 'http://127.0.0.1:19443';
const ACCOUNT_REALM_ORIGIN = 'http://localhost:3002';
const ACCOUNT_WEB_ORIGIN = 'http://localhost:3000';
const LONG_CHINESE_ACCOUNT_NAME = '开发内核主账号｜固定服务 First Run 连通性验收｜超长中文名称用于窄屏可读性验证';
const SECRET_TEXT = /(?:bearer\s+[a-z0-9._~+/=-]+|(?:access|refresh|id)[_-]?token\s*[:=]|eyj[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}\.)/iu;

if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error(`First Run connectivity requires Windows x64, got ${process.platform}/${process.arch}`);
}

const acceptance = JSON.parse(fs.readFileSync(
  path.join(repoRoot, 'config', 'dev-kernel-checkpoint-acceptance.json'),
  'utf8',
));
if (acceptance.checkpoint !== 'dev_kernel_checkpoint'
  || acceptance.nonRelease !== true
  || acceptance.schemaVersion !== 2
  || acceptance.accountRealmBaseUrl !== ACCOUNT_REALM_ORIGIN
  || acceptance.accountWebBaseUrl !== ACCOUNT_WEB_ORIGIN
  || acceptance.fixtureBaseUrl !== FIXTURE_ORIGIN
  || acceptance.providerBaseUrl !== `${FIXTURE_ORIGIN}/v1`) {
  throw new Error('dev-kernel acceptance fixture is invalid');
}

const trial = createIsolatedJourneyRoot({
  journeyId: 'dev-kernel-first-run',
  tier: 'integration',
  batch: 'first-run-connectivity',
  repeatIndex: 1,
});
const lock = acquireFixedServiceLock();
const artifactRoot = path.join(trial.paths.artifacts, 'first-run-connectivity');
const screenshotsRoot = path.join(artifactRoot, 'screenshots');
const logsRoot = path.join(artifactRoot, 'process-logs');
fs.mkdirSync(screenshotsRoot, { recursive: true });
fs.mkdirSync(logsRoot, { recursive: true });
let fixture;
let desktopHandle;
let desktopConnection;
let runtimeDataRoot;
let completed = false;

try {
  const serviceBefore = readFixedServiceStatus();
  const electronHost = verifyElectronHost();
  const manifest = createRealmFixtureManifest(FIXTURE_ORIGIN);
  manifest.scenarioId = 'dev-kernel-checkpoint.first-run-connectivity';
  manifest.devKernelCheckpoint = {
    nonRelease: true,
    allowedAccountIds: [acceptance.primaryAccountId],
  };
  manifest.realmFixture.currentUser = {
    id: acceptance.primaryAccountId,
    displayName: LONG_CHINESE_ACCOUNT_NAME,
    handle: '@dev-kernel-first-run',
    email: `${acceptance.primaryAccountId}@nimi.local`,
    avatarUrl: '',
  };
  const manifestPath = path.join(trial.paths.control, 'realm-fixture-manifest.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  fixture = await startRealmFixtureServer({ manifestPath, host: '127.0.0.1', port: 19443 });
  if (fixture.origin !== FIXTURE_ORIGIN) throw new Error(`fixture origin drifted: ${fixture.origin}`);
  const accountAuthority = await probeRealRealmBrowserLoginAuthority(
    acceptance.accountRealmBaseUrl,
    acceptance.accountWebBaseUrl,
  );

  const cdpPort = await reservePort();
  const observedPages = [];
  const observer = createEarlyCdpObserver(observedPages);
  const toolchainHomes = resolveHostRustToolchainHomes({ env: process.env, hostHome: os.homedir() });
  const env = {
    ...process.env,
    NO_COLOR: '1',
    FORCE_COLOR: '0',
    NIMI_DEV_KERNEL_ELECTRON_BUILD_MODE: 'reuse',
    NIMI_PROTECTED_LOCAL_DIAGNOSTICS: '1',
    NIMI_REALM_URL: ACCOUNT_REALM_ORIGIN,
    VITE_NIMI_REALM_URL: ACCOUNT_REALM_ORIGIN,
    NIMI_REALM_JWKS_URL: `${ACCOUNT_REALM_ORIGIN}/api/auth/jwks`,
    NIMI_REALM_REVOCATION_URL: `${ACCOUNT_REALM_ORIGIN}/api/auth/sessions/introspect`,
    NIMI_REALM_JWT_ISSUER: ACCOUNT_REALM_ORIGIN,
    NIMI_REALM_JWT_AUDIENCE: 'nimi-runtime',
    NIMI_LOCAL_AGENT_PRODUCT_TRIAL_ROOT: trial.paths.root,
    NIMI_LOCAL_AGENT_PRODUCT_CONTROL_ROOT: trial.paths.control,
    NIMI_LOCAL_AGENT_PRODUCT_DESKTOP_USER_DATA_ROOT: trial.paths.desktopUserData,
    NIMI_LOCAL_AGENT_PRODUCT_DESKTOP_CDP_PORT: String(cdpPort),
    NIMI_LOCAL_AGENT_PRODUCT_ACCOUNT_ID: acceptance.primaryAccountId,
    NIMI_LOCAL_AGENT_PRODUCT_JOURNEY_ID: 'dev-kernel-first-run',
    NIMI_LOCAL_AGENT_PRODUCT_TRIAL_ID: trial.identity.journeyTrialId,
    RUSTUP_HOME: toolchainHomes.rustupHome,
    CARGO_HOME: toolchainHomes.cargoHome,
  };
  const launch = beginObservedProcess({
    connect: () => connectCdp(cdpPort, 'First Run Desktop', 180_000, observer),
    start: () => startProcess(process.execPath, [
      path.join(repoRoot, 'apps', 'desktop', 'scripts', 'run-dev-kernel-checkpoint-electron.mjs'),
    ], {
      cwd: repoRoot,
      env,
      stdoutPath: path.join(logsRoot, 'desktop.stdout.log'),
      stderrPath: path.join(logsRoot, 'desktop.stderr.log'),
    }),
  });
  desktopHandle = launch.handle;
  registerTrialProcessIdentity(trial, desktopHandle, 'first-run-desktop-electron');
  desktopConnection = await waitForObservedProcessConnection({
    connectionPromise: launch.connectionPromise,
    handle: desktopHandle,
    label: 'First Run Desktop Electron',
  });
  const { page } = desktopConnection;
  await page.waitForLoadState('load', { timeout: 60_000 });
  await page.reload({ waitUntil: 'load', timeout: 60_000 });

  // CDP can attach while the signed Electron host is still completing its
  // first protected Desktop session. Treat that handshake interval as
  // transient, exactly as the fixed-service smoke does, while preserving the
  // native host's fail-closed runtime-service-untrusted result per attempt.
  const initialProjection = await waitUntil(async () => {
    const projection = await readProductControlJSONProjection(page, PRODUCT_CONTROL_RECORD_METHOD);
    return [
      'config_missing',
      'data_root_missing',
      'data_root_selected',
      'local_ai_profile_selected_assets_missing',
      'local_ai_ready',
    ].includes(projection?.state) ? projection : null;
  }, { timeoutMs: 60_000, intervalMs: 100, label: 'installer-owned acceptance round' });
  const resumedFinalizationDiagnostic = [
    'local_ai_profile_selected_assets_missing',
    'local_ai_ready',
  ].includes(initialProjection.state);
  const resumedDeviceDiagnostic = initialProjection.state === 'data_root_selected';
  runtimeDataRoot = requireCheckpointDataRootProposal(initialProjection, serviceBefore.runtimeCandidateId);

  const baseline = await prepareDesktopFixedServiceBaseline(page);
  await page.evaluate(() => window.localStorage.setItem('nimi.shell.locale', 'zh'));
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.getByTestId('login-screen').waitFor({ state: 'visible', timeout: 60_000 });
  const login = await loginDesktop(desktopConnection, acceptance.primaryAccountId);
  if (login.outcome !== 'first-run') throw new Error(`expected First Run after login, got ${login.outcome}`);

  if (resumedDeviceDiagnostic) {
    const firstRunTrial = {
      ...trial,
      paths: { ...trial.paths, runtimeData: runtimeDataRoot },
    };
    const firstRun = await completeDesktopFirstRun(desktopConnection, firstRunTrial, screenshotsRoot, {
      captureAllPhases: true,
      exerciseDeviceRetry: true,
      resumeFromDevice: true,
    });
    const record = await readProductControlJSONProjection(page, PRODUCT_CONTROL_RECORD_METHOD).catch(() => null);
    const diagnostic = {
      schemaVersion: 'nimi.dev-kernel-first-run-device-resume-diagnostic/v1',
      observedAt: new Date().toISOString(),
      finalAcceptanceEvidence: false,
      serviceBefore,
      initialProjection,
      login,
      firstRun,
      productControl: record,
    };
    const diagnosticPath = path.join(artifactRoot, 'first-run-device-resume-diagnostic.json');
    fs.writeFileSync(diagnosticPath, `${JSON.stringify(diagnostic, null, 2)}\n`, { mode: 0o600 });
    await page.screenshot({ path: path.join(screenshotsRoot, 'desktop-first-run-device-resume-ready.png') });
    throw new Error('resumed First Run reached ready_for_use after a prior runner observation race; result remains non-final diagnostic evidence');
  }

  if (resumedFinalizationDiagnostic) {
    const outcome = await waitUntil(async () => {
      const failure = page.getByTestId('product-first-run-finalization-error');
      if (await failure.isVisible().catch(() => false)) {
        return { kind: 'failure', text: String(await failure.innerText().catch(() => '')).trim() };
      }
      if (await page.getByTestId('main-shell').isVisible().catch(() => false)) {
        return { kind: 'ready', text: '' };
      }
      return null;
    }, { timeoutMs: 180_000, intervalMs: 250, label: 'resumed First Run finalization diagnostic' });
    const record = await readProductControlJSONProjection(page, PRODUCT_CONTROL_RECORD_METHOD).catch(() => null);
    const diagnostic = {
      schemaVersion: 'nimi.dev-kernel-first-run-resume-diagnostic/v1',
      observedAt: new Date().toISOString(),
      finalAcceptanceEvidence: false,
      serviceBefore,
      initialProjection,
      login,
      outcome,
      productControl: record,
    };
    const diagnosticPath = path.join(artifactRoot, 'first-run-resume-diagnostic.json');
    fs.writeFileSync(diagnosticPath, `${JSON.stringify(diagnostic, null, 2)}\n`, { mode: 0o600 });
    await page.screenshot({ path: path.join(screenshotsRoot, 'desktop-first-run-resume-diagnostic.png') });
    throw new Error(outcome.kind === 'failure'
      ? `resumed First Run finalization failed: ${outcome.text}`
      : 'resumed First Run reached ready_for_use; a fresh installer-owned round is still required for final acceptance');
  }

  const runtimeInterruption = {};
  const firstRunTrial = {
    ...trial,
    paths: { ...trial.paths, runtimeData: runtimeDataRoot },
  };
  const firstRun = await completeDesktopFirstRun(desktopConnection, firstRunTrial, screenshotsRoot, {
    captureAllPhases: true,
    exerciseDeviceRetry: true,
    beforeStorageContinue: async ({ page: firstRunPage, continueStorage }) => {
      Object.assign(runtimeInterruption, await exerciseRuntimeInterruption({
        page: firstRunPage,
        continueStorage,
        screenshotsRoot,
      }));
      return runtimeInterruption.storageContinueHandled === true;
    },
  });
  await waitUntil(async () => await page.getByTestId('main-shell').isVisible().catch(() => false), {
    timeoutMs: 60_000,
    intervalMs: 100,
    label: 'ready Desktop shell after First Run',
  });
  const accountLabel = String(await page.getByTestId('desktop-account-menu-trigger').textContent() || '').trim();
  const widePath = path.join(screenshotsRoot, 'desktop-first-run-ready-wide.png');
  await setWindowBounds(desktopConnection, 1440, 940);
  await page.screenshot({ path: widePath });
  const wideAudit = await pageAudit(desktopConnection, 'First Run ready wide');
  const narrowMethod = await setWindowBounds(desktopConnection, 390, 780);
  const narrowPath = path.join(screenshotsRoot, 'desktop-first-run-ready-narrow.png');
  await page.screenshot({ path: narrowPath });
  const narrowAudit = await pageAudit(desktopConnection, 'First Run ready narrow');
  const accessibility = assessAccessibilityAudit(narrowAudit);
  const bodyText = await page.locator('body').innerText();
  const locale = {
    documentLang: narrowAudit.dom.lang,
    chineseTextObserved: /[\u3400-\u9fff]/u.test(bodyText),
    replacementCharacterObserved: bodyText.includes('\uFFFD'),
  };
  const longText = {
    scope: 'real-account-and-runtime-owned-path',
    accountLabel,
    proposedDataRoot: runtimeDataRoot,
    syntheticLongTextUsed: false,
    observed: accountLabel.trim().length > 0
      && comparablePath(runtimeDataRoot) === comparablePath(initialProjection.dataRootProposal.path),
    overflowed: narrowAudit.dom.scrollWidth > narrowAudit.dom.clientWidth,
  };
  await observer.flush();
  const privacy = summarizePrivacy(observedPages, bodyText);
  const observation = {
    schemaVersion: 'nimi.dev-kernel-first-run-connectivity/v1',
    observedAt: new Date().toISOString(),
    diagnosticBuildMode: 'reuse',
    finalAcceptanceEvidence: false,
    serviceBefore,
    initialProjection,
    electronHost,
    accountAuthority,
    commands: { status: STATUS_COMMAND, restart: RESTART_COMMAND, productControl: RUNTIME_UNARY_COMMAND },
    baseline,
    login,
    runtimeInterruption,
    firstRun,
    widePath,
    narrowPath,
    narrowMethod,
    wideAudit,
    narrowAudit,
    locale,
    longText,
    accessibility,
    privacy,
    observedPages,
  };
  const issues = validateFirstRunConnectivityObservation(observation);
  const evidenceRoot = path.join(repoRoot, '.nimi', 'local', 'evidence', 'dev-kernel-first-run');
  fs.mkdirSync(evidenceRoot, { recursive: true });
  const outputRoot = path.join(evidenceRoot, `${serviceBefore.runtimeCandidateId}-${Date.now()}`);
  fs.mkdirSync(outputRoot, { recursive: true });
  const outputPath = path.join(outputRoot, 'observation.json');
  fs.cpSync(screenshotsRoot, path.join(outputRoot, 'screenshots'), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify({ ...observation, issues }, null, 2)}\n`, { mode: 0o600 });
  if (issues.length > 0) throw new Error(`First Run connectivity failed: ${issues.join('; ')}`);
  completed = true;
  process.stdout.write(`dev-kernel First Run connectivity: PASS (${outputPath})\n`);
} finally {
  if (desktopConnection) await desktopConnection.browser.close().catch(() => undefined);
  if (desktopHandle) await terminateProcessTree(desktopHandle);
  if (fixture) await fixture.close().catch(() => undefined);
  lock.release();
  if (completed) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    removeIsolatedTrialRoot(trial);
  } else {
    process.stderr.write(`First Run connectivity diagnostic root retained: ${trial.paths.root}\n`);
  }
}

function comparablePath(value) {
  const candidate = String(value || '').trim();
  if (!candidate) return '';
  return path.resolve(candidate).toLowerCase();
}

async function exerciseRuntimeInterruption({ page, continueStorage, screenshotsRoot }) {
  const serviceBefore = readFixedServiceStatus();
  let restartSettled = false;
  const restartPromise = invokeDesktop(page, RESTART_COMMAND).finally(() => { restartSettled = true; });
  const probePromises = Array.from({ length: 40 }, (_, index) => (async () => {
    await new Promise((resolve) => setTimeout(resolve, index * 15));
    if (restartSettled) return { skipped: true };
    try {
      await invokeDesktopRuntimeUnary(page, PRODUCT_CONTROL_RECORD_METHOD, {}, 750);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  })());
  await new Promise((resolve) => setTimeout(resolve, 25));
  await continueStorage.click({ noWaitAfter: true });
  const uiOutcomePromise = waitUntil(async () => {
    if (await page.getByTestId('product-first-run-error').isVisible().catch(() => false)) return 'unavailable-error';
    if (await page.getByTestId('first-run-phase-device-scan').isVisible().catch(() => false)) return 'advanced';
    return null;
  }, { timeoutMs: 60_000, intervalMs: 25, label: 'First Run behavior during Runtime restart' });
  const restartResult = await restartPromise;
  const [probeResults, uiOutcome] = await Promise.all([Promise.all(probePromises), uiOutcomePromise]);
  const serviceAfter = await waitUntil(() => {
    const status = readFixedServiceStatus();
    return status.processId !== serviceBefore.processId ? status : null;
  }, { timeoutMs: 120_000, intervalMs: 100, label: 'First Run Runtime process replacement' });
  const probeFailures = probeResults.filter((result) => result.ok === false);
  const carrierUnavailableObserved = probeFailures.some((result) => /unavailable|pipe|transport|connection|restart/iu.test(result.error));
  let unavailablePath = null;
  if (uiOutcome === 'unavailable-error') {
    unavailablePath = path.join(screenshotsRoot, 'desktop-first-run-runtime-unavailable.png');
    await page.screenshot({ path: unavailablePath });
  }
  const reconnected = await waitUntil(async () => {
    const status = await invokeDesktop(page, STATUS_COMMAND).catch(() => null);
    const record = await readProductControlJSONProjection(page, PRODUCT_CONTROL_RECORD_METHOD).catch(() => null);
    return status?.running === true && status?.managed === true && record?.state ? true : null;
  }, { timeoutMs: 60_000, intervalMs: 100, label: 'First Run Electron protected-carrier re-handshake' });
  let recoveryRetryIssued = false;
  let storageRecoveryState = uiOutcome;
  if (uiOutcome === 'unavailable-error') {
    await waitUntil(async () => !(await continueStorage.isDisabled().catch(() => true)) || null, {
      timeoutMs: 30_000,
      intervalMs: 50,
      label: 'First Run Storage retry enabled after Runtime restart',
    });
    await continueStorage.click({ noWaitAfter: true });
    recoveryRetryIssued = true;
    storageRecoveryState = await waitUntil(async () => {
      const snapshot = {
        deviceVisible: await page.getByTestId('first-run-phase-device-scan').isVisible().catch(() => false),
        errorVisible: await page.getByTestId('product-first-run-error').isVisible().catch(() => false),
        pendingAction: await page.getByTestId('product-first-run-workflow')
          .getAttribute('data-pending-action').catch(() => ''),
      };
      return classifyFirstRunStorageRecoverySnapshot(snapshot);
    }, {
      timeoutMs: 10_000,
      intervalMs: 25,
      label: 'First Run Storage retry accepted after Runtime restart',
    });
  }
  return {
    serviceBefore,
    serviceAfter,
    restartResult,
    probeCount: probeResults.filter((result) => result.skipped !== true).length,
    probeFailureCount: probeFailures.length,
    carrierUnavailableObserved,
    unavailableUiObserved: uiOutcome === 'unavailable-error',
    unavailablePath,
    reconnected,
    recoveryRetryIssued,
    storageRecoveryState,
    storageContinueHandled: uiOutcome === 'advanced' || recoveryRetryIssued,
  };
}

function verifyElectronHost() {
  const version = String(requireFromDesktop('electron/package.json').version || '').trim();
  const executable = path.join(repoRoot, '.nimi', 'local', 'electron-desktop-runtime', version, 'Nimi Desktop Runtime.exe');
  const signingIdentity = requireWindowsDevSigningIdentity({ cwd: repoRoot });
  requireWindowsDevSignedFiles([executable], signingIdentity.certificateSha256, { cwd: repoRoot });
  return {
    basename: path.basename(executable),
    signatureStatus: 'Valid',
    signerCertificateSha256: signingIdentity.certificateSha256,
  };
}

function summarizePrivacy(observedPages, bodyText) {
  return {
    authorizationHeaderObserved: observedPages.some((entry) => entry.authorizationHeaderObserved === true),
    secretTextObserved: SECRET_TEXT.test(String(bodyText || ''))
      || observedPages.some((entry) => entry.secretTextObserved === true),
    storageAuthorityMaterialObserved: observedPages.some((entry) => entry.storageAuthorityMaterialObserved === true),
  };
}
