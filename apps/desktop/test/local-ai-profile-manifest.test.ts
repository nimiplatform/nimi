import assert from 'node:assert/strict';
import test from 'node:test';

import {
  bridgeLocalRuntimeProfile,
  normalizeLocalRuntimeProfilesDeclaration,
} from '../src/runtime/local-runtime/index.js';

test('normalizeLocalRuntimeProfilesDeclaration parses profile bundles and asset entries', () => {
  const profiles = normalizeLocalRuntimeProfilesDeclaration([
    {
      id: 'quality-best',
      title: 'Quality Best',
      description: 'Best image quality stack',
      recommended: true,
      consumeCapabilities: ['image'],
      requirements: {
        minGpuMemoryGb: 12,
        minDiskBytes: 30 * 1024 * 1024 * 1024,
        platforms: ['darwin', 'linux'],
      },
      entries: [
        {
          entryId: 'flux-main',
          kind: 'asset',
          capability: 'image',
          assetId: 'black-forest-labs/FLUX.1-dev',
          repo: 'black-forest-labs/FLUX.1-dev',
          engine: 'localai',
        },
        {
          entryId: 'flux-vae',
          kind: 'asset',
          assetId: 'flux/vae',
          assetKind: 'vae',
          templateId: 'verified.flux.vae',
          engine: 'localai',
        },
      ],
    },
  ]);

  assert.equal(profiles.length, 1);
  assert.equal(profiles[0]?.recommended, true);
  assert.equal(profiles[0]?.entries[1]?.kind, 'asset');
  assert.equal(profiles[0]?.requirements?.minGpuMemoryGb, 12);
});

test('bridgeLocalRuntimeProfile keeps asset entries on the unified asset contract', () => {
  const profile = normalizeLocalRuntimeProfilesDeclaration([
    {
      id: 'balanced-fast',
      title: 'Balanced Fast',
      recommended: false,
      consumeCapabilities: ['image'],
      entries: [
        {
          entryId: 'image-main',
          kind: 'asset',
          capability: 'image',
          assetId: 'nimi/image-fast',
          repo: 'nimi/image-fast',
          engine: 'localai',
        },
        {
          entryId: 'clip-slot',
          kind: 'asset',
          capability: 'image',
          assetId: 'nimi/clip-fast',
          assetKind: 'clip',
          engineSlot: 'clip_path',
          templateId: 'verified.clip.fast',
          engine: 'localai',
        },
      ],
    },
  ])[0];

  assert.ok(profile);
  const bridge = bridgeLocalRuntimeProfile(profile);
  assert.equal(bridge.assets.length, 2);
  assert.equal(bridge.assets[0]?.assetId, 'nimi/image-fast');
  assert.equal(bridge.assets[1]?.assetKind, 'clip');
  assert.equal(bridge.assets[1]?.engineSlot, 'clip_path');
});

test('normalizeLocalRuntimeProfilesDeclaration rejects legacy model and artifact entry kinds', () => {
  const profiles = normalizeLocalRuntimeProfilesDeclaration([
    {
      id: 'legacy-profile',
      title: 'Legacy Profile',
      recommended: false,
      consumeCapabilities: ['image'],
      entries: [
        {
          entryId: 'legacy-model',
          kind: 'model',
          capability: 'image',
          modelId: 'local/z_image_turbo',
        },
        {
          entryId: 'legacy-artifact',
          kind: 'artifact',
          capability: 'image',
          artifactId: 'local/z_image_ae',
          artifactKind: 'vae',
        },
      ],
    },
  ]);

  assert.equal(profiles.length, 1);
  assert.deepEqual(profiles[0]?.entries, []);
});
