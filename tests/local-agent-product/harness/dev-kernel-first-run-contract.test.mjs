import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { validateFirstRunConnectivityObservation } from './dev-kernel-first-run-contract.mjs';
import {
  classifyFirstRunStorageRecoverySnapshot,
  classifyFirstRunTerminalSnapshot,
  isAuthoritativeFirstRunStorageAdvance,
  isRecoverableFirstRunStorageRestart,
  selectLatestBlockingFirstRunDependencyJob,
} from './dev-kernel-cross-app-driver.mjs';

function firstRunDriverSource() {
  return [
    'dev-kernel-cross-app-driver.mjs',
    'dev-kernel-host-driver.mjs',
    'dev-kernel-first-run-driver.mjs',
  ].map((file) => fs.readFileSync(path.join(import.meta.dirname, file), 'utf8')).join('\n');
}

function status(pid) {
  return {
    serviceName: 'NimiRuntime', state: 'running', processId: pid, startMode: 'Auto',
    serviceAccount: 'LocalSystem', serviceAccountMatches: true, binaryPathMatches: true,
    serviceSidMatches: true, restrictedSid: true, desktopPipePresent: true, localAppPipePresent: true,
    signatureStatus: 'Valid', runtimeBinaryMatchesCandidate: true, runtimeBuildRecordMatchesCandidate: true,
    checkpointCandidatePostureVerified: true, runtimeCandidateId: `dev-kernel-runtime-${'a'.repeat(32)}`,
    runtimeBinarySha256: 'b'.repeat(64), runtimeBuildRecordSha256: 'c'.repeat(64),
    sourceDirtyDescriptorSha256: 'd'.repeat(64), sourceTreeSha256: 'e'.repeat(64),
    checkpointReleasePosture: 'non_release',
    checkpointProductClosePromotion: 'non_promotable_to_product_close',
  };
}

function narrow() {
  return { clientWidth: 390, scrollWidth: 390 };
}

function validObservation() {
  const dataRootPath = 'D:\\DataNimi';
  return {
    serviceBefore: status(100),
    electronHost: { basename: 'Nimi Desktop Runtime.exe', signatureStatus: 'Valid' },
    commands: {
      status: 'nimi.shell.runtimeLifecycle.status',
      restart: 'nimi.shell.runtimeLifecycle.restart',
      productControl: 'nimi.shell.runtime.unary',
    },
    initialProjection: {
      state: 'data_root_selected',
      record: { dataRoot: { path: dataRootPath, status: 'selected' } },
    },
    baseline: { accountState: 'anonymous' },
    login: { outcome: 'first-run', accountId: '01J00000000000000000000000' },
    accountAuthority: {
      accountRealmOrigin: 'http://localhost:3002',
      accountWebOrigin: 'http://localhost:3000',
      authorizeStatus: 302,
      loginPath: '/login',
      oauthNextOrigin: 'http://localhost:3002',
      oauthNextPath: '/api/auth/oauth/authorize',
      automaticLoopbackCallbackObserved: false,
    },
    runtimeInterruption: {
      serviceBefore: status(200), serviceAfter: status(300),
      carrierUnavailableObserved: true, reconnected: true,
    },
    firstRun: {
      productState: 'ready_for_use',
      productControlRecord: {
        state: 'ready_for_use',
        record: { dataRoot: { path: dataRootPath, status: 'ready' } },
      },
      layout: {
        narrowMetrics: narrow(),
        phaseAcceptance: {
          deviceInitialScanState: 'pending',
          deviceContinueInitiallyDisabled: true,
          deviceRetryDisabledWhilePending: true,
          deviceContinueDisabledWhileRetryPending: true,
          localAiContinueInitiallyDisabled: true,
          setupObserved: true,
          deviceNarrowMetrics: narrow(), localAiNarrowMetrics: narrow(), setupNarrowMetrics: narrow(),
        },
      },
    },
    narrowAudit: { dom: narrow() },
    locale: { documentLang: 'zh-CN', chineseTextObserved: true, replacementCharacterObserved: false },
    longText: {
      scope: 'real-account-and-product-control-data-root',
      recordedDataRoot: dataRootPath,
      syntheticLongTextUsed: false,
      observed: true,
      overflowed: false,
    },
    accessibility: { ok: true },
    privacy: { authorizationHeaderObserved: false, secretTextObserved: false, storageAuthorityMaterialObserved: false },
    console: { errors: [], expectedErrorCount: 0, unexpectedErrorCount: 0, pageErrorCount: 0, observerErrorCount: 0 },
    diagnosticBuildMode: 'reuse', finalAcceptanceEvidence: false,
  };
}

