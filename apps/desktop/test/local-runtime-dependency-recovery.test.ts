import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  NimiRuntimeLocalEnvironmentDependencyJob,
  NimiRuntimeLocalEnvironmentPlanDependency,
} from '@nimiplatform/sdk/runtime';
import {
  retryableInterruptedRuntimeDependencyJobs,
  runtimeDependencyAutoRetryKey,
} from '../src/shell/renderer/features/runtime-config/runtime-config-local-model-center-runtime-dependency-recovery';
import {
  localModelCenterDependencyBlocksSetup,
} from '../src/shell/renderer/features/runtime-config/runtime-config-use-local-model-center-runtime-dependencies';

function dependency(
  state: string,
  overrides: Partial<NimiRuntimeLocalEnvironmentPlanDependency> = {},
): NimiRuntimeLocalEnvironmentPlanDependency {
  const dependencyId = 'asset_id=local-import/ae|parent_asset_id=local-import/z_image_turbo-Q4_K';
  return {
    environmentKey: `model.companion-asset|${dependencyId}`,
    dependencyFamily: 'model.companion-asset',
    dependencyId,
    consumerScope: 'stable-diffusion.cpp.cuda',
    state,
    required: true,
    confirmationRequired: true,
    ...overrides,
  } as NimiRuntimeLocalEnvironmentPlanDependency;
}

function job(
  state: string,
  overrides: Partial<NimiRuntimeLocalEnvironmentDependencyJob> = {},
): NimiRuntimeLocalEnvironmentDependencyJob {
  const dependencyId = 'asset_id=local-import/ae|parent_asset_id=local-import/z_image_turbo-Q4_K';
  return {
    jobId: 'localenv_job_interrupted',
    environmentKey: `model.companion-asset|${dependencyId}`,
    dependencyFamily: 'model.companion-asset',
    dependencyId,
    consumerScope: 'stable-diffusion.cpp.cuda',
    state,
    retryable: state === 'failed',
    reasonCode: 'LOCAL_ENVIRONMENT_DEPENDENCY_JOB_INTERRUPTED',
    recoveryDisposition: 'auto_retry_transient',
    createdAt: '2026-06-18T13:25:00.000Z',
    updatedAt: '2026-06-18T13:25:00.000Z',
    ...overrides,
  } as NimiRuntimeLocalEnvironmentDependencyJob;
}

test('local model center does not treat missing workflow profile context as Runtime setup failure', () => {
  assert.equal(localModelCenterDependencyBlocksSetup(dependency('unsupported', {
    reasonCode: 'LOCAL_ENVIRONMENT_IMAGE_PROFILE_BINDINGS_REQUIRED',
  })), false);
});

test('local model center still blocks genuine required Runtime dependencies', () => {
  assert.equal(localModelCenterDependencyBlocksSetup(dependency('unsupported', {
    dependencyFamily: 'native-engine-package.stablediffusion-ggml',
    dependencyId: 'stable-diffusion.cpp.package',
    reasonCode: 'LOCAL_ENVIRONMENT_DEPENDENCY_UNSUPPORTED',
  })), true);
});

test('local model center retries interrupted companion jobs while dependency is still blocking', () => {
  const interrupted = job('failed');
  const jobs = retryableInterruptedRuntimeDependencyJobs([dependency('failed')], [interrupted]);

  assert.deepEqual(jobs, [interrupted]);
  assert.equal(
    runtimeDependencyAutoRetryKey(interrupted),
    'model.companion-asset|asset_id=local-import/ae|parent_asset_id=local-import/z_image_turbo-Q4_K|stable-diffusion.cpp.cuda|LOCAL_ENVIRONMENT_DEPENDENCY_JOB_INTERRUPTED',
  );
});

test('local model center does not retry stale interrupted jobs for ready dependencies', () => {
  const jobs = retryableInterruptedRuntimeDependencyJobs([dependency('ready_managed')], [job('failed')]);

  assert.deepEqual(jobs, []);
});

test('local model center does not retry while a matching dependency job is active', () => {
  const interrupted = job('failed', { updatedAt: '2026-06-18T13:20:00.000Z' });
  const active = job('downloading', {
    jobId: 'localenv_job_active',
    retryable: false,
    reasonCode: '',
    recoveryDisposition: '',
    updatedAt: '2026-06-18T13:30:00.000Z',
  });
  const jobs = retryableInterruptedRuntimeDependencyJobs([dependency('failed')], [interrupted, active]);

  assert.deepEqual(jobs, []);
});

test('local model center only retries retryable interrupted terminal jobs', () => {
  const notRetryable = job('failed', { retryable: false });
  const failedForOtherReason = job('failed', {
    jobId: 'localenv_job_other',
    reasonCode: 'LOCAL_ENVIRONMENT_DEPENDENCY_JOB_FAILED',
    recoveryDisposition: 'manual_retry',
  });

  assert.deepEqual(retryableInterruptedRuntimeDependencyJobs([dependency('failed')], [notRetryable]), []);
  assert.deepEqual(retryableInterruptedRuntimeDependencyJobs([dependency('failed')], [failedForOtherReason]), []);
});
