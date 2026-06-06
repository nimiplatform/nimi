import assert from 'node:assert/strict';
import { test } from 'node:test';

import { assertNoLegacyLocalModelPrefix } from '../../src/ai-provider/model-factory-shared.js';

test('assertNoLegacyLocalModelPrefix rejects legacy local prefixes', () => {
  const legacyModelIds = [
    'localai/model',
    'nexa/model',
    'nimi_media/model',
    'media.diffusers/model',
    'localsidecar/model',
  ];

  for (const modelId of legacyModelIds) {
    assert.throws(
      () => assertNoLegacyLocalModelPrefix(modelId),
      (error: unknown) => {
        assert.match(String((error as { message?: string })?.message || ''), /legacy local model prefix/);
        assert.equal((error as { reasonCode?: string }).reasonCode, 'SDK_AI_PROVIDER_CONFIG_INVALID');
        return true;
      },
      `expected ${modelId} to be rejected`,
    );
  }
});

test('assertNoLegacyLocalModelPrefix accepts engine-first local prefixes', () => {
  const acceptedModelIds = [
    'local/model',
    'llama/model',
    'media/model',
    'speech/model',
    'sidecar/model',
  ];

  for (const modelId of acceptedModelIds) {
    assert.doesNotThrow(
      () => assertNoLegacyLocalModelPrefix(modelId),
      `expected ${modelId} to be accepted`,
    );
  }
});

test('assertNoLegacyLocalModelPrefix accepts non-legacy edge cases', () => {
  const acceptedModelIds = [
    '',
    'modelname',
    'cloud/model',
  ];

  for (const modelId of acceptedModelIds) {
    assert.doesNotThrow(
      () => assertNoLegacyLocalModelPrefix(modelId),
      `expected ${modelId} to be accepted`,
    );
  }
});
