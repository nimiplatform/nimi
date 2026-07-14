import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { validateFirstRunConnectivityObservation } from './dev-kernel-first-run-contract.mjs';
import {
  classifyFirstRunStorageRecoverySnapshot,
  classifyFirstRunTerminalSnapshot,
} from './dev-kernel-cross-app-driver.mjs';

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
  const candidateId = `dev-kernel-runtime-${'a'.repeat(32)}`;
  const proposalPath = `C:\\Users\\tester\\AppData\\Local\\Nimi\\dev-kernel-checkpoint\\acceptance-runs\\dev-kernel-checkpoint\\${candidateId}\\Nimi`;
  return {
    serviceBefore: status(100),
    electronHost: { basename: 'Nimi Desktop Runtime.exe', signatureStatus: 'Valid' },
    commands: {
      status: 'nimi.shell.runtimeLifecycle.status',
      restart: 'nimi.shell.runtimeLifecycle.restart',
      productControl: 'nimi.shell.runtime.unary',
    },
    initialProjection: {
      state: 'data_root_missing',
      dataRootProposal: {
        path: proposalPath,
        authority: 'runtime_protected_product_control',
        profile: 'dev_kernel_checkpoint',
      },
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
      productControlRecord: { state: 'ready_for_use' },
      layout: {
        narrowMetrics: narrow(),
        phaseAcceptance: {
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
    longText: { proposedDataRoot: proposalPath, observed: true, overflowed: false },
    accessibility: { ok: true },
    privacy: { authorizationHeaderObserved: false, secretTextObserved: false, storageAuthorityMaterialObserved: false },
    diagnosticBuildMode: 'reuse', finalAcceptanceEvidence: false,
  };
}

test('First Run connectivity contract admits the complete Electron/fixed-service observation', () => {
  assert.deepEqual(validateFirstRunConnectivityObservation(validObservation()), []);
});

test('First Run runner never uses process home or renderer env as the data-root proposal authority', () => {
  const source = fs.readFileSync(path.join(import.meta.dirname, 'run-first-run-connectivity.mjs'), 'utf8');
  assert.match(source, /requireCheckpointDataRootProposal/);
  assert.doesNotMatch(source, /\bHOME\s*:/);
  assert.doesNotMatch(source, /\bUSERPROFILE\s*:/);
  assert.doesNotMatch(source, /NIMI_LOCAL_AGENT_PRODUCT_RUNTIME_DATA_ROOT\s*:/);
  assert.doesNotMatch(source, /(?:rmSync|removeCheckpointDataRoot)\s*\(\s*runtimeDataRoot/);
});

test('First Run terminal failure captures the bounded Runtime dependency-job owner projection', () => {
  const driver = fs.readFileSync(path.join(import.meta.dirname, 'dev-kernel-cross-app-driver.mjs'), 'utf8');
  assert.match(driver, /ListLocalEnvironmentDependencyJobs/);
  assert.match(driver, /first-run-terminal-failure\.json/);
  assert.match(driver, /failureDetail:\s*String\(job\.failureDetail/);
  assert.match(driver, /intervalMs:\s*500,\s*label:\s*'Desktop first-run backend admission'/);
});

test('First Run connectivity contract admits a pristine candidate with no Product Control record', () => {
  const fixture = validObservation();
  fixture.initialProjection.state = 'config_missing';
  assert.deepEqual(validateFirstRunConnectivityObservation(fixture), []);
});

test('First Run connectivity contract admits a signed persistent development data-root proposal', () => {
  const fixture = validObservation();
  fixture.initialProjection.dataRootProposal.path = 'D:\\SharedNimiPayload';
  fixture.longText.proposedDataRoot = 'D:\\SharedNimiPayload';
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

test('First Run restart recovery advances only after a fresh Storage retry is accepted', () => {
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
