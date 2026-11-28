import assert from 'node:assert/strict';
import test from 'node:test';

import { ScenarioOutput, SpeechDiarizationStatus, SpeechTranscriptStatus } from '../../core-generated/runtime-protobuf/runtime/v1/ai.js';
import {
  extractNimiRuntimeSpeechTranscriptionOutput,
  buildNimiRuntimeScenarioJobHead,
  buildNimiRuntimeScenarioJobIdentity,
} from './index';
test('transcription extraction preserves source-local speaker intervals through the generation feature', () => {
  const intervals = [{ speakerId: 'a', startSeconds: 0, endSeconds: 1 }, { speakerId: 'b', startSeconds: 1, endSeconds: 2 }];
  const output = ScenarioOutput.create({ output: { oneofKind: 'speechTranscribe', speechTranscribe: {
    text: 'hello', transcription: { status: SpeechTranscriptStatus.TRANSCRIBED, text: 'hello', language: 'en', words: [],
      diarization: { status: SpeechDiarizationStatus.DIARIZED, durationSeconds: 2, intervals } },
  } } });
  assert.deepEqual(extractNimiRuntimeSpeechTranscriptionOutput(output).transcription?.diarization,
    { status: 'diarized', durationSeconds: 2, intervals });
});

test('scenario job identity is stable-prefixed and unique per call', () => {
  const first = buildNimiRuntimeScenarioJobIdentity({
    appId: 'acme.widget',
    capabilityId: 'image.generate',
    scenarioId: 'portrait mode',
  });
  const second = buildNimiRuntimeScenarioJobIdentity({
    appId: 'acme.widget',
    capabilityId: 'image.generate',
    scenarioId: 'portrait mode',
  });

  assert.match(first.idempotencyKey, /^acme-widget_image-generate_portrait-mode_/);
  assert.match(first.idempotencyKey, /^[A-Za-z0-9_-]{1,128}$/);
  assert.equal(first.requestId, first.idempotencyKey);
  assert.notEqual(first.idempotencyKey, second.idempotencyKey);
});

test('scenario job head carries identity and a zero withdrawn wire slot', () => {
  assert.deepEqual(buildNimiRuntimeScenarioJobHead({
    appId: 'acme.widget',
    subjectUserId: 'user-1',
  }), {
    appId: 'acme.widget',
    subjectUserId: 'user-1',
    timeoutMs: 0,
  });
});

test('scenario job head fails closed for invalid timeout', () => {
  assert.throws(
    () => buildNimiRuntimeScenarioJobHead({ appId: 'acme.widget', timeoutMs: 0 } as never),
    /business timeout/u,
  );
});
