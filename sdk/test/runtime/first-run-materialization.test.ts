import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PLATFORM_AI_PROFILE_FACTORY_ROWS,
  selectFactoryAIProfileForFirstRun,
} from '../../src/platform-catalog/index.js';
import {
  FIRST_RUN_MATERIALIZATION_CONSUMER_SCOPE,
  aggregateMaterializationDownloadProgress,
  productStateForMaterializationStatus,
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

function dependencyJob(
  failureDetail: string,
  overrides: Partial<{
    jobId: string;
    environmentKey: string;
    dependencyFamily: string;
    dependencyId: string;
    state: string;
    retryable: boolean;
    reasonCode: string;
    recoveryDisposition: string;
  }> = {},
) {
  const dependencyFamily = overrides.dependencyFamily ?? 'model.asset';
  const dependencyId = overrides.dependencyId ?? 'asset-id:local.chat.gemma';
  const environmentKey = overrides.environmentKey ?? `${dependencyFamily}|${dependencyId}`;
  return {
    packId: 'tester-pack',
    dependency: {
      dependencyFamily,
      dependencyId,
      required: true,
      state: 'needs_confirmation',
      sourceKind: 'runtime-managed',
      confirmationRequired: true,
      environmentKey,
    },
    job: {
      jobId: overrides.jobId ?? 'job-model',
      environmentKey,
      dependencyFamily,
      dependencyId,
      state: overrides.state ?? 'failed',
      sourceKind: 'runtime-managed',
      retryable: overrides.retryable ?? true,
      failureDetail,
      reasonCode: overrides.reasonCode ?? 'LOCAL_ENVIRONMENT_DEPENDENCY_JOB_FAILED',
      recoveryDisposition: overrides.recoveryDisposition ?? 'manual_retry',
      bytesReceived: 0,
      bytesTotal: 0,
      percent: 0,
      speedBytesPerSec: 0,
      etaSeconds: 0,
    },
  };
}

function downloadingDependency(
  bytesReceived: number,
  bytesTotal: number,
  speedBytesPerSec: number,
) {
  return {
    packId: 'tester-pack',
    dependency: {
      dependencyFamily: 'model.asset',
      dependencyId: 'tester-model',
      required: true,
      state: 'needs_confirmation',
      sourceKind: 'managed_download',
      confirmationRequired: true,
      environmentKey: 'tester-pack',
    },
    job: {
      jobId: 'job-download',
      environmentKey: 'tester-pack',
      dependencyFamily: 'model.asset',
      dependencyId: 'tester-model',
      state: 'downloading',
      sourceKind: 'managed_download',
      retryable: true,
      failureDetail: '',
      bytesReceived,
      bytesTotal,
      percent: bytesTotal > 0 ? Math.round((bytesReceived / bytesTotal) * 100) : 0,
      speedBytesPerSec,
      etaSeconds: 0,
    },
  };
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
  assert.equal(projection.productState, 'local_ai_profile_selected_assets_missing');
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
    reasonCode: 'LOCAL_ENVIRONMENT_DEPENDENCY_JOB_INTERRUPTED',
    recoveryDisposition: 'auto_retry_transient',
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
    productState: 'local_ai_profile_selected_environment_not_ready',
    reason: 'runtime_materialization_job_failed',
    missingDependencyFamilies: [],
    dependencies: [{ packId: 'tester-pack', dependency, job: failedJob }],
  }).length, 1);
  assert.equal(repairableFirstRunMaterializationDependencies({
    status: 'repair_required',
    productState: 'local_ai_profile_selected_environment_not_ready',
    reason: 'runtime_materialization_repair_required',
    missingDependencyFamilies: [],
    dependencies: [{ packId: 'tester-pack', dependency: { ...dependency, state: 'repair_required' }, job: null }],
  }).length, 1);
});

test('first-run materialization progress never fabricates a rate or percent', () => {
  const withRate = aggregateMaterializationDownloadProgress([
    downloadingDependency(250, 1000, 125),
  ]);
  assert.ok(withRate);
  assert.equal(withRate.percent, 25);
  assert.equal(withRate.speedBytesPerSec, 125);
  assert.equal(withRate.etaSeconds, 6);

  const noRate = aggregateMaterializationDownloadProgress([
    downloadingDependency(250, 1000, 0),
  ]);
  assert.ok(noRate);
  assert.equal(noRate.percent, 25);
  assert.equal(noRate.speedBytesPerSec, null);
  assert.equal(noRate.etaSeconds, null);

  const noTotal = aggregateMaterializationDownloadProgress([
    downloadingDependency(250, 0, 125),
  ]);
  assert.ok(noTotal);
  assert.equal(noTotal.percent, null);
  assert.equal(noTotal.etaSeconds, null);

  assert.equal(aggregateMaterializationDownloadProgress([]), null);
});

