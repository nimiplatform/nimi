import assert from 'node:assert/strict';
import test from 'node:test';

import {
  repairableConfirmedFirstRunMaterializationDependencies,
  resolveFirstRunMaterializationProjection,
  retryableInterruptedFirstRunMaterializationJobs,
  shouldResumeConfirmedFirstRunMaterialization,
  type FirstRunMaterializationProjection,
} from '../src/shell/renderer/first-run/runtime-materialization.js';

function projection(
  status: FirstRunMaterializationProjection['status'],
  dependencies: FirstRunMaterializationProjection['dependencies'] = [],
): FirstRunMaterializationProjection {
  return {
    status,
    productState: 'local_ai_profile_selected_assets_missing',
    reason: 'test',
    missingDependencyFamilies: [],
    dependencies,
  };
}

function dependencyJob(
  failureDetail: string,
  overrides: Partial<NonNullable<FirstRunMaterializationProjection['dependencies'][number]['job']>> = {},
): FirstRunMaterializationProjection['dependencies'][number] {
  return {
    packId: 'local-text',
    dependency: {
      dependencyFamily: overrides.dependencyFamily ?? 'model.asset',
      dependencyId: overrides.dependencyId ?? 'asset-id:local.chat.gemma',
      required: true,
      state: 'needs_confirmation',
      sourceKind: 'runtime-managed',
      confirmationRequired: true,
      environmentKey: overrides.environmentKey ?? 'model.asset|asset-id:local.chat.gemma',
    },
    job: {
      jobId: overrides.jobId ?? 'job-model',
      environmentKey: overrides.environmentKey ?? 'model.asset|asset-id:local.chat.gemma',
      dependencyFamily: overrides.dependencyFamily ?? 'model.asset',
      dependencyId: overrides.dependencyId ?? 'asset-id:local.chat.gemma',
      state: overrides.state ?? 'failed',
      sourceKind: 'runtime-managed',
      retryable: overrides.retryable ?? true,
      failureDetail,
      bytesReceived: 0,
      bytesTotal: 0,
      percent: 0,
      speedBytesPerSec: 0,
      etaSeconds: 0,
    },
  };
}

function repairRequiredDependency(
  overrides: Partial<FirstRunMaterializationProjection['dependencies'][number]['dependency']> = {},
): FirstRunMaterializationProjection['dependencies'][number] {
  return {
    packId: 'local-speech',
    dependency: {
      dependencyFamily: 'python.package-set',
      dependencyId: 'local-speech-qwen3-tts.package-set',
      required: true,
      state: 'repair_required',
      sourceKind: 'runtime-managed',
      confirmationRequired: false,
      environmentKey: 'python.package-set|local-speech-qwen3-tts.package-set',
      reasonCode: 'LOCAL_ENVIRONMENT_DEPENDENCY_REPAIR_REQUIRED',
      ...overrides,
    },
    job: null,
  };
}

test('confirmed first-run setup resumes startable materialization after restart', () => {
  assert.equal(
    shouldResumeConfirmedFirstRunMaterialization(
      'local_ai_profile_selected_assets_missing',
      projection('needs_confirmation'),
    ),
    true,
  );
  assert.equal(
    shouldResumeConfirmedFirstRunMaterialization(
      'local_ai_profile_selected_environment_not_ready',
      projection('needs_confirmation'),
    ),
    true,
  );
  assert.equal(
    shouldResumeConfirmedFirstRunMaterialization(
      'local_ai_assets_downloaded_environment_not_ready',
      projection('needs_confirmation'),
    ),
    true,
  );
  assert.equal(
    shouldResumeConfirmedFirstRunMaterialization(
      'local_ai_ready',
      projection('needs_confirmation'),
    ),
    true,
  );
});

test('first-run materialization resume does not run before setup confirmation or after readiness', () => {
  assert.equal(
    shouldResumeConfirmedFirstRunMaterialization(
      'ai_environment_unconfigured',
      projection('needs_confirmation'),
    ),
    false,
  );
  assert.equal(
    shouldResumeConfirmedFirstRunMaterialization(
      'local_ai_profile_selected_assets_missing',
      projection('local_ai_ready'),
    ),
    false,
  );
});

test('confirmed first-run setup auto-recovers interrupted model downloads', () => {
  const interrupted = dependencyJob('LOCAL_ENVIRONMENT_DEPENDENCY_JOB_INTERRUPTED');
  const timedOut = dependencyJob(
    'download model file "model.gguf": context deadline exceeded (Client.Timeout or context cancellation while reading body)',
    { jobId: 'job-timeout', dependencyId: 'asset-id:timeout' },
  );
  assert.deepEqual(
    retryableInterruptedFirstRunMaterializationJobs(
      'local_ai_profile_selected_environment_not_ready',
      projection('failed', [interrupted, timedOut]),
    ).map((job) => job.jobId),
    ['job-model', 'job-timeout'],
  );
});

test('first-run setup auto-retries admitted transient failures and rejects non-transient ones', () => {
  const pythonLock = dependencyJob('Timeout (300s) when waiting for lock on uv cache', {
    dependencyFamily: 'python.package-set',
    dependencyId: 'local-speech.package-set',
    jobId: 'job-python',
  });
  const hashMismatch = dependencyJob('model file "model.gguf": model file hash mismatch', {
    jobId: 'job-hash',
  });
  const unconfirmed = retryableInterruptedFirstRunMaterializationJobs(
    'ai_environment_unconfigured',
    projection('failed', [dependencyJob('unexpected EOF')]),
  );
  assert.deepEqual(unconfirmed, []);
  assert.deepEqual(
    retryableInterruptedFirstRunMaterializationJobs(
      'local_ai_profile_selected_environment_not_ready',
      projection('failed', [pythonLock, hashMismatch]),
    ),
    [pythonLock.job],
  );
});

test('first-run materialization treats verified ready dependency as ready despite stale failed job', async () => {
  const runtime = {
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
      ).job!];
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
    } as never,
    runtimeDataRoot: 'D:\\Nimi',
    installLevel: 'minimal',
    runtime,
  });
  assert.equal(resolved.status, 'local_ai_ready');
});

test('confirmed first-run setup auto-repairs repair-required materialization dependencies once observer handles them', () => {
  const tts = repairRequiredDependency();
  const asr = repairRequiredDependency({
    dependencyId: 'local-speech-qwen3-asr.package-set',
    environmentKey: 'python.package-set|local-speech-qwen3-asr.package-set',
  });
  assert.deepEqual(
    repairableConfirmedFirstRunMaterializationDependencies(
      'local_ai_profile_selected_environment_not_ready',
      projection('repair_required', [tts, asr]),
    ).map(({ dependency }) => dependency.dependencyId),
    ['local-speech-qwen3-tts.package-set', 'local-speech-qwen3-asr.package-set'],
  );
});

test('first-run repair auto-recovery does not run before setup confirmation or outside repair state', () => {
  const repair = repairRequiredDependency();
  assert.deepEqual(
    repairableConfirmedFirstRunMaterializationDependencies(
      'ai_environment_unconfigured',
      projection('repair_required', [repair]),
    ),
    [],
  );
  assert.deepEqual(
    repairableConfirmedFirstRunMaterializationDependencies(
      'local_ai_profile_selected_environment_not_ready',
      projection('failed', [repair]),
    ),
    [],
  );
});
