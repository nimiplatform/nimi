import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isLocalRuntimeEnvironmentDependencyJobActiveState,
  isLocalRuntimeEnvironmentDependencyJobCancelledState,
  isLocalRuntimeEnvironmentDependencyJobFailedState,
  isLocalRuntimeEnvironmentDependencyJobRetryableState,
  isLocalRuntimeEnvironmentDependencyJobTransferringState,
  isLocalRuntimeEnvironmentDependencyNeedsConfirmationState,
  isLocalRuntimeEnvironmentDependencyReadyState,
  isLocalRuntimeEnvironmentDependencyRepairRequiredState,
  isLocalRuntimeEnvironmentDependencyStartableState,
  isLocalRuntimeEnvironmentDependencyUnsupportedState,
  parseLocalRuntimeEnvironmentDependencyJobProjection,
  parseLocalRuntimeEnvironmentPlanProjection,
} from '../../src/runtime/local-environment-dependency-states.js';

test('local environment dependency state projections classify Runtime ready states', () => {
  assert.equal(isLocalRuntimeEnvironmentDependencyReadyState('ready_managed'), true);
  assert.equal(isLocalRuntimeEnvironmentDependencyReadyState('ready_system'), true);
  assert.equal(isLocalRuntimeEnvironmentDependencyReadyState('needs_confirmation'), false);
  assert.equal(isLocalRuntimeEnvironmentDependencyReadyState(' READY_SYSTEM '), true);
});

test('local environment dependency state projections classify startable states', () => {
  assert.equal(isLocalRuntimeEnvironmentDependencyStartableState('needs_confirmation'), true);
  assert.equal(isLocalRuntimeEnvironmentDependencyStartableState('failed'), true);
  assert.equal(isLocalRuntimeEnvironmentDependencyStartableState('cancelled'), true);
  assert.equal(isLocalRuntimeEnvironmentDependencyStartableState('ready_managed'), false);
});

test('local environment dependency state projections classify setup-required terminal surfaces', () => {
  assert.equal(isLocalRuntimeEnvironmentDependencyNeedsConfirmationState('needs_confirmation'), true);
  assert.equal(isLocalRuntimeEnvironmentDependencyNeedsConfirmationState('queued'), false);
  assert.equal(isLocalRuntimeEnvironmentDependencyRepairRequiredState('repair_required'), true);
  assert.equal(isLocalRuntimeEnvironmentDependencyRepairRequiredState('failed'), false);
  assert.equal(isLocalRuntimeEnvironmentDependencyUnsupportedState('unsupported'), true);
  assert.equal(isLocalRuntimeEnvironmentDependencyUnsupportedState('ready_system'), false);
});

test('local environment dependency job state projections classify active jobs', () => {
  assert.equal(isLocalRuntimeEnvironmentDependencyJobActiveState('queued'), true);
  assert.equal(isLocalRuntimeEnvironmentDependencyJobActiveState('downloading'), true);
  assert.equal(isLocalRuntimeEnvironmentDependencyJobActiveState('verifying'), true);
  assert.equal(isLocalRuntimeEnvironmentDependencyJobActiveState('installing'), true);
  assert.equal(isLocalRuntimeEnvironmentDependencyJobActiveState('needs_confirmation'), false);
  assert.equal(isLocalRuntimeEnvironmentDependencyJobActiveState('failed'), false);
  assert.equal(isLocalRuntimeEnvironmentDependencyJobActiveState('starting'), false);
  assert.equal(isLocalRuntimeEnvironmentDependencyJobActiveState('running'), false);
  assert.equal(isLocalRuntimeEnvironmentDependencyJobActiveState('in_progress'), false);
});

test('local environment dependency job state projections classify transferring jobs', () => {
  assert.equal(isLocalRuntimeEnvironmentDependencyJobTransferringState('downloading'), true);
  assert.equal(isLocalRuntimeEnvironmentDependencyJobTransferringState('verifying'), true);
  assert.equal(isLocalRuntimeEnvironmentDependencyJobTransferringState('queued'), false);
  assert.equal(isLocalRuntimeEnvironmentDependencyJobTransferringState('installing'), false);
});

