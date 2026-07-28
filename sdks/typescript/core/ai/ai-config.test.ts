import assert from 'node:assert/strict';
import test from 'node:test';

import { SchedulingState } from '../../core-generated/runtime-typed-client';
import { ReasonCode } from '../../types';
import {
  applyNimiAIProfileToConfig,
  assertNimiAppAIScopeRef,
  assertNimiBuiltInChatAIScopeRef,
  createNimiAIConfigEvidence,
  createNimiAIConfigSubscriptionRegistry,
  coerceNimiAITextGenerationParams,
  buildNimiRuntimeAISchedulingRequest,
  createEmptyNimiAIConfig,
  createNimiAIConfigStore,
  createNimiAIHostSurface,
  createNimiAppAIScopeRef,
  createNimiBuiltInChatAIScopeRef,
  createNimiAIScopeRef,
  createNimiAISnapshotRecord,
  createNimiAISnapshotExecutionId,
  createNimiAISnapshotStore,
  diffNimiAIConfigs,
  createNimiRuntimeAISchedulingClient,
  encodeNimiAIScopeRef,
  ensureNimiAppFirstLaunchAIConfig,
  formNimiRuntimeProfileDescriptor,
  isNimiAppAIScopeRef,
  isNimiBuiltInChatAIScopeRef,
  nimiBuiltInChatAIScopeRefs,
  parseExportedNimiAccountProfileLibraryProfiles,
  parseNimiAccountProfileLibraryIndexEntry,
  parseNimiAccountProfileLibraryOrigin,
  parseNimiAIProfile,
  parseNimiAccountProfileLibraryProjection,
  parseNimiAccountProfileLibraryProfile,
  parseNimiAIScopeRefKey,
  previewNimiAIProfileApply,
  projectNimiAIProfileApply,
  resolveNimiRuntimeImageCompanionSlots,
  resolveNimiAIConfigRuntimeBinding,
  serializeNimiRuntimeProfileDescriptor,
  toNimiRuntimeProfileDescriptorWire,
  validateNimiAIConfig,
  validateNimiAIConfigTargetRef,
  validateNimiAIProfile,
  versionNimiAIConfig,
  type NimiAIHostStorage,
  type NimiAIProfile,
  type NimiAIValidationIssue,
  type NimiAIValidationIssueCode,
} from './index';

function assertValidationIssue(
  issues: readonly NimiAIValidationIssue[],
  code: NimiAIValidationIssueCode,
  path: string,
): void {
  assert.equal(issues.some((issue) => issue.code === code && issue.path === path), true);
}

