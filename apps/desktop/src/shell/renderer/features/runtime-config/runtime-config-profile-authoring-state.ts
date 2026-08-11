import {
  NIMI_AI_PROFILE_LLAMA_CACHE_TYPES,
  NIMI_AI_PROFILE_LLAMA_CPP_EMBED_IMPLEMENTATION,
  NIMI_AI_PROFILE_LLAMA_CPP_IMPLEMENTATION,
  NIMI_AI_PROFILE_QWEN3_ASR_IMPLEMENTATION,
  NIMI_AI_PROFILE_QWEN3_ASR_TRANSFORMERS_IMPLEMENTATION,
  NIMI_AI_PROFILE_QWEN3_TTS_IMPLEMENTATION,
  NIMI_AI_PROFILE_STABLE_DIFFUSION_IMPLEMENTATION,
  NIMI_AI_PROFILE_STABLE_DIFFUSION_MODEL_FAMILIES,
  NIMI_AI_PROFILE_STABLE_DIFFUSION_VIDEO_IMPLEMENTATION,
  createNimiAIProfileAuthoringBuilder,
  createNimiAIProfileLlamaEmbedLocalImplementation,
  createNimiAIProfileLlamaLocalImplementation,
  createNimiAIProfileQwen3ASRLocalImplementation,
  createNimiAIProfileQwen3ASRTransformersLocalImplementation,
  createNimiAIProfileQwen3TTSLocalImplementation,
  createNimiAIProfileStableDiffusionLocalImplementation,
  createNimiAIProfileStableDiffusionVideoLocalImplementation,
  deriveNimiAIProfileApplyPreview,
  deriveNimiAIProfileImportPreview,
  deriveNimiAIProfileLocalConfigurationPreview,
  deriveNimiAIProfileRequirementProjection,
  deriveNimiAIProfileSelectionMismatchPreview,
  importNimiAIProfileAuthoring,
  type NimiAIProfileApplyPreview,
  type NimiAIProfileAuthoringMachineProjection,
  type NimiAIProfileAuthoringRequirementProjection,
  type NimiAIProfileImportPreview,
  type NimiAIProfileLocalConfigurationPreview,
  type NimiAIProfileRequirementPolicy,
  type NimiAIProfileSelectionMismatchPreview,
  type NimiAIProfileStableDiffusionModelFamily,
  type NimiCapabilityAIConfig,
  type NimiPortableAIProfile,
} from '@nimiplatform/sdk/ai';
import type { NimiJsonObject, NimiJsonValue } from '@nimiplatform/sdk/contracts';
import type { NimiMachineLocalAIConfiguration } from '@nimiplatform/sdk/runtime';

export const RUNTIME_CONFIG_AI_PROFILE_CAPABILITY_CONTRACTS = Object.freeze([
  'text.generate',
  'image.generate',
  'video.generate',
  'text.embed',
  'audio.synthesize',
  'audio.transcribe',
] as const);

export type RuntimeConfigAIProfileCapabilityContract =
  typeof RUNTIME_CONFIG_AI_PROFILE_CAPABILITY_CONTRACTS[number];
export type RuntimeConfigAIProfileOptionalBoolean = '' | 'true' | 'false';
export type RuntimeConfigAIProfileOptionalPolicy = '' | NimiAIProfileRequirementPolicy;

export type RuntimeConfigAIProfileRequirementDraft = {
  readonly policy: RuntimeConfigAIProfileOptionalPolicy;
  readonly verifiedContentId: string;
};

export type RuntimeConfigAIProfileLlamaDraft = {
  readonly main: RuntimeConfigAIProfileRequirementDraft;
  readonly mmproj: RuntimeConfigAIProfileRequirementDraft;
  readonly contextSize: string;
  readonly cacheTypeK: '' | 'f32' | 'f16' | 'bf16' | 'q8_0' | 'q4_0';
  readonly cacheTypeV: '' | 'f32' | 'f16' | 'bf16' | 'q8_0' | 'q4_0';
  readonly flashAttention: RuntimeConfigAIProfileOptionalBoolean;
  readonly gpuLayers: string;
};

export type RuntimeConfigAIProfileStableDiffusionExecutionDraft = {
  readonly steps: string;
  readonly cfgScale: string;
  readonly width: string;
  readonly height: string;
  readonly seed: string;
  readonly sampler: string;
  readonly scheduler: string;
  readonly threads: string;
  readonly diffusionFlashAttention: RuntimeConfigAIProfileOptionalBoolean;
  readonly offloadParamsToCPU: RuntimeConfigAIProfileOptionalBoolean;
};

export type RuntimeConfigAIProfileStableDiffusionDraft = {
  readonly modelFamily: NimiAIProfileStableDiffusionModelFamily;
  readonly enableInputImage: RuntimeConfigAIProfileOptionalBoolean;
  readonly main: RuntimeConfigAIProfileRequirementDraft;
  readonly textEncoder: RuntimeConfigAIProfileRequirementDraft;
  readonly vae: RuntimeConfigAIProfileRequirementDraft;
  readonly uncondDiffusion: RuntimeConfigAIProfileRequirementDraft;
  readonly execution: RuntimeConfigAIProfileStableDiffusionExecutionDraft;
};

