import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseLocalRuntimeAssetRecord,
  parseLocalRuntimeAssetsHealthResult,
} from '../src/shell/renderer/bridge/runtime-bridge/local-ai-parsers.js';

test('parseLocalRuntimeAssetRecord requires hard-cut asset fields in bridge surface', () => {
  const parsed = parseLocalRuntimeAssetRecord({
    localAssetId: 'local-z-image',
    assetId: 'local/z_image_turbo',
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
    reasonCode: 'AI_LOCAL_SPEECH_CAPABILITY_DOWNLOAD_FAILED',
  });

  assert.deepEqual(parsed.files, ['z_image_turbo-Q4_K.gguf']);
  assert.equal(parsed.reasonCode, 'AI_LOCAL_SPEECH_CAPABILITY_DOWNLOAD_FAILED');
});

test('parseLocalRuntimeAssetsHealthResult reads assets key only', () => {
  const parsed = parseLocalRuntimeAssetsHealthResult({
    assets: [{
      localAssetId: 'asset-1',
      status: 'active',
      detail: 'healthy',
      endpoint: 'http://127.0.0.1:1234/v1',
      reasonCode: 'AI_LOCAL_SPEECH_HOST_INIT_FAILED',
    }],
  });

  assert.equal(parsed.assets.length, 1);
  assert.equal(parsed.assets[0]?.localAssetId, 'asset-1');
  assert.equal(parsed.assets[0]?.reasonCode, 'AI_LOCAL_SPEECH_HOST_INIT_FAILED');
});
