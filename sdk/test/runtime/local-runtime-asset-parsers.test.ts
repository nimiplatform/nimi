import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeAssetStatus,
  parseAssetRecord,
  parseCatalogItemDescriptor,
  parseCatalogRecommendation,
  parseGgufVariantDescriptor,
  parseInstallPlanDescriptor,
  parseUnregisteredAssetDescriptor,
} from '../../src/runtime/index.js';

test('parseCatalogRecommendation fails closed when source is missing or invalid', () => {
  assert.equal(parseCatalogRecommendation({
    tier: 'recommended',
    reasonCodes: ['memory_headroom_recommended'],
  }), undefined);
  assert.equal(parseCatalogRecommendation({
    source: 'guessed-media-fit',
    tier: 'recommended',
    reasonCodes: [],
  }), undefined);
});

test('parseGgufVariantDescriptor preserves Runtime evidence without inventing format', () => {
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

test('parseGgufVariantDescriptor accepts protobuf int64 size strings', () => {
  const parsed = parseGgufVariantDescriptor({
    filename: 'model-q4.gguf',
    entry: 'model-q4.gguf',
    files: ['model-q4.gguf'],
    sizeBytes: '2048',
  });

  assert.equal(parsed.sizeBytes, 2048);
});

test('parseAssetRecord keeps recommendation inputs without synthesizing completeness', () => {
  const parsed = parseAssetRecord({
    localModelId: 'local-z-image',
    modelId: 'local-import/z_image_turbo-Q4_K',
    capabilities: ['image'],
    engine: 'media',
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

test('parseUnregisteredAssetDescriptor only accepts assetKind-based declarations', () => {
  const parsed = parseUnregisteredAssetDescriptor({
    filename: 'legacy-qwen.gguf',
    path: '/tmp/legacy-qwen.gguf',
    sizeBytes: 42,
    declaration: {
      assetKind: 'chat',
      engine: 'llama',
      modelType: 'chat',
    },
    suggestionSource: 'filename',
    confidence: 'low',
    autoImportable: false,
    requiresManualReview: true,
  });

  assert.equal(parsed.declaration?.assetKind, 'chat');
  assert.equal(parsed.declaration?.engine, 'llama');

  const legacyOnly = parseUnregisteredAssetDescriptor({
    filename: 'legacy-qwen.gguf',
    path: '/tmp/legacy-qwen.gguf',
    sizeBytes: 42,
    declaration: {
      modelType: 'chat',
      engine: 'llama',
    },
    suggestionSource: 'filename',
    confidence: 'low',
    autoImportable: false,
    requiresManualReview: true,
  });

  assert.equal(legacyOnly.declaration, undefined);
});

test('normalizeAssetStatus fail-closes retired model and artifact enums', () => {
  assert.equal(normalizeAssetStatus('LOCAL_MODEL_STATUS_ACTIVE'), 'installed');
  assert.equal(normalizeAssetStatus('LOCAL_ARTIFACT_STATUS_ACTIVE'), 'installed');
  assert.equal(normalizeAssetStatus('LOCAL_ASSET_STATUS_ACTIVE'), 'active');
});

test('catalog and install plan parsers do not invent local engine authority', () => {
  const catalogItem = parseCatalogItemDescriptor({
    itemId: 'catalog-1',
    title: 'Runtime catalog item',
    modelId: 'qwen3',
    repo: 'Qwen/Qwen3',
    capabilities: ['text.generate'],
    files: [],
    hashes: {},
    tags: [],
  });
  const installPlan = parseInstallPlanDescriptor({
    planId: 'plan-1',
    itemId: 'catalog-1',
    modelId: 'qwen3',
    repo: 'Qwen/Qwen3',
    capabilities: ['text.generate'],
    files: [],
    hashes: {},
    warnings: [],
  });

  assert.equal(catalogItem.engine, '');
  assert.equal(installPlan.engine, '');
});