/**
 * MiniMax-H3 video.generate authoring draft. The five slots mirror the ten
 * portable keys of the SDK video section; input.image intent is declared
 * through the shared supported-features field, not a portable key.
 */
export type RuntimeConfigAIProfileStableDiffusionVideoDraft = {
  readonly fl2va: RuntimeConfigAIProfileRequirementDraft;
  readonly ref2va: RuntimeConfigAIProfileRequirementDraft;
  readonly encoder: RuntimeConfigAIProfileRequirementDraft;
  readonly videoVAE: RuntimeConfigAIProfileRequirementDraft;
  readonly audioVAE: RuntimeConfigAIProfileRequirementDraft;
};

export type RuntimeConfigAIProfileLocalDraft = {
  readonly includeImplementation: boolean;
  readonly driverKind: 'none' | 'llama' | 'llama-embed' | 'qwen3-tts' | 'qwen3-asr' | 'qwen3-asr-transformers' | 'stable-diffusion' | 'stable-diffusion-video';
  readonly supportedFeaturesText: string;
  readonly llama: RuntimeConfigAIProfileLlamaDraft;
  readonly stableDiffusion: RuntimeConfigAIProfileStableDiffusionDraft;
  readonly stableDiffusionVideo: RuntimeConfigAIProfileStableDiffusionVideoDraft;
};

export type RuntimeConfigAIProfileCloudDraft = {
  readonly implementationId: string;
  readonly driverId: string;
  readonly driverDialect: string;
  readonly supportedFeaturesText: string;
  readonly providerModelTargetJson: string;
};

export type RuntimeConfigAIProfileCapabilityDraft = {
  readonly draftId: string;
  readonly capabilityContract: RuntimeConfigAIProfileCapabilityContract;
  readonly route: 'local' | 'cloud';
  readonly requiredFeaturesText: string;
  readonly defaultsJson: string;
  readonly local: RuntimeConfigAIProfileLocalDraft;
  readonly cloud: RuntimeConfigAIProfileCloudDraft;
};

export type RuntimeConfigAIProfileAuthoringDraft = {
  readonly profileId: string;
  readonly title: string;
  readonly descriptionIncluded: boolean;
  readonly description: string;
  readonly provenanceJson: string;
  readonly licenseJson: string;
  readonly displayMetadataJson: string;
  readonly capabilities: readonly RuntimeConfigAIProfileCapabilityDraft[];
  readonly nextDraftOrdinal: number;
};

export type RuntimeConfigAIProfileAuthoringOperation =
  | 'editing'
  | 'imported'
  | 'exported'
  | 'operation-failed';

export type RuntimeConfigAIProfileAuthoringState = {
  readonly draft: RuntimeConfigAIProfileAuthoringDraft;
  readonly operation: RuntimeConfigAIProfileAuthoringOperation;
  readonly operationSource: 'none' | 'import' | 'export';
  readonly technicalError: string;
  readonly revision: number;
};

export type RuntimeConfigAIProfileAuthoringAction =
  | { readonly type: 'draft-changed'; readonly draft: RuntimeConfigAIProfileAuthoringDraft }
  | { readonly type: 'import-succeeded'; readonly draft: RuntimeConfigAIProfileAuthoringDraft }
  | { readonly type: 'export-succeeded' }
  | {
    readonly type: 'operation-failed';
    readonly source: 'import' | 'export';
    readonly technicalError: string;
  };

export type RuntimeConfigAIProfileAuthoringCurrentProjection = {
  readonly appId: string;
  readonly appAIConfig: NimiCapabilityAIConfig | null;
  readonly sharedAIConfig: NimiCapabilityAIConfig | null;
  readonly machine: NimiAIProfileAuthoringMachineProjection;
};

export type RuntimeConfigAIProfileAuthoringRequirementView = {
  readonly capabilityContract: string;
  readonly supportedFeatures: readonly string[];
  readonly projection: NimiAIProfileAuthoringRequirementProjection;
};

export type RuntimeConfigAIProfileAuthoringJourneyPreview = {
  readonly importPreview: NimiAIProfileImportPreview;
  readonly appApplyPreview: NimiAIProfileApplyPreview;
  readonly sharedApplyPreview: NimiAIProfileApplyPreview;
  readonly localConfigurationPreviews: readonly NimiAIProfileLocalConfigurationPreview[];
  readonly selectionPreviews: readonly NimiAIProfileSelectionMismatchPreview[];
};

export type RuntimeConfigAIProfileAuthoringPreviewModel = {
  readonly profile: NimiPortableAIProfile;
  readonly requirements: readonly RuntimeConfigAIProfileAuthoringRequirementView[];
  readonly exportArtifact: RuntimeConfigAIProfileAuthoringExport | null;
  readonly exportTechnicalError: string;
  readonly journey: RuntimeConfigAIProfileAuthoringJourneyPreview | null;
};

