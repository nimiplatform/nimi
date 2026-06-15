import assert from 'node:assert/strict';
import test from 'node:test';

import {
  NIMI_FIRST_RUN_MATERIALIZATION_CONSUMER_SCOPE,
  aggregateNimiFirstRunMaterializationDownloadProgress,
  repairableNimiFirstRunMaterializationDependencies,
  repairNimiFirstRunMaterializationDependency,
  resolveNimiFirstRunMaterializationProjection,
  retryableInterruptedNimiFirstRunMaterializationJobs,
  retryNimiFirstRunMaterializationJob,
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
      consumerScope: 'first-run',
    },
    options: { caller: 'core' },
  }]);
  assert.equal(projection.status, 'in_progress');
  assert.equal(projection.reason, 'runtime_materialization_jobs_started');
  assert.equal(projection.productState, 'local_ai_profile_selected_assets_missing');
});

test('First-run materialization repairs dependencies with the first-run consumer scope', async () => {
  const repairCalls: unknown[] = [];
  const targetDependency = dependency({
    dependencyFamily: 'ollama',
    dependencyId: 'ollama-runtime',
    state: 'repair_required',
    reasonCode: 'runtime_asset_missing',
  });
  const runtime = materializationRuntime({
    dependencies: [targetDependency],
    jobs: [],
    onRepair(input, options) {
      repairCalls.push({ input, options });
    },
  });

  await repairNimiFirstRunMaterializationDependency({
    profile: {
      localComputePackRefs: ['qwen-small'],
      dependencyFamilyRefs: ['ollama'],
      materializationConfirmationRequired: true,
    },
    runtime,
    dependency: targetDependency,
    confirmed: true,
    reasonCode: 'runtime_asset_missing',
  });

  assert.deepEqual(repairCalls, [{
    input: {
      environmentKey: 'env-1',
      dependencyFamily: 'ollama',
      dependencyId: 'ollama-runtime',
      confirmed: true,
      reasonCode: 'runtime_asset_missing',
      consumerScope: 'first-run',
    },
    options: { caller: 'core' },
  }]);
});

test('First-run materialization retry starts missing prerequisites before retrying failed jobs', async () => {
  const startCalls: unknown[] = [];
  const retryCalls: unknown[] = [];
  const failedJob = job({
    jobId: 'failed-venv',
    dependencyFamily: 'python.venv',
    dependencyId: 'local-speech-qwen3-asr.venv',
    consumerScope: 'speech.qwen3-asr.python',
    state: 'failed',
    retryable: true,
  });
  const runtime = materializationRuntime({
    dependencies: [
      dependency({
        dependencyFamily: 'python.tool.uv',
        dependencyId: 'uv',
        consumerScope: 'speech.qwen3-asr.python',
        state: 'needs_confirmation',
      }),
      dependency({
        dependencyFamily: 'python.venv',
        dependencyId: 'local-speech-qwen3-asr.venv',
        consumerScope: 'speech.qwen3-asr.python',
        state: 'failed',
      }),
    ],
    jobs: [failedJob],
    onStart(input, options) {
      startCalls.push({ input, options });
    },
    onRetry(input, options) {
      retryCalls.push({ input, options });
    },
  });

  await retryNimiFirstRunMaterializationJob({
    profile: {
      localComputePackRefs: ['local-speech'],
      dependencyFamilyRefs: ['python.tool.uv', 'python.venv'],
      materializationConfirmationRequired: true,
    },
    runtime,
    jobId: 'failed-venv',
    confirmed: true,
  });

  assert.deepEqual(startCalls, [{
    input: {
      environmentKey: 'env-1',
      dependencyFamily: 'python.tool.uv',
      dependencyId: 'uv',
      sourceKind: 'managed',
      confirmed: true,
      consumerScope: 'speech.qwen3-asr.python',
    },
    options: { caller: 'core' },
  }]);
  assert.deepEqual(retryCalls, [{
    input: {
      jobId: 'failed-venv',
      confirmed: true,
    },
    options: { caller: 'core' },
  }]);
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
  const manualRetryFailed = job({
    jobId: 'manual-retry-failed',
    dependencyFamily: 'runtime',
    dependencyId: 'server-config',
    state: 'failed',
    retryable: true,
    recoveryDisposition: 'manual_retry',
  });
  const repairing = dependency({
    dependencyFamily: 'driver',
    dependencyId: 'gpu-driver',
    state: 'repair_required',
    selectedSourceRecordId: 'source-driver',
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
      { packId: 'pack', dependency: dependency({ dependencyFamily: 'runtime', dependencyId: 'server-config' }), job: manualRetryFailed },
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
  assert.deepEqual(retryableInterruptedNimiFirstRunMaterializationJobs(projection), [failed, manualRetryFailed]);
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

test('First-run materialization does not repair dependencies without a selected source', () => {
  const unselectedRepairRequired = dependency({
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
      { packId: 'pack', dependency: unselectedRepairRequired, job: null },
    ],
  } as const;

  assert.deepEqual(repairableNimiFirstRunMaterializationDependencies({
    ...projection,
    status: 'repair_required',
    reason: 'runtime_materialization_repair_required',
  }), []);
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
  readonly onRepair?: (
    input: Parameters<NimiFirstRunMaterializationRuntime['repairEnvironmentDependency']>[0],
    options: Parameters<NimiFirstRunMaterializationRuntime['repairEnvironmentDependency']>[1],
  ) => void;
  readonly onRetry?: (
    input: Parameters<NimiFirstRunMaterializationRuntime['retryEnvironmentDependencyJob']>[0],
    options: Parameters<NimiFirstRunMaterializationRuntime['retryEnvironmentDependencyJob']>[1],
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
    async retryEnvironmentDependencyJob(retryInput, options) {
      input.onRetry?.(retryInput, options);
      return job({ jobId: 'retrying', state: 'queued' });
    },
    async repairEnvironmentDependency(repairInput, options) {
      input.onRepair?.(repairInput, options);
      return job({
        jobId: 'repairing',
        dependencyFamily: repairInput.dependencyFamily,
        dependencyId: repairInput.dependencyId,
        consumerScope: repairInput.consumerScope,
        state: 'queued',
      });
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
    consumerScope: overrides.consumerScope ?? NIMI_FIRST_RUN_MATERIALIZATION_CONSUMER_SCOPE,
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
    consumerScope: overrides.consumerScope ?? NIMI_FIRST_RUN_MATERIALIZATION_CONSUMER_SCOPE,
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
