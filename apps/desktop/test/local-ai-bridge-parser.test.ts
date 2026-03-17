import assert from 'node:assert/strict';
import test from 'node:test';

import { parseLocalRuntimeModelRecord } from '../src/shell/renderer/bridge/runtime-bridge/local-ai-parsers.js';

test('parseLocalRuntimeModelRecord keeps model recommendation inputs in bridge surface', () => {
  const parsed = parseLocalRuntimeModelRecord({
    localModelId: 'local-z-image',
    modelId: 'local/z_image_turbo',
    capabilities: ['image'],
    engine: 'localai',
    entry: 'z_image_turbo-Q4_K.gguf',
    files: ['z_image_turbo-Q4_K.gguf'],
    license: 'apache-2.0',
    source: {
      repo: 'Tongyi-MAI/Z-Image',
      revision: 'main',
    },
    hashes: {
      'z_image_turbo-Q4_K.gguf': 'sha256:abc',
    },
    tags: ['image', 'z-image'],
    knownTotalSizeBytes: 2048,
    endpoint: 'http://127.0.0.1:1234/v1',
    status: 'installed',
    installedAt: '2026-03-08T00:00:00Z',
    updatedAt: '2026-03-08T00:00:00Z',
  });

  assert.deepEqual(parsed.files, ['z_image_turbo-Q4_K.gguf']);
  assert.deepEqual(parsed.tags, ['image', 'z-image']);
  assert.equal(parsed.knownTotalSizeBytes, 2048);
});