export type RuntimeConfigAIProfileAuthoringInspection =
  | { readonly status: 'valid'; readonly model: RuntimeConfigAIProfileAuthoringPreviewModel }
  | { readonly status: 'invalid'; readonly technicalError: string };

export type RuntimeConfigAIProfileAuthoringExport = {
  readonly profile: NimiPortableAIProfile;
  readonly artifactJson: string;
  readonly fileName: string;
};

const PREVIEW_VALIDATION = Object.freeze({
  requireProvenance: false,
  requireLicense: false,
  requireNonEmptyProvenance: false,
  requireNonEmptyLicense: false,
});

export function createRuntimeConfigAIProfileAuthoringDraft(): RuntimeConfigAIProfileAuthoringDraft {
  return {
    profileId: 'profile.authoring.draft',
    title: 'Untitled AIProfile',
    descriptionIncluded: false,
    description: '',
    provenanceJson: '',
    licenseJson: '',
    displayMetadataJson: '',
    capabilities: [createCapabilityDraft('capability-1', 'text.generate')],
    nextDraftOrdinal: 2,
  };
}

export function createRuntimeConfigAIProfileAuthoringState(): RuntimeConfigAIProfileAuthoringState {
  return {
    draft: createRuntimeConfigAIProfileAuthoringDraft(),
    operation: 'editing',
    operationSource: 'none',
    technicalError: '',
    revision: 0,
  };
}

export function reduceRuntimeConfigAIProfileAuthoringState(
  state: RuntimeConfigAIProfileAuthoringState,
  action: RuntimeConfigAIProfileAuthoringAction,
): RuntimeConfigAIProfileAuthoringState {
  switch (action.type) {
    case 'draft-changed':
      return {
        draft: action.draft,
        operation: 'editing',
        operationSource: 'none',
        technicalError: '',
        revision: state.revision + 1,
      };
    case 'import-succeeded':
      return {
        draft: action.draft,
        operation: 'imported',
        operationSource: 'import',
        technicalError: '',
        revision: state.revision + 1,
      };
    case 'export-succeeded':
      return {
        ...state,
        operation: 'exported',
        operationSource: 'export',
        technicalError: '',
      };
    case 'operation-failed':
      return {
        ...state,
        operation: 'operation-failed',
        operationSource: action.source,
        technicalError: action.technicalError,
      };
  }
}

export function addRuntimeConfigAIProfileCapability(
  draft: RuntimeConfigAIProfileAuthoringDraft,
): RuntimeConfigAIProfileAuthoringDraft {
  const used = new Set(draft.capabilities.map((capability) => capability.capabilityContract));
  const capabilityContract = RUNTIME_CONFIG_AI_PROFILE_CAPABILITY_CONTRACTS.find(
    (candidate) => !used.has(candidate),
  );
  if (!capabilityContract) return draft;
  return {
    ...draft,
    capabilities: [
      ...draft.capabilities,
      createCapabilityDraft(`capability-${draft.nextDraftOrdinal}`, capabilityContract),
    ],
    nextDraftOrdinal: draft.nextDraftOrdinal + 1,
  };
}

export function changeRuntimeConfigAIProfileCapabilityContract(
  draft: RuntimeConfigAIProfileAuthoringDraft,
  draftId: string,
  capabilityContract: RuntimeConfigAIProfileCapabilityContract,
): RuntimeConfigAIProfileAuthoringDraft {
  if (draft.capabilities.some((capability) => (
    capability.draftId !== draftId && capability.capabilityContract === capabilityContract
  ))) return draft;
  return {
    ...draft,
    capabilities: draft.capabilities.map((capability) => (
      capability.draftId === draftId
        ? {
          ...capability,
          capabilityContract,
          local: {
            ...capability.local,
            driverKind: localDriverKind(capabilityContract),
            includeImplementation: localDriverKind(capabilityContract) !== 'none',
          },
        }
        : capability
    )),
  };
}

export function buildRuntimeConfigAIProfileAuthoringDraft(
  draft: RuntimeConfigAIProfileAuthoringDraft,
): NimiPortableAIProfile {
  return authoringBuilderFromDraft(draft).build(PREVIEW_VALIDATION);
}

