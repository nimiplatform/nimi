import {
  applyNimiAIProfileToConfig,
  createEmptyNimiAIConfig,
  createNimiAIScopeRef,
  formNimiRuntimeProfileDescriptor,
  previewNimiAIProfileApply,
  serializeNimiRuntimeProfileDescriptor,
  toNimiRuntimeProfileDescriptorWire,
  type NimiAICapabilityRequirementDeclaration,
  type NimiAIProfile,
} from '../core/ai';
import type { NimiMigrationProofResult } from './proof-contracts';

export async function runAIProfileRequirementFlowProof(): Promise<NimiMigrationProofResult> {
  const scopeRef = createNimiAIScopeRef({ kind: 'app', ownerId: 'migration-proof.ai-profile-flow' });
  const requirement: NimiAICapabilityRequirementDeclaration = {
    requirementId: 'migration-proof.ai-profile-flow.chat',
    scopeRef,
    requiredSlices: [{
      requirementSliceId: 'chat.text.generate',
      capability: 'text.generate',
      profileSliceRef: 'capabilities.text.generate',
      readinessPolicy: 'required',
      runtimeDescriptorRef: 'descriptor.text.generate',
    }],
    optionalSlices: [{
      requirementSliceId: 'chat.image.generate',
      capability: 'image.generate',
      profileSliceRef: 'capabilities.image.generate',
      readinessPolicy: 'optional',
      runtimeDescriptorRef: 'descriptor.image.generate',
    }],
    editableFields: ['params.temperature'],
    runtimeActivationConsumers: [{
      consumerId: 'runtime.chat.text',
      consumerScope: 'migration-proof',
      requirementSliceId: 'chat.text.generate',
    }],
    readinessProjectionRefs: ['runtime.prepare.chat.text'],
    setupProjectionPolicy: 'setup-required',
  };

  const readyProfile: NimiAIProfile = {
    profileId: 'migration-proof-profile',
    version: 'v1',
    revision: 'rev-1',
    title: 'Migration Proof Profile',
    description: 'Descriptor-backed AIProfile migration proof.',
    tags: ['migration-proof'],
    capabilities: {
      'text.generate': {
        targetRef: {
          kind: 'local-runtime',
          profileId: 'runtime-prepared-text',
          readinessRef: 'runtime.readiness.text.generate',
        },
        params: { temperature: 0.2 },
        readinessPolicy: 'required',
        contractState: 'declared',
        runtimeDescriptor: {
          sliceId: 'descriptor.text.generate',
          executionMode: 'local',
          contractState: 'declared',
          paramsRef: 'params.text.generate',
          execution: {
            backend: 'llama.cpp',
            backendClass: 'native',
          },
          model: {
            family: 'gemma',
          },
          assetRefs: ['asset.main'],
          paramsDigest: 'sha256:text-params',
          environmentDigest: 'sha256:text-env',
        },
      },
      'image.generate': {
        readinessPolicy: 'optional',
        contractState: 'proposed',
        runtimeDescriptor: {
          sliceId: 'descriptor.image.generate',
          executionMode: 'local',
          contractState: 'proposed',
          paramsRef: 'params.image.generate',
          execution: {
            backend: 'stablediffusion-ggml',
            backendClass: 'native-image',
          },
          model: {
            family: 'sdxl',
          },
          assetRefs: ['asset.image-main'],
          orderedCompanionOccurrences: [{
            occurrenceId: 'lora-1',
            role: 'lora',
            engineSlot: 'lora',
            assetBindingRef: 'asset.lora',
            order: 0,
            required: false,
            weight: '0.7',
          }],
        },
      },
    },
    assetBindings: [{
      bindingId: 'asset.main',
      assetRole: 'main-model',
      componentKind: 'weights',
      source: 'manual',
      expectedIdentity: 'gemma-main',
      readinessPolicy: 'required',
      manual: {
        expectedName: 'gemma.gguf',
        associationInstructions: 'Import the prepared local GGUF asset.',
      },
    }, {
      bindingId: 'asset.lora',
      assetRole: 'companion',
      componentKind: 'lora',
      source: 'manual',
      expectedIdentity: 'style-lora',
      readinessPolicy: 'optional',
      manual: {
        expectedName: 'style-lora.safetensors',
        associationInstructions: 'Import the optional style LoRA companion.',
      },
    }],
    defaultParams: { temperature: 0.2 },
    editableFields: ['params.temperature'],
    prepareRequirements: ['runtime.prepare.assets', 'runtime.prepare.environment'],
    contractStates: ['declared', 'proposed'],
    projectionWarnings: ['image_generate_setup_required_until_runtime_prepare'],
  };

  const descriptor = formNimiRuntimeProfileDescriptor({
    profile: readyProfile,
    requirementDeclarations: [requirement],
    descriptorId: 'descriptor:migration-proof-ai-profile',
    sourceProfileDigest: 'sha256:migration-proof-profile',
    projectedAt: '2026-06-06T00:00:00.000Z',
  });
  const wire = toNimiRuntimeProfileDescriptorWire(descriptor);
  const prepareRequestBytes = serializeNimiRuntimeProfileDescriptor(descriptor);

  const before = createEmptyNimiAIConfig(scopeRef);
  const preview = previewNimiAIProfileApply({
    before,
    scopeRef,
    profile: readyProfile,
    requirementDeclarations: [requirement],
    now: () => '2026-06-06T00:00:01.000Z',
  });
  const applied = applyNimiAIProfileToConfig({
    config: before,
    profile: readyProfile,
    requirementDeclarations: [requirement],
    now: () => '2026-06-06T00:00:01.000Z',
  });

  const setupRequiredProfile: NimiAIProfile = {
    ...readyProfile,
    profileId: 'migration-proof-setup-required-profile',
    capabilities: {
      'text.generate': {
        readinessPolicy: 'required',
        contractState: 'proposed',
      },
    },
    projectionWarnings: [
      'factory_ai_profile_selection_hint',
      'runtime_prepare_required_before_live_config',
    ],
  };
  const setupRequiredPreview = previewNimiAIProfileApply({
    before: null,
    scopeRef,
    profile: setupRequiredProfile,
    requirementDeclarations: [requirement],
  });

  const evidence = [
    `descriptor:${wire.descriptor_id}`,
    `prepare-bytes:${prepareRequestBytes.byteLength}`,
    `wire-slices:${wire.capability_slices.length}`,
    `apply-targets:${Object.keys(applied.capabilities.targetRefs).join(',')}`,
    `optional-omitted:${String(!('image.generate' in applied.capabilities.targetRefs))}`,
    `setup-required:${setupRequiredPreview.outcome}:${setupRequiredPreview.setupProjection?.reasonCodes.join(',') ?? ''}`,
  ];

  return {
    proofId: 'ai-profile-requirement-flow',
    appShape: 'AIProfile descriptor-backed requirement-scoped setup/apply flow',
    status: preview.outcome === 'ready_to_apply'
      && applied.capabilities.targetRefs['text.generate']?.kind === 'local-runtime'
      && !('image.generate' in applied.capabilities.targetRefs)
      && setupRequiredPreview.outcome === 'setup_required_no_live_config'
      && prepareRequestBytes.byteLength > 0
      ? 'passed'
      : 'failed',
    migratedBy: 'profile-requirement-flow',
    adapterIds: [],
    observedCapabilities: [
      'ai-profile-descriptor',
      'runtime-prepare-request',
      'requirement-scoped-apply',
      'setup-required-projection',
      'no-raw-descriptor-json',
    ],
    evidence,
  };
}
