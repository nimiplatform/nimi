import assert from 'node:assert/strict';
import test from 'node:test';

import { createSpeechModelImpl } from '../../src/ai-provider/model-factory-speech.js';
import { createTranscriptionModelImpl } from '../../src/ai-provider/model-factory-transcription.js';
import { createVideoModelImpl } from '../../src/ai-provider/model-factory-video.js';
import { toProtoStruct } from '../../src/ai-provider/helpers.js';
import type { RuntimeDefaults, RuntimeForAiProvider } from '../../src/ai-provider/types.js';
import { ReasonCode } from '../../src/types/index.js';

const DEFAULTS: RuntimeDefaults = {
  appId: 'nimi.ai.provider.validation.test',
  routePolicy: 'cloud',
  timeoutMs: 1_000,
};

const runtime = {
  ai: {
    submitScenarioJob: async () => {
      throw new Error('submitScenarioJob should not be called in validation tests');
    },
    getScenarioJob: async () => {
      throw new Error('getScenarioJob should not be called in validation tests');
    },
    cancelScenarioJob: async () => ({ canceled: true }),
    getScenarioArtifacts: async () => ({ artifacts: [] }),
    executeScenario: async () => {
      throw new Error('executeScenario should not be called in validation tests');
    },
    streamScenario: async () => {
      throw new Error('streamScenario should not be called in validation tests');
    },
    subscribeScenarioJobEvents: async () => {
      throw new Error('subscribeScenarioJobEvents should not be called in validation tests');
    },
  },
} as RuntimeForAiProvider;

test('speech synthesis requires non-empty text input', async () => {
  const speech = createSpeechModelImpl(runtime, DEFAULTS, 'speech-model');
  await assert.rejects(
    () => speech.synthesize({ text: '   ' }),
    (error: Error & { reasonCode?: string }) => {
      assert.equal(error.reasonCode, ReasonCode.SDK_AI_PROVIDER_CONFIG_INVALID);
      return true;
    },
  );
});

test('transcription rejects unsafe audio URLs before dispatch', async () => {
  const transcription = createTranscriptionModelImpl(runtime, DEFAULTS, 'stt-model');
  await assert.rejects(
    () => transcription.transcribe({
      mimeType: 'audio/wav',
      audioUrl: 'https://127.0.0.1/private.wav',
    }),
    (error: Error & { reasonCode?: string }) => {
      assert.equal(error.reasonCode, ReasonCode.AI_INPUT_INVALID);
      return true;
    },
  );
});

test('video generation requires prompt in text-to-video mode', async () => {
  const video = createVideoModelImpl(runtime, DEFAULTS, 'video-model');
  await assert.rejects(
    () => video.generate({
      mode: 't2v',
      prompt: '   ',
      content: [],
    }),
    (error: Error & { reasonCode?: string }) => {
      assert.equal(error.reasonCode, ReasonCode.SDK_AI_PROVIDER_CONFIG_INVALID);
      return true;
    },
  );
});

test('video generation rejects unsafe image URLs before dispatch', async () => {
  const video = createVideoModelImpl(runtime, DEFAULTS, 'video-model');
  await assert.rejects(
    () => video.generate({
      mode: 'i2v-first-frame',
      content: [{ type: 'image_url', role: 'first_frame', imageUrl: 'https://localhost/frame.png' }],
    }),
    (error: Error & { reasonCode?: string }) => {
      assert.equal(error.reasonCode, ReasonCode.AI_INPUT_INVALID);
      return true;
    },
  );
});

test('toProtoStruct fails closed on non-JSON-safe inputs', () => {
  assert.throws(
    () => toProtoStruct({ bad: () => 'nope' } as never),
    (error: Error & { reasonCode?: string }) => {
      assert.equal(error.reasonCode, ReasonCode.SDK_AI_PROVIDER_CONFIG_INVALID);
      return true;
    },
  );
});
