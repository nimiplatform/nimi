import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  NimiRuntimeLocalEnvironmentDependencyJob,
  NimiRuntimeLocalEnvironmentPlan,
  NimiRuntimeLocalEnvironmentPlanDependency,
} from '@nimiplatform/sdk/runtime';

import {
  resolveRuntimeConfigLocalASREnvironmentPlan,
  resolveRuntimeConfigLocalTTSEnvironmentPlan,
} from '../src/shell/renderer/features/runtime-config/runtime-config-local-speech-environment-service.js';
import {
  canSubmitRuntimeConfigLocalSpeechEnvironmentPlan,
  resolveRuntimeConfigLocalSpeechConfirmationProjection,
  submitRuntimeConfigLocalSpeechEnvironmentPlan,
} from '../src/shell/renderer/features/runtime-config/runtime-config-local-speech-environment-panel.js';

function environmentDependency(input: Partial<NimiRuntimeLocalEnvironmentPlanDependency> & {
  readonly dependencyFamily: string;
  readonly state: string;
}): NimiRuntimeLocalEnvironmentPlanDependency {
  return {
    dependencyFamily: input.dependencyFamily,
    dependencyId: input.dependencyId || `${input.dependencyFamily}.id`,
    consumerScope: input.consumerScope || 'speech.qwen3-tts.python',
    required: input.required ?? true,
    state: input.state,
    sourceKind: input.sourceKind || 'managed',
    confirmationRequired: input.confirmationRequired ?? input.state === 'needs_confirmation',
    selectedSourceRecordId: input.selectedSourceRecordId,
    environmentKey: input.environmentKey || `${input.dependencyFamily}.environment`,
    canonicalRoot: input.canonicalRoot,
    reasonCode: input.reasonCode,
    detail: input.detail,
  };
}

function environmentPlan(
  dependencies: readonly NimiRuntimeLocalEnvironmentPlanDependency[],
): NimiRuntimeLocalEnvironmentPlan {
  return {
    planId: 'plan-tts',
    packId: 'local-speech',
    productLabel: 'Local speech',
    hostProfileId: 'host-profile',
    platformTuple: 'windows-x86_64-cuda',
    runtimeDataRoot: 'D:\\DataNimi',
    consumerScope: 'speech.qwen3-tts.python',
    cloudOnlyImpact: '',
    state: 'needs_confirmation',
    dependencies,
    requiredDependencyFamilies: [...new Set(dependencies.filter((dependency) => dependency.required).map((dependency) => dependency.dependencyFamily))],
    aggregateSizeKnown: false,
    aggregateSizeBytes: 0,
    storageCategories: ['dependencies', 'environments'],
    sourceOwners: ['RuntimeLocalService'],
    noSystemMutation: true,
  };
}

function dependencyJob(input: {
  readonly dependency: NimiRuntimeLocalEnvironmentPlanDependency;
  readonly state: string;
  readonly jobId?: string;
  readonly updatedAt?: string;
  readonly retryable?: boolean;
  readonly recoveryDisposition?: string;
}): NimiRuntimeLocalEnvironmentDependencyJob {
	const retryable = input.retryable ?? input.state === 'failed';
  return {
    jobId: input.jobId || `${input.dependency.dependencyFamily}.job`,
    environmentKey: input.dependency.environmentKey,
    dependencyFamily: input.dependency.dependencyFamily,
    dependencyId: input.dependency.dependencyId,
    consumerScope: input.dependency.consumerScope,
    state: input.state,
    sourceKind: input.dependency.sourceKind,
    retryable,
    recoveryDisposition: input.recoveryDisposition || (retryable ? 'manual_retry' : 'not_retryable'),
    createdAt: '2026-08-10T00:00:00.000Z',
    updatedAt: input.updatedAt || '2026-08-10T00:00:00.000Z',
    bytesReceived: 0,
    bytesTotal: 0,
    percent: 0,
    speedBytesPerSec: 0,
    etaSeconds: 0,
  };
}