export function exportRuntimeConfigAIProfileAuthoring(
  draft: RuntimeConfigAIProfileAuthoringDraft,
): RuntimeConfigAIProfileAuthoringExport {
  const builder = authoringBuilderFromDraft(draft);
  const artifactJson = builder.export();
  const profile = importNimiAIProfileAuthoring(artifactJson).build();
  const safeId = profile.profileId.replace(/[^A-Za-z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '');
  return Object.freeze({
    profile,
    artifactJson,
    fileName: `${safeId || 'ai-profile'}.ai-profile.json`,
  });
}

export function importRuntimeConfigAIProfileAuthoring(
  input: string | Uint8Array | NimiJsonObject,
): RuntimeConfigAIProfileAuthoringDraft {
  // Import and strict build are both SDK-owned. No Desktop LCC/AIConfig record is touched.
  const profile = importNimiAIProfileAuthoring(input).build();
  return draftFromProfile(profile);
}

export function inspectRuntimeConfigAIProfileAuthoring(
  draft: RuntimeConfigAIProfileAuthoringDraft,
  current: RuntimeConfigAIProfileAuthoringCurrentProjection | null,
): RuntimeConfigAIProfileAuthoringInspection {
  try {
    return {
      status: 'valid',
      model: deriveRuntimeConfigAIProfileAuthoringPreview(draft, current),
    };
  } catch (error) {
    return { status: 'invalid', technicalError: technicalErrorDetail(error) };
  }
}

export function deriveRuntimeConfigAIProfileAuthoringPreview(
  draft: RuntimeConfigAIProfileAuthoringDraft,
  current: RuntimeConfigAIProfileAuthoringCurrentProjection | null,
): RuntimeConfigAIProfileAuthoringPreviewModel {
  const profile = buildRuntimeConfigAIProfileAuthoringDraft(draft);
  const requirements = Object.entries(profile.capabilities).flatMap(([
    capabilityContract,
    capability,
  ]) => {
    if (capability.route !== 'local' || !capability.implementation) return [];
    return [Object.freeze({
      capabilityContract,
      supportedFeatures: capability.implementation.supportedFeatures,
      projection: deriveNimiAIProfileRequirementProjection(profile, capabilityContract),
    })];
  });
  let exportArtifact: RuntimeConfigAIProfileAuthoringExport | null = null;
  let exportTechnicalError = '';
  try {
    exportArtifact = exportRuntimeConfigAIProfileAuthoring(draft);
  } catch (error) {
    exportTechnicalError = technicalErrorDetail(error);
  }

  const journey = current === null
    ? null
    : Object.freeze({
      importPreview: deriveNimiAIProfileImportPreview({
        profile,
        validation: PREVIEW_VALIDATION,
      }),
      appApplyPreview: deriveNimiAIProfileApplyPreview({
        profile,
        target: { kind: 'app', appId: current.appId },
        before: current.appAIConfig,
        validation: PREVIEW_VALIDATION,
      }),
      sharedApplyPreview: deriveNimiAIProfileApplyPreview({
        profile,
        target: { kind: 'shared-local-agent' },
        before: current.sharedAIConfig,
        validation: PREVIEW_VALIDATION,
      }),
      localConfigurationPreviews: Object.entries(profile.capabilities).flatMap(([
        capabilityContract,
        capability,
      ]) => (
        capability.route === 'local' && capability.implementation
          ? [deriveNimiAIProfileLocalConfigurationPreview({
            profile,
            capabilityContract,
            machine: current.machine,
            validation: PREVIEW_VALIDATION,
          })]
          : []
      )),
      selectionPreviews: Object.keys(profile.capabilities).map((capabilityContract) => (
        deriveNimiAIProfileSelectionMismatchPreview({
          profile,
          capabilityContract,
          machine: current.machine,
          validation: PREVIEW_VALIDATION,
        })
      )),
    });

  return Object.freeze({
    profile,
    requirements: Object.freeze(requirements),
    exportArtifact,
    exportTechnicalError,
    journey,
  });
}

export function projectRuntimeConfigAIProfileAuthoringMachine(
  machine: NimiMachineLocalAIConfiguration,
): NimiAIProfileAuthoringMachineProjection {
  return Object.freeze({
    configurations: Object.freeze(machine.configurations.map((configuration) => Object.freeze({
      configurationId: configuration.configurationId,
      capabilityContract: configuration.capabilityContract,
      implementation: Object.freeze({ ...configuration.implementation }),
      ...(configuration.portableConfig !== undefined
        ? { portableConfig: configuration.portableConfig as unknown as NimiJsonObject }
        : {}),
      supportedFeatures: Object.freeze([...configuration.supportedFeatures]),
      requirementResolution: configuration.requirementResolution,
      ...(configuration.provenance !== undefined
        ? { provenance: configuration.provenance as unknown as NimiJsonObject }
        : {}),
    }))),
    selections: Object.freeze(machine.selections.map((selection) => Object.freeze({
      capabilityContract: selection.capabilityContract,
      configurationId: selection.configurationId,
    }))),
  });
}

export async function loadRuntimeConfigAIProfileAuthoringCurrentProjection(input: {
  readonly appId: string;
  readonly getAppAIConfig: () => Promise<NimiCapabilityAIConfig | null>;
  readonly getSharedAIConfig: () => Promise<NimiCapabilityAIConfig | null>;
  readonly getMachine: () => Promise<NimiMachineLocalAIConfiguration>;
}): Promise<RuntimeConfigAIProfileAuthoringCurrentProjection> {
  const [appAIConfig, sharedAIConfig, machine] = await Promise.all([
    input.getAppAIConfig(),
    input.getSharedAIConfig(),
    input.getMachine(),
  ]);
  return Object.freeze({
    appId: input.appId,
    appAIConfig,
    sharedAIConfig,
    machine: projectRuntimeConfigAIProfileAuthoringMachine(machine),
  });
}

export function technicalErrorDetail(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : String(error || 'Unknown AIProfile authoring error');
}

function createCapabilityDraft(
  draftId: string,
  capabilityContract: RuntimeConfigAIProfileCapabilityContract,
): RuntimeConfigAIProfileCapabilityDraft {
  return {
    draftId,
    capabilityContract,
    route: 'local',
    requiredFeaturesText: '',
    defaultsJson: '',
    local: {
      includeImplementation: localDriverKind(capabilityContract) !== 'none',
      driverKind: localDriverKind(capabilityContract),
      supportedFeaturesText: '',
      llama: {
        main: requirementDraft(),
        mmproj: requirementDraft(),
        contextSize: '',
        cacheTypeK: '',
        cacheTypeV: '',
        flashAttention: '',
        gpuLayers: '',
      },
      stableDiffusion: {
        modelFamily: 'z-image',
        enableInputImage: '',
        main: requirementDraft(),
        textEncoder: requirementDraft(),
        vae: requirementDraft(),
        uncondDiffusion: requirementDraft(),
        execution: {
          steps: '',
          cfgScale: '',
          width: '',
          height: '',
          seed: '',
          sampler: '',
          scheduler: '',
          threads: '',
          diffusionFlashAttention: '',
          offloadParamsToCPU: '',
        },
      },
      stableDiffusionVideo: {
        fl2va: requirementDraft(),
        ref2va: requirementDraft(),
        encoder: requirementDraft(),
        videoVAE: requirementDraft(),
        audioVAE: requirementDraft(),
      },
    },
    cloud: {
      implementationId: '',
      driverId: '',
      driverDialect: '',
      supportedFeaturesText: '',
      providerModelTargetJson: '',
    },
  };
}

function requirementDraft(): RuntimeConfigAIProfileRequirementDraft {
  return { policy: '', verifiedContentId: '' };
}

function localDriverKind(
  capabilityContract: RuntimeConfigAIProfileCapabilityContract,
): RuntimeConfigAIProfileLocalDraft['driverKind'] {
  if (capabilityContract === 'text.generate') return 'llama';
  if (capabilityContract === 'text.embed') return 'llama-embed';
  if (capabilityContract === 'audio.synthesize') return 'qwen3-tts';
  if (capabilityContract === 'audio.transcribe') return 'qwen3-asr';
  if (capabilityContract === 'image.generate') return 'stable-diffusion';
  if (capabilityContract === 'video.generate') return 'stable-diffusion-video';
  return 'none';
}

function authoringBuilderFromDraft(draft: RuntimeConfigAIProfileAuthoringDraft) {
  const builder = createNimiAIProfileAuthoringBuilder({
    profileId: draft.profileId,
    title: draft.title,
    ...(draft.descriptionIncluded ? { description: draft.description } : {}),
    ...(draft.provenanceJson.trim()
      ? { provenance: parseJsonObject(draft.provenanceJson, 'provenance') }
      : {}),
    ...(draft.licenseJson.trim()
      ? { license: parseJsonValue(draft.licenseJson, 'license') }
      : {}),
    ...(draft.displayMetadataJson.trim()
      ? { displayMetadata: parseJsonObject(draft.displayMetadataJson, 'display metadata') }
      : {}),
  });

  for (const capability of draft.capabilities) {
    const requiredFeatures = parseFeatureText(capability.requiredFeaturesText);
    const defaults = capability.defaultsJson.trim()
      ? parseJsonObject(capability.defaultsJson, `${capability.capabilityContract} defaults`)
      : undefined;
    if (capability.route === 'local') {
      builder.setLocalCapability({
        capabilityContract: capability.capabilityContract,
        requiredFeatures,
        ...(defaults !== undefined ? { defaults } : {}),
        ...(capability.local.includeImplementation
          ? { localConfiguration: localImplementationFromDraft(capability) }
          : {}),
      });
      continue;
    }
    builder.setCloudCapability({
      capabilityContract: capability.capabilityContract,
      requiredFeatures,
      ...(defaults !== undefined ? { defaults } : {}),
      recommendation: {
        implementation: {
          implementationId: capability.cloud.implementationId,
          driverId: capability.cloud.driverId,
          driverDialect: capability.cloud.driverDialect,
        },
        supportedFeatures: parseFeatureText(capability.cloud.supportedFeaturesText),
        providerModelTarget: parseJsonObject(
          capability.cloud.providerModelTargetJson,
          `${capability.capabilityContract} provider-model target`,
        ),
      },
    });
  }
  return builder;
}

function localImplementationFromDraft(capability: RuntimeConfigAIProfileCapabilityDraft) {
  const supportedFeatures = parseFeatureText(capability.local.supportedFeaturesText);
  if (capability.local.driverKind === 'llama') {
    const llama = capability.local.llama;
    return createNimiAIProfileLlamaLocalImplementation({
      supportedFeatures,
      portableConfig: {
        ...requirementInput('main', llama.main),
        ...requirementInput('mmproj', llama.mmproj),
        ...optionalNumberInput('contextSize', llama.contextSize),
        ...(llama.cacheTypeK ? { cacheTypeK: llama.cacheTypeK } : {}),
        ...(llama.cacheTypeV ? { cacheTypeV: llama.cacheTypeV } : {}),
        ...optionalBooleanInput('flashAttention', llama.flashAttention),
        ...optionalNumberInput('gpuLayers', llama.gpuLayers),
      },
    });
  }
  if (capability.local.driverKind === 'llama-embed') {
    const llama = capability.local.llama;
    return createNimiAIProfileLlamaEmbedLocalImplementation({
      supportedFeatures,
      portableConfig: {
        ...requirementInput('main', llama.main),
        ...optionalNumberInput('contextSize', llama.contextSize),
        ...(llama.cacheTypeK ? { cacheTypeK: llama.cacheTypeK } : {}),
        ...(llama.cacheTypeV ? { cacheTypeV: llama.cacheTypeV } : {}),
        ...optionalBooleanInput('flashAttention', llama.flashAttention),
        ...optionalNumberInput('gpuLayers', llama.gpuLayers),
      },
    });
  }
  if (capability.local.driverKind === 'qwen3-tts') {
    return createNimiAIProfileQwen3TTSLocalImplementation({ supportedFeatures });
  }
  if (capability.local.driverKind === 'qwen3-asr') {
    return createNimiAIProfileQwen3ASRLocalImplementation({ supportedFeatures });
  }
  if (capability.local.driverKind === 'qwen3-asr-transformers') {
    return createNimiAIProfileQwen3ASRTransformersLocalImplementation({ supportedFeatures });
  }
  if (capability.local.driverKind === 'stable-diffusion-video') {
    const video = capability.local.stableDiffusionVideo;
    return createNimiAIProfileStableDiffusionVideoLocalImplementation({
      supportedFeatures,
      portableConfig: {
        ...requirementInput('fl2va', video.fl2va),
        ...requirementInput('ref2va', video.ref2va),
        ...requirementInput('encoder', video.encoder),
        ...requirementInput('videoVAE', video.videoVAE),
        ...requirementInput('audioVAE', video.audioVAE),
      },
    });
  }
  if (capability.local.driverKind !== 'stable-diffusion') {
    throw new Error(`${capability.capabilityContract} has no typed Local Driver authoring section`);
  }
  const stable = capability.local.stableDiffusion;
  const executionOptions = {
    ...optionalNumberInput('steps', stable.execution.steps),
    ...optionalNumberInput('cfgScale', stable.execution.cfgScale),
    ...optionalNumberInput('width', stable.execution.width),
    ...optionalNumberInput('height', stable.execution.height),
    ...optionalNumberInput('seed', stable.execution.seed),
    ...(stable.execution.sampler ? { sampler: stable.execution.sampler } : {}),
    ...(stable.execution.scheduler ? { scheduler: stable.execution.scheduler } : {}),
    ...optionalNumberInput('threads', stable.execution.threads),
    ...optionalBooleanInput(
      'diffusionFlashAttention',
      stable.execution.diffusionFlashAttention,
    ),
    ...optionalBooleanInput('offloadParamsToCPU', stable.execution.offloadParamsToCPU),
  };
  return createNimiAIProfileStableDiffusionLocalImplementation({
    supportedFeatures,
    portableConfig: {
      modelFamily: stable.modelFamily,
      ...optionalBooleanInput('enableInputImage', stable.enableInputImage),
      ...requirementInput('main', stable.main),
      ...requirementInput('textEncoder', stable.textEncoder),
      ...requirementInput('vae', stable.vae),
      ...requirementInput('uncondDiffusion', stable.uncondDiffusion),
      ...(Object.keys(executionOptions).length > 0 ? { executionOptions } : {}),
    },
  });
}

function requirementInput(
  prefix:
    | 'main'
    | 'mmproj'
    | 'textEncoder'
    | 'vae'
    | 'uncondDiffusion'
    | 'fl2va'
    | 'ref2va'
    | 'encoder'
    | 'videoVAE'
    | 'audioVAE',
  requirement: RuntimeConfigAIProfileRequirementDraft,
): Record<string, string> {
  return {
    ...(requirement.policy ? { [`${prefix}RequirementPolicy`]: requirement.policy } : {}),
    ...(requirement.verifiedContentId
      ? { [`${prefix}VerifiedContentId`]: requirement.verifiedContentId }
      : {}),
  };
}

function optionalNumberInput<Key extends string>(
  key: Key,
  value: string,
): Partial<Record<Key, number>> {
  if (!value.trim()) return {};
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${key} must be a finite number`);
  return { [key]: parsed } as Partial<Record<Key, number>>;
}

function optionalBooleanInput<Key extends string>(
  key: Key,
  value: RuntimeConfigAIProfileOptionalBoolean,
): Partial<Record<Key, boolean>> {
  return value ? { [key]: value === 'true' } as Partial<Record<Key, boolean>> : {};
}

function parseFeatureText(value: string): readonly string[] {
  if (!value.trim()) return [];
  return value.split(/[\n,]/gu).map((feature) => feature.trim()).filter(Boolean);
}

function parseJsonObject(value: string, label: string): NimiJsonObject {
  const parsed = parseJson(value, label);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return parsed as NimiJsonObject;
}

function parseJsonValue(value: string, label: string): NimiJsonValue {
  return parseJson(value, label) as NimiJsonValue;
}

function parseJson(value: string, label: string): unknown {
  if (!value.trim()) throw new Error(`${label} JSON is required`);
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error(`${label} must contain valid JSON`);
  }
}

function draftFromProfile(profile: NimiPortableAIProfile): RuntimeConfigAIProfileAuthoringDraft {
  let nextDraftOrdinal = 1;
  const capabilities = Object.entries(profile.capabilities).map(([
    capabilityContract,
    capability,
  ]) => {
    if (!isCapabilityContract(capabilityContract)) {
      throw new Error(`Desktop authoring does not expose ${capabilityContract}`);
    }
    const draft = createCapabilityDraft(`capability-${nextDraftOrdinal}`, capabilityContract);
    nextDraftOrdinal += 1;
    const common = {
      ...draft,
      route: capability.route,
      requiredFeaturesText: capability.requiredFeatures.join(', '),
      defaultsJson: prettyJson(capability.defaults),
    };
    if (capability.route === 'cloud') {
      return {
        ...common,
        cloud: {
          implementationId: capability.implementation.implementationId,
          driverId: capability.implementation.driverId,
          driverDialect: capability.implementation.driverDialect,
          supportedFeaturesText: capability.implementation.supportedFeatures.join(', '),
          providerModelTargetJson: prettyJson(capability.providerModelTarget),
        },
      };
    }
    if (!capability.implementation) {
      return {
        ...common,
        local: { ...draft.local, includeImplementation: false },
      };
    }
    const driverKind = implementationDriverKind(capability.implementation);
    const config = capability.driverPortableConfig ?? {};
    return {
      ...common,
      local: {
        ...draft.local,
        includeImplementation: true,
        driverKind,
        supportedFeaturesText: capability.implementation.supportedFeatures.join(', '),
        llama: driverKind === 'llama' || driverKind === 'llama-embed'
          ? llamaDraftFromConfig(config)
          : draft.local.llama,
        stableDiffusion: driverKind === 'stable-diffusion'
          ? stableDiffusionDraftFromConfig(config)
          : draft.local.stableDiffusion,
        stableDiffusionVideo: driverKind === 'stable-diffusion-video'
          ? stableDiffusionVideoDraftFromConfig(config)
          : draft.local.stableDiffusionVideo,
      },
    };
  });
  return {
    profileId: profile.profileId,
    title: profile.title,
    descriptionIncluded: profile.description !== undefined,
    description: profile.description ?? '',
    provenanceJson: prettyJson(profile.provenance),
    licenseJson: prettyJson(profile.license),
    displayMetadataJson: prettyJson(profile.displayMetadata),
    capabilities,
    nextDraftOrdinal,
  };
}

function implementationDriverKind(
  implementation: {
    readonly implementationId: string;
    readonly driverId: string;
    readonly driverDialect: string;
  },
): RuntimeConfigAIProfileLocalDraft['driverKind'] {
  if (sameImplementation(implementation, NIMI_AI_PROFILE_LLAMA_CPP_IMPLEMENTATION)) return 'llama';
  if (sameImplementation(implementation, NIMI_AI_PROFILE_LLAMA_CPP_EMBED_IMPLEMENTATION)) {
    return 'llama-embed';
  }
  if (sameImplementation(implementation, NIMI_AI_PROFILE_QWEN3_TTS_IMPLEMENTATION)) {
    return 'qwen3-tts';
  }
  if (sameImplementation(implementation, NIMI_AI_PROFILE_QWEN3_ASR_IMPLEMENTATION)) {
    return 'qwen3-asr';
  }
  if (sameImplementation(implementation, NIMI_AI_PROFILE_QWEN3_ASR_TRANSFORMERS_IMPLEMENTATION)) {
    return 'qwen3-asr-transformers';
  }
  if (sameImplementation(implementation, NIMI_AI_PROFILE_STABLE_DIFFUSION_IMPLEMENTATION)) {
    return 'stable-diffusion';
  }
  if (sameImplementation(implementation, NIMI_AI_PROFILE_STABLE_DIFFUSION_VIDEO_IMPLEMENTATION)) {
    return 'stable-diffusion-video';
  }
  throw new Error('Imported Local implementation has no typed Desktop authoring section');
}

function sameImplementation(
  left: { readonly implementationId: string; readonly driverId: string; readonly driverDialect: string },
  right: { readonly implementationId: string; readonly driverId: string; readonly driverDialect: string },
): boolean {
  return left.implementationId === right.implementationId
    && left.driverId === right.driverId
    && left.driverDialect === right.driverDialect;
}

function llamaDraftFromConfig(config: NimiJsonObject): RuntimeConfigAIProfileLlamaDraft {
  return {
    main: requirementDraftFromConfig(config, 'main'),
    mmproj: requirementDraftFromConfig(config, 'mmproj'),
    contextSize: numberText(config.contextSize),
    cacheTypeK: cacheType(config.cacheTypeK),
    cacheTypeV: cacheType(config.cacheTypeV),
    flashAttention: optionalBooleanText(config.flashAttention),
    gpuLayers: numberText(config.gpuLayers),
  };
}

function stableDiffusionDraftFromConfig(
  config: NimiJsonObject,
): RuntimeConfigAIProfileStableDiffusionDraft {
  const execution = jsonObject(config.executionOptions) ?? {};
  return {
    modelFamily: modelFamily(config.modelFamily),
    enableInputImage: optionalBooleanText(config.enableInputImage),
    main: requirementDraftFromConfig(config, 'main'),
    textEncoder: requirementDraftFromConfig(config, 'textEncoder'),
    vae: requirementDraftFromConfig(config, 'vae'),
    uncondDiffusion: requirementDraftFromConfig(config, 'uncondDiffusion'),
    execution: {
      steps: numberText(execution.steps),
      cfgScale: numberText(execution.cfgScale),
      width: numberText(execution.width),
      height: numberText(execution.height),
      seed: numberText(execution.seed),
      sampler: stringText(execution.sampler),
      scheduler: stringText(execution.scheduler),
      threads: numberText(execution.threads),
      diffusionFlashAttention: optionalBooleanText(execution.diffusionFlashAttention),
      offloadParamsToCPU: optionalBooleanText(execution.offloadParamsToCPU),
    },
  } satisfies RuntimeConfigAIProfileStableDiffusionDraft;
}

function stableDiffusionVideoDraftFromConfig(
  config: NimiJsonObject,
): RuntimeConfigAIProfileStableDiffusionVideoDraft {
  return {
    fl2va: requirementDraftFromConfig(config, 'fl2va'),
    ref2va: requirementDraftFromConfig(config, 'ref2va'),
    encoder: requirementDraftFromConfig(config, 'encoder'),
    videoVAE: requirementDraftFromConfig(config, 'videoVAE'),
    audioVAE: requirementDraftFromConfig(config, 'audioVAE'),
  };
}

function requirementDraftFromConfig(
  config: NimiJsonObject,
  prefix:
    | 'main'
    | 'mmproj'
    | 'textEncoder'
    | 'vae'
    | 'uncondDiffusion'
    | 'fl2va'
    | 'ref2va'
    | 'encoder'
    | 'videoVAE'
    | 'audioVAE',
): RuntimeConfigAIProfileRequirementDraft {
  return {
    policy: optionalPolicy(config[`${prefix}RequirementPolicy`]),
    verifiedContentId: stringText(config[`${prefix}VerifiedContentId`]),
  };
}

function optionalPolicy(value: NimiJsonValue | undefined): RuntimeConfigAIProfileOptionalPolicy {
  return value === 'strict' || value === 'substitutable' ? value : '';
}

function optionalBooleanText(value: NimiJsonValue | undefined): RuntimeConfigAIProfileOptionalBoolean {
  return typeof value === 'boolean' ? String(value) as 'true' | 'false' : '';
}

function stringText(value: NimiJsonValue | undefined): string {
  return typeof value === 'string' ? value : '';
}

function numberText(value: NimiJsonValue | undefined): string {
  return typeof value === 'number' ? String(value) : '';
}

function cacheType(value: NimiJsonValue | undefined): RuntimeConfigAIProfileLlamaDraft['cacheTypeK'] {
  return typeof value === 'string'
    && (NIMI_AI_PROFILE_LLAMA_CACHE_TYPES as readonly string[]).includes(value)
    ? value as RuntimeConfigAIProfileLlamaDraft['cacheTypeK']
    : '';
}

function modelFamily(value: NimiJsonValue | undefined): NimiAIProfileStableDiffusionModelFamily {
  return typeof value === 'string'
    && (NIMI_AI_PROFILE_STABLE_DIFFUSION_MODEL_FAMILIES as readonly string[]).includes(value)
    ? value as NimiAIProfileStableDiffusionModelFamily
    : 'z-image';
}

function jsonObject(value: NimiJsonValue | undefined): NimiJsonObject | null {
  if (value === null || value === undefined || typeof value !== 'object') return null;
  if (Array.isArray(value as unknown[])) return null;
  return value as NimiJsonObject;
}

function prettyJson(value: NimiJsonValue | NimiJsonObject | undefined): string {
  return value === undefined ? '' : JSON.stringify(value, null, 2);
}

function isCapabilityContract(value: string): value is RuntimeConfigAIProfileCapabilityContract {
  return (RUNTIME_CONFIG_AI_PROFILE_CAPABILITY_CONTRACTS as readonly string[]).includes(value);
}
