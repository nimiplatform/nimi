import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  NimiRuntimeLocalEnvironmentDependencyJob,
  NimiRuntimeLocalEnvironmentPlanDependency,
} from '@nimiplatform/sdk/runtime';
import {
  runtimeDependencyCurrentState,
  runtimeDependencyJobForDisplay,
  runtimeDependencyRequiresAttention,
} from '../src/shell/renderer/features/runtime-config/runtime-config-local-model-center-runtime-dependency-state';

function dependency(
  state: string,
  overrides: Partial<NimiRuntimeLocalEnvironmentPlanDependency> = {},
): NimiRuntimeLocalEnvironmentPlanDependency {
  return {
    environmentKey: 'local-image-native',
    dependencyFamily: 'native-engine-package.stablediffusion-ggml',
    dependencyId: 'stable-diffusion.cpp.package',
    consumerScope: 'stable-diffusion.cpp.cuda',
    state,
    confirmationRequired: state === 'needs_confirmation',
    ...overrides,
  } as NimiRuntimeLocalEnvironmentPlanDependency;
}

function job(
  state: string,
  overrides: Partial<NimiRuntimeLocalEnvironmentDependencyJob> = {},
): NimiRuntimeLocalEnvironmentDependencyJob {
  return {
    jobId: 'runtime-job-1',
    environmentKey: 'local-image-native',
    dependencyFamily: 'native-engine-package.stablediffusion-ggml',
    dependencyId: 'stable-diffusion.cpp.package',
    consumerScope: 'stable-diffusion.cpp.cuda',
    state,
    retryable: state === 'failed',
    createdAt: '2026-06-18T00:00:00.000Z',
    updatedAt: '2026-06-18T00:00:00.000Z',
    ...overrides,
  } as NimiRuntimeLocalEnvironmentDependencyJob;
}

test('stale ready job cannot mask a currently blocking image runtime dependency', () => {
  const currentDependency = dependency('needs_confirmation');
  const staleReadyJob = job('ready_managed');

  assert.equal(runtimeDependencyJobForDisplay(currentDependency, staleReadyJob), undefined);
  assert.equal(runtimeDependencyCurrentState(currentDependency, staleReadyJob), 'needs_confirmation');
  assert.equal(runtimeDependencyRequiresAttention(currentDependency, staleReadyJob), true);
});

test('stale failed job cannot make a currently ready image runtime dependency look broken', () => {
  const currentDependency = dependency('ready_managed');
  const staleFailedJob = job('failed');

  assert.equal(runtimeDependencyJobForDisplay(currentDependency, staleFailedJob), undefined);
  assert.equal(runtimeDependencyCurrentState(currentDependency, staleFailedJob), 'ready_managed');
  assert.equal(runtimeDependencyRequiresAttention(currentDependency, staleFailedJob), false);
});

test('active and retryable jobs surface only while the current dependency still blocks activation', () => {
  const currentDependency = dependency('needs_confirmation');
  const activeJob = job('downloading');
  const retryableJob = job('failed');

  assert.equal(runtimeDependencyJobForDisplay(currentDependency, activeJob), activeJob);
  assert.equal(runtimeDependencyCurrentState(currentDependency, activeJob), 'downloading');
  assert.equal(runtimeDependencyJobForDisplay(currentDependency, retryableJob), retryableJob);
  assert.equal(runtimeDependencyCurrentState(currentDependency, retryableJob), 'failed');
});
