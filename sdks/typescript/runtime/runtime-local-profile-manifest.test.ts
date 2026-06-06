import assert from 'node:assert/strict';
import test from 'node:test';

import {
  bridgeNimiRuntimeLocalProfile,
  findNimiRuntimeLocalProfileById,
  normalizeNimiRuntimeLocalProfilesDeclaration,
  nimiRuntimeLocalProfileSupportsCapability,
} from './index';

test('Runtime local profile manifest normalizes declarations and drops invalid rows', () => {
  assert.deepEqual(normalizeNimiRuntimeLocalProfilesDeclaration(undefined), []);

  const profiles = normalizeNimiRuntimeLocalProfilesDeclaration([
    null,
    { id: 'missing-title', title: '' },
    {
      id: ' local-image ',
      title: ' Local Image ',
      description: ' Runs an image profile locally ',
      recommended: true,
      consumeCapabilities: [' image.generate ', '', 'text.generate'],
      requirements: {
        minGpuMemoryGb: '8',
        minDiskBytes: 'not-a-number',
        platforms: [' darwin ', '', 'linux'],
        notes: [' GPU required ', null],
      },
      entries: [
        {
          entryId: ' asset-sdxl ',
          kind: 'asset',
          title: ' SDXL ',
          description: ' Image model ',
          capability: 'image.generate',
          assetId: ' models/sdxl ',
          kindHint: 'image',
          engineSlot: ' image ',
          templateId: ' template-1 ',
          revision: ' rev-1 ',
          tags: [' default ', '', 'image'],
        },
        {
          id: ' service-ollama ',
          kind: 'SERVICE',
          title: ' Ollama ',
          capability: 'text.generate',
          required: false,
          preferred: true,
          repo: ' nimi/ollama ',
          serviceId: ' ollama ',
          engine: ' ollama ',
        },
        {
          entryId: ' node-runner ',
          kind: 'node',
          title: ' Node Runner ',
          nodeId: ' local-node ',
          engine: ' node ',
        },
        { entryId: 'invalid-kind', kind: 'sidecar' },
        { kind: 'service' },
      ],
    },
  ]);

  assert.equal(profiles.length, 1);
  const profile = profiles[0]!;
  assert.equal(profile.id, 'local-image');
  assert.equal(profile.title, 'Local Image');
  assert.equal(profile.description, 'Runs an image profile locally');
  assert.equal(profile.recommended, true);
  assert.deepEqual(profile.consumeCapabilities, ['image.generate', 'text.generate']);
  assert.equal(profile.requirements?.minGpuMemoryGb, 8);
  assert.equal(profile.requirements?.minDiskBytes, undefined);
  assert.deepEqual(profile.requirements?.platforms, ['darwin', 'linux']);
  assert.deepEqual(profile.requirements?.notes, ['GPU required']);

  assert.deepEqual(profile.entries.map((entry) => entry.entryId), [
    'asset-sdxl',
    'service-ollama',
    'node-runner',
  ]);
  assert.equal(profile.entries[0]?.assetKind, 'image');
  assert.deepEqual(profile.entries[0]?.tags, ['default', 'image']);
  assert.equal(profile.entries[1]?.required, false);
  assert.equal(profile.entries[1]?.preferred, true);
  assert.equal(profile.entries[2]?.nodeId, 'local-node');
});

test('Runtime local profile manifest finds profiles and matches capabilities explicitly', () => {
  const [profile] = normalizeNimiRuntimeLocalProfilesDeclaration([{
    id: 'local-chat',
    title: 'Local Chat',
    consumeCapabilities: ['text.generate'],
    entries: [
      { entryId: 'chat-model', kind: 'asset', capability: 'text.generate', assetId: 'models/chat', assetKind: 'chat' },
      { entryId: 'embed-model', kind: 'asset', capability: 'text.embed', assetId: 'models/embed', assetKind: 'embedding' },
    ],
  }]);

  assert.equal(findNimiRuntimeLocalProfileById([profile!], ' local-chat ')?.title, 'Local Chat');
  assert.equal(findNimiRuntimeLocalProfileById([profile!], ''), null);
  assert.equal(findNimiRuntimeLocalProfileById([profile!], 'missing'), null);
  assert.equal(nimiRuntimeLocalProfileSupportsCapability(profile!, undefined), true);
  assert.equal(nimiRuntimeLocalProfileSupportsCapability(profile!, ' text.generate '), true);
  assert.equal(nimiRuntimeLocalProfileSupportsCapability(profile!, ' text.embed '), true);
  assert.equal(nimiRuntimeLocalProfileSupportsCapability(profile!, 'video.generate'), false);
});

test('Runtime local profile manifest builds execution bridge without hidden entries', () => {
  const [profile] = normalizeNimiRuntimeLocalProfilesDeclaration([{
    id: 'hybrid',
    title: 'Hybrid',
    consumeCapabilities: ['text.generate', 'image.generate'],
    entries: [
      {
        entryId: 'image-asset',
        kind: 'asset',
        capability: 'image.generate',
        assetId: 'models/sdxl',
        assetKind: 'image',
      },
      {
        entryId: 'required-service',
        kind: 'service',
        capability: 'text.generate',
        title: 'Runtime Service',
        serviceId: 'service-1',
        engine: 'ollama',
      },
      {
        entryId: 'optional-service',
        kind: 'service',
        required: false,
        title: 'Optional Runtime Service',
        serviceId: 'service-2',
      },
      {
        entryId: 'node-step',
        kind: 'node',
        capability: 'text.generate',
        title: 'Node Step',
        nodeId: 'node-1',
        engine: 'node',
      },
    ],
  }]);

  const fullBridge = bridgeNimiRuntimeLocalProfile(profile!);
  assert.deepEqual(fullBridge.assets.map((entry) => entry.entryId), ['image-asset']);
  assert.deepEqual(fullBridge.runtimeEntries?.required?.map((entry) => entry.entryId), [
    'required-service',
    'node-step',
  ]);
  assert.deepEqual(fullBridge.runtimeEntries?.optional?.map((entry) => entry.entryId), ['optional-service']);
  assert.deepEqual(fullBridge.runtimeEntries?.required?.[0], {
    entryId: 'required-service',
    kind: 'service',
    capability: 'text.generate',
    title: 'Runtime Service',
    assetId: undefined,
    repo: undefined,
    serviceId: 'service-1',
    nodeId: undefined,
    engine: 'ollama',
  });

  const textBridge = bridgeNimiRuntimeLocalProfile(profile!, ' text.generate ');
  assert.deepEqual(textBridge.assets, []);
  assert.deepEqual(textBridge.runtimeEntries?.required?.map((entry) => entry.entryId), [
    'required-service',
    'node-step',
  ]);
  assert.deepEqual(textBridge.runtimeEntries?.optional?.map((entry) => entry.entryId), ['optional-service']);

  const imageBridge = bridgeNimiRuntimeLocalProfile(profile!, 'image.generate');
  assert.deepEqual(imageBridge.assets.map((entry) => entry.entryId), ['image-asset']);
  assert.equal(imageBridge.runtimeEntries?.required, undefined);
  assert.deepEqual(imageBridge.runtimeEntries?.optional?.map((entry) => entry.entryId), ['optional-service']);
});