test('local environment dependency job state projections classify retryable terminal jobs', () => {
  assert.equal(isLocalRuntimeEnvironmentDependencyJobRetryableState('failed'), true);
  assert.equal(isLocalRuntimeEnvironmentDependencyJobRetryableState('cancelled'), true);
  assert.equal(isLocalRuntimeEnvironmentDependencyJobRetryableState('unsupported'), true);
  assert.equal(isLocalRuntimeEnvironmentDependencyJobRetryableState('repair_required'), false);
  assert.equal(isLocalRuntimeEnvironmentDependencyJobRetryableState('downloading'), false);
});

test('local environment dependency job state projections classify explicit failed and cancelled states', () => {
  assert.equal(isLocalRuntimeEnvironmentDependencyJobFailedState('failed'), true);
  assert.equal(isLocalRuntimeEnvironmentDependencyJobFailedState('cancelled'), false);
  assert.equal(isLocalRuntimeEnvironmentDependencyJobCancelledState('cancelled'), true);
  assert.equal(isLocalRuntimeEnvironmentDependencyJobCancelledState('failed'), false);
});

test('local environment dependency plan parser projects Runtime plan fields', () => {
  const parsed = parseLocalRuntimeEnvironmentPlanProjection({
    planId: 'plan-1',
    packId: 'local-speech',
    productLabel: 'Local Speech',
    hostProfileId: 'macos-arm64',
    platformTuple: 'darwin-arm64',
    runtimeDataRoot: '/runtime/data',
    consumerScope: 'first-run',
    cloudOnlyImpact: 'voice disabled',
    state: 'needs_confirmation',
    reasonCode: 'AI_LOCAL_SPEECH_DOWNLOAD_CONFIRMATION_REQUIRED',
    dependencies: [{
      dependencyFamily: 'python',
      dependencyId: 'local-speech-python',
      required: true,
      state: 'needs_confirmation',
      sourceKind: 'managed_download',
      confirmationRequired: true,
      selectedSourceRecordId: 'source-1',
      environmentKey: 'local-speech',
      canonicalRoot: '/runtime/data/envs/local-speech',
      reasonCode: 'AI_LOCAL_SPEECH_DOWNLOAD_CONFIRMATION_REQUIRED',
      detail: 'download required',
    }],
  });

  assert.equal(parsed.planId, 'plan-1');
  assert.equal(parsed.dependencies[0]?.dependencyId, 'local-speech-python');
  assert.equal(parsed.dependencies[0]?.confirmationRequired, true);
  assert.equal(parsed.dependencies[0]?.canonicalRoot, '/runtime/data/envs/local-speech');
});

test('local environment dependency job parser clamps progress projection', () => {
  const parsed = parseLocalRuntimeEnvironmentDependencyJobProjection({
    jobId: 'job-1',
    environmentKey: 'local-speech',
    dependencyFamily: 'python',
    dependencyId: 'local-speech-python',
    state: 'downloading',
    sourceKind: 'managed_download',
    canonicalRoot: '/runtime/data/envs/local-speech',
    selectedSourceRecordId: 'source-1',
    failureDetail: '',
    retryable: true,
    reasonCode: 'LOCAL_ENVIRONMENT_DEPENDENCY_JOB_INTERRUPTED',
    recoveryDisposition: 'auto_retry_transient',
    createdAt: '2026-05-31T00:00:00Z',
    updatedAt: '2026-05-31T00:01:00Z',
    bytesReceived: '2048',
    bytesTotal: '4096',
    percent: 101.2,
    speedBytesPerSec: '512',
    etaSeconds: -5,
  });

  assert.equal(parsed.bytesReceived, 2048);
  assert.equal(parsed.bytesTotal, 4096);
  assert.equal(parsed.percent, 100);
  assert.equal(parsed.speedBytesPerSec, 512);
  assert.equal(parsed.etaSeconds, 0);
  assert.equal(parsed.reasonCode, 'LOCAL_ENVIRONMENT_DEPENDENCY_JOB_INTERRUPTED');
  assert.equal(parsed.recoveryDisposition, 'auto_retry_transient');
});
