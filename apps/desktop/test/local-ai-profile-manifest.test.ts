import assert from 'node:assert/strict';
import test from 'node:test';

import {
  bridgeLocalRuntimeProfile,
  normalizeLocalRuntimeProfilesDeclaration,
} from '../src/runtime/local-runtime/index.js';

test('normalizeLocalRuntimeProfilesDeclaration parses profile bundles and artifact entries', () => {
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
          kind: 'model',
          capability: 'image',
          modelId: 'black-forest-labs/FLUX.1-dev',
          repo: 'black-forest-labs/FLUX.1-dev',
          engine: 'localai',
        },
        {
          entryId: 'flux-vae',
          kind: 'artifact',
          artifactId: 'flux/vae',
          artifactKind: 'vae',
          templateId: 'verified.flux.vae',
          engine: 'localai',
        },
      ],
    },
  ]);

  assert.equal(profiles.length, 1);
  assert.equal(profiles[0]?.recommended, true);
  assert.equal(profiles[0]?.entries[1]?.kind, 'artifact');
  assert.equal(profiles[0]?.requirements?.minGpuMemoryGb, 12);
});

test('bridgeLocalRuntimeProfile separates runtime dependencies from companion artifacts', () => {
  const profile = normalizeLocalRuntimeProfilesDeclaration([
    {
      id: 'balanced-fast',
      title: 'Balanced Fast',
      recommended: false,
      consumeCapabilities: ['image'],
      entries: [
        {
          entryId: 'image-main',
          kind: 'model',
          capability: 'image',
          modelId: 'nimi/image-fast',
          repo: 'nimi/image-fast',
          engine: 'localai',
        },
        {
          entryId: 'clip-companion',
          kind: 'artifact',
          capability: 'image',
          artifactId: 'nimi/clip-fast',
          artifactKind: 'clip',
          templateId: 'verified.clip.fast',
          engine: 'localai',
        },
      ],
    },
  ])[0];

  assert.ok(profile);
  const bridge = bridgeLocalRuntimeProfile(profile);
  assert.equal(bridge.runtimeEntries?.required?.length, 1);
  assert.equal(bridge.runtimeEntries?.required?.[0]?.modelId, 'nimi/image-fast');
  assert.equal(bridge.artifacts.length, 1);
  assert.equal(bridge.artifacts[0]?.artifactKind, 'clip');
});
