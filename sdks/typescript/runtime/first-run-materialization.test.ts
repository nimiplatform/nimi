import assert from 'node:assert/strict';
import test from 'node:test';

import {
  NIMI_FIRST_RUN_MATERIALIZATION_CONSUMER_SCOPE,
  aggregateNimiFirstRunMaterializationDownloadProgress,
  repairableNimiFirstRunMaterializationDependencies,
  resolveNimiFirstRunMaterializationProjection,
  retryableInterruptedNimiFirstRunMaterializationJobs,
  startNimiFirstRunMaterialization,
  type NimiFirstRunMaterializationRuntime,
  type NimiRuntimeLocalEnvironmentDependencyJob,
  type NimiRuntimeLocalEnvironmentPlan,
  type NimiRuntimeLocalEnvironmentPlanDependency,
} from './index';

test('First-run materialization resolves confirmation-required Runtime dependencies without starting jobs', async () => {
  const calls: unknown[] = [];
  const runtime = materializationRuntime({
    dependencies: [
      dependency({ dependencyFamily: 'ollama', dependencyId: 'ollama-runtime', state: 'needs_confirmation' }),
    ],
    jobs: [],
    onResolve(input) {
      calls.push(input);
    },
    onStart() {
      throw new Error('start must wait for user confirmation');
    },
  });

  const projection = await startNimiFirstRunMaterialization({
    profile: {
      localComputePackRefs: ['qwen-small'],
      dependencyFamilyRefs: ['ollama'],
      materializationConfirmationRequired: true,
    },
    runtime,
    runtimeDataRoot: '/tester/nimi-data',
    installLevel: 'recommended',
    confirmed: false,
  });

  assert.equal(NIMI_FIRST_RUN_MATERIALIZATION_CONSUMER_SCOPE, 'first-run');
  assert.deepEqual(calls, [{
    packId: 'qwen-small',
    consumerScope: 'first-run',
    runtimeDataRoot: '/tester/nimi-data',
    installLevel: 'recommended',
  }]);
  assert.equal(projection.status, 'needs_confirmation');
  assert.equal(projection.reason, 'materialization_requires_confirmation');
  assert.equal(projection.productState, 'local_ai_profile_selected_assets_missing');
});

test('First-run materialization starts startable dependencies through core Runtime writes', async () => {
  const startCalls: unknown[] = [];
  const runtime = materializationRuntime({
    dependencies: [
      dependency({ dependencyFamily: 'ollama', dependencyId: 'ollama-runtime', state: 'needs_confirmation' }),
    ],
    jobsForEnvironment() {
      return startCalls.length === 0
        ? []
        : [
          job({
            jobId: 'job-1',
            dependencyFamily: 'ollama',
            dependencyId: 'ollama-runtime',
            state: 'queued',
          }),
        ];
    },
    onStart(input, options) {
      startCalls.push({ input, options });
    },
  });

  const projection = await startNimiFirstRunMaterialization({
    profile: {
      localComputePackRefs: ['qwen-small'],
      dependencyFamilyRefs: ['ollama'],
      materializationConfirmationRequired: true,
    },
    runtime,
    confirmed: true,
  });

  assert.deepEqual(startCalls, [{
    input: {
      environmentKey: 'env-1',
      dependencyFamily: 'ollama',
      dependencyId: 'ollama-runtime',
      sourceKind: 'managed',
      confirmed: true,
    },
    options: { caller: 'core' },
  }]);
  assert.equal(projection.status, 'in_progress');
  assert.equal(projection.reason, 'runtime_materialization_jobs_started');
  assert.equal(projection.productState, 'local_ai_profile_selected_assets_missing');
});

test('First-run materialization projects progress, retryable jobs, and repairable dependencies', () => {
  const downloading = job({
    jobId: 'download',
    dependencyFamily: 'models',
    dependencyId: 'text-model',
    state: 'downloading',
    bytesReceived: 100,
    bytesTotal: 200,
    speedBytesPerSec: 20,
  });
  const verifying = job({
    jobId: 'verify',
    dependencyFamily: 'models',
    dependencyId: 'vision-model',
    state: 'verifying',
    bytesReceived: 300,
    bytesTotal: 600,
    speedBytesPerSec: 80,
  });
  const failed = job({
    jobId: 'failed',
    dependencyFamily: 'runtime',
    dependencyId: 'server',
    state: 'failed',
    retryable: true,
    recoveryDisposition: 'auto_retry_transient',
  });
  const repairing = dependency({
    dependencyFamily: 'driver',
    dependencyId: 'gpu-driver',
    state: 'repair_required',
  });
  const projection = {
    status: 'failed',
    reason: 'runtime_materialization_job_failed',
    productState: 'local_ai_profile_selected_environment_not_ready',
    missingDependencyFamilies: [],
    dependencies: [
      { packId: 'pack', dependency: dependency({ dependencyFamily: 'models', dependencyId: 'text-model' }), job: downloading },
      { packId: 'pack', dependency: dependency({ dependencyFamily: 'models', dependencyId: 'vision-model' }), job: verifying },
      { packId: 'pack', dependency: dependency({ dependencyFamily: 'runtime', dependencyId: 'server' }), job: failed },
      { packId: 'pack', dependency: repairing, job: null },
    ],
  } as const;

  assert.deepEqual(aggregateNimiFirstRunMaterializationDownloadProgress(projection.dependencies), {
    bytesReceived: 400,
    bytesTotal: 800,
    percent: 50,
    speedBytesPerSec: 100,
    etaSeconds: 4,
  });
  assert.deepEqual(retryableInterruptedNimiFirstRunMaterializationJobs(projection), [failed]);
  assert.deepEqual(repairableNimiFirstRunMaterializationDependencies({
    ...projection,
    status: 'repair_required',
    reason: 'runtime_materialization_repair_required',
  }), [{
    packId: 'pack',
    dependency: repairing,
    job: null,
  }]);
});

