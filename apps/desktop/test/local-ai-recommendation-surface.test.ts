import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  LocalRuntimeVerifiedAssetDescriptor,
} from '../src/runtime/local-runtime/index.js';

import {
  isRecommendedDescriptor,
  relatedPassiveAssetsForRunnable,
  sortVerifiedAssetsForDisplay,
  sortVerifiedPassiveAssetsForDisplay,
} from '../src/shell/renderer/features/runtime-config/runtime-config-local-model-center-helpers.js';

test('sortVerifiedAssetsForDisplay prioritizes recommended entries', () => {
  const sorted = sortVerifiedAssetsForDisplay([
    {
      templateId: 'verified.chat.llama3_8b',
      title: 'Llama 3 8B Instruct',
      description: 'General chat model',
      installKind: 'download',
      assetId: 'local/llama3.1',
      kind: 'chat',
      logicalModelId: 'local/llama3.1',
      repo: 'nimiplatform/llama3.1-8b-instruct',
      revision: 'main',
      capabilities: ['chat'],
      engine: 'localai',
      entry: 'model.gguf',
      files: ['model.gguf'],
      license: 'llama3',
      hashes: {},
      endpoint: 'http://127.0.0.1:1234/v1',
      fileCount: 1,
      totalSizeBytes: 0,
      tags: ['chat', 'verified'],
    },
    {
      templateId: 'verified.image.z_image_turbo',
      title: 'Z-Image Turbo (GGUF)',
      description: 'Recommended image model',
      installKind: 'download',
      assetId: 'local/z_image_turbo',
      kind: 'image',
      logicalModelId: 'local/z_image_turbo',
      repo: 'jayn7/Z-Image-Turbo-GGUF',
      revision: 'main',
      capabilities: ['image'],
      engine: 'localai',
      entry: 'z_image_turbo-Q4_K_M.gguf',
      files: ['z_image_turbo-Q4_K_M.gguf'],
      license: 'tongyi',
      hashes: {},
      endpoint: 'http://127.0.0.1:1234/v1',
      fileCount: 1,
      totalSizeBytes: 0,
      tags: ['image', 'verified', 'recommended', 'z-image'],
    },
  ]);

  assert.equal(sorted[0]?.templateId, 'verified.image.z_image_turbo');
  assert.equal(isRecommendedDescriptor(sorted[0]?.tags), true);
});

test('sortVerifiedPassiveAssetsForDisplay keeps recommended VAE and LLM ahead of generic assets', () => {
  const sorted = sortVerifiedPassiveAssetsForDisplay([
    {
      templateId: 'verified.asset.generic.clip',
      title: 'Generic CLIP',
      description: 'Generic clip helper',
      assetId: 'local/generic_clip',

      kind: 'clip',
      engine: 'localai',
      entry: 'clip/model.safetensors',
      files: ['clip/model.safetensors'],
      license: 'apache-2.0',
      repo: 'example/generic-clip',
      revision: 'main',
      hashes: {},
      fileCount: 1,
      totalSizeBytes: 0,
      tags: ['image', 'verified', 'clip'],
      metadata: { family: 'generic-image' },
    },
    {
      templateId: 'verified.asset.z_image.qwen3_4b',
      title: 'Qwen3 4B Dependency Chat',
      description: 'Recommended dependency chat asset',
      assetId: 'local/qwen3_4b_companion',

      kind: 'chat',
      engine: 'localai',
      entry: 'Qwen3-4B-Q4_K_M.gguf',
      files: ['Qwen3-4B-Q4_K_M.gguf'],
      license: 'qwen',
      repo: 'Qwen/Qwen3-4B-GGUF',
      revision: 'main',
      hashes: {},
      fileCount: 1,
      totalSizeBytes: 0,
      tags: ['image', 'verified', 'recommended', 'z-image', 'chat'],
      metadata: { family: 'z-image' },
    },
    {
      templateId: 'verified.asset.z_image.vae',
      title: 'Z-Image AE VAE',
      description: 'Recommended dependency VAE asset',
      assetId: 'local/z_image_ae',

      kind: 'vae',
      engine: 'localai',
      entry: 'vae/diffusion_pytorch_model.safetensors',
      files: ['vae/diffusion_pytorch_model.safetensors'],
      license: 'tongyi',
      repo: 'Tongyi-MAI/Z-Image-Turbo',
      revision: 'main',
      hashes: {},
      fileCount: 1,
      totalSizeBytes: 0,
      tags: ['image', 'verified', 'recommended', 'z-image', 'vae'],
      metadata: { family: 'z-image' },
    },
  ]);

  assert.deepEqual(
    sorted.map((artifact) => artifact.templateId),
    [
      'verified.asset.z_image.qwen3_4b',
      'verified.asset.z_image.vae',
      'verified.asset.generic.clip',
    ],
  );
});

test('relatedPassiveAssetsForRunnable ignores recommended tag when matching image families', () => {
  const model: LocalRuntimeVerifiedAssetDescriptor = {
    templateId: 'verified.image.z_image_turbo',
    title: 'Z-Image Turbo (GGUF)',
    description: 'Recommended image model',
    installKind: 'download',
    assetId: 'local/z_image_turbo',
    kind: 'image',
    logicalModelId: 'local/z_image_turbo',
    repo: 'jayn7/Z-Image-Turbo-GGUF',
    revision: 'main',
    capabilities: ['image'],
    engine: 'localai',
    entry: 'z_image_turbo-Q4_K_M.gguf',
    files: ['z_image_turbo-Q4_K_M.gguf'],
    license: 'tongyi',
    hashes: {},
    endpoint: 'http://127.0.0.1:1234/v1',
    fileCount: 1,
    totalSizeBytes: 0,
    tags: ['image', 'verified', 'recommended', 'z-image'],
  };

  const artifacts: LocalRuntimeVerifiedAssetDescriptor[] = [
    {
      templateId: 'verified.asset.z_image.vae',
      title: 'Z-Image AE VAE',
      description: 'Recommended dependency VAE asset',
      assetId: 'local/z_image_ae',

      kind: 'vae',
      engine: 'localai',
      entry: 'vae/diffusion_pytorch_model.safetensors',
      files: ['vae/diffusion_pytorch_model.safetensors'],
      license: 'tongyi',
      repo: 'Tongyi-MAI/Z-Image-Turbo',
      revision: 'main',
      hashes: {},
      fileCount: 1,
      totalSizeBytes: 0,
      tags: ['image', 'verified', 'recommended', 'z-image', 'vae'],
      metadata: { family: 'z-image' },
    },
    {
      templateId: 'verified.asset.generic.vae',
      title: 'Generic Recommended VAE',
      description: 'Recommended but unrelated',
      assetId: 'local/generic_vae',

      kind: 'vae',
      engine: 'localai',
      entry: 'generic/model.safetensors',
      files: ['generic/model.safetensors'],
      license: 'apache-2.0',
      repo: 'example/generic-vae',
      revision: 'main',
      hashes: {},
      fileCount: 1,
      totalSizeBytes: 0,
      tags: ['image', 'verified', 'recommended', 'vae'],
      metadata: { family: 'generic-image' },
    },
  ];

  assert.deepEqual(
    relatedPassiveAssetsForRunnable(model, artifacts).map((artifact: LocalRuntimeVerifiedAssetDescriptor) => artifact.templateId),
    ['verified.asset.z_image.vae'],
  );
});
