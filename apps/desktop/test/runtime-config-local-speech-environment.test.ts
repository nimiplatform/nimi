import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveRuntimeConfigLocalASREnvironmentPlan,
  resolveRuntimeConfigLocalTTSEnvironmentPlan,
} from '../src/shell/renderer/features/runtime-config/runtime-config-local-speech-environment-service.js';

test('local speech environment resolves the selected exact ASR binding through Runtime plan authority', async () => {
  const requests: unknown[] = [];
  const expectedPlan = { planId: 'plan-asr' };

  const plan = await resolveRuntimeConfigLocalASREnvironmentPlan({
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

  assert.equal(plan, expectedPlan);
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

test('local speech environment resolves the selected exact TTS binding through Runtime plan authority', async () => {
  const requests: unknown[] = [];
  const expectedPlan = { planId: 'plan-tts' };

  const plan = await resolveRuntimeConfigLocalTTSEnvironmentPlan({
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

  assert.equal(plan, expectedPlan);
  assert.deepEqual(requests, [{
    packId: 'local-speech',
    consumerScope: 'speech.qwen3-tts.python',
    localAssetId: 'local-tts-1',
    assetId: undefined,
  }]);
});
