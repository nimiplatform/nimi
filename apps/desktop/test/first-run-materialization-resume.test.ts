import assert from 'node:assert/strict';
import test from 'node:test';

import { NIMI_FIRST_RUN_MATERIALIZATION_CONSUMER_SCOPE } from '@nimiplatform/sdk/runtime';
import {
  repairableConfirmedNimiFirstRunMaterializationDependencies,
  retryableInterruptedNimiFirstRunMaterializationJobsForProductState,
  shouldResumeConfirmedNimiFirstRunMaterialization,
  type NimiFirstRunMaterializationProjection,
} from '../src/shell/renderer/first-run/runtime-materialization.js';

function projection(
  status: NimiFirstRunMaterializationProjection['status'],
  dependencies: NimiFirstRunMaterializationProjection['dependencies'] = [],
): NimiFirstRunMaterializationProjection {
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
  overrides: Partial<NonNullable<NimiFirstRunMaterializationProjection['dependencies'][number]['job']>> = {},
): NimiFirstRunMaterializationProjection['dependencies'][number] {
  return {
    packId: 'local-text',
    dependency: {
      dependencyFamily: overrides.dependencyFamily ?? 'model.asset',
      dependencyId: overrides.dependencyId ?? 'asset-id:local.chat.gemma',
      consumerScope: overrides.consumerScope ?? NIMI_FIRST_RUN_MATERIALIZATION_CONSUMER_SCOPE,
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
      consumerScope: overrides.consumerScope ?? NIMI_FIRST_RUN_MATERIALIZATION_CONSUMER_SCOPE,
      state: overrides.state ?? 'failed',
      sourceKind: 'runtime-managed',
      retryable: overrides.retryable ?? true,
      createdAt: overrides.createdAt ?? '2026-06-05T00:00:00.000Z',
      updatedAt: overrides.updatedAt ?? '2026-06-05T00:01:00.000Z',
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

function repairRequiredDependency(
  overrides: Partial<NimiFirstRunMaterializationProjection['dependencies'][number]['dependency']> = {},
): NimiFirstRunMaterializationProjection['dependencies'][number] {
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
      selectedSourceRecordId: 'source:local-speech-qwen3-tts.package-set',
      reasonCode: 'LOCAL_ENVIRONMENT_DEPENDENCY_REPAIR_REQUIRED',
      ...overrides,
      consumerScope: overrides.consumerScope ?? NIMI_FIRST_RUN_MATERIALIZATION_CONSUMER_SCOPE,
    },
    job: null,
  };
}

test('confirmed first-run setup resumes startable materialization after restart', () => {
  assert.equal(
    shouldResumeConfirmedNimiFirstRunMaterialization(
      'local_ai_profile_selected_assets_missing',
      projection('needs_confirmation'),
    ),
    true,
  );
  assert.equal(
    shouldResumeConfirmedNimiFirstRunMaterialization(
      'local_ai_profile_selected_environment_not_ready',
      projection('needs_confirmation'),
    ),
    true,
  );
  assert.equal(
    shouldResumeConfirmedNimiFirstRunMaterialization(
      'local_ai_assets_downloaded_environment_not_ready',
      projection('needs_confirmation'),
    ),
    true,
  );
  assert.equal(
    shouldResumeConfirmedNimiFirstRunMaterialization(
      'local_ai_ready',
      projection('needs_confirmation'),
    ),
    true,
  );
});

test('first-run materialization resume does not run before setup confirmation or after readiness', () => {
  assert.equal(
    shouldResumeConfirmedNimiFirstRunMaterialization(
      'ai_environment_unconfigured',
      projection('needs_confirmation'),
    ),
    false,
  );
  assert.equal(
    shouldResumeConfirmedNimiFirstRunMaterialization(
      'local_ai_profile_selected_assets_missing',
      projection('local_ai_ready'),
    ),
    false,
  );
});

test('confirmed first-run setup gates SDK retryable materialization jobs', () => {
  const interrupted = dependencyJob('LOCAL_ENVIRONMENT_DEPENDENCY_JOB_INTERRUPTED', {
    reasonCode: 'LOCAL_ENVIRONMENT_DEPENDENCY_JOB_INTERRUPTED',
    recoveryDisposition: 'auto_retry_transient',
  });
  assert.deepEqual(
    retryableInterruptedNimiFirstRunMaterializationJobsForProductState(
      'local_ai_profile_selected_environment_not_ready',
      projection('failed', [interrupted]),
    ).map((job) => job.jobId),
    ['job-model'],
  );
  assert.deepEqual(
    retryableInterruptedNimiFirstRunMaterializationJobsForProductState(
      'ai_environment_unconfigured',
      projection('failed', [interrupted]),
    ),
    [],
  );
});

test('confirmed first-run setup leaves manual-retry failures for the explicit Retry action', () => {
  const staleFailedJob = dependencyJob('runtime engine manager unavailable');
  assert.deepEqual(
    retryableInterruptedNimiFirstRunMaterializationJobsForProductState(
      'local_ai_profile_selected_environment_not_ready',
      projection('failed', [staleFailedJob]),
    ),
    [],
  );
});

test('confirmed first-run setup auto-repairs repair-required materialization dependencies once observer handles them', () => {
  const tts = repairRequiredDependency();
  const asr = repairRequiredDependency({
    dependencyId: 'local-speech-qwen3-asr.package-set',
    environmentKey: 'python.package-set|local-speech-qwen3-asr.package-set',
    selectedSourceRecordId: 'source:local-speech-qwen3-asr.package-set',
  });
  assert.deepEqual(
    repairableConfirmedNimiFirstRunMaterializationDependencies(
      'local_ai_profile_selected_environment_not_ready',
      projection('repair_required', [tts, asr]),
    ).map(({ dependency }) => dependency.dependencyId),
    ['local-speech-qwen3-tts.package-set', 'local-speech-qwen3-asr.package-set'],
  );
});

test('first-run repair auto-recovery does not run before setup confirmation or outside repair state', () => {
  const repair = repairRequiredDependency();
  assert.deepEqual(
    repairableConfirmedNimiFirstRunMaterializationDependencies(
      'ai_environment_unconfigured',
      projection('repair_required', [repair]),
    ),
    [],
  );
  assert.deepEqual(
    repairableConfirmedNimiFirstRunMaterializationDependencies(
      'local_ai_profile_selected_environment_not_ready',
      projection('failed', [repair]),
    ),
    [],
  );
});
