import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseCatalogRecommendation,
  parseGgufVariantDescriptor,
  parseAssetRecord as parseModelRecord,
} from '../src/runtime/local-runtime/parsers.js';

test('parseCatalogRecommendation fails closed when source is missing', () => {
  const parsed = parseCatalogRecommendation({
    tier: 'recommended',
    reasonCodes: ['memory_headroom_recommended'],
  });

  assert.equal(parsed, undefined);
});

test('parseCatalogRecommendation fails closed when source enum is invalid', () => {
  const parsed = parseCatalogRecommendation({
    source: 'guessed-media-fit',
    tier: 'recommended',
    reasonCodes: [],
  });

  assert.equal(parsed, undefined);
});

test('parseGgufVariantDescriptor does not invent gguf format', () => {
  const parsed = parseGgufVariantDescriptor({
    filename: 'model-q4.gguf',
    entry: 'model-q4.gguf',
    files: ['model-q4.gguf'],
    recommendation: {
      source: 'media-fit',
      reasonCodes: ['metadata_incomplete'],
    },
  });

  assert.equal(parsed.format, undefined);
  assert.equal(parsed.recommendation?.source, 'media-fit');
});

test('parseModelRecord keeps recommendation inputs without synthesizing completeness', () => {
  const parsed = parseModelRecord({
    localModelId: 'local-z-image',
    modelId: 'local-import/z_image_turbo-Q4_K',
    capabilities: ['image'],
    engine: 'localai',
    entry: 'z_image_turbo-Q4_K.gguf',
    files: [],
    license: 'apache-2.0',
    source: {
      repo: 'Tongyi-MAI/Z-Image',
      revision: 'main',
    },
    hashes: {},
    tags: [],
    endpoint: 'http://127.0.0.1:1234/v1',
    status: 'active',
    installedAt: '2026-03-08T00:00:00Z',
    updatedAt: '2026-03-08T00:00:00Z',
  });

  assert.deepEqual(parsed.files, []);
});