test('local speech environment resolves the selected exact ASR binding through Runtime plan authority', async () => {
  const requests: unknown[] = [];
  const expectedPlan = { planId: 'plan-asr' };

  const result = await resolveRuntimeConfigLocalASREnvironmentPlan({
    machineConfiguration: {
      async get() {
        return {
          selections: [{
            capabilityContract: 'audio.transcribe',
            configurationId: 'asr-config',
            effectiveDefaults: null,
          }],
          configurations: [{
            configurationId: 'asr-config',
            capabilityContract: 'audio.transcribe',
            implementation: {
              implementationId: 'local.audio.transcribe.qwen3-asr',
              driverId: 'nimi.runtime.driver.qwen3-asr',
              driverDialect: 'qwen3-asr/audio-transcribe/v1',
            },
            projectedRequirements: [],
            exactBindings: [{
              requirementId: 'stt.model',
              localAssetId: 'local-asr-1',
              verifiedContentId: 'nimi/stt-qwen3-asr',
              entrySha256: 'asr-sha',
            }],
            supportedFeatures: [],
            interpretability: 'interpretable',
            requirementResolution: 'configured',
            reasons: [],
            displayName: 'Qwen3 ASR',
          }],
        };
      },
    },
    localEnvironment: {
      async resolveEnvironmentPlan(request) {
        requests.push(request);
        return expectedPlan as never;
      },
    },
  });

  assert.equal(result.plan, expectedPlan);
  assert.deepEqual(result.resolution, {
    packId: 'local-speech',
    consumerScope: 'speech.qwen3-asr.python',
    localAssetId: 'local-asr-1',
    assetId: undefined,
  });
  assert.deepEqual(requests, [{
    packId: 'local-speech',
    consumerScope: 'speech.qwen3-asr.python',
    localAssetId: 'local-asr-1',
    assetId: undefined,
  }]);
});

test('local speech environment fails closed without one exact selected ASR binding', async () => {
  await assert.rejects(
    resolveRuntimeConfigLocalASREnvironmentPlan({
      machineConfiguration: {
        async get() {
          return { configurations: [], selections: [] };
        },
      },
      localEnvironment: {
        async resolveEnvironmentPlan() {
          throw new Error('must not resolve without exact selection');
        },
      },
    }),
    /LOCAL_ASR_SELECTION_NOT_FOUND/u,
  );
});

test('local speech environment resolves the explicit Transformers-native ASR selection separately', async () => {
  const requests: unknown[] = [];
  const expectedPlan = { planId: 'plan-asr-transformers' };

  const result = await resolveRuntimeConfigLocalASREnvironmentPlan({
    machineConfiguration: {
      async get() {
        return {
          selections: [{
            capabilityContract: 'audio.transcribe',
            configurationId: 'asr-transformers-config',
            effectiveDefaults: null,
          }],
          configurations: [{
            configurationId: 'asr-transformers-config',
            capabilityContract: 'audio.transcribe',
            implementation: {
              implementationId: 'local.audio.transcribe.qwen3-asr-transformers',
              driverId: 'nimi.runtime.driver.qwen3-asr-transformers',
              driverDialect: 'qwen3-asr-transformers/audio-transcribe/v1',
            },
            projectedRequirements: [],
            exactBindings: [{
              requirementId: 'stt.model',
              localAssetId: 'local-asr-transformers-1',
              verifiedContentId: 'nimi/stt-qwen3-asr-transformers',
              entrySha256: 'asr-transformers-sha',
            }],
            supportedFeatures: [],
            interpretability: 'interpretable',
            requirementResolution: 'configured',
            reasons: [],
            displayName: 'Qwen3 ASR Transformers',
          }],
        };
      },
    },
    localEnvironment: {
      async resolveEnvironmentPlan(request) {
        requests.push(request);
        return expectedPlan as never;
      },
    },
  });

  assert.equal(result.plan, expectedPlan);
  assert.deepEqual(result.resolution, {
    packId: 'local-speech',
    consumerScope: 'speech.qwen3-asr-transformers.python',
    localAssetId: 'local-asr-transformers-1',
    assetId: undefined,
  });
  assert.deepEqual(requests, [{
    packId: 'local-speech',
    consumerScope: 'speech.qwen3-asr-transformers.python',
    localAssetId: 'local-asr-transformers-1',
    assetId: undefined,
  }]);
});

