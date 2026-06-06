import assert from 'node:assert/strict';
import test from 'node:test';

import {
  collectAIProfileSchemaProbeWarnings,
  createEmptyAIConfig,
  createHostAIProfileSurface,
  formRuntimeProfileDescriptor,
  type AICapabilityRequirementDeclaration,
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
      targetRef: {
        kind: 'local_runtime_target_ref',
        targetId: 'target-chat',
        profileId: 'profile-chat',
      },
    },
    'image.generate': { readinessPolicy: 'optional' },
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
  assert.equal(preview.outcome, 'ready_to_apply');
  assert.equal(preview.after?.capabilities.targetRefs['text.generate']?.kind, 'local_runtime_target_ref');
  assert.equal(preview.probeWarnings.length, 1);
  assert.match(preview.probeWarnings[0], /image\.generate/);
  assert.equal(savedConfigs.size, 0);

  const apply = await surface.apply(SCOPE, PROFILE.profileId);
  assert.equal(apply.success, true);
  assert.equal(savedConfigs.get('scope')?.profileOrigin?.profileId, PROFILE.profileId);

  const secondPreview = await surface.previewApply(SCOPE, PROFILE.profileId);
  assert.equal(secondPreview.before?.profileOrigin?.profileId, PROFILE.profileId);
});

test('host AIProfile surface passes expected base version to the host save authority', async () => {
  const profiles = [PROFILE];
  let current = createEmptyAIConfig(SCOPE);
  const expectedVersions: string[] = [];
  const surface = createHostAIProfileSurface({
    listProfiles: () => profiles,
    loadConfig: () => current,
    saveConfig: (_scopeRef, config, options) => {
      expectedVersions.push(options.expectedBaseVersion);
      current = config;
      return config;
    },
  });

  const preview = await surface.previewApply(SCOPE, PROFILE.profileId);
  const applied = await surface.apply(SCOPE, PROFILE.profileId);

  assert.equal(applied.success, true);
  assert.deepEqual(expectedVersions, [preview.baseVersion]);
});

test('host AIProfile surface lets host fail closed on stale CAS version', async () => {
  const profiles = [PROFILE];
  let current = createEmptyAIConfig(SCOPE);
  const surface = createHostAIProfileSurface({
    listProfiles: () => profiles,
    loadConfig: () => current,
    saveConfig: () => {
      throw new Error('AIConfig CAS conflict: baseVersion is stale');
    },
  });

  await assert.rejects(
    () => surface.apply(SCOPE, PROFILE.profileId),
    /AIConfig CAS conflict/,
  );
});

test('host AIProfile surface forwards preview base version to explicit apply', async () => {
  const profiles = [PROFILE];
  let current = createEmptyAIConfig(SCOPE);
  const expectedVersions: string[] = [];
  const surface = createHostAIProfileSurface({
    listProfiles: () => profiles,
    loadConfig: () => current,
    saveConfig: (_scopeRef, config, options) => {
      expectedVersions.push(options.expectedBaseVersion);
      current = config;
      return config;
    },
  });

  const preview = await surface.previewApply(SCOPE, PROFILE.profileId);
  const applied = await surface.apply(SCOPE, PROFILE.profileId, {
    expectedBaseVersion: preview.baseVersion,
  });

  assert.equal(applied.success, true);
  assert.deepEqual(expectedVersions, [preview.baseVersion]);
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
    outcome: 'failed',
    setupProjection: null,
    probeWarnings: [],
  });
  await assert.rejects(
    () => surface.previewApply(SCOPE, 'invalid'),
    /Profile schema invalid: title is required/,
  );
});

test('AIProfile schema probe warnings are deterministic and host agnostic', () => {
  assert.deepEqual(collectAIProfileSchemaProbeWarnings(PROFILE), [
    'Capability "image.generate" has no compact target ref; it will not be executable until prepared.',
  ]);
});

