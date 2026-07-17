import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  DEV_KERNEL_OWNER_MINIMAL_CHECKPOINTS,
  validateOwnerMinimalResult,
} from './dev-kernel-owner-minimal-contract.mjs';
import { requireReusedReadyDataRoot } from './dev-kernel-first-run-driver.mjs';

function ownerDriverSource() {
  return [
    'dev-kernel-first-run-driver.mjs',
    'dev-kernel-cross-app-driver.mjs',
    'dev-kernel-core-reactivation-driver.mjs',
    'dev-kernel-local-development-driver.mjs',
  ].map((file) => fs.readFileSync(path.join(import.meta.dirname, file), 'utf8')).join('\n');
}

function validResult() {
  return {
    schemaVersion: 'nimi.local-agent-product-owner-minimal-result/v1',
    journeyId: 'dev-kernel-owner-minimal',
    outcome: 'passed',
    privacy: { ok: true, findings: [] },
    checkpoints: DEV_KERNEL_OWNER_MINIMAL_CHECKPOINTS.map((checkpointId) => ({
      checkpointId,
      outcome: 'passed',
    })),
    artifacts: [
      { artifactId: 'owner-minimal-summary' },
      { artifactId: 'owner-minimal-dom-console-a11y' },
      { artifactId: 'owner-minimal-shell-1' },
      { artifactId: 'owner-minimal-shell-2' },
      { artifactId: 'owner-minimal-shell-3' },
    ],
  };
}

test('owner-minimal contract accepts the canonical six-step permission journey', () => {
  assert.deepEqual(validateOwnerMinimalResult(validResult()), []);
});

test('owner-minimal contract rejects reordered, failed, private, or screenshot-free results', () => {
  const fixture = validResult();
  fixture.checkpoints.reverse();
  fixture.checkpoints[0].outcome = 'failed';
  fixture.privacy = { ok: false, findings: ['authority material'] };
  fixture.artifacts = fixture.artifacts.filter((artifact) => !artifact.artifactId.startsWith('owner-minimal-shell-'));
  assert.match(
    validateOwnerMinimalResult(fixture).join('; '),
    /privacy.*checkpoints.*screenshots/iu,
  );
});

