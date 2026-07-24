#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

import { createRealmFixtureManifest } from '../../../apps/desktop/e2e/fixtures/acceptance-fixture.mjs';
import { startRealmFixtureServer } from '../../../apps/desktop/e2e/fixtures/realm-fixture-server.mjs';
import {
  requireWindowsDevSignedFiles,
  requireWindowsDevSigningIdentity,
} from '../../../scripts/lib/windows-dev-signing.mjs';
import { beginObservedProcess, waitForObservedProcessConnection } from './dev-kernel-contract.mjs';
import {
  acquireFixedServiceLock,
  connectCdp,
  createEarlyCdpObserver,
  invokeDesktop,
  invokeDesktopRuntimeUnary,
  readFixedServiceStatus,
  reservePort,
  waitUntil,
} from './dev-kernel-cross-app-driver.mjs';
import {
  trustStageCounts,
  validateFixedServiceSmokeObservation,
} from './dev-kernel-fixed-service-contract.mjs';
import { startProcess, terminateProcessTree } from './cross-app-driver.mjs';
import { registerTrialProcessIdentity } from './sandbox-hygiene.mjs';
import { captureSourceState } from './source-state.mjs';
import { createIsolatedJourneyRoot, removeIsolatedTrialRoot } from './trial-root.mjs';
import { repoRoot } from './registry.mjs';

const requireFromDesktop = createRequire(path.join(repoRoot, 'apps', 'desktop', 'package.json'));
const { NIMI_STANDARD_SHELL_COMMANDS } = requireFromDesktop('@nimiplatform/kit/shell/capabilities');
const STATUS_COMMAND = NIMI_STANDARD_SHELL_COMMANDS['runtime-lifecycle.status'];
const RESTART_COMMAND = NIMI_STANDARD_SHELL_COMMANDS['runtime-lifecycle.restart'];
const RUNTIME_UNARY_COMMAND = NIMI_STANDARD_SHELL_COMMANDS['runtime.unary'];
const FIXTURE_ORIGIN = 'http://127.0.0.1:19443';
const SECRET_TEXT = /(?:bearer\s+[a-z0-9._~+/=-]+|(?:access|refresh|id)[_-]?token\s*[:=]|eyj[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}\.)/iu;

if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error(`fixed-service smoke requires Windows x64, got ${process.platform}/${process.arch}`);
}

const trial = createIsolatedJourneyRoot({
  journeyId: 'dev-kernel-fixed-service-smoke',
  tier: 'integration',
  batch: 'developer-smoke',
  repeatIndex: 1,
});
const sourceState = captureSourceState(repoRoot);
const lock = acquireFixedServiceLock();
const artifactRoot = path.join(trial.paths.artifacts, 'fixed-service-smoke');
const logsRoot = path.join(artifactRoot, 'process-logs');
fs.mkdirSync(logsRoot, { recursive: true });
let fixture;
let desktopHandle;
let desktopConnection;
let completed = false;

