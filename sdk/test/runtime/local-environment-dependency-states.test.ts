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
