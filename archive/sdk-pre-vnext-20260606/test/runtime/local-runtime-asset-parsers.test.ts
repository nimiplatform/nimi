import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeAssetStatus,
  parseAssetHealth,
  parseAssetRecord,
  parseCatalogItemDescriptor,
  parseCatalogRecommendation,
  parseGgufVariantDescriptor,
  parseInstallPlanDescriptor,
  parseUnregisteredAssetDescriptor,
  parseVerifiedAssetDescriptor,
} from '../../src/runtime/index.js';
import { ReasonCode } from '../../src/types/index.js';

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

test('parseAssetRecord decodes engineConfig struct payloads into plain objects', () => {
  const parsed = parseAssetRecord({
    localAssetId: 'local-z-image',
    assetId: 'local-import/z_image_turbo-Q4_K',
    capabilities: ['image'],
    engine: 'localai',
    entry: 'z_image_turbo-Q4_K.gguf',
    license: 'apache-2.0',
    source: {
      repo: 'Tongyi-MAI/Z-Image',
      revision: 'main',
    },
    hashes: {},
    endpoint: 'http://127.0.0.1:1234/v1',
    status: 'active',
    installedAt: '2026-03-08T00:00:00Z',
    updatedAt: '2026-03-08T00:00:00Z',
    engineConfig: {
      fields: {
        backend: { kind: { oneofKind: 'stringValue', stringValue: 'stablediffusion-ggml' } },
        options: {
          kind: {
            oneofKind: 'listValue',
            listValue: {
              values: [
                { kind: { oneofKind: 'stringValue', stringValue: 'diffusion_model' } },
                { kind: { oneofKind: 'stringValue', stringValue: 'llm_path:Qwen3-4B-Q4_K_M.gguf' } },
              ],
            },
          },
        },
        parameters: {
          kind: {
            oneofKind: 'structValue',
            structValue: {
              fields: {
                model: { kind: { oneofKind: 'stringValue', stringValue: 'z_image_turbo-Q4_K.gguf' } },
              },
            },
          },
        },
      },
    },
  });

  assert.deepEqual(parsed.engineConfig, {
    backend: 'stablediffusion-ggml',
    options: [
      'diffusion_model',
      'llm_path:Qwen3-4B-Q4_K_M.gguf',
    ],
    parameters: {
      model: 'z_image_turbo-Q4_K.gguf',
    },
  });
});

test('parseAssetRecord and parseVerifiedAssetDescriptor decode metadata into plain objects', () => {
  const metadata = {
    fields: {
      role: { kind: { oneofKind: 'stringValue', stringValue: 'companion' } },
      slots: {
        kind: {
          oneofKind: 'listValue',
          listValue: {
            values: [
              { kind: { oneofKind: 'stringValue', stringValue: 'vae' } },
              { kind: { oneofKind: 'stringValue', stringValue: 'llm' } },
            ],
          },
        },
      },
    },
  };

  const artifact = parseAssetRecord({
    localAssetId: 'artifact-vae',
    assetId: 'z-image-ae',
    kind: 'vae',
    engine: 'localai',
    entry: 'ae.safetensors',
    files: ['ae.safetensors'],
    license: 'apache-2.0',
    source: {
      repo: 'Tongyi-MAI/Z-Image',
      revision: 'main',
    },
    hashes: {
      'ae.safetensors': 'sha256:abc',
    },
    status: 'installed',
    installedAt: '2026-03-08T00:00:00Z',
    updatedAt: '2026-03-08T00:00:00Z',
    metadata,
  });

  const verified = parseVerifiedAssetDescriptor({
    templateId: 'z-image-ae',
    title: 'Z-Image AE',
    description: 'Verified VAE',
    assetId: 'z-image-ae',
    kind: 'vae',
    engine: 'localai',
    entry: 'ae.safetensors',
    files: ['ae.safetensors'],
    license: 'apache-2.0',
    repo: 'Tongyi-MAI/Z-Image',
    revision: 'main',
    hashes: {
      'ae.safetensors': 'sha256:abc',
    },
    metadata,
  });

  assert.deepEqual(artifact.metadata, {
    role: 'companion',
    slots: ['vae', 'llm'],
  });
  assert.equal(artifact.assetId, 'local/z-image-ae');
  assert.deepEqual(verified.metadata, {
    role: 'companion',
    slots: ['vae', 'llm'],
  });
  assert.equal(verified.assetId, 'z-image-ae');
});

test('parseAssetRecord decodes Runtime LocalAssetKind enum projection', () => {
  const parsed = parseAssetRecord({
    localAssetId: 'artifact-controlnet',
    assetId: 'z-image-controlnet',
    kind: 'LOCAL_ASSET_KIND_CONTROLNET',
    engine: 'media',
    entry: 'controlnet.safetensors',
    files: ['controlnet.safetensors'],
    license: 'apache-2.0',
    source: {
      repo: 'local-import/z-image-controlnet',
      revision: 'main',
    },
    hashes: {},
    status: 'installed',
    installedAt: '2026-03-08T00:00:00Z',
    updatedAt: '2026-03-08T00:00:00Z',
  });

  assert.equal(parsed.kind, 'controlnet');
});

