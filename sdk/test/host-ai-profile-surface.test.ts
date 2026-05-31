import assert from 'node:assert/strict';
import test from 'node:test';

import {
  collectAIProfileSchemaProbeWarnings,
  createEmptyAIConfig,
  createHostAIProfileSurface,
  type AIConfig,
  type AIProfile,
  type AIScopeRef,
} from '../src/ai/index.js';

const SCOPE: AIScopeRef = { kind: 'app', ownerId: 'dev.nimi.consumer', surfaceId: 'lab' };

const PROFILE: AIProfile = {
  profileId: 'factory:consumer-ready',
  title: 'Consumer Ready',
  description: '',
  tags: ['test'],
  capabilities: {
    'text.generate': {
      binding: {
        source: 'local',
        connectorId: '',
        model: 'local-chat',
      },
    },
    'image.generate': {},
  },
};

test('host AIProfile surface previews without committing and reports static warnings', async () => {
  const profiles = [PROFILE];
  const savedConfigs = new Map<string, AIConfig>();
  const surface = createHostAIProfileSurface({
    listProfiles: () => profiles,
    hasConfig: () => savedConfigs.has('scope'),
    loadConfig: () => savedConfigs.get('scope') ?? createEmptyAIConfig(SCOPE),
    saveConfig: (_scopeRef, config) => {
      savedConfigs.set('scope', config);
      return config;
    },
  });

  const listed = await surface.list();
  listed[0].tags.push('mutated');
  assert.deepEqual(profiles[0].tags, ['test']);

  const preview = await surface.previewApply(SCOPE, PROFILE.profileId);
  assert.equal(preview.before, null);
  assert.equal(preview.after.capabilities.selectedBindings['text.generate']?.model, 'local-chat');
  assert.equal(preview.probeWarnings.length, 1);
  assert.match(preview.probeWarnings[0], /image\.generate/);
  assert.equal(savedConfigs.size, 0);

  const apply = await surface.apply(SCOPE, PROFILE.profileId);
  assert.equal(apply.success, true);
  assert.equal(savedConfigs.get('scope')?.profileOrigin?.profileId, PROFILE.profileId);

  const secondPreview = await surface.previewApply(SCOPE, PROFILE.profileId);
  assert.equal(secondPreview.before?.profileOrigin?.profileId, PROFILE.profileId);
});

test('host AIProfile surface fails closed for missing and invalid profiles', async () => {
  const surface = createHostAIProfileSurface({
    listProfiles: () => [
      { ...PROFILE, profileId: 'invalid', title: '' },
    ],
    loadConfig: () => createEmptyAIConfig(SCOPE),
    saveConfig: (_scopeRef, config) => config,
  });

  await assert.rejects(
    () => surface.previewApply(SCOPE, 'missing'),
    /Profile not found: missing/,
  );
  assert.deepEqual(await surface.apply(SCOPE, 'missing'), {
    success: false,
    config: null,
    failureReason: 'Profile not found: missing',
    probeWarnings: [],
  });
  await assert.rejects(
    () => surface.previewApply(SCOPE, 'invalid'),
    /Profile schema invalid: title is required/,
  );
});

test('AIProfile schema probe warnings are deterministic and host agnostic', () => {
  assert.deepEqual(collectAIProfileSchemaProbeWarnings(PROFILE), [
    'Capability "image.generate" has no model binding; it will not be executable until configured.',
  ]);
});
