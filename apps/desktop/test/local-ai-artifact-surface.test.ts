import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseAssetRecord as parseArtifactRecord,
  parseAssetRecord as parseModelRecord,
  parseVerifiedAssetDescriptor as parseVerifiedArtifactDescriptor,
} from '../src/runtime/local-runtime/parsers.js';

test('parseModelRecord decodes engineConfig struct payloads into plain objects', () => {
  const parsed = parseModelRecord({
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

test('parseArtifactRecord and parseVerifiedArtifactDescriptor decode metadata into plain objects', () => {
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

  const artifact = parseArtifactRecord({
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

  const verified = parseVerifiedArtifactDescriptor({
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

test('parseModelRecord canonicalizes local runtime ids to local/ prefix', () => {
  const model = parseModelRecord({
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

  const artifact = parseArtifactRecord({
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

test('parseModelRecord projects legacy chat-only embedding assets to embedding kind', () => {
  const parsed = parseModelRecord({
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

test('parseVerifiedArtifactDescriptor decodes proto embedding asset kind', () => {
  const parsed = parseVerifiedArtifactDescriptor({
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
