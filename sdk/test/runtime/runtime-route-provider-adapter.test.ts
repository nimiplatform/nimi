import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_LOCAL_PROVIDER_ADAPTER_ID,
  isLocalProviderAdapterId,
  LOCAL_PROVIDER_ADAPTER_IDS,
  normalizeLocalProviderAdapterId,
} from '../../src/runtime/index.js';

test('local provider adapter ids are normalized by SDK projection', () => {
  assert.deepEqual(LOCAL_PROVIDER_ADAPTER_IDS, [
    'openai_compat_adapter',
    'llama_native_adapter',
    'media_native_adapter',
    'speech_native_adapter',
    'sidecar_music_adapter',
  ]);
  assert.equal(DEFAULT_LOCAL_PROVIDER_ADAPTER_ID, 'openai_compat_adapter');
  assert.equal(isLocalProviderAdapterId('llama_native_adapter'), true);
  assert.equal(isLocalProviderAdapterId('unknown_adapter'), false);
  assert.equal(normalizeLocalProviderAdapterId(' MEDIA_NATIVE_ADAPTER '), 'media_native_adapter');
  assert.equal(normalizeLocalProviderAdapterId('unknown_adapter'), undefined);
  assert.equal(
    normalizeLocalProviderAdapterId('unknown_adapter', DEFAULT_LOCAL_PROVIDER_ADAPTER_ID),
    DEFAULT_LOCAL_PROVIDER_ADAPTER_ID,
  );
});