try {
  const serviceBefore = readFixedServiceStatus();
  const cdpPort = await reservePort();
  const fixtureOrigin = FIXTURE_ORIGIN;
  const fixtureManifest = createRealmFixtureManifest(fixtureOrigin);
  fixtureManifest.scenarioId = 'dev-kernel-checkpoint.fixed-service-smoke';
  const manifestPath = path.join(trial.paths.control, 'realm-fixture-manifest.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify(fixtureManifest, null, 2)}\n`, { mode: 0o600 });
  fixture = await startRealmFixtureServer({ manifestPath, host: '127.0.0.1', port: 19443 });

  const observedPages = [];
  const observer = createEarlyCdpObserver(observedPages);
  const electronHost = verifyElectronHost();
  const env = {
    ...process.env,
    NO_COLOR: '1',
    FORCE_COLOR: '0',
    NIMI_DEV_KERNEL_ELECTRON_BUILD_MODE: 'reuse',
    NIMI_PROTECTED_LOCAL_DIAGNOSTICS: '1',
    NIMI_REALM_URL: fixtureOrigin,
    VITE_NIMI_REALM_URL: fixtureOrigin,
    NIMI_REALM_JWKS_URL: `${fixtureOrigin}/api/auth/jwks`,
    NIMI_REALM_REVOCATION_URL: `${fixtureOrigin}/api/auth/sessions/introspect`,
    NIMI_REALM_JWT_ISSUER: fixtureOrigin,
    NIMI_REALM_JWT_AUDIENCE: 'nimi-runtime',
    NIMI_LOCAL_AGENT_PRODUCT_TRIAL_ROOT: trial.paths.root,
    NIMI_LOCAL_AGENT_PRODUCT_DESKTOP_USER_DATA_ROOT: trial.paths.desktopUserData,
    NIMI_LOCAL_AGENT_PRODUCT_DESKTOP_CDP_PORT: String(cdpPort),
    NIMI_LOCAL_AGENT_PRODUCT_SOURCE_DIGEST: sourceState.sourceDigest,
    HOME: trial.paths.root,
    USERPROFILE: trial.paths.root,
    APPDATA: trial.paths.appDataRoaming,
    LOCALAPPDATA: trial.paths.appDataLocal,
  };
  const launch = beginObservedProcess({
    connect: () => connectCdp(cdpPort, 'fixed-service smoke Desktop', 120_000, observer),
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
  registerTrialProcessIdentity(trial, desktopHandle, 'fixed-service-smoke-desktop-electron');
  const desktop = await waitForObservedProcessConnection({
    connectionPromise: launch.connectionPromise,
    handle: desktopHandle,
    label: 'fixed-service smoke Desktop Electron',
  });
  desktopConnection = desktop;
  // CDP can attach after the target exists but before Electron's initial
  // loadURL promise settles. Reloading in that interval aborts the real main
  // process navigation and can also cancel the first protected connector.
  await desktop.page.waitForLoadState('load', { timeout: 60_000 });
  await desktop.page.reload({ waitUntil: 'load', timeout: 60_000 });

  const beforeRestart = await readCarrierProjection(desktop.page, 'before restart');
  const restartResult = await invokeDesktop(desktop.page, RESTART_COMMAND);
  const serviceAfter = await waitUntil(() => {
    const status = readFixedServiceStatus();
    return status.processId !== serviceBefore.processId ? status : null;
  }, { timeoutMs: 120_000, intervalMs: 250, label: 'fixed service process replacement' });
  const afterRestart = await readCarrierProjection(desktop.page, 'after restart');
  await observer.flush();
  await new Promise((resolve) => setTimeout(resolve, 250));
  const processSnapshot = desktopHandle.snapshot();
  const trustCounts = trustStageCounts(`${processSnapshot.stdout}\n${processSnapshot.stderr}`);
  const privacy = summarizePrivacy(observedPages, await desktop.page.locator('body').innerText().catch(() => ''));
  const observation = {
    schemaVersion: 'nimi.dev-kernel-fixed-service-smoke/v1',
    observedAt: new Date().toISOString(),
    diagnosticBuildMode: 'reuse',
    finalAcceptanceEvidence: false,
    serviceBefore,
    serviceAfter,
    electronHost,
    commands: { status: STATUS_COMMAND, restart: RESTART_COMMAND, productControl: RUNTIME_UNARY_COMMAND },
    beforeRestart,
    restartResult,
    afterRestart,
    trustStageCounts: trustCounts,
    openDesktopSessionCount: trustCounts.opened,
    privacy,
    observedPages,
  };
  const issues = validateFixedServiceSmokeObservation(observation);
  const evidenceRoot = path.join(repoRoot, '.nimi', 'local', 'evidence', 'dev-kernel-fixed-service-smoke');
  fs.mkdirSync(evidenceRoot, { recursive: true });
  const outputPath = path.join(evidenceRoot, `${serviceBefore.runtimeCandidateId}-${Date.now()}.json`);
  fs.writeFileSync(outputPath, `${JSON.stringify({ ...observation, issues }, null, 2)}\n`, { mode: 0o600 });
  if (issues.length > 0) throw new Error(`fixed-service smoke failed: ${issues.join('; ')}`);
  completed = true;
  process.stdout.write(`dev-kernel fixed-service smoke: PASS (${outputPath})\n`);
} finally {
  if (desktopConnection) await desktopConnection.browser.close().catch(() => undefined);
  if (desktopHandle) await terminateProcessTree(desktopHandle);
  if (fixture) await fixture.close().catch(() => undefined);
  lock.release();
  if (completed) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    removeIsolatedTrialRoot(trial);
  }
  else process.stderr.write(`fixed-service smoke diagnostic root retained: ${trial.paths.root}\n`);
}

async function readCarrierProjection(page, phase) {
  const lifecycle = await invokeWithRetry(page, STATUS_COMMAND, `${phase} lifecycle status`);
  const account = await invokeWithRetry(page, 'runtime_account_session_status', `${phase} account status`);
  const productControl = await readProductControlRecord(page, phase);
  const dependencyJobs = await readLocalEnvironmentDependencyJobs(page, phase);
  const developerMode = await invokeWithRetry(page, 'developer_mode_status', `${phase} Developer Mode read`);
  return { lifecycle, account, productControl, dependencyJobs, developerMode };
}

async function invokeWithRetry(page, command, label, payload = {}) {
  return waitUntil(
    () => invokeDesktop(page, command, payload),
    { timeoutMs: 60_000, intervalMs: 250, label },
  );
}

async function readProductControlRecord(page, phase) {
  const decoded = await waitUntil(
    () => invokeDesktopRuntimeUnary(page, '/nimi.runtime.v1.RuntimeLocalService/GetProductControlRecord'),
    { timeoutMs: 60_000, intervalMs: 250, label: `${phase} product-control read` },
  );
  const json = typeof decoded?.json === 'string' ? decoded.json : '';
  if (!json) throw new Error(`${phase} product-control projection JSON is missing`);
  return JSON.parse(json);
}

async function readLocalEnvironmentDependencyJobs(page, phase) {
  const decoded = await waitUntil(
    () => invokeDesktopRuntimeUnary(
      page,
      '/nimi.runtime.v1.RuntimeLocalService/ListLocalEnvironmentDependencyJobs',
      {},
    ),
    { timeoutMs: 60_000, intervalMs: 250, label: `${phase} dependency-job read` },
  );
  return (decoded?.jobs || []).map((job) => ({
    jobId: String(job.jobId || ''),
    environmentKey: String(job.environmentKey || ''),
    dependencyFamily: String(job.dependencyFamily || ''),
    dependencyId: String(job.dependencyId || ''),
    state: String(job.state || ''),
    sourceKind: String(job.sourceKind || ''),
    canonicalRoot: String(job.canonicalRoot || ''),
    selectedSourceRecordId: String(job.selectedSourceRecordId || ''),
    failureDetail: String(job.failureDetail || ''),
    retryable: job.retryable === true,
    reasonCode: String(job.reasonCode || ''),
    recoveryDisposition: String(job.recoveryDisposition || ''),
    consumerScope: String(job.consumerScope || ''),
    createdAt: String(job.createdAt || ''),
    updatedAt: String(job.updatedAt || ''),
  }));
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
    authorizationHeaderObserved: observedPages.some((page) => page.authorizationHeaderObserved === true),
    secretTextObserved: SECRET_TEXT.test(String(bodyText || '')) || observedPages.some((page) => page.secretTextObserved === true),
    storageAuthorityMaterialObserved: observedPages.some((page) => page.storageAuthorityMaterialObserved === true),
  };
}