test('First-run materialization fails closed when the selected profile dependency family is absent', async () => {
  const runtime = materializationRuntime({
    dependencies: [
      dependency({ dependencyFamily: 'ollama', dependencyId: 'ollama-runtime', state: 'ready_managed' }),
    ],
    jobs: [],
  });

  const projection = await resolveNimiFirstRunMaterializationProjection({
    profile: {
      localComputePackRefs: ['qwen-small'],
      dependencyFamilyRefs: ['missing-family'],
      materializationConfirmationRequired: false,
    },
    runtime,
  });

  assert.equal(projection.status, 'blocked');
  assert.equal(projection.reason, 'missing_dependency_families:missing-family');
  assert.equal(projection.productState, 'blocked');
});

function materializationRuntime(input: {
  readonly dependencies: readonly NimiRuntimeLocalEnvironmentPlanDependency[];
  readonly jobs?: readonly NimiRuntimeLocalEnvironmentDependencyJob[];
  readonly jobsForEnvironment?: (environmentKey: string) => readonly NimiRuntimeLocalEnvironmentDependencyJob[];
  readonly onResolve?: (input: Parameters<NimiFirstRunMaterializationRuntime['resolveEnvironmentPlan']>[0]) => void;
  readonly onStart?: (
    input: Parameters<NimiFirstRunMaterializationRuntime['startEnvironmentDependencyJob']>[0],
    options: Parameters<NimiFirstRunMaterializationRuntime['startEnvironmentDependencyJob']>[1],
  ) => void;
}): NimiFirstRunMaterializationRuntime {
  return {
    async resolveEnvironmentPlan(planInput) {
      input.onResolve?.(planInput);
      return plan({
        packId: planInput.packId,
        consumerScope: planInput.consumerScope,
        runtimeDataRoot: planInput.runtimeDataRoot ?? '',
        dependencies: input.dependencies,
      });
    },
    async listEnvironmentDependencyJobs({ environmentKey }) {
      return input.jobsForEnvironment?.(environmentKey) ?? input.jobs ?? [];
    },
    async startEnvironmentDependencyJob(startInput, options) {
      input.onStart?.(startInput, options);
      return job({
        jobId: 'started',
        dependencyFamily: startInput.dependencyFamily,
        dependencyId: startInput.dependencyId,
        state: 'queued',
      });
    },
    async cancelEnvironmentDependencyJob() {
      return job({ jobId: 'cancelled', state: 'cancelled' });
    },
    async retryEnvironmentDependencyJob() {
      return job({ jobId: 'retrying', state: 'queued' });
    },
    async repairEnvironmentDependency() {
      return job({ jobId: 'repairing', state: 'queued' });
    },
  };
}

function plan(input: {
  readonly packId: string;
  readonly consumerScope: string;
  readonly runtimeDataRoot?: string;
  readonly dependencies: readonly NimiRuntimeLocalEnvironmentPlanDependency[];
}): NimiRuntimeLocalEnvironmentPlan {
  return {
    planId: `${input.packId}:plan`,
    packId: input.packId,
    productLabel: 'Nimi Local AI',
    hostProfileId: 'host',
    platformTuple: 'darwin-arm64',
    runtimeDataRoot: input.runtimeDataRoot ?? '',
    consumerScope: input.consumerScope,
    cloudOnlyImpact: '',
    state: 'planned',
    dependencies: input.dependencies,
  };
}

function dependency(
  overrides: Partial<NimiRuntimeLocalEnvironmentPlanDependency> = {},
): NimiRuntimeLocalEnvironmentPlanDependency {
  return {
    dependencyFamily: overrides.dependencyFamily ?? 'ollama',
    dependencyId: overrides.dependencyId ?? 'ollama-runtime',
    required: overrides.required ?? true,
    state: overrides.state ?? 'needs_confirmation',
    sourceKind: overrides.sourceKind ?? 'managed',
    confirmationRequired: overrides.confirmationRequired ?? true,
    environmentKey: overrides.environmentKey ?? 'env-1',
    selectedSourceRecordId: overrides.selectedSourceRecordId,
    canonicalRoot: overrides.canonicalRoot,
    reasonCode: overrides.reasonCode,
    detail: overrides.detail,
  };
}

function job(
  overrides: Partial<NimiRuntimeLocalEnvironmentDependencyJob> = {},
): NimiRuntimeLocalEnvironmentDependencyJob {
  return {
    jobId: overrides.jobId ?? 'job-1',
    environmentKey: overrides.environmentKey ?? 'env-1',
    dependencyFamily: overrides.dependencyFamily ?? 'ollama',
    dependencyId: overrides.dependencyId ?? 'ollama-runtime',
    state: overrides.state ?? 'queued',
    sourceKind: overrides.sourceKind ?? 'managed',
    canonicalRoot: overrides.canonicalRoot,
    selectedSourceRecordId: overrides.selectedSourceRecordId,
    failureDetail: overrides.failureDetail,
    retryable: overrides.retryable ?? false,
    createdAt: overrides.createdAt ?? '2026-06-05T00:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-06-05T00:01:00.000Z',
    reasonCode: overrides.reasonCode,
    recoveryDisposition: overrides.recoveryDisposition,
    bytesReceived: overrides.bytesReceived ?? 0,
    bytesTotal: overrides.bytesTotal ?? 0,
    percent: overrides.percent ?? 0,
    speedBytesPerSec: overrides.speedBytesPerSec ?? 0,
    etaSeconds: overrides.etaSeconds ?? 0,
  };
}
