import assert from 'node:assert/strict';
import test from 'node:test';

import { coerceNimiAITextGenerationParams } from './text-generation-params';

test('text.generate defaults coercion remains contract-only', () => {
  assert.deepEqual(coerceNimiAITextGenerationParams({
    temperature: '0.2',
    topP: 0.9,
    topK: '40',
    maxTokens: 128,
    stopSequences: [' END ', ''],
    timeoutMs: '5000',
  }), {
    ok: true,
    value: {
      parameters: {
        temperature: 0.2,
        topP: 0.9,
        topK: 40,
        maxTokens: 128,
        stop: ['END'],
      },
      timeoutMs: 5000,
    },
  });
});

test('text.generate defaults coercion rejects invalid standardized values', () => {
  assert.deepEqual(coerceNimiAITextGenerationParams({ maxTokens: '1.5' }), {
    ok: false,
    field: 'maxTokens',
    message: 'AIConfig defaults.maxTokens must be a positive integer.',
  });
  assert.deepEqual(coerceNimiAITextGenerationParams({ temperature: 'hot' }), {
    ok: false,
    field: 'temperature',
    message: 'AIConfig defaults.temperature must be a finite number.',
  });
  assert.deepEqual(coerceNimiAITextGenerationParams({ stopSequences: 'END' }), {
    ok: false,
    field: 'stopSequences',
    message: 'AIConfig defaults.stopSequences must be a string array.',
  });
});
