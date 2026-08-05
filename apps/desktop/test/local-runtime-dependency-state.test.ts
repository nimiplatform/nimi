import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  NimiRuntimeLocalEnvironmentDependencyJob,
  NimiRuntimeLocalEnvironmentPlanDependency,
} from '@nimiplatform/sdk/runtime';
import { i18n, initI18n } from '../src/shell/renderer/i18n';
import { localizedAssetUnhealthyReason } from '../src/shell/renderer/features/runtime-config/runtime-config-reason-messages';
import {
  runtimeDependencyBannerTitle,
} from '../src/shell/renderer/features/runtime-config/runtime-config-local-model-center-runtime-dependency-banner';
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

test('runtime dependency setup title reserves GPU acceleration copy for CUDA runtime dependencies', async () => {
  await initI18n();
  const t = i18n.t.bind(i18n);

  assert.equal(runtimeDependencyBannerTitle(dependency('needs_confirmation', {
    dependencyFamily: 'native-engine-package.stablediffusion-ggml',
    dependencyId: 'stable-diffusion.cpp.package',
    consumerScope: 'stable-diffusion.cpp.metal',
  }), undefined, t), 'Set up local image Runtime');

  assert.equal(runtimeDependencyBannerTitle(dependency('needs_confirmation', {
    dependencyFamily: 'accelerator.cuda.runtime',
    dependencyId: 'nvidia-cuda-user-space-runtime',
    consumerScope: 'stable-diffusion.cpp.cuda',
  }), undefined, t), 'Optional local GPU acceleration');
});

test('unhealthy asset reason codes resolve to localized human copy, never the raw code', async () => {
  await initI18n();

  // Non-speech reason code resolves through the localized reasonMessages catalog.
  assert.equal(
    localizedAssetUnhealthyReason('AI_LOCAL_MODEL_UNAVAILABLE', i18n.t),
    'Runtime local execution is unavailable.',
  );
  // Speech reason codes resolve through the same localized catalog.
  assert.equal(
    localizedAssetUnhealthyReason('AI_LOCAL_SPEECH_BUNDLE_DEGRADED', i18n.t),
    'The Runtime local speech bundle is unavailable.',
  );
  // An unmapped code yields '' so the caller renders generic copy, never the code.
  assert.equal(localizedAssetUnhealthyReason('SOME_UNMAPPED_INTERNAL_CODE', i18n.t), '');
});
