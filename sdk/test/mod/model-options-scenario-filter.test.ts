import assert from 'node:assert/strict';
import { test } from 'node:test';

import { filterModelsForScenario } from '../../src/mod/model-options/scenario-filter.js';

test('OpenRouter TTS options do not invent SDK-owned fallback model ids', () => {
  const filtered = filterModelsForScenario(
    ['openai/gpt-4.1', 'openai/gpt-audio-mini'],
    'tts',
    { vendor: 'openrouter' },
  );

  assert.deepEqual(filtered, []);
});

test('OpenRouter TTS options keep only admitted TTS-like connector models', () => {
  const filtered = filterModelsForScenario(
    ['openai/gpt-4.1', 'openai/tts-1', 'openai/gpt-4o-mini-tts'],
    'tts',
    { vendor: 'openrouter' },
  );

  assert.deepEqual(filtered, ['openai/tts-1', 'openai/gpt-4o-mini-tts']);
});