test('First Run connectivity contract admits fresh acceptance and diagnostic-only bound reuse', () => {
  assert.deepEqual(validateFirstRunConnectivityObservation(validObservation()), []);
  assert.deepEqual(validateFirstRunConnectivityObservation({
    ...validObservation(), diagnosticBuildMode: 'fresh', finalAcceptanceEvidence: true,
  }), []);
  assert.deepEqual(validateFirstRunConnectivityObservation({
    ...validObservation(), diagnosticBuildMode: 'fresh-prepared', finalAcceptanceEvidence: true,
  }), []);
  assert.ok(validateFirstRunConnectivityObservation({
    ...validObservation(), diagnosticBuildMode: 'reuse', finalAcceptanceEvidence: true,
  }).some((issue) => issue.includes('diagnostic-only reuse')));
});

test('First Run connectivity contract reuses an existing ready Product Control record', () => {
  const fixture = validObservation();
  fixture.initialProjection.state = 'ready_for_use';
  fixture.initialProjection.record.dataRoot.status = 'ready';
  fixture.login.outcome = 'main-shell';
  fixture.firstRun.reusedReady = true;
  fixture.firstRun.layout = { narrowMetrics: null, phaseAcceptance: null };
  assert.deepEqual(validateFirstRunConnectivityObservation(fixture), []);
});

test('First Run connectivity contract accepts only phase-bound typed Runtime interruption console errors', () => {
  const expected = validObservation();
  expected.console = {
    errors: [{ expected: true, phase: 'runtime-interruption', classification: 'expected-runtime-unavailable' }],
    expectedErrorCount: 1,
    unexpectedErrorCount: 0,
    pageErrorCount: 0,
    observerErrorCount: 0,
  };
  assert.deepEqual(validateFirstRunConnectivityObservation(expected), []);
  const unexpected = structuredClone(expected);
  unexpected.console.errors[0].phase = 'ready-audit';
  unexpected.console.errors[0].expected = false;
  unexpected.console.unexpectedErrorCount = 1;
  assert.match(validateFirstRunConnectivityObservation(unexpected).join('; '), /unclassified console/iu);
});

test('First Run driver imports its host dependencies explicitly', () => {
  const source = fs.readFileSync(path.join(import.meta.dirname, 'dev-kernel-first-run-driver.mjs'), 'utf8');
  assert.match(
    source,
    /import\s*\{[\s\S]*classifyFirstRunTerminalSnapshot[\s\S]*requireRecordedProductControlDataRoot[\s\S]*\}\s*from '\.\/dev-kernel-host-driver\.mjs'/u,
  );
});