test('host AIProfile surface returns no-live-config for unresolved required slices', async () => {
  const unresolved: AIProfile = {
    ...PROFILE,
    profileId: 'factory:setup-required',
    capabilities: {
      'image.generate': {
        contractState: 'proposed',
        readinessPolicy: 'required',
      },
    },
  };
  let saveCalls = 0;
  const surface = createHostAIProfileSurface({
    listProfiles: () => [unresolved],
    loadConfig: () => createEmptyAIConfig(SCOPE),
    saveConfig: (_scopeRef, config) => {
      saveCalls += 1;
      return config;
    },
  });

  const preview = await surface.previewApply(SCOPE, unresolved.profileId);
  assert.equal(preview.after, null);
  assert.equal(preview.outcome, 'setup_required_no_live_config');
  assert.deepEqual(preview.setupProjection?.reasonCodes, ['product_state_proposed']);

  const applied = await surface.apply(SCOPE, unresolved.profileId);
  assert.equal(applied.success, false);
  assert.equal(applied.config, null);
  assert.equal(applied.outcome, 'setup_required_no_live_config');
  assert.equal(saveCalls, 0);
});

test('host AIProfile surface fails closed when local dependency resolver is not configured', async () => {
  const surface = createHostAIProfileSurface({
    listProfiles: () => [PROFILE],
    loadConfig: () => createEmptyAIConfig(SCOPE),
    saveConfig: (_scopeRef, config) => config,
  });

  await assert.rejects(
    () => surface.resolveLocalDependencies(PROFILE.profileId),
    /AIProfile local dependency resolver is not configured/,
  );
});

test('host AIProfile surface delegates local dependency resolution when configured', async () => {
  const surface = createHostAIProfileSurface({
    listProfiles: () => [PROFILE],
    loadConfig: () => createEmptyAIConfig(SCOPE),
    saveConfig: (_scopeRef, config) => config,
    resolveLocalDependencies: async (profileId) => [{ profileId, kind: 'local-model' }],
  });

  assert.deepEqual(await surface.resolveLocalDependencies(PROFILE.profileId), [
    { profileId: PROFILE.profileId, kind: 'local-model' },
  ]);
});