test('first-run materialization retry helper admits transient Runtime failures only', () => {
  const modelInterrupted = dependencyJob('LOCAL_ENVIRONMENT_DEPENDENCY_JOB_INTERRUPTED', {
    reasonCode: 'LOCAL_ENVIRONMENT_DEPENDENCY_JOB_INTERRUPTED',
    recoveryDisposition: 'auto_retry_transient',
  });
  const modelTimedOut = dependencyJob(
    'download model file "model.gguf": context deadline exceeded (Client.Timeout or context cancellation while reading body)',
    {
      jobId: 'job-timeout',
      dependencyId: 'asset-id:timeout',
      reasonCode: 'LOCAL_ENVIRONMENT_DEPENDENCY_JOB_INTERRUPTED',
      recoveryDisposition: 'auto_retry_transient',
    },
  );
  const pythonLock = dependencyJob('Timeout (300s) when waiting for lock on uv cache', {
    dependencyFamily: 'python.package-set',
    dependencyId: 'local-speech.package-set',
    jobId: 'job-python',
    reasonCode: 'LOCAL_ENVIRONMENT_DEPENDENCY_JOB_INTERRUPTED',
    recoveryDisposition: 'auto_retry_transient',
  });
  const hashMismatch = dependencyJob('model file "model.gguf": model file hash mismatch', {
    jobId: 'job-hash',
  });

  const projection = {
    status: 'failed' as const,
    productState: productStateForMaterializationStatus('failed'),
    reason: 'runtime_materialization_job_failed',
    missingDependencyFamilies: [],
    dependencies: [modelInterrupted, modelTimedOut, pythonLock, hashMismatch],
  };
  assert.deepEqual(
    retryableInterruptedFirstRunMaterializationJobs(projection).map((job) => job.jobId),
    ['job-model', 'job-timeout', 'job-python'],
  );
  assert.deepEqual(
    retryableInterruptedFirstRunMaterializationJobs({ ...projection, status: 'activation_pending' }),
    [],
  );
});

test('first-run materialization retry helper does not parse diagnostic failure detail', () => {
  const projection = {
    status: 'failed' as const,
    reason: 'runtime_materialization_job_failed',
    missingDependencyFamilies: [],
    dependencies: [
      dependencyJob('LOCAL_ENVIRONMENT_DEPENDENCY_JOB_INTERRUPTED', {
        jobId: 'job-diagnostic-only',
        reasonCode: 'LOCAL_ENVIRONMENT_DEPENDENCY_JOB_INTERRUPTED',
        recoveryDisposition: 'manual_retry',
      }),
      dependencyJob('model file hash mismatch', {
        jobId: 'job-runtime-owned-auto',
        reasonCode: 'LOCAL_ENVIRONMENT_DEPENDENCY_JOB_INTERRUPTED',
        recoveryDisposition: 'auto_retry_transient',
      }),
    ],
  };

  assert.deepEqual(
    retryableInterruptedFirstRunMaterializationJobs(projection).map((job) => job.jobId),
    ['job-runtime-owned-auto'],
  );
});

test('first-run materialization treats ready dependency projection as ready despite stale failed jobs', async () => {
  const runtime: FirstRunMaterializationRuntime = {
    async resolveEnvironmentPlan() {
      return {
        planId: 'plan:local-speech',
        packId: 'local-speech',
        productLabel: 'Speech',
        hostProfileId: 'host',
        platformTuple: 'windows/amd64',
        state: 'ready',
        dependencies: [{
          dependencyFamily: 'python.package-set',
          dependencyId: 'local-speech-qwen3-tts.package-set',
          required: true,
          state: 'ready_managed',
          sourceKind: 'managed',
          confirmationRequired: false,
          selectedSourceRecordId: 'src-ready',
          environmentKey: 'python.package-set|local-speech-qwen3-tts.package-set',
        }],
      };
    },
    async listEnvironmentDependencyJobs() {
      return [dependencyJob(
        'No virtual environment or system Python installation found for path',
        {
          dependencyFamily: 'python.package-set',
          dependencyId: 'local-speech-qwen3-tts.package-set',
          environmentKey: 'python.package-set|local-speech-qwen3-tts.package-set',
          jobId: 'job-stale-failed',
        },
      ).job];
    },
    async startEnvironmentDependencyJob() {
      throw new Error('not used');
    },
    async cancelEnvironmentDependencyJob() {
      throw new Error('not used');
    },
    async retryEnvironmentDependencyJob() {
      throw new Error('not used');
    },
    async repairEnvironmentDependency() {
      throw new Error('not used');
    },
  };

  const resolved = await resolveFirstRunMaterializationProjection({
    profile: {
      localComputePackRefs: ['local-speech'],
      dependencyFamilyRefs: ['python.package-set'],
      materializationConfirmationRequired: true,
    },
    runtime,
    runtimeDataRoot: 'D:\\Nimi',
    installLevel: 'minimal',
  });
  assert.equal(resolved.status, 'local_ai_ready');
  assert.equal(resolved.productState, 'local_ai_ready');
});