test('local speech environment resolves the selected exact TTS binding through Runtime plan authority', async () => {
  const requests: unknown[] = [];
  const expectedPlan = { planId: 'plan-tts' };

  const result = await resolveRuntimeConfigLocalTTSEnvironmentPlan({
    machineConfiguration: {
      async get() {
        return {
          selections: [{
            capabilityContract: 'audio.synthesize',
            configurationId: 'tts-config',
            effectiveDefaults: null,
          }],
          configurations: [{
            configurationId: 'tts-config',
            capabilityContract: 'audio.synthesize',
            implementation: {
              implementationId: 'local.audio.synthesize.qwen3-tts',
              driverId: 'nimi.runtime.driver.qwen3-tts',
              driverDialect: 'qwen3-tts/audio-synthesize/v1',
            },
            projectedRequirements: [],
            exactBindings: [{
              requirementId: 'tts.model',
              localAssetId: 'local-tts-1',
              verifiedContentId: 'nimi/tts-qwen3-customvoice',
              entrySha256: 'tts-sha',
            }],
            supportedFeatures: [],
            interpretability: 'interpretable',
            requirementResolution: 'configured',
            reasons: [],
            displayName: 'Qwen3 TTS',
          }],
        };
      },
    },
    localEnvironment: {
      async resolveEnvironmentPlan(request) {
        requests.push(request);
        return expectedPlan as never;
      },
    },
  });

  assert.equal(result.plan, expectedPlan);
  assert.deepEqual(result.resolution, {
    packId: 'local-speech',
    consumerScope: 'speech.qwen3-tts.python',
    localAssetId: 'local-tts-1',
    assetId: undefined,
  });
  assert.deepEqual(requests, [{
    packId: 'local-speech',
    consumerScope: 'speech.qwen3-tts.python',
    localAssetId: 'local-tts-1',
    assetId: undefined,
  }]);
});

test('local speech environment resolves the selected exact VoxCPM binding through its package set', async () => {
  const requests: unknown[] = [];
  const expectedPlan = { planId: 'plan-voxcpm' };

  const result = await resolveRuntimeConfigLocalTTSEnvironmentPlan({
    machineConfiguration: {
      async get() {
        return {
          selections: [{
            capabilityContract: 'audio.synthesize',
            configurationId: 'voxcpm-config',
            effectiveDefaults: null,
          }],
          configurations: [{
            configurationId: 'voxcpm-config',
            capabilityContract: 'audio.synthesize',
            implementation: {
              implementationId: 'local.audio.synthesize.voxcpm',
              driverId: 'nimi.runtime.driver.voxcpm',
              driverDialect: 'voxcpm/audio-synthesize/v1',
            },
            projectedRequirements: [],
            exactBindings: [{
              requirementId: 'tts.model',
              localAssetId: 'local-voxcpm-1',
              verifiedContentId: 'sha256:voxcpm',
              entrySha256: 'voxcpm-sha',
            }],
            supportedFeatures: [],
            interpretability: 'interpretable',
            requirementResolution: 'configured',
            reasons: [],
            displayName: 'VoxCPM 2',
          }],
        };
      },
    },
    localEnvironment: {
      async resolveEnvironmentPlan(request) {
        requests.push(request);
        return expectedPlan as never;
      },
    },
  });

  assert.equal(result.plan, expectedPlan);
  assert.deepEqual(result.resolution, {
    packId: 'local-speech',
    consumerScope: 'speech.voxcpm.python',
    localAssetId: 'local-voxcpm-1',
    assetId: undefined,
  });
  assert.deepEqual(requests, [result.resolution]);
});

test('local speech capability setup leaves mixed repair, retry, and start admission to Runtime', () => {
  const runtime = environmentDependency({ dependencyFamily: 'python-runtime', state: 'repair_required' });
  const profile = environmentDependency({ dependencyFamily: 'python-profile', state: 'failed' });
  const torch = environmentDependency({ dependencyFamily: 'python-torch-wheel', state: 'missing' });
  const failedProfileJob = dependencyJob({ dependency: profile, state: 'failed' });
  const activeTorchJob = dependencyJob({ dependency: torch, state: 'installing' });

  assert.equal(canSubmitRuntimeConfigLocalSpeechEnvironmentPlan(
    environmentPlan([runtime, profile, torch]),
    [failedProfileJob, activeTorchJob],
  ), true);
});

