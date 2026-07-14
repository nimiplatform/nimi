import assert from 'node:assert/strict';
import test from 'node:test';

import {
  REQUIRED_FIXED_SERVICE_TRUST_STAGES,
  trustStageCounts,
  validateFixedServiceSmokeObservation,
  validateFixedServiceStatus,
} from './dev-kernel-fixed-service-contract.mjs';

function validStatus(pid) {
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

function validProjection() {
  return {
    lifecycle: { running: true, managed: true },
    account: { state: 'anonymous' },
    productControl: { state: 'data_root_missing' },
    developerMode: { enabled: false },
  };
}

function validObservedPages() {
  return [
    {
      kind: 'renderer-network-context', requestObserverAttached: true, observerErrors: [],
    },
    {
      kind: 'renderer-page', historicalResourceAuditCompleted: true,
      storageObserverAttached: true, storageAuditCompleted: true, observerErrors: [],
    },
  ];
}

test('fixed-service status contract admits the signed source-bound checkpoint shape', () => {
  assert.deepEqual(validateFixedServiceStatus(validStatus(100)), []);
});

test('fixed-service status contract rejects service identity and candidate drift', () => {
  const status = validStatus(100);
  status.serviceAccount = 'LocalService';
  status.restrictedSid = false;
  status.runtimeBinaryMatchesCandidate = false;
  assert.match(validateFixedServiceStatus(status).join('; '), /LocalSystem.*restrictedSid.*runtimeBinaryMatchesCandidate/u);
});

test('fixed-service smoke requires two complete protected handshakes and canonical commands', () => {
  const log = REQUIRED_FIXED_SERVICE_TRUST_STAGES
    .flatMap((stage) => [`[protected-local desktop-session] stage=${stage}`, `[protected-local desktop-session] stage=${stage}`])
    .join('\n');
  const observation = {
    serviceBefore: validStatus(100),
    serviceAfter: validStatus(200),
    electronHost: { basename: 'Nimi Desktop Runtime.exe', signatureStatus: 'Valid' },
    commands: {
      status: 'nimi.shell.runtimeLifecycle.status',
      restart: 'nimi.shell.runtimeLifecycle.restart',
      productControl: 'nimi.shell.runtime.unary',
    },
    beforeRestart: validProjection(),
    afterRestart: validProjection(),
    trustStageCounts: trustStageCounts(log),
    privacy: { authorizationHeaderObserved: false, secretTextObserved: false, storageAuthorityMaterialObserved: false },
    observedPages: validObservedPages(),
    diagnosticBuildMode: 'reuse',
  };
  assert.deepEqual(validateFixedServiceSmokeObservation(observation), []);
  observation.commands.status = 'runtime_bridge_status';
  observation.commands.productControl = 'product_control_record_get';
  observation.serviceAfter.processId = 100;
  observation.trustStageCounts.opened = 1;
  assert.match(validateFixedServiceSmokeObservation(observation).join('; '), /replace.*canonical.*before and after/u);
  observation.observedPages[1].observerErrors.push({ code: 'observer-operation-timeout' });
  assert.match(validateFixedServiceSmokeObservation(observation).join('; '), /observer must complete without errors/u);
});

test('fixed-service smoke admits the canonical expired account projection without treating it as authenticated', () => {
  const log = REQUIRED_FIXED_SERVICE_TRUST_STAGES
    .flatMap((stage) => [`[protected-local desktop-session] stage=${stage}`, `[protected-local desktop-session] stage=${stage}`])
    .join('\n');
  const beforeRestart = validProjection();
  const afterRestart = validProjection();
  beforeRestart.account = { state: 'expired', accountProjection: { accountId: 'account-a' } };
  afterRestart.account = { state: 'expired', accountProjection: { accountId: 'account-a' } };
  const observation = {
    serviceBefore: validStatus(100), serviceAfter: validStatus(200),
    electronHost: { basename: 'Nimi Desktop Runtime.exe', signatureStatus: 'Valid' },
    commands: {
      status: 'nimi.shell.runtimeLifecycle.status',
      restart: 'nimi.shell.runtimeLifecycle.restart',
      productControl: 'nimi.shell.runtime.unary',
    },
    beforeRestart, afterRestart,
    trustStageCounts: trustStageCounts(log),
    privacy: { authorizationHeaderObserved: false, secretTextObserved: false, storageAuthorityMaterialObserved: false },
    observedPages: validObservedPages(),
    diagnosticBuildMode: 'reuse',
  };
  assert.deepEqual(validateFixedServiceSmokeObservation(observation), []);
  assert.notEqual(observation.beforeRestart.account.state, 'authenticated');
});
