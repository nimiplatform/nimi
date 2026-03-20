import assert from 'node:assert/strict';
import test from 'node:test';

import { extractEmbeddingVectors, extractGenerateText, extractSpeechTranscription } from '../../src/runtime/helpers.js';
import { ReasonCode } from '../../src/types/index.js';
import { speechTranscribeOutput, textEmbedOutput, textGenerateOutput } from '../helpers/runtime-ai-shapes.js';

test('extractGenerateText reads typed scenario text output', () => {
  const output = textGenerateOutput('hello from runtime');

  assert.equal(extractGenerateText(output), 'hello from runtime');
});

test('extractGenerateText returns empty string for missing or mismatched output kind', () => {
  assert.equal(extractGenerateText(undefined), '');
  assert.equal(extractGenerateText(textEmbedOutput([[1, 2]])), '');
});

test('extractEmbeddingVectors reads typed scenario embedding output', () => {
  const output = textEmbedOutput([[1, 2.5], [3, 4]]);

  assert.deepEqual(extractEmbeddingVectors(output), [[1, 2.5], [3, 4]]);
});

test('extractEmbeddingVectors tolerates missing or mismatched output kind', () => {
  assert.deepEqual(extractEmbeddingVectors(undefined), []);
  assert.deepEqual(extractEmbeddingVectors(textGenerateOutput('nope')), []);
  assert.deepEqual(extractEmbeddingVectors(textEmbedOutput([[1, Number.NaN, 2]])), [[1, 2]]);
});

test('extractSpeechTranscription reads typed scenario speech transcription output', () => {
  const output = speechTranscribeOutput('hello from runtime');

  assert.deepEqual(extractSpeechTranscription(output), {
    text: 'hello from runtime',
    artifacts: output.output.oneofKind === 'speechTranscribe' ? output.output.speechTranscribe.artifacts : [],
  });
});

test('extractSpeechTranscription fails closed for missing or mismatched output kind', () => {
  assert.throws(
    () => extractSpeechTranscription(undefined),
    (error: Error & { reasonCode?: string }) => {
      assert.equal(error.reasonCode, ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED);
      return true;
    },
  );
  assert.throws(
    () => extractSpeechTranscription(textGenerateOutput('nope')),
    (error: Error & { reasonCode?: string }) => {
      assert.equal(error.reasonCode, ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED);
      return true;
    },
  );
});