test('First Run runner records a fresh choice through Product Control and never uses process home or renderer env as authority', () => {
  const source = fs.readFileSync(path.join(import.meta.dirname, 'run-first-run-connectivity.mjs'), 'utf8');
  const driver = firstRunDriverSource();
  assert.match(driver, /product_control_record_select_data_root/);
  assert.match(driver, /requireRecordedProductControlDataRoot/);
  assert.doesNotMatch(source, /\bHOME\s*:/);
  assert.doesNotMatch(source, /\bUSERPROFILE\s*:/);
  assert.doesNotMatch(source, /NIMI_LOCAL_AGENT_PRODUCT_RUNTIME_DATA_ROOT\s*:/);
  assert.doesNotMatch(source, /dataRootProposal|runtime_protected_product_control|path\.join\([^)]*['"]Nimi['"]\)/);
});

test('First Run runner reuses persisted selected and ready Product Control state without another root choice', () => {
  const source = fs.readFileSync(path.join(import.meta.dirname, 'run-first-run-connectivity.mjs'), 'utf8');
  assert.match(source, /local_ai_profile_selected_assets_missing/);
  assert.match(source, /'local_ai_profile_selected_assets_missing',\s*'local_ai_ready',[\s\S]*\.includes\(initialProjection\.state\)/u);
  assert.match(source, /resumedFinalization[\s\S]*captureReusedReadyFirstRun/iu);
  assert.match(source, /resumedDevice[\s\S]*completeDesktopFirstRun/iu);
  assert.match(source, /resumeFromDevice:\s*true/);
  assert.doesNotMatch(source, /fresh installer-owned round is still required for final acceptance/);
});

test('First Run applies a restart-required Product Control selection before consuming readback', () => {
  const driver = firstRunDriverSource();
  assert.match(driver, /CONFIG_RESTART_REQUIRED[\s\S]*RUNTIME_RESTART_COMMAND[\s\S]*fixed service PID replacement after Product Control data-root selection/iu);
});

test('First Run consumes only Product Control readback after the fresh typed selection', () => {
  const source = fs.readFileSync(path.join(import.meta.dirname, 'dev-kernel-first-run-driver.mjs'), 'utf8');
  assert.match(
    source,
    /product_control_record_select_data_root[\s\S]*Product Control data-root record readback[\s\S]*requireRecordedProductControlDataRoot/iu,
  );
});

test('First Run bounds exact Runtime-unavailable Setup recovery without weakening owner failures', () => {
  const driver = firstRunDriverSource();
  assert.match(driver, /setupFailure\.text\.trim\(\) === 'runtime-service-unavailable'/u);
  assert.match(driver, /setupRuntimeUnavailableGraceMs = 360_000[\s\S]*PRODUCT_CONTROL_RECORD_METHOD[\s\S]*setupRuntimeUnavailableCarrierRecovered/iu);
  assert.match(driver, /first-run-setup-retry[\s\S]*setupRuntimeUnavailableRetryIssued[\s\S]*return null[\s\S]*classifyFirstRunTerminalSnapshot/iu);
});

test('First Run bounds exact Runtime-unavailable finalization recovery to one protected retry', () => {
  const driver = firstRunDriverSource();
  assert.match(driver, /finalizationFailure\.text\.trim\(\) === 'runtime-service-unavailable'/u);
  assert.match(driver, /finalizationRuntimeUnavailableGraceMs = 360_000[\s\S]*RUNTIME_STATUS_COMMAND[\s\S]*PRODUCT_CONTROL_RECORD_METHOD[\s\S]*finalizationRuntimeUnavailableCarrierRecovered/iu);
  assert.match(driver, /product-first-run-finalization-retry[\s\S]*finalizationRuntimeUnavailableRetryIssued = true[\s\S]*return null[\s\S]*classifyFirstRunTerminalSnapshot/iu);
  assert.match(driver, /&& !finalizationRuntimeUnavailableRetryIssued/u);
});

test('First Run Device retry observes pending and disabled controls in one DOM snapshot', () => {
  const driver = firstRunDriverSource();
  assert.match(driver, /page\.evaluate\(\(\) => \{[\s\S]*data-device-scan[\s\S]*HTMLButtonElement[\s\S]*retryDisabled:\s*retryButton\.disabled[\s\S]*continueDisabled:\s*continueButton\.disabled/u);
  assert.match(driver, /intervalMs:\s*10,\s*label:\s*'first-run Device retry pending controls'/u);
});

test('First Run terminal failure captures the bounded Runtime dependency-job owner projection', () => {
  const driver = firstRunDriverSource();
  assert.match(driver, /ListLocalEnvironmentDependencyJobs/);
  assert.match(driver, /first-run-terminal-failure\.json/);
  assert.match(driver, /failureDetail:\s*String\(job\.failureDetail/);
  assert.match(driver, /timeoutMs:\s*1_800_000,\s*intervalMs:\s*500,\s*label:\s*'Desktop first-run backend admission'/);
});

test('First Run connectivity contract admits a pristine candidate with no Product Control record', () => {
  const fixture = validObservation();
  fixture.initialProjection.state = 'config_missing';
  fixture.initialProjection.record = null;
  assert.deepEqual(validateFirstRunConnectivityObservation(fixture), []);
});

test('First Run Device initial state is only asserted when pending is observed atomically', () => {
  const settled = validObservation();
  settled.firstRun.layout.phaseAcceptance.deviceInitialScanState = 'settled';
  settled.firstRun.layout.phaseAcceptance.deviceContinueInitiallyDisabled = null;
  assert.deepEqual(validateFirstRunConnectivityObservation(settled), []);

  const pending = validObservation();
  pending.firstRun.layout.phaseAcceptance.deviceContinueInitiallyDisabled = false;
  assert.match(validateFirstRunConnectivityObservation(pending).join('; '), /initial scan.*pending/iu);
});

test('First Run connectivity contract admits a different persisted Product Control data root', () => {
  const fixture = validObservation();
  fixture.initialProjection.record.dataRoot.path = 'D:\\SharedNimiPayload';
  fixture.firstRun.productControlRecord.record.dataRoot.path = 'D:\\SharedNimiPayload';
  fixture.longText.recordedDataRoot = 'D:\\SharedNimiPayload';
  assert.deepEqual(validateFirstRunConnectivityObservation(fixture), []);
});

test('First Run connectivity contract rejects legacy carrier, missing UX states, overflow, and authority leakage', () => {
  const fixture = validObservation();
  fixture.commands.productControl = 'product_control_record_get';
  fixture.initialProjection.state = 'ready_for_use';
  fixture.runtimeInterruption.carrierUnavailableObserved = false;
  fixture.firstRun.layout.phaseAcceptance.setupObserved = false;
  fixture.firstRun.layout.phaseAcceptance.deviceNarrowMetrics.scrollWidth = 480;
  fixture.locale.replacementCharacterObserved = true;
  fixture.privacy.authorizationHeaderObserved = true;
  assert.match(
    validateFirstRunConnectivityObservation(fixture).join('; '),
    /canonical.*unavailable.*Setup.*overflow.*Chinese.*authority material/iu,
  );
});

test('First Run terminal classifier fails fast when materialization exposes Retry', () => {
  assert.deepEqual(classifyFirstRunTerminalSnapshot({
    authShellVisible: false,
    explicitFailures: [],
    setupRetryVisible: true,
    setupText: '物化状态 failed 原因 runtime_materialization_job_failed',
  }), {
    kind: 'failure',
    testId: 'first-run-setup-retry',
    text: '物化状态 failed 原因 runtime_materialization_job_failed',
  });
});

test('First Run terminal classifier admits auth shell and keeps pending setup non-terminal', () => {
  assert.deepEqual(classifyFirstRunTerminalSnapshot({ authShellVisible: true }), { kind: 'auth-shell' });
  assert.equal(classifyFirstRunTerminalSnapshot({
    authShellVisible: false,
    explicitFailures: [],
    setupRetryVisible: false,
  }), false);
});

test('First Run exits on the latest manual owner failure but permits a newer transient recovery', () => {
  const base = {
    environmentKey: 'python.package-set|speech',
    dependencyFamily: 'python.package-set',
    dependencyId: 'speech.package-set',
    consumerScope: 'speech',
  };
  const failed = {
    ...base,
    jobId: 'failed',
    state: 'failed',
    reasonCode: 'LOCAL_ENVIRONMENT_DEPENDENCY_JOB_FAILED',
    recoveryDisposition: 'manual_retry',
    updatedAt: '2026-07-16T05:00:00.000Z',
  };
  assert.equal(selectLatestBlockingFirstRunDependencyJob([failed])?.jobId, 'failed');
  assert.equal(selectLatestBlockingFirstRunDependencyJob([
    failed,
    {
      ...base,
      jobId: 'recovering',
      state: 'installing',
      recoveryDisposition: 'auto_retry_transient',
      updatedAt: '2026-07-16T05:00:01.000Z',
    },
  ]), null);
});

test('First Run Storage retry classifier rejects error and idle snapshots', () => {
  assert.equal(classifyFirstRunStorageRecoverySnapshot({ deviceVisible: true }), 'advanced');
  assert.equal(classifyFirstRunStorageRecoverySnapshot({
    deviceVisible: false,
    errorVisible: false,
    pendingAction: 'select-data-root',
  }), 'pending');
  assert.equal(classifyFirstRunStorageRecoverySnapshot({
    deviceVisible: false,
    errorVisible: true,
    pendingAction: 'select-data-root',
  }), false);
  assert.equal(classifyFirstRunStorageRecoverySnapshot({
    deviceVisible: false,
    errorVisible: false,
    pendingAction: '',
  }), false);
});

test('First Run restart recovery accepts canonical Device scan only with matching Runtime truth', () => {
  const snapshot = { deviceVisible: true, errorVisible: false, pendingAction: '' };
  const productControl = {
    state: 'data_root_selected',
    record: { dataRoot: { path: 'C:\\NimiData' } },
  };
  assert.equal(
    isAuthoritativeFirstRunStorageAdvance(snapshot, productControl, 'C:\\NimiData'),
    true,
  );
  assert.equal(
    isAuthoritativeFirstRunStorageAdvance(snapshot, {
      ...productControl,
      state: 'data_root_missing',
    }, 'C:\\NimiData'),
    false,
  );
  assert.equal(
    isAuthoritativeFirstRunStorageAdvance(snapshot, productControl, 'C:\\OtherData'),
    false,
  );
  assert.equal(
    isAuthoritativeFirstRunStorageAdvance({ ...snapshot, errorVisible: true }, productControl, 'C:\\NimiData'),
    false,
  );
  assert.equal(
    isAuthoritativeFirstRunStorageAdvance({ ...snapshot, pendingAction: 'data-root' }, productControl, 'C:\\NimiData'),
    false,
  );
});

test('First Run Storage restart recovery requires the exact typed failure and same healthy candidate replacement', () => {
  const serviceBefore = status(200);
  const serviceAfter = status(300);
  const unavailable = { kind: 'error', message: 'runtime-service-unavailable' };

  assert.equal(isRecoverableFirstRunStorageRestart(unavailable, serviceBefore, serviceAfter), true);
  assert.equal(isRecoverableFirstRunStorageRestart(
    { kind: 'error', message: 'runtime-owner-rejected' },
    serviceBefore,
    serviceAfter,
  ), false);
  assert.equal(isRecoverableFirstRunStorageRestart(unavailable, serviceBefore, status(200)), false);
  assert.equal(isRecoverableFirstRunStorageRestart(unavailable, serviceBefore, {
    ...serviceAfter,
    runtimeCandidateId: `dev-kernel-runtime-${'f'.repeat(32)}`,
  }), false);
  assert.equal(isRecoverableFirstRunStorageRestart(unavailable, serviceBefore, {
    ...serviceAfter,
    runtimeBinarySha256: 'f'.repeat(64),
  }), false);
  assert.equal(isRecoverableFirstRunStorageRestart(unavailable, serviceBefore, {
    ...serviceAfter,
    runtimeBuildRecordMatchesCandidate: false,
  }), false);
});