test('local speech plan apply visibility binds active jobs to the exact consumer', () => {
  const tts = environmentDependency({
    dependencyFamily: 'python-runtime',
    dependencyId: 'python-3.12.13-cp312',
    environmentKey: 'shared-python-runtime',
    state: 'installing',
  });
  const asr = environmentDependency({
    ...tts,
    consumerScope: 'speech.qwen3-asr.python',
  });
  const asrJob = dependencyJob({ dependency: asr, state: 'installing', jobId: 'asr-job', updatedAt: '2026-08-10T00:02:00.000Z' });
  const ttsJob = dependencyJob({ dependency: tts, state: 'installing', jobId: 'tts-job', updatedAt: '2026-08-10T00:01:00.000Z' });

  assert.equal(canSubmitRuntimeConfigLocalSpeechEnvironmentPlan(environmentPlan([tts]), [asrJob]), true);
  assert.equal(canSubmitRuntimeConfigLocalSpeechEnvironmentPlan(environmentPlan([tts]), [asrJob, ttsJob]), false);
});

test('local speech plan apply follows current missing state over a historical non-retryable job', () => {
  const dependency = environmentDependency({
    dependencyFamily: 'python-torch-wheel',
    state: 'missing',
  });
  const historicalJob = dependencyJob({
    dependency,
    state: 'failed',
    retryable: false,
    recoveryDisposition: 'not_retryable',
  });

  assert.equal(canSubmitRuntimeConfigLocalSpeechEnvironmentPlan(
    environmentPlan([dependency]),
    [historicalJob],
  ), true);
});

test('local speech confirmation consumes only Runtime-owned plan facts', () => {
  const ready = environmentDependency({ dependencyFamily: 'python-runtime', state: 'ready_managed', sourceKind: 'managed' });
  const missing = environmentDependency({ dependencyFamily: 'model.asset', state: 'needs_confirmation', sourceKind: 'imported' });
  const optional = environmentDependency({ dependencyFamily: 'optional-diagnostic', state: 'missing', sourceKind: 'unavailable', required: false });

  const plan = {
    ...environmentPlan([ready, missing, optional]),
    requiredDependencyFamilies: ['python.runtime', 'model.asset'],
    aggregateSizeKnown: false,
    aggregateSizeBytes: 0,
    storageCategories: ['environments', 'models'],
    sourceOwners: ['RuntimeLocalService'],
    noSystemMutation: true,
  };
  assert.deepEqual(resolveRuntimeConfigLocalSpeechConfirmationProjection(plan), {
    families: 'python.runtime, model.asset',
    aggregateSizeKnown: false,
    aggregateSizeBytes: 0,
    storageCategories: 'environments, models',
    sourceOwners: 'RuntimeLocalService',
    noSystemMutation: true,
  });
});

test('local speech setup fails closed on an incomplete Runtime-owned confirmation projection', () => {
  const dependency = environmentDependency({ dependencyFamily: 'python-runtime', state: 'needs_confirmation' });
  const plan = environmentPlan([dependency]);
  const incompletePlans: readonly NimiRuntimeLocalEnvironmentPlan[] = [
    { ...plan, requiredDependencyFamilies: [] },
    { ...plan, requiredDependencyFamilies: ['different.required.family'] },
    { ...plan, storageCategories: [] },
    { ...plan, sourceOwners: [] },
    { ...plan, noSystemMutation: false },
  ];

  for (const incomplete of incompletePlans) {
    assert.equal(canSubmitRuntimeConfigLocalSpeechEnvironmentPlan(incomplete, []), false);
  }
});

test('one confirmed local speech capability action submits one Runtime-owned complete plan', async () => {
  const plan = environmentPlan([
    environmentDependency({ dependencyFamily: 'python-runtime', state: 'repair_required' }),
    environmentDependency({ dependencyFamily: 'python-profile', state: 'failed' }),
    environmentDependency({ dependencyFamily: 'python-torch-wheel', state: 'missing' }),
  ]);
  const resolution = {
    packId: 'local-speech',
    consumerScope: 'speech.qwen3-tts.python',
    localAssetId: 'local-tts-1',
  } as const;
  const calls: unknown[] = [];

  await submitRuntimeConfigLocalSpeechEnvironmentPlan({
    async applyEnvironmentPlan(input, options) {
      calls.push([input, options]);
      return { plan, jobs: [] };
    },
  }, resolution, plan);

  assert.deepEqual(calls, [[{
    resolution,
    expectedPlanId: plan.planId,
    confirmed: true,
  }, { caller: 'core' }]]);
});