test('parseAssetRecord canonicalizes local runtime ids to local/ prefix', () => {
  const model = parseAssetRecord({
    localAssetId: '01JMODEL',
    assetId: 'z_image_turbo',
    capabilities: ['image'],
    engine: 'localai',
    entry: 'z_image_turbo-Q4_K_M.gguf',
    files: ['z_image_turbo-Q4_K_M.gguf'],
    license: 'apache-2.0',
    source: {
      repo: 'jayn7/Z-Image-Turbo-GGUF',
      revision: 'main',
    },
    hashes: {},
    tags: ['image', 'z-image'],
    knownTotalSizeBytes: 1234,
    endpoint: 'http://127.0.0.1:1234/v1',
    status: 'active',
    installedAt: '2026-03-08T00:00:00Z',
    updatedAt: '2026-03-08T00:00:00Z',
  });

  const artifact = parseAssetRecord({
    localAssetId: '01JART',
    assetId: 'media/z_image_ae',
    kind: 'vae',
    engine: 'media',
    entry: 'ae.safetensors',
    files: ['ae.safetensors'],
    license: 'apache-2.0',
    source: {
      repo: 'Tongyi-MAI/Z-Image',
      revision: 'main',
    },
    hashes: {},
    status: 'installed',
    installedAt: '2026-03-08T00:00:00Z',
    updatedAt: '2026-03-08T00:00:00Z',
  });

  assert.equal(model.assetId, 'local/z_image_turbo');
  assert.deepEqual(model.files, ['z_image_turbo-Q4_K_M.gguf']);
  assert.equal(artifact.assetId, 'local/z_image_ae');
});

test('parseAssetRecord projects legacy chat-only embedding assets to embedding kind', () => {
  const parsed = parseAssetRecord({
    localAssetId: '01JEMBED',
    assetId: 'local-import/qwen3-embedding-8b',
    kind: 'chat',
    capabilities: ['text.embed'],
    engine: 'llama',
    entry: 'Qwen3-Embedding-8B-Q4_K_M.gguf',
    files: ['Qwen3-Embedding-8B-Q4_K_M.gguf'],
    license: 'apache-2.0',
    source: {
      repo: 'local-import/qwen3-embedding-8b',
      revision: 'main',
    },
    hashes: {},
    status: 'installed',
    installedAt: '2026-03-08T00:00:00Z',
    updatedAt: '2026-03-08T00:00:00Z',
  });

  assert.equal(parsed.kind, 'embedding');
  assert.deepEqual(parsed.capabilities, ['embedding']);
});

test('parseVerifiedAssetDescriptor decodes proto embedding asset kind', () => {
  const parsed = parseVerifiedAssetDescriptor({
    templateId: 'verified.embed.qwen3',
    title: 'Qwen3 Embedding 8B',
    description: 'Verified embedding model',
    assetId: 'verified/embed/qwen3',
    kind: 6,
    capabilities: ['text.embed'],
    engine: 'llama',
    entry: 'Qwen3-Embedding-8B-Q4_K_M.gguf',
    files: ['Qwen3-Embedding-8B-Q4_K_M.gguf'],
    license: 'apache-2.0',
    repo: 'Qwen/Qwen3-Embedding-8B-GGUF',
    revision: 'main',
    hashes: {},
  });

  assert.equal(parsed.kind, 'embedding');
  assert.deepEqual(parsed.capabilities, ['embedding']);
});

test('local runtime asset parsers preserve projection reasonCode evidence', () => {
  const asset = parseAssetRecord({
    localAssetId: 'speech-asset',
    assetId: 'speech/qwen3tts',
    kind: 'tts',
    engine: 'speech',
    entry: 'model.bin',
    files: ['model.bin'],
    license: 'apache-2.0',
    source: { repo: 'Qwen/Qwen3-TTS', revision: 'main' },
    hashes: {},
    status: 'unhealthy',
    installedAt: '2026-04-17T00:00:00Z',
    updatedAt: '2026-04-17T00:00:00Z',
    healthDetail: 'speech probe missing expected model',
    reasonCode: ReasonCode.AI_LOCAL_SPEECH_CAPABILITY_DOWNLOAD_FAILED,
  });
  assert.equal(asset.reasonCode, ReasonCode.AI_LOCAL_SPEECH_CAPABILITY_DOWNLOAD_FAILED);

  const health = parseAssetHealth({
    localAssetId: 'speech-asset',
    status: 'unhealthy',
    detail: 'speech probe missing required capability',
    endpoint: 'http://127.0.0.1:8330/v1',
    reasonCode: ReasonCode.AI_LOCAL_SPEECH_BUNDLE_DEGRADED,
  });
  assert.equal(health.reasonCode, ReasonCode.AI_LOCAL_SPEECH_BUNDLE_DEGRADED);
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