function createMemoryStorage(): NimiAIHostStorage & { readonly values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

const SCOPE = createNimiAIScopeRef({
  kind: 'app',
  ownerId: 'dev.nimi.wave4',
  surfaceId: 'chat',
});

const READY_PROFILE: NimiAIProfile = {
  profileId: 'profile-chat',
  title: 'Chat profile',
  description: 'Runtime-backed chat profile',
  tags: ['chat'],
  capabilities: {
    'text.generate': {
      targetRef: {
        kind: 'local-runtime',
        version: 'v2',
        profileBindingId: 'runtime-profile-binding-chat',
      },
      params: { temperature: 0.2 },
      runtimeDescriptor: {
        executionMode: 'local',
        execution: { backend: 'llama.cpp' },
        model: { family: 'llama' },
      },
    },
  },
};

test('image model family companion contract distinguishes Ideogram4 and Z-Image requirements', () => {
  assert.deepEqual(
    resolveNimiRuntimeImageCompanionSlots('ideogram4').map((slot) => [slot.engineSlot, slot.required]),
    [
      ['uncond_diffusion_model', true],
      ['llm_path', true],
      ['vae_path', true],
    ],
  );
  assert.deepEqual(
    resolveNimiRuntimeImageCompanionSlots('z-image').map((slot) => [slot.engineSlot, slot.required]),
    [
      ['llm_path', true],
      ['vae_path', true],
    ],
  );
  assert.deepEqual(
    resolveNimiRuntimeImageCompanionSlots('z-image-turbo').map((slot) => [slot.engineSlot, slot.required]),
    [
      ['llm_path', true],
      ['vae_path', true],
    ],
  );
  assert.deepEqual(
    resolveNimiRuntimeImageCompanionSlots('z_image_turbo').map((slot) => slot.engineSlot),
    ['llm_path', 'vae_path'],
  );
  assert.deepEqual(
    resolveNimiRuntimeImageCompanionSlots('z-image-base').map((slot) => slot.engineSlot),
    ['llm_path', 'vae_path'],
  );
  assert.equal(
    resolveNimiRuntimeImageCompanionSlots('sdxl').some((slot) => slot.engineSlot === 'uncond_diffusion_model'),
    false,
  );
});

function requirementDeclaration(
  capabilities: readonly string[] = ['text.generate'],
  scopeRef = SCOPE,
) {
  return {
    requirementId: `requirement:${scopeRef.ownerId}:${scopeRef.surfaceId ?? 'default'}:${capabilities.join('+')}`,
    scopeRef,
    requiredSlices: capabilities.map((capability) => ({
      requirementSliceId: `slice:${capability}`,
      capability,
      profileSliceRef: `slice:${capability}`,
      readinessPolicy: 'required' as const,
    })),
    setupProjectionPolicy: 'sdk-ai-config-setup-projection',
  };
}

const CHAT_REQUIREMENT = requirementDeclaration();

test('Nimi AI scope keys are explicit and reversible', () => {
  const key = encodeNimiAIScopeRef(SCOPE);

  assert.equal(key, 'app:dev.nimi.wave4:chat');
  assert.deepEqual(parseNimiAIScopeRefKey(key), SCOPE);
  assert.throws(
    () => createNimiAIScopeRef({ kind: 'app', ownerId: '' }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === ReasonCode.SDK_AI_INPUT_INVALID,
  );
});

test('AIConfig runtime binding resolver projects live targets and metadata', () => {
  const config = {
    scopeRef: SCOPE,
    capabilities: {
      targetRefs: {
        'text.generate': {
          kind: 'cloud-connector' as const,
          connectorId: 'openrouter',
          remoteModelCatalogId: 'remote-catalog-openrouter-gemini',
          providerModelId: 'google/gemini-2.5-pro',
          provider: 'OpenRouter',
        },
      },
      selectedParams: {
        'text.generate': { temperature: '0.7' },
      },
    },
    profileOrigin: {
      profileId: 'profile-1',
      title: 'Profile One',
      appliedAt: '2026-01-01T00:00:00.000Z',
    },
  };

  const resolved = resolveNimiAIConfigRuntimeBinding({
    config,
    capabilityId: 'chat.stream',
    bindingCapabilityId: 'text.generate',
  });

  assert.equal(resolved.ok, true);
  if (!resolved.ok) throw new Error(resolved.message);
  assert.equal(resolved.binding.model, 'google/gemini-2.5-pro');
  assert.equal(resolved.binding.routePolicy, 'cloud');
  assert.equal(resolved.binding.connectorId, 'openrouter');
  assert.deepEqual(resolved.binding.schedulingTarget, {
    capability: 'text.generate',
    targetRef: config.capabilities.targetRefs['text.generate'],
  });
  assert.deepEqual(resolved.binding.selectedParams, { temperature: '0.7' });
  assert.equal(resolved.binding.metadata.aiConfigCapabilityId, 'chat.stream');
  assert.equal(resolved.binding.metadata.aiConfigBindingCapabilityId, 'text.generate');
  assert.equal(resolved.binding.metadata.aiConfigBindingSource, 'cloud');
  assert.equal(resolved.binding.metadata.aiConfigBindingConnectorId, 'openrouter');
  assert.equal(resolved.binding.metadata.aiConfigBindingModel, 'google/gemini-2.5-pro');
  assert.equal(resolved.binding.metadata.aiConfigProfileId, 'profile-1');
  assert.equal(typeof resolved.binding.metadata.aiConfigHash, 'string');
});

test('AIConfig runtime binding resolver fails closed for unavailable targets', () => {
  const base = {
    scopeRef: SCOPE,
    capabilities: {
      targetRefs: {},
      selectedParams: {},
    },
    profileOrigin: null,
  };

  const missingBinding = resolveNimiAIConfigRuntimeBinding({
    config: base,
    capabilityId: 'text.generate',
    bindingCapabilityId: null,
  });
  assert.equal(missingBinding.ok, false);
  if (missingBinding.ok) throw new Error('expected missing binding capability failure');
  assert.equal(missingBinding.reason, 'binding-capability-missing');

  assert.equal(resolveNimiAIConfigRuntimeBinding({
    config: base,
    capabilityId: 'text.generate',
    bindingCapabilityId: 'text.generate',
  }).ok, false);

  const profileSlice = resolveNimiAIConfigRuntimeBinding({
    config: {
      ...base,
      capabilities: {
        targetRefs: {
          'text.generate': {
            kind: 'profile-slice',
            sourceProfileId: 'profile-1',
            sliceId: 'slice-text',
          },
        },
        selectedParams: {},
      },
    },
    capabilityId: 'text.generate',
    bindingCapabilityId: 'text.generate',
  });
  assert.equal(profileSlice.ok, false);
  if (profileSlice.ok) throw new Error('expected profile slice failure');
  assert.equal(profileSlice.reason, 'profile-slice-unmaterialized');
});

test('AIConfig text generation params coercion accepts strings and fails invalid values', () => {
  const coerced = coerceNimiAITextGenerationParams({
    temperature: '0.7',
    topP: 0.95,
    topK: '40',
    maxTokens: '2048',
    presencePenalty: '-0.1',
    frequencyPenalty: 0.2,
    timeoutMs: '120000',
    stopSequences: ['END', ''],
  });

  assert.equal(coerced.ok, true);
  if (!coerced.ok) throw new Error(coerced.message);
  assert.deepEqual(coerced.value, {
    parameters: {
      temperature: 0.7,
      topP: 0.95,
      topK: 40,
      maxTokens: 2048,
      presencePenalty: -0.1,
      frequencyPenalty: 0.2,
      stop: ['END'],
    },
    timeoutMs: 120000,
  });

  const invalidMaxTokens = coerceNimiAITextGenerationParams({ maxTokens: '1.5' });
  assert.equal(invalidMaxTokens.ok, false);
  if (invalidMaxTokens.ok) throw new Error('expected maxTokens coercion failure');
  assert.equal(invalidMaxTokens.field, 'maxTokens');

  const invalidTemperature = coerceNimiAITextGenerationParams({ temperature: 'hot' });
  assert.equal(invalidTemperature.ok, false);
  if (invalidTemperature.ok) throw new Error('expected temperature coercion failure');
  assert.equal(invalidTemperature.field, 'temperature');

  const invalidStopSequences = coerceNimiAITextGenerationParams({ stopSequences: 'END' });
  assert.equal(invalidStopSequences.ok, false);
  if (invalidStopSequences.ok) throw new Error('expected stopSequences coercion failure');
  assert.equal(invalidStopSequences.field, 'stopSequences');
});

test('Nimi AI scope and target validation fail closed across admitted families', () => {
  const builtInNimi = createNimiBuiltInChatAIScopeRef('nimi');
  const builtInAgent = createNimiBuiltInChatAIScopeRef('agent');

  assert.deepEqual(nimiBuiltInChatAIScopeRefs(), [builtInNimi, builtInAgent]);
  assert.equal(isNimiBuiltInChatAIScopeRef(builtInNimi), true);
  assert.equal(isNimiBuiltInChatAIScopeRef(SCOPE), false);
  assert.equal(isNimiAppAIScopeRef(SCOPE), true);
  assert.deepEqual(assertNimiAppAIScopeRef(SCOPE), SCOPE);
  assert.deepEqual(assertNimiBuiltInChatAIScopeRef(builtInAgent), builtInAgent);
  assert.equal(parseNimiAIScopeRefKey('app:only-two-parts'), null);
  assert.equal(parseNimiAIScopeRefKey('app:%E0%A4%A:chat'), null);
  assert.throws(
    () => assertNimiBuiltInChatAIScopeRef(SCOPE),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === ReasonCode.SDK_SCOPE_CATALOG_INVALID,
  );
  assert.throws(
    () => assertNimiAppAIScopeRef(builtInNimi),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === ReasonCode.SDK_SCOPE_CATALOG_INVALID,
  );

  assert.deepEqual(validateNimiAIConfigTargetRef({
    kind: 'profile-slice',
    sourceProfileId: 'profile-1',
    sliceId: 'slice-1',
  }, 'target'), []);
  assertValidationIssue(validateNimiAIConfigTargetRef({
    kind: 'profile-slice',
    sliceId: '',
  }, 'target'), 'AI_FIELD_REQUIRED', 'target.sourceProfileId');
  assertValidationIssue(validateNimiAIConfigTargetRef({
    kind: 'local-runtime',
  }, 'target'), 'AI_TARGET_REF_BINDING_REQUIRED', 'target');
  assertValidationIssue(validateNimiAIConfigTargetRef({
    kind: 'local-runtime',
    version: 'v2',
    targetId: 'legacy-target',
    profileId: 'legacy-profile',
  }, 'target'), 'AI_FIELD_RETIRED', 'target.targetId');
  assertValidationIssue(validateNimiAIConfigTargetRef({
    kind: 'cloud-connector',
    connectorId: 'connector-1',
    providerModelId: 'model-1',
  }, 'target'), 'AI_FIELD_REQUIRED', 'target.remoteModelCatalogId');
  assertValidationIssue(validateNimiAIConfigTargetRef({
    kind: 'unsupported',
  }, 'target'), 'AI_TARGET_REF_KIND_UNSUPPORTED', 'target.kind');

  assert.deepEqual(validateNimiAIConfig(null), {
    valid: false,
    issues: [{ code: 'AI_TYPE_INVALID', path: 'config' }],
  });
  assertValidationIssue(validateNimiAIConfig({
    scopeRef: SCOPE,
    capabilities: { targetRefs: [] },
  }).issues, 'AI_TYPE_INVALID', 'config.capabilities.targetRefs');
  assertValidationIssue(validateNimiAIConfig({
    scopeRef: SCOPE,
    capabilities: {
      targetRefs: {
        'text.generate': {
          kind: 'cloud-connector',
          connectorId: 'connector-1',
          remoteModelCatalogId: 'remote-catalog-1',
          providerModelId: 'model-1',
          secret: 'forbidden',
        },
      },
    },
  }).issues, 'AI_FIELD_FORBIDDEN', 'config.capabilities.targetRefs.text.generate.secret');
  assertValidationIssue(validateNimiAIConfig({
    scopeRef: SCOPE,
    capabilities: {
      targetRefs: {
        'text.generate': {
          kind: 'local-runtime',
          version: 'v2',
          readinessRef: 'readiness:text',
          runtime: {
            runtimeBaselineRef: 'baseline',
            runtimeConsumerId: 'llama.cpp.cpu',
            boundAssetId: 'asset:text',
            modelResolved: 'asset:text',
            runtimeExecutionTraceId: 'trace-runtime',
          },
        },
      },
    },
  }).issues, 'AI_FIELD_FORBIDDEN', 'config.capabilities.targetRefs.text.generate.runtime.runtimeBaselineRef');
});

test('Nimi AI profile validation rejects hidden Runtime/private payloads', () => {
  const validation = validateNimiAIProfile({
    ...READY_PROFILE,
    capabilities: {
      'text.generate': {
        binding: { secret: 'do-not-store' },
      },
    },
  });

  assert.equal(validation.valid, false);
  assertValidationIssue(
    validation.issues,
    'AI_FIELD_FORBIDDEN',
    'profile.capabilities.text.generate.binding',
  );
  assertValidationIssue(
    validation.issues,
    'AI_FIELD_FORBIDDEN',
    'profile.capabilities.text.generate.binding.secret',
  );
});

test('Nimi AI profile parsing and runtime descriptor projection cover failure boundaries', () => {
  assert.deepEqual(parseNimiAIProfile({
    profileId: 'minimal',
    title: 'Minimal',
    capabilities: {},
  }, { allowMissingOptionalFields: true }), {
    profileId: 'minimal',
    title: 'Minimal',
    description: undefined,
    tags: [],
    capabilities: {},
  });
  assert.throws(
    () => parseNimiAIProfile({
      profileId: 'minimal',
      title: 'Minimal',
      capabilities: {},
    }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_AI_PAYLOAD_INVALID',
  );

  const unsupportedProfile: NimiAIProfile = {
    profileId: 'unsupported',
    title: 'Unsupported',
    capabilities: {
      'text.generate': { contractState: 'unsupported' },
      'image.generate': { contractState: 'proposed' },
      'audio.synthesize': { readinessPolicy: 'optional' },
    },
  };
  const projection = projectNimiAIProfileApply({
    scopeRef: SCOPE,
    profile: unsupportedProfile,
    requirementDeclarations: [requirementDeclaration(['text.generate', 'image.generate'])],
  });
  assert.equal(projection.outcome, 'unsupported_no_live_config');
  assert.deepEqual(projection.setupProjection?.reasonCodes, ['product_state_unsupported', 'product_state_proposed']);
  assert.equal(previewNimiAIProfileApply({
    before: null,
    scopeRef: SCOPE,
    profile: {
      profileId: '',
      title: '',
      capabilities: {},
    },
    requirementDeclarations: [CHAT_REQUIREMENT],
  }).outcome, 'invalid_profile');
  assert.throws(
    () => applyNimiAIProfileToConfig({
      config: createEmptyNimiAIConfig(SCOPE),
      profile: {
        profileId: '',
        title: '',
        capabilities: {},
      },
      requirementDeclarations: [CHAT_REQUIREMENT],
    }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_AI_PROFILE_INVALID',
  );

  const cloudProfile: NimiAIProfile = {
    profileId: 'cloud-profile',
    title: 'Cloud Profile',
    capabilities: {
      'text.generate': {
        targetRef: {
          kind: 'cloud-connector',
          connectorId: 'connector-1',
          remoteModelCatalogId: 'remote-catalog-1',
          provider: 'openai-compatible',
          providerModelId: 'model-1',
        },
        runtimeDescriptor: {
          executionMode: 'cloud_connector',
          providerCapability: 'text.generate',
          credentialPolicy: 'managed',
        },
      },
    },
  };
  const descriptor = formNimiRuntimeProfileDescriptor({
    profile: cloudProfile,
    descriptorId: 'descriptor-cloud',
    sourceProfileDigest: 'digest-cloud',
    projectedAt: '2026-06-05T00:00:00.000Z',
    requirementDeclarations: [{
      requirementId: 'req-cloud',
      scopeRef: SCOPE,
      setupProjectionPolicy: 'fail-closed',
      requiredSlices: [{
        requirementSliceId: 'slice-cloud',
        capability: 'text.generate',
        profileSliceRef: 'text-cloud',
        readinessPolicy: 'required',
      }],
      optionalSlices: [{
        requirementSliceId: 'slice-optional-missing',
        capability: 'image.generate',
        profileSliceRef: 'image-missing',
        readinessPolicy: 'optional',
      }],
    }],
  });
  assert.equal(descriptor.capabilitySlices[0]?.executionMode, 'cloud_connector');
  assert.equal(descriptor.capabilitySlices[0]?.provider, 'openai-compatible');
  assert.equal(descriptor.capabilitySlices[0]?.connectorSelector, 'connector-1');
  assert.equal(descriptor.capabilitySlices.length, 1);

  assert.throws(
    () => formNimiRuntimeProfileDescriptor({
      profile: READY_PROFILE,
      descriptorId: '',
      sourceProfileDigest: 'digest',
      requirementDeclarations: [],
    }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === ReasonCode.SDK_AI_INPUT_INVALID,
  );
  assert.throws(
    () => formNimiRuntimeProfileDescriptor({
      profile: READY_PROFILE,
      descriptorId: 'descriptor-empty',
      sourceProfileDigest: 'digest',
      requirementDeclarations: [],
    }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_AI_RUNTIME_DESCRIPTOR_INVALID',
  );
  assert.throws(
    () => formNimiRuntimeProfileDescriptor({
      profile: {
        profileId: 'missing-local-fields',
        title: 'Missing local fields',
        capabilities: {
          'text.generate': {
            runtimeDescriptor: {
              executionMode: 'local',
              execution: {},
              model: {},
            },
          },
        },
      },
      descriptorId: 'descriptor-local-invalid',
      sourceProfileDigest: 'digest',
      requirementDeclarations: [{
        requirementId: 'req-local',
        scopeRef: SCOPE,
        setupProjectionPolicy: 'fail-closed',
        requiredSlices: [{
          requirementSliceId: 'slice-local',
          capability: 'text.generate',
          profileSliceRef: 'text-local',
          readinessPolicy: 'required',
        }],
      }],
    }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_AI_RUNTIME_DESCRIPTOR_INVALID',
  );
});

test('Nimi runtime profile descriptor serialization emits Runtime wire JSON bytes', () => {
  const mediaProfile: NimiAIProfile = {
    profileId: 'factory:z-image',
    version: '1',
    revision: 'rev-1',
    title: 'Z Image',
    capabilities: {
      'image.generate': {
        runtimeDescriptor: {
          executionMode: 'local',
          runtimeConsumerId: 'stable-diffusion.cpp.metal',
          execution: {
            backend: 'stablediffusion-ggml',
            backendClass: 'native_binary',
            backendFamily: 'stablediffusion-ggml',
          },
          model: { family: 'flux' },
          assetRefs: ['main'],
          orderedCompanionOccurrences: [{
            occurrenceId: 'qwen-text-encoder',
            order: 0,
            role: 'text_encoder',
            engineSlot: 'llm_path',
            assetBindingRef: 'qwen',
            required: true,
          }, {
            occurrenceId: 'z-image-ae',
            order: 1,
            role: 'vae',
            engineSlot: 'vae_path',
            assetBindingRef: 'ae',
            required: true,
            options: { precision: 'fp16' },
            appliesTo: ['slice:image-native'],
          }],
        },
      },
    },
    assetBindings: [{
      bindingId: 'main',
      assetRole: 'main',
      componentKind: 'image',
      source: 'huggingface',
      expectedIdentity: 'z_image_turbo',
      readinessPolicy: 'required',
      huggingFace: {
        repoId: 'nimiplatform/z-image',
        revision: 'main',
        entries: ['z-image.gguf'],
        accessPolicy: 'public',
        repoType: 'model',
        format: 'gguf',
      },
    }, {
      bindingId: 'qwen',
      assetRole: 'companion',
      componentKind: 'chat',
      source: 'huggingface',
      expectedIdentity: 'qwen3_4b_companion',
      readinessPolicy: 'required',
      huggingFace: {
        repoId: 'nimiplatform/qwen3-4b',
        revision: 'main',
        entries: ['Qwen3-4B-Q4_K_M.gguf'],
        accessPolicy: 'public',
      },
    }, {
      bindingId: 'ae',
      assetRole: 'companion',
      componentKind: 'vae',
      source: 'manual',
      expectedIdentity: 'z_image_ae',
      readinessPolicy: 'required',
      manual: {
        expectedName: 'ae.safetensors',
        associationInstructions: 'Associate the VAE companion with the Z Image profile.',
        expectedFormat: 'safetensors',
        allowedFilePatterns: ['*.safetensors'],
      },
    }],
    defaultParams: { steps: 8 },
    editableFields: ['steps'],
    prepareRequirements: ['native_backend_package'],
    contractStates: ['declared'],
    projectionWarnings: ['setup_required_until_runtime_prepare'],
  };

  const descriptor = formNimiRuntimeProfileDescriptor({
    profile: mediaProfile,
    descriptorId: 'descriptor:z-image',
    sourceProfileDigest: 'sha256:z-image',
    projectedAt: '2026-06-06T00:00:00.000Z',
    requirementDeclarations: [{
      requirementId: 'requirement:z-image',
      scopeRef: SCOPE,
      setupProjectionPolicy: 'sdk-ai-config-setup-projection',
      requiredSlices: [{
        requirementSliceId: 'slice:image-native',
        capability: 'image.generate',
        profileSliceRef: 'slice:image-native',
        readinessPolicy: 'required',
        editableFieldRefs: ['steps'],
      }],
      runtimeActivationConsumers: [{
        requirementSliceId: 'slice:image-native',
        consumerId: 'desktop.chat.generate',
        consumerScope: 'app:dev.nimi.wave4:chat',
      }],
      editableFields: ['steps'],
      readinessProjectionRefs: ['runtime.local.prepareProfileRuntimeDescriptor'],
    }],
  });

  assert.equal(descriptor.profileRef.profileId, 'factory:z-image');
  assert.equal(descriptor.capabilitySlices[0]?.consumerId, 'desktop.chat.generate');
  assert.equal(descriptor.capabilitySlices[0]?.runtimeConsumerId, 'stable-diffusion.cpp.metal');
  assert.equal(descriptor.assetBindings?.length, 3);

  const wire = toNimiRuntimeProfileDescriptorWire(descriptor);
  assert.equal(wire.schema_version, 1);
  assert.equal(wire.profile_ref.profile_id, 'factory:z-image');
  assert.equal(wire.projection_origin.projected_at, '2026-06-06T00:00:00.000Z');
  assert.equal(wire.capability_slices[0]?.execution?.backend_class, 'native_binary');
  assert.deepEqual(wire.capability_slices[0]?.asset_refs, ['main']);
  assert.equal(wire.capability_slices[0]?.consumer_id, 'desktop.chat.generate');
  assert.equal(wire.capability_slices[0]?.runtime_consumer_id, 'stable-diffusion.cpp.metal');
  assert.deepEqual(wire.capability_slices[0]?.ordered_companion_occurrences?.map((occurrence) => ({
    occurrenceId: occurrence.occurrence_id,
    order: occurrence.order,
    engineSlot: occurrence.engineSlot,
    binding: occurrence.asset_binding_ref,
  })), [{
    occurrenceId: 'qwen-text-encoder',
    order: 0,
    engineSlot: 'llm_path',
    binding: 'qwen',
  }, {
    occurrenceId: 'z-image-ae',
    order: 1,
    engineSlot: 'vae_path',
    binding: 'ae',
  }]);
  assert.equal(wire.asset_bindings?.[0]?.huggingface?.repo_id, 'nimiplatform/z-image');
  assert.equal(wire.asset_bindings?.[2]?.manual?.expected_name, 'ae.safetensors');
  assert.equal(JSON.stringify(wire).includes('prepared_asset_id'), false);

  const descriptorJson = serializeNimiRuntimeProfileDescriptor(descriptor);
  const runtimePrepareRequest = { descriptorJson };
  assert.equal(runtimePrepareRequest.descriptorJson instanceof Uint8Array, true);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(runtimePrepareRequest.descriptorJson)), wire);
});

test('Nimi AI profile apply is scoped to declared ready requirement slices', () => {
  const scopedProfile: NimiAIProfile = {
    profileId: 'profile-scoped',
    title: 'Scoped profile',
    capabilities: {
      'text.generate': {
      targetRef: {
        kind: 'local-runtime',
        version: 'v2',
        profileBindingId: 'runtime-profile-binding-text',
      },
        params: { temperature: 0.1 },
      },
      'image.generate': {
        readinessPolicy: 'required',
      },
    },
  };
  const textRequirement = requirementDeclaration(['text.generate']);
  const imageRequirement = requirementDeclaration(['image.generate']);

  const textPreview = previewNimiAIProfileApply({
    before: null,
    scopeRef: SCOPE,
    profile: scopedProfile,
    requirementDeclarations: [textRequirement],
    now: () => '2026-06-06T00:00:00.000Z',
  });
  assert.equal(textPreview.outcome, 'ready_to_apply');
  assert.deepEqual(Object.keys(textPreview.after?.capabilities.targetRefs ?? {}), ['text.generate']);
  assert.equal(textPreview.after?.capabilities.targetRefs['text.generate']?.kind, 'local-runtime');
  assert.equal('image.generate' in (textPreview.after?.capabilities.targetRefs ?? {}), false);

  const imagePreview = previewNimiAIProfileApply({
    before: null,
    scopeRef: SCOPE,
    profile: scopedProfile,
    requirementDeclarations: [imageRequirement],
  });
  assert.equal(imagePreview.outcome, 'setup_required_no_live_config');
  assert.deepEqual(imagePreview.setupProjection?.blockingCapabilities, ['image.generate']);
  assert.deepEqual(imagePreview.setupProjection?.reasonCodes, ['required_slice_unresolved']);
});

test('Nimi runtime profile descriptor serialization rejects Runtime evidence and ambiguous consumers', () => {
  assert.throws(
    () => formNimiRuntimeProfileDescriptor({
      profile: READY_PROFILE,
      descriptorId: 'descriptor-ambiguous-consumer',
      sourceProfileDigest: 'digest-profile-chat',
      requirementDeclarations: [{
        requirementId: 'chat-requirement',
        scopeRef: SCOPE,
        setupProjectionPolicy: 'fail-closed',
        requiredSlices: [{
          requirementSliceId: 'slice-text',
          capability: 'text.generate',
          profileSliceRef: 'text-generate-local',
          readinessPolicy: 'required',
        }],
        optionalSlices: [{
          requirementSliceId: 'slice-extra',
          capability: 'image.generate',
          profileSliceRef: 'image-local',
          readinessPolicy: 'optional',
        }],
        runtimeActivationConsumers: [{
          consumerId: 'desktop.chat.generate',
        }],
      }],
    }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_AI_REQUIREMENT_INVALID',
  );
  assert.throws(
    () => formNimiRuntimeProfileDescriptor({
      profile: {
        ...READY_PROFILE,
        assetBindings: [{
          bindingId: 'main',
          assetRole: 'main',
          componentKind: 'text',
          source: 'huggingface',
          expectedIdentity: 'llama',
          readinessPolicy: 'required',
          preparedAssetId: 'asset:main',
          huggingFace: {
            repoId: 'nimiplatform/llama',
            revision: 'main',
            entries: ['model.gguf'],
            accessPolicy: 'public',
          },
        }],
      } as unknown as NimiAIProfile,
      descriptorId: 'descriptor-forbidden',
      sourceProfileDigest: 'digest-profile-chat',
      requirementDeclarations: [{
        requirementId: 'chat-requirement',
        scopeRef: SCOPE,
        setupProjectionPolicy: 'fail-closed',
        requiredSlices: [{
          requirementSliceId: 'slice-text',
          capability: 'text.generate',
          profileSliceRef: 'text-generate-local',
          readinessPolicy: 'required',
        }],
      }],
    }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_AI_PROFILE_INVALID',
  );
});

test('Nimi runtime profile descriptor keeps proposed and unsupported workflow shapes explicit', () => {
  const descriptor = formNimiRuntimeProfileDescriptor({
    profile: {
      profileId: 'profile-workflow-fail-closed',
      title: 'Workflow fail closed',
      capabilities: {
        'image.generate': {
          contractState: 'proposed',
          runtimeDescriptor: {
            executionMode: 'local',
            execution: { backend: 'diffusers', backendFamily: 'diffusers' },
            model: { family: 'sdxl' },
          },
        },
        'video.generate': {
          contractState: 'unsupported',
          runtimeDescriptor: {
            executionMode: 'local',
            execution: { backend: 'video.pipeline', backendFamily: 'video.pipeline' },
            model: { family: 'wan' },
          },
        },
      },
    },
    descriptorId: 'descriptor-workflow-fail-closed',
    sourceProfileDigest: 'sha256:workflow',
    projectedAt: '2026-06-06T00:00:00.000Z',
    requirementDeclarations: [{
      requirementId: 'requirement-workflow',
      scopeRef: SCOPE,
      setupProjectionPolicy: 'sdk-ai-config-setup-projection',
      requiredSlices: [{
        requirementSliceId: 'slice-image-diffusers',
        capability: 'image.generate',
        profileSliceRef: 'slice-image-diffusers',
        readinessPolicy: 'required',
      }, {
        requirementSliceId: 'slice-video',
        capability: 'video.generate',
        profileSliceRef: 'slice-video',
        readinessPolicy: 'required',
      }],
    }],
  });

  const wire = toNimiRuntimeProfileDescriptorWire(descriptor);
  assert.deepEqual(wire.capability_slices.map((slice) => ({
    capability: slice.capability,
    backend: slice.execution?.backend,
    family: slice.model?.family,
    contractState: slice.contract_state,
  })), [{
    capability: 'image.generate',
    backend: 'diffusers',
    family: 'sdxl',
    contractState: 'proposed',
  }, {
    capability: 'video.generate',
    backend: 'video.pipeline',
    family: 'wan',
    contractState: 'unsupported',
  }]);
});

test('Nimi AI host surface previews and applies profiles without implicit storage fallback', async () => {
  const storage = createMemoryStorage();
  const configStore = createNimiAIConfigStore({ storage: () => storage });
  const snapshotStore = createNimiAISnapshotStore({ storage: () => storage });
  const surface = createNimiAIHostSurface({
    profiles: [READY_PROFILE],
    configStore,
    snapshotStore,
    now: () => '2026-06-04T00:00:00.000Z',
  });
  const notifications: string[] = [];
  surface.aiConfig.subscribe(SCOPE, (config) => {
    notifications.push(versionNimiAIConfig(config));
  });

  const preview = await surface.aiProfile.previewApply(SCOPE, 'profile-chat', {
    requirementDeclarations: [CHAT_REQUIREMENT],
  });

  assert.equal(preview.outcome, 'ready_to_apply');
  assert.equal(preview.before, null);
  assert.equal(preview.after?.profileOrigin?.profileId, 'profile-chat');
  assert.equal(configStore.has(SCOPE), false);
  assert.deepEqual(notifications, []);

  const applied = await surface.aiProfile.apply(SCOPE, 'profile-chat', {
    expectedBaseVersion: preview.baseVersion,
    requirementDeclarations: [CHAT_REQUIREMENT],
  });

  assert.equal(applied.success, true);
  assert.equal(surface.aiConfig.get(SCOPE).profileOrigin?.appliedAt, '2026-06-04T00:00:00.000Z');
  assert.equal(notifications.length, 1);
  assert.deepEqual(surface.aiConfig.listScopes(), [SCOPE]);

  const stale = await surface.aiProfile.apply(SCOPE, 'profile-chat', {
    expectedBaseVersion: preview.baseVersion,
    requirementDeclarations: [CHAT_REQUIREMENT],
  });
  assert.equal(stale.success, false);
  assert.equal(stale.outcome, 'stale_base');

  const snapshot = createNimiAISnapshotRecord({
    executionId: 'exec-1',
    scopeRef: SCOPE,
    config: surface.aiConfig.get(SCOPE),
    capability: 'text.generate',
    selectedTargetRef: surface.aiConfig.get(SCOPE).capabilities.targetRefs['text.generate'] ?? null,
    createdAt: '2026-06-04T00:00:01.000Z',
  });
  surface.aiSnapshot.record(SCOPE, snapshot);
  assert.equal(surface.aiSnapshot.getLatest(SCOPE)?.executionId, 'exec-1');
  assert.equal(snapshot.configEvidence.capabilityBindingKeys.includes('text.generate'), true);
  assert.equal(snapshot.conversationCapabilitySlice.capability, 'text.generate');
});

test('Nimi AI config store fails closed without host storage or explicit ephemeral mode', () => {
  const store = createNimiAIConfigStore();

  assert.throws(
    () => store.has(SCOPE),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_AI_HOST_STORAGE_REQUIRED',
  );

  const ephemeral = createNimiAIConfigStore({ enableEphemeralStore: true });
  assert.equal(ephemeral.has(SCOPE), false);
  ephemeral.save(createEmptyNimiAIConfig(SCOPE));
  assert.equal(ephemeral.has(SCOPE), true);
});

test('Nimi AI config and snapshot stores validate stored state and host boundaries', () => {
  const storage = createMemoryStorage();
  const store = createNimiAIConfigStore({ storage: () => storage });
  const scopeKey = encodeNimiAIScopeRef(SCOPE);
  const otherScope = createNimiAppAIScopeRef('dev.nimi.other', 'chat');
  storage.values.set(`nimi:ai-config:${scopeKey}`, JSON.stringify(createEmptyNimiAIConfig(otherScope)));
  assert.throws(
    () => store.loadOrNull(SCOPE),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_AI_CONFIG_SCOPE_MISMATCH',
  );

  storage.values.set(`nimi:ai-config:${scopeKey}`, JSON.stringify({
    scopeRef: SCOPE,
    capabilities: { targetRefs: { 'text.generate': { kind: 'unknown' } }, selectedParams: {} },
  }));
  assert.throws(
    () => store.loadOrNull(SCOPE),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_AI_CONFIG_INVALID',
  );
  assert.throws(
    () => store.save({
      scopeRef: SCOPE,
      capabilities: { targetRefs: { 'text.generate': { kind: 'unknown' } }, selectedParams: {} },
      profileOrigin: null,
    }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_AI_CONFIG_INVALID',
  );

  storage.values.set('nimi:ai-config:index', JSON.stringify([
    scopeKey,
    'not-a-scope',
    encodeNimiAIScopeRef(otherScope),
  ]));
  assert.deepEqual(store.listScopeRefs(), [SCOPE, otherScope]);

  const notifications: string[] = [];
  const registry = createNimiAIConfigSubscriptionRegistry();
  const unsubscribe = registry.subscribe(SCOPE, (config) => {
    notifications.push(versionNimiAIConfig(config));
  });
  const config = applyNimiAIProfileToConfig({
    config: createEmptyNimiAIConfig(SCOPE),
    profile: READY_PROFILE,
    requirementDeclarations: [CHAT_REQUIREMENT],
    now: () => '2026-06-05T00:00:00.000Z',
  });
  registry.notify(config);
  unsubscribe();
  registry.notify(config);
  assert.equal(notifications.length, 1);

  const evidence = createNimiAIConfigEvidence(config);
  assert.deepEqual(evidence.capabilityBindingKeys, ['text.generate']);
  assert.equal(diffNimiAIConfigs(null, null).identical, true);
  assert.equal(createNimiAISnapshotExecutionId(-1).length, 26);

  const snapshotStore = createNimiAISnapshotStore({
    storage: () => storage,
    maxSnapshots: 1,
  });
  const snapshot = createNimiAISnapshotRecord({
    executionId: 'exec-2',
    scopeRef: SCOPE,
    config,
    capability: 'text.generate',
    selectedTargetRef: config.capabilities.targetRefs['text.generate'] ?? null,
    runtimeEvidence: { schedulingJudgement: { state: 'runnable' } },
    createdAt: '2026-06-05T00:00:00.000Z',
  });
  assert.equal(snapshotStore.record(snapshot).runtimeEvidence?.schedulingJudgement?.state, 'runnable');
  assert.equal(snapshotStore.getLatest(SCOPE)?.executionId, 'exec-2');
  assert.throws(
    () => createNimiAISnapshotRecord({
      executionId: 'exec-mismatch',
      scopeRef: otherScope,
      config,
      capability: 'text.generate',
      selectedTargetRef: null,
      createdAt: '2026-06-05T00:00:00.000Z',
    }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_AI_SNAPSHOT_SCOPE_MISMATCH',
  );
  assert.throws(
    () => snapshotStore.record({
      ...snapshot,
      conversationCapabilitySlice: {
        ...snapshot.conversationCapabilitySlice,
        executionId: 'other-exec',
      },
    }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_AI_SNAPSHOT_EXECUTION_MISMATCH',
  );

  const surface = createNimiAIHostSurface({
    profiles: [READY_PROFILE],
    configStore: createNimiAIConfigStore({ enableEphemeralStore: true }),
  });
  assert.throws(
    () => surface.aiSnapshot.get('exec-1'),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_AI_SNAPSHOT_STORE_REQUIRED',
  );
});

test('Nimi AI profile apply and runtime descriptor formation fail closed on unresolved slices', async () => {
  const unresolvedProfile: NimiAIProfile = {
    profileId: 'profile-unresolved',
    title: 'Needs setup',
    capabilities: {
      'text.generate': {
        readinessPolicy: 'required',
      },
    },
  };
  const store = createNimiAIConfigStore({ enableEphemeralStore: true });
  const surface = createNimiAIHostSurface({
    profiles: [READY_PROFILE, unresolvedProfile],
    configStore: store,
  });

  const preview = await surface.aiProfile.previewApply(SCOPE, 'profile-unresolved', {
    requirementDeclarations: [CHAT_REQUIREMENT],
  });
  assert.equal(preview.outcome, 'setup_required_no_live_config');
  assert.equal(preview.after, null);

  assert.throws(
    () => applyNimiAIProfileToConfig({
      config: createEmptyNimiAIConfig(SCOPE),
      profile: unresolvedProfile,
      requirementDeclarations: [CHAT_REQUIREMENT],
    }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_AI_PROFILE_NOT_APPLYABLE',
  );

  const descriptor = await surface.aiProfile.formRuntimeDescriptor({
    profileId: 'profile-chat',
    descriptorId: 'descriptor-1',
    sourceProfileDigest: 'digest-profile-chat',
    projectedAt: '2026-06-04T00:00:00.000Z',
    requirementDeclarations: [{
      requirementId: 'chat-requirement',
      scopeRef: SCOPE,
      setupProjectionPolicy: 'fail-closed',
      requiredSlices: [{
        requirementSliceId: 'slice-text',
        capability: 'text.generate',
        profileSliceRef: 'text-generate-local',
        readinessPolicy: 'required',
      }],
    }],
  });

  assert.equal(descriptor.schemaVersion, 1);
  assert.equal(descriptor.capabilitySlices[0]?.execution?.backend, 'llama.cpp');
  assert.equal(descriptor.capabilitySlices[0]?.model?.family, 'llama');
});

test('Nimi AI account profile library parsing validates editable profile projections', () => {
  const projection = parseNimiAccountProfileLibraryProjection({
    accountId: 'acct-1',
    libraryRef: 'account-profile-library:acct-1',
    index: {
      schemaVersion: 1,
      accountId: 'acct-1',
      updatedAt: '2026-06-04T00:00:00.000Z',
      entries: [{
        profileId: 'profile-chat',
        title: 'Chat',
        origin: 'user',
        relativePath: 'profiles/chat.json',
        editable: true,
        removable: true,
        updatedAt: '2026-06-04T00:00:00.000Z',
      }],
    },
    profiles: [{
      profileId: 'profile-chat',
      origin: 'user',
      editable: true,
      removable: true,
      createdAt: '2026-06-04T00:00:00.000Z',
      updatedAt: '2026-06-04T00:00:00.000Z',
      profile: READY_PROFILE,
    }],
  });

  assert.equal(projection.profiles[0]?.profile.profileId, 'profile-chat');
  assert.equal(parseExportedNimiAccountProfileLibraryProfiles([READY_PROFILE])[0]?.profileId, 'profile-chat');
  assert.throws(
    () => parseNimiAccountProfileLibraryProjection({
      accountId: 'acct-1',
      libraryRef: 'account-profile-library:acct-1',
      index: { entries: [] },
      profiles: [{ profileId: 'default', origin: 'account-default', profile: READY_PROFILE }],
    }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_AI_PROFILE_LIBRARY_INVALID',
  );
});

test('Nimi AI account profile library parsers fail closed on invalid origins and exports', () => {
  assert.equal(parseNimiAccountProfileLibraryOrigin(' imported '), 'imported');
  assert.deepEqual(parseNimiAccountProfileLibraryIndexEntry({
    profileId: 'profile-imported',
    title: 'Imported',
    origin: 'imported',
    relativePath: 'profiles/imported.json',
    editable: true,
    removable: false,
    updatedAt: '2026-06-05T00:00:00.000Z',
  }), {
    profileId: 'profile-imported',
    title: 'Imported',
    origin: 'imported',
    relativePath: 'profiles/imported.json',
    editable: true,
    removable: false,
    updatedAt: '2026-06-05T00:00:00.000Z',
  });
  assert.equal(parseNimiAccountProfileLibraryProfile({
    profileId: 'profile-imported',
    origin: 'imported',
    editable: false,
    removable: true,
    createdAt: '2026-06-05T00:00:00.000Z',
    updatedAt: '2026-06-05T00:00:00.000Z',
    profile: {
      profileId: 'profile-imported',
      title: 'Imported',
      capabilities: {},
    },
  }).profile.profileId, 'profile-imported');
  assert.throws(
    () => parseNimiAccountProfileLibraryOrigin('system-default'),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_AI_PROFILE_LIBRARY_INVALID',
  );
  assert.throws(
    () => parseNimiAccountProfileLibraryProfile({
      profileId: 'default',
      origin: 'account-default',
      profile: READY_PROFILE,
    }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_AI_PROFILE_LIBRARY_INVALID',
  );
  assert.throws(
    () => parseExportedNimiAccountProfileLibraryProfiles({ profile: READY_PROFILE }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_AI_PROFILE_LIBRARY_INVALID',
  );
});

test('Nimi AI first-launch app config initializes through explicit host authorities', async () => {
  const scopeRef = createNimiAppAIScopeRef('dev.nimi.app', 'chat');
  const committed: NimiAIProfile[] = [];
  let stored: ReturnType<typeof createEmptyNimiAIConfig> | null = null;

  const initialized = await ensureNimiAppFirstLaunchAIConfig({
    scopeRef,
    getExistingAppAIConfig: () => stored,
    resolveRecommendedProfile: () => ({ profile: READY_PROFILE, manifestSatisfied: true }),
    resolveAccountDefaultProfile: () => null,
    resolveRequirementDeclarations: () => [requirementDeclaration(['text.generate'], scopeRef)],
    applyHostAIConfig: (_scope, config) => {
      committed.push(READY_PROFILE);
      stored = config;
      return config;
    },
    validateManifestRequirements: () => [],
    now: () => '2026-06-04T00:00:00.000Z',
  });

  assert.equal(initialized.outcome, 'initialized');
  assert.equal(initialized.outcome === 'initialized' ? initialized.profileSource : '', 'recommended-profile');
  assert.equal(committed.length, 1);

  const already = await ensureNimiAppFirstLaunchAIConfig({
    scopeRef,
    getExistingAppAIConfig: () => stored,
    resolveRecommendedProfile: () => null,
    resolveAccountDefaultProfile: () => READY_PROFILE,
    resolveRequirementDeclarations: () => [requirementDeclaration(['text.generate'], scopeRef)],
    applyHostAIConfig: (_scope, config) => config,
  });
  assert.equal(already.outcome, 'already-initialized');

  const setupRequired = await ensureNimiAppFirstLaunchAIConfig({
    scopeRef: createNimiAppAIScopeRef('dev.nimi.other', 'chat'),
    getExistingAppAIConfig: () => null,
    resolveRecommendedProfile: () => ({
      profile: {
        profileId: 'needs-setup',
        title: 'Needs setup',
        capabilities: { 'text.generate': { readinessPolicy: 'required' } },
      },
      manifestSatisfied: true,
    }),
    resolveAccountDefaultProfile: () => null,
    resolveRequirementDeclarations: ({ scopeRef: setupScope }) => [requirementDeclaration(['text.generate'], setupScope)],
    applyHostAIConfig: (_scope, config) => config,
  });
  assert.equal(setupRequired.outcome, 'setup-required-no-live-config');

  let appliedAfterGap = false;
  const manifestGap = await ensureNimiAppFirstLaunchAIConfig({
    scopeRef: createNimiAppAIScopeRef('dev.nimi.gap', 'chat'),
    getExistingAppAIConfig: () => null,
    resolveRecommendedProfile: () => ({ profile: READY_PROFILE, manifestSatisfied: true }),
    resolveAccountDefaultProfile: () => null,
    resolveRequirementDeclarations: ({ scopeRef: gapScope }) => [requirementDeclaration(['text.generate'], gapScope)],
    applyHostAIConfig: (_scope, config) => {
      appliedAfterGap = true;
      return config;
    },
    validateManifestRequirements: () => [{ requirementId: 'text.generate', detail: 'missing runtime route' }],
  });
  assert.equal(manifestGap.outcome, 'setup-required-no-live-config');
  assert.equal(appliedAfterGap, false);
});

test('Nimi AI scheduling projection calls Runtime peekScheduling without embedding live bindings in AIConfig', async () => {
  const config = applyNimiAIProfileToConfig({
    config: createEmptyNimiAIConfig(SCOPE),
    profile: READY_PROFILE,
    requirementDeclarations: [CHAT_REQUIREMENT],
  });
  const requests: ReturnType<typeof buildNimiRuntimeAISchedulingRequest>[] = [];
  const scheduling = createNimiRuntimeAISchedulingClient({
    appId: 'dev.nimi.wave4',
    config,
    runtime: {
      async peekScheduling(request) {
        requests.push(request);
        return {
          occupancy: { globalUsed: 1, globalCap: 4, appUsed: 1, appCap: 2 },
          aggregateJudgement: {
            state: SchedulingState.RUNNABLE,
            detail: 'ready',
            resourceWarnings: [],
          },
          targetJudgements: [{
            target: request.targets[0],
            judgement: {
              state: SchedulingState.RUNNABLE,
              detail: 'target ready',
              resourceWarnings: [],
            },
          }],
        };
      },
    },
  });

  const projection = await scheduling.peek();

  assert.equal(requests[0]?.targets[0]?.targetId, 'runtime-profile-binding-chat');
  assert.equal(requests[0]?.targets[0]?.profileId, 'runtime-profile-binding-chat');
  assert.equal(projection.aggregateJudgement?.state, 'runnable');
  assert.equal(projection.targetJudgements[0]?.target.capability, 'text.generate');

  assert.throws(
    () => buildNimiRuntimeAISchedulingRequest({
      appId: 'dev.nimi.wave4',
      config: {
        ...config,
        capabilities: {
          targetRefs: {
            'text.generate': {
              kind: 'profile-slice',
              sourceProfileId: 'profile-chat',
              sliceId: 'text-generate-local',
            },
          },
          selectedParams: {},
        },
      },
    }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_AI_SCHEDULING_TARGET_REQUIRED',
  );
});
