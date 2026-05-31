import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PLATFORM_AI_PROFILE_FACTORY_ROWS,
  selectFactoryAIProfileForFirstRun,
} from '../../src/platform-catalog/index.js';
import {
  FIRST_RUN_MATERIALIZATION_CONSUMER_SCOPE,
  aggregateMaterializationDownloadProgress,
  repairableFirstRunMaterializationDependencies,
  resolveFirstRunMaterializationProjection,
  retryableInterruptedFirstRunMaterializationJobs,
  startFirstRunMaterialization,
  type FirstRunMaterializationRuntime,
} from '../../src/runtime/index.js';

function createRuntime(): FirstRunMaterializationRuntime & { readonly started: string[] } {
  const started: string[] = [];
  const runtime: FirstRunMaterializationRuntime & { readonly started: string[] } = {
    started,
    async resolveEnvironmentPlan(input) {
      assert.equal(input.consumerScope, FIRST_RUN_MATERIALIZATION_CONSUMER_SCOPE);
      return {
        planId: 'plan-1',
        packId: input.packId,
        productLabel: 'Tester Local',
        hostProfileId: 'tester-host',
        platformTuple: 'darwin-arm64',
        state: 'needs_confirmation',
        dependencies: [{
          dependencyFamily: 'model.asset',
          dependencyId: 'tester-model',
          required: true,
          state: 'needs_confirmation',
          sourceKind: 'managed_download',
          confirmationRequired: true,
          environmentKey: input.packId,
        }],
      };
    },
    async listEnvironmentDependencyJobs() {
      return [];
    },
    async startEnvironmentDependencyJob(input) {
      started.push(`${input.environmentKey}:${input.dependencyFamily}:${input.dependencyId}:${input.confirmed}`);
    },
    async cancelEnvironmentDependencyJob() {},
    async retryEnvironmentDependencyJob() {},
    async repairEnvironmentDependency() {},
  };
  return runtime;
}

test('first-run factory profile selection lives in SDK platform catalog', () => {
  assert.equal(selectFactoryAIProfileForFirstRun(PLATFORM_AI_PROFILE_FACTORY_ROWS, 'minimal')?.alias, 'local-speech-ready');
  assert.equal(selectFactoryAIProfileForFirstRun(PLATFORM_AI_PROFILE_FACTORY_ROWS, 'recommended')?.alias, 'local-gpu');
});

test('first-run materialization projection resolves Runtime dependency plans without ready inference', async () => {
  const runtime = createRuntime();
  const projection = await resolveFirstRunMaterializationProjection({
    profile: {
      localComputePackRefs: ['local-text'],
      dependencyFamilyRefs: ['model.asset'],
      materializationConfirmationRequired: true,
    },
    runtime,
    installLevel: 'minimal',
  });

  assert.equal(projection.status, 'needs_confirmation');
  assert.equal(projection.reason, 'materialization_requires_confirmation');
  assert.equal(projection.dependencies[0]?.dependency.dependencyFamily, 'model.asset');
});

test('first-run materialization starts only Runtime-resolved startable dependencies', async () => {
  const runtime = createRuntime();
  const projection = await startFirstRunMaterialization({
    profile: {
      localComputePackRefs: ['local-text'],
      dependencyFamilyRefs: ['model.asset'],
      materializationConfirmationRequired: true,
    },
    runtime,
    confirmed: true,
  });

  assert.equal(projection.status, 'starting');
  assert.deepEqual(runtime.started, ['local-text:model.asset:tester-model:true']);
});

test('first-run materialization progress and recovery helpers preserve Runtime job state distinctions', () => {
  const dependency = {
    dependencyFamily: 'model.asset',
    dependencyId: 'tester-model',
    required: true,
    state: 'needs_confirmation',
    sourceKind: 'managed_download',
    confirmationRequired: true,
    environmentKey: 'tester-pack',
  };
  const failedJob = {
    jobId: 'job-1',
    environmentKey: 'tester-pack',
    dependencyFamily: 'model.asset',
    dependencyId: 'tester-model',
    state: 'failed',
    sourceKind: 'managed_download',
    retryable: true,
    failureDetail: 'unexpected eof',
    bytesReceived: 512,
    bytesTotal: 1024,
    percent: 50,
    speedBytesPerSec: 256,
    etaSeconds: 2,
  };
  const progress = aggregateMaterializationDownloadProgress([{
    packId: 'tester-pack',
    dependency,
    job: { ...failedJob, state: 'downloading' },
  }]);

  assert.equal(progress?.percent, 50);
  assert.equal(retryableInterruptedFirstRunMaterializationJobs({
    status: 'failed',
    reason: 'runtime_materialization_job_failed',
    missingDependencyFamilies: [],
    dependencies: [{ packId: 'tester-pack', dependency, job: failedJob }],
  }).length, 1);
  assert.equal(repairableFirstRunMaterializationDependencies({
    status: 'repair_required',
    reason: 'runtime_materialization_repair_required',
    missingDependencyFamilies: [],
    dependencies: [{ packId: 'tester-pack', dependency: { ...dependency, state: 'repair_required' }, job: null }],
  }).length, 1);
});