test('SDK forms runtime-validated descriptor slices instead of target-ref-only payloads', () => {
  const profile: AIProfile = {
    profileId: 'factory:runtime-shape',
    title: 'Runtime Shape',
    description: '',
    tags: ['test'],
    capabilities: {
      'image.generate': {
        readinessPolicy: 'required',
        runtimeDescriptor: {
          sliceId: 'slice:image',
          executionMode: 'local',
          execution: {
            backend: 'stablediffusion-ggml',
            backend_class: 'native_binary',
            backend_family: 'stablediffusion-ggml',
          },
          model: { family: 'flux' },
          assetRefs: ['main'],
          orderedCompanionOccurrences: [
            {
              occurrence_id: 'lora-1',
              order: 0,
              role: 'lora',
              engineSlot: 'lora_path',
              asset_binding_ref: 'lora-a',
              required: true,
            },
          ],
        },
      },
      'text.generate': {
        targetRef: {
          kind: 'cloud_connector_target_ref',
          connectorId: 'connector:openai',
          provider: 'openai',
          providerModelId: 'gpt-4.1-mini',
        },
        runtimeDescriptor: {
          sliceId: 'slice:text-cloud',
          executionMode: 'cloud_connector',
          providerCapability: 'text.generate',
          credentialPolicy: 'runtime_custody_required',
        },
      },
      'video.generate': {
        contractState: 'unsupported',
        readinessPolicy: 'required',
      },
    },
  };
  const requirements: AICapabilityRequirementDeclaration[] = [{
    requirementId: 'requirement:runtime-shape',
    scopeRef: SCOPE,
    requiredSlices: [
      {
        requirementSliceId: 'requirement-slice:image',
        capability: 'image.generate',
        profileSliceRef: 'slice:image',
        readinessPolicy: 'required',
      },
      {
        requirementSliceId: 'requirement-slice:text',
        capability: 'text.generate',
        profileSliceRef: 'slice:text-cloud',
        readinessPolicy: 'required',
      },
      {
        requirementSliceId: 'requirement-slice:video',
        capability: 'video.generate',
        profileSliceRef: 'slice:video',
        readinessPolicy: 'required',
        runtimeDescriptor: {
          executionMode: 'local',
          contractState: 'unsupported',
          execution: {
            backend: 'video.pipeline',
            backend_class: 'python_pipeline',
            backend_family: 'video-python',
          },
          model: { family: 'wan' },
        },
      },
    ],
    setupProjectionPolicy: 'runtime_no_live_config',
  }];

  const descriptor = formRuntimeProfileDescriptor({
    profile,
    requirementDeclarations: requirements,
    descriptorId: 'descriptor:runtime-shape',
    sourceProfileDigest: 'sha256:runtime-shape',
    projectedAt: '2026-06-04T00:00:00.000Z',
    assetBindings: [
      {
        binding_id: 'main',
        asset_role: 'main',
        component_kind: 'image',
        source: 'huggingface',
        expected_identity: 'hf:nimiplatform/z-image',
        readiness_policy: 'required',
        huggingface: {
          repo_id: 'nimiplatform/z-image',
          revision: 'main',
          entries: ['model.gguf'],
          access_policy: 'public',
        },
      },
      {
        binding_id: 'lora-a',
        asset_role: 'companion',
        component_kind: 'lora',
        source: 'huggingface',
        expected_identity: 'hf:nimiplatform/lora-a',
        readiness_policy: 'optional',
        huggingface: {
          repo_id: 'nimiplatform/lora-a',
          revision: 'main',
          entries: ['lora.safetensors'],
          access_policy: 'gated',
        },
      },
    ],
  });

  assert.equal(descriptor.capability_slices.length, 3);
  assert.equal(descriptor.capability_slices[0].execution?.backend, 'stablediffusion-ggml');
  assert.equal(descriptor.capability_slices[0].model?.family, 'flux');
  assert.equal(descriptor.capability_slices[0].asset_refs?.[0], 'main');
  assert.equal(
    descriptor.capability_slices[0].ordered_companion_occurrences?.[0].asset_binding_ref,
    'lora-a',
  );
  assert.equal(descriptor.capability_slices[1].provider, 'openai');
  assert.equal(descriptor.capability_slices[1].provider_capability, 'text.generate');
  assert.equal(descriptor.capability_slices[1].model_id, 'gpt-4.1-mini');
  assert.equal(descriptor.capability_slices[1].credential_policy, 'runtime_custody_required');
  assert.equal(descriptor.capability_slices[2].capability, 'video.generate');
  assert.equal(descriptor.capability_slices[2].contract_state, 'unsupported');
  assert.ok(!('target_ref' in descriptor.capability_slices[0]));
});

test('SDK does not silently drop required unresolved runtime descriptor slices', () => {
  const profile: AIProfile = {
    profileId: 'factory:required-unresolved',
    title: 'Required Unresolved',
    description: '',
    tags: ['test'],
    capabilities: {
      'image.generate': {},
    },
  };
  const requirement: AICapabilityRequirementDeclaration = {
    requirementId: 'requirement:required-unresolved',
    scopeRef: SCOPE,
    requiredSlices: [
      {
        requirementSliceId: 'requirement-slice:image',
        capability: 'image.generate',
        profileSliceRef: 'slice:image',
        readinessPolicy: 'required',
        runtimeDescriptor: {
          executionMode: 'local',
          execution: {
            backend: 'diffusers',
            backend_class: 'python_pipeline',
            backend_family: 'diffusers',
          },
          model: { family: 'sdxl' },
          contractState: 'proposed',
        },
      },
    ],
    optionalSlices: [
      {
        requirementSliceId: 'requirement-slice:optional-text',
        capability: 'text.generate',
        profileSliceRef: 'slice:text',
        readinessPolicy: 'optional',
      },
    ],
    setupProjectionPolicy: 'runtime_no_live_config',
  };

  const descriptor = formRuntimeProfileDescriptor({
    profile,
    requirementDeclarations: [requirement],
    descriptorId: 'descriptor:required-unresolved',
    sourceProfileDigest: 'sha256:required-unresolved',
  });

  assert.deepEqual(descriptor.capability_slices.map((slice) => slice.capability), ['image.generate']);
  assert.equal(descriptor.capability_slices[0].execution?.backend, 'diffusers');
  assert.equal(descriptor.capability_slices[0].contract_state, 'proposed');
});
