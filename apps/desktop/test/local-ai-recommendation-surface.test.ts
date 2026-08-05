import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  NimiRuntimeLocalVerifiedAssetDescriptor,
} from '@nimiplatform/sdk/runtime';

import {
  relatedPassiveAssetsForRunnable,
} from '../src/shell/renderer/features/runtime-config/runtime-config-local-model-center-helpers.js';

test('relatedPassiveAssetsForRunnable ignores recommendation tags when matching image families', () => {
  const model: NimiRuntimeLocalVerifiedAssetDescriptor = {
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

  const artifacts: NimiRuntimeLocalVerifiedAssetDescriptor[] = [
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
    relatedPassiveAssetsForRunnable(model, artifacts).map((artifact) => artifact.templateId),
    ['verified.asset.z_image.vae'],
  );
});