test('owner-minimal runner reuses the core driver and prepares carriers only between processes', () => {
  const runner = fs.readFileSync(path.join(import.meta.dirname, 'run-owner-minimal.mjs'), 'utf8');
  const freshPreparation = fs.readFileSync(path.join(import.meta.dirname, 'run-fresh-prepared-electron-journey.mjs'), 'utf8');
  const processOwnership = [
    path.join(import.meta.dirname, 'fresh-prepared-electron-runner.mjs'),
    path.join(import.meta.dirname, '../../../scripts/lib/electron-carrier-processes.mjs'),
  ].map((file) => fs.readFileSync(file, 'utf8')).join('\n');
  const driver = ownerDriverSource();
  assert.match(runner, /runDevKernelOwnerMinimalTrial/);
  assert.match(driver, /runDevKernelTrial\(\{ \.\.\.input, executionMode: 'owner-minimal' \}\)/);
  assert.match(driver, /return await persistOwnerMinimalResult/);
  assert.match(driver, /return await persistCoreResult/);
  assert.doesNotMatch(runner, /go(?:\.exe)?['"\s,]+run|serve|node-grpc|runtime_bridge_status/iu);
  assert.match(freshPreparation, /before fresh carrier preparation/);
  assert.match(freshPreparation, /after fresh-prepared journey cleanup/);
  assert.match(freshPreparation, /deadline = Date\.now\(\) \+ 10_000/);
  assert.match(freshPreparation, /findBlockingElectronCarriers/);
  assert.match(processOwnership, /electron-desktop-runtime/iu);
  assert.match(processOwnership, /apps\\\\zhiyu/iu);
  assert.match(processOwnership, /--port\(\?:=\|\\s\+\)1472/);
});

test('owner-minimal orchestrator imports its Runtime host dependencies explicitly', () => {
  const source = fs.readFileSync(path.join(import.meta.dirname, 'dev-kernel-cross-app-driver.mjs'), 'utf8');
  assert.match(
    source,
    /import\s*\{[\s\S]*invokeDesktop[\s\S]*probeRealRealmBrowserLoginAuthority[\s\S]*\}\s*from '\.\/dev-kernel-host-driver\.mjs'/u,
  );
});

test('owner-minimal reuses a protected ready round after a transient First Run gate', () => {
  const driver = ownerDriverSource();
  assert.match(driver, /primaryLogin\.outcome === 'first-run'[\s\S]*productControl\?\.state === 'ready_for_use'[\s\S]*captureReusedReadyFirstRun/iu);
  assert.match(driver, /captureReusedReadyFirstRun[\s\S]*requireReusedReadyDataRoot[\s\S]*waitForTestId\(page, 'main-shell'[\s\S]*PRODUCT_CONTROL_SELECTED_DATA_ROOT_METHOD/iu);
  assert.match(driver, /requireReusedReadyDataRoot[\s\S]*requireCheckpointDataRootProposal[\s\S]*record\?\.dataRoot\?\.status !== 'ready'/iu);
  assert.match(driver, /current\?\.state !== 'ready_for_use'[\s\S]*page\.reload\(\{ waitUntil: 'domcontentloaded'[\s\S]*waitForTestId\(page, 'main-shell'/iu);
  assert.match(driver, /ready-shell-transition[\s\S]*captureReusedReadyFirstRun[\s\S]*reuseReadyCandidateId: serviceBefore\.runtimeCandidateId/iu);
});

test('owner-minimal binds a reused ready round to the Runtime-selected root, not the unused proposal', () => {
  const candidateId = 'dev-kernel-runtime-0123456789abcdef0123456789abcdef';
  const volumeRoot = path.parse(process.cwd()).root;
  const selectedRoot = path.join(volumeRoot, 'NimiSelectedData');
  const proposedRoot = path.join(volumeRoot, 'NimiAcceptance', candidateId, 'Nimi');
  const productControl = {
    state: 'ready_for_use',
    record: {
      state: 'ready_for_use',
      dataRoot: { path: selectedRoot, status: 'ready' },
    },
    dataRootProposal: {
      path: proposedRoot,
      authority: 'runtime_protected_product_control',
      profile: 'dev_kernel_checkpoint',
    },
  };

  assert.equal(requireReusedReadyDataRoot(productControl, candidateId), path.resolve(selectedRoot));
  assert.notEqual(path.resolve(selectedRoot), path.resolve(proposedRoot));
  assert.throws(
    () => requireReusedReadyDataRoot({
      ...productControl,
      record: { ...productControl.record, dataRoot: { path: selectedRoot, status: 'selected' } },
    }, candidateId),
    /safe Runtime-owned selected data root/u,
  );
});

test('owner-minimal waits for the Runtime-owned Developer Mode projection before toggling', () => {
  const driver = ownerDriverSource();
  assert.match(driver, /label: 'Developer Mode Runtime projection'/u);
  assert.match(driver, /developer-mode-retry-button[\s\S]*Developer Mode Runtime projection unavailable/iu);
  assert.match(driver, /card\.getAttribute\('data-developer-mode'\) === expected[\s\S]*button\.isEnabled/iu);
});

test('owner-minimal bounds only the exact supervised-host startup transport race', () => {
  const driver = ownerDriverSource();
  assert.match(driver, /latest\?\.state === 'runtime-unavailable'[\s\S]*lastError\?\.reasonCode === 'runtime-service-unavailable'[\s\S]*transientRuntimeUnavailableMs/iu);
  assert.match(driver, /'zero-grant session',[\s\S]*transientRuntimeUnavailableMs:\s*15_000/iu);
  assert.match(driver, /rawInitial\.lastError\?\.reasonCode === 'runtime-service-unavailable'[\s\S]*zhiyu-dev-kernel-refresh[\s\S]*raw process exact transport recovery/iu);
  assert.match(driver, /\['runtime-service-untrusted', 'runtime-service-unavailable'\][\s\S]*raw process mismatch denial/iu);
  assert.match(driver, /rawServiceAfter\.processId !== rawServiceBefore\.processId[\s\S]*raw process denial overlapped a fixed Runtime service transition/iu);
});

test('owner-minimal resolves the Desktop-owned presence file from the real launcher home only', () => {
  const driver = ownerDriverSource();
  assert.match(driver, /function startZhiyuDev[\s\S]*const launcherHome = os\.homedir\(\)[\s\S]*HOME: launcherHome, USERPROFILE: launcherHome/iu);
  assert.match(driver, /NIMI_LOCAL_AGENT_PRODUCT_ZHIYU_USER_DATA_ROOT: trial\.paths\.zhiyuUserData/iu);
});

test('core browser-auth plan fits only the verified formal test-Realm budget', () => {
  const driver = fs.readFileSync(path.join(import.meta.dirname, 'dev-kernel-cross-app-driver.mjs'), 'utf8');
  const plan = driver.match(/const CORE_BROWSER_AUTH_PLAN = Object\.freeze\(\[([\s\S]*?)\]\);/u)?.[1] || '';
  assert.match(plan, /remembered-conversation-turn-send-grant/u);
  assert.match(plan, /remembered-conversation-turn-subscribe-grant/u);
  assert.match(plan, /secondary-login/u);
  assert.match(plan, /primary-login-restored/u);
  assert.match(driver, /realmAuthPolicy\.passwordLoginLimit < browserAuthPlan\.length/u);
  assert.match(driver, /browserAuthDriver\.audit\(\)/u);
  assert.doesNotMatch(driver, /(?:15\s*\*\s*60|900_?000).*setTimeout|restart.*Realm.*rate/iu);
});

test('owner-minimal drives every fresh login and approval through isolated real Chrome', () => {
  const driver = ownerDriverSource();
  const firstRun = fs.readFileSync(path.join(import.meta.dirname, 'run-first-run-connectivity.mjs'), 'utf8');
  assert.match(driver, /createDevKernelBrowserAuthDriver[\s\S]*requiredCredentialRoles: executionMode === 'core' \? \['primary', 'secondary'\] : \['primary'\]/u);
  assert.match(driver, /browserAuthSafeChildEnvironment\(process\.env\)/u);
  assert.match(driver, /NIMI_DESKTOP_ELECTRON_OPEN_EXTERNAL_CAPTURE_FILE: browserCaptureFile/u);
  assert.match(driver, /authenticatePresence[\s\S]*runtime_account_session_status/u);
  assert.match(firstRun, /createDevKernelBrowserAuthDriver[\s\S]*credentialRole: 'primary'/u);
  assert.doesNotMatch(driver, /shell\.openExternal|auth\.passwordLogin|\/api\/auth\/(?:password\/)?login/u);
});
