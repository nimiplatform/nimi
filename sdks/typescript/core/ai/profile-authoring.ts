import type {
  AIConfig,
  AIConfigCapabilityIntent,
  AIConfigOwner,
  CapabilityImplementationIdentity,
} from '../../core-generated/runtime-protobuf/runtime/v1/capability_configuration.js';
import type { NimiJsonObject, NimiJsonValue } from '../contracts/index.js';
import { createNimiError } from '../../types/index.js';
import { sha256Hex } from '../../types/sha256.js';
import {
  createNimiCloudAIConfigCapabilityIntent,
  createNimiLocalAIConfigCapabilityIntent,
  parseNimiPortableAIProfile,
  runtimeAIConfigStructToJson,
  serializeNimiPortableAIProfile,
  type NimiPortableAIProfile,
  type NimiPortableAIProfileCapability,
  type NimiPortableAIProfileImplementation,
  type NimiPortableAIProfileInput,
} from './config-profile.js';

export const NIMI_AI_PROFILE_INPUT_IMAGE_FEATURE = 'input.image';
export const NIMI_AI_PROFILE_INPUT_AUDIO_FEATURE = 'input.audio';
export const NIMI_AI_PROFILE_INPUT_TEXT_FEATURE = 'input.text';

export const NIMI_AI_PROFILE_LLAMA_CPP_IMPLEMENTATION = Object.freeze({
  implementationId: 'local.text.generate.llama-cpp',
  driverId: 'nimi.runtime.driver.llama-cpp',
  driverDialect: 'llama.cpp/text-generate/v1',
}) satisfies Readonly<CapabilityImplementationIdentity>;

export const NIMI_AI_PROFILE_LLAMA_CPP_EMBED_IMPLEMENTATION = Object.freeze({
  implementationId: 'local.text.embed.llama-cpp',
  driverId: 'nimi.runtime.driver.llama-cpp',
  driverDialect: 'llama.cpp/text-embed/v1',
}) satisfies Readonly<CapabilityImplementationIdentity>;

export const NIMI_AI_PROFILE_QWEN3_TTS_IMPLEMENTATION = Object.freeze({
  implementationId: 'local.audio.synthesize.qwen3-tts',
  driverId: 'nimi.runtime.driver.qwen3-tts',
  driverDialect: 'qwen3-tts/audio-synthesize/v1',
}) satisfies Readonly<CapabilityImplementationIdentity>;

export const NIMI_AI_PROFILE_QWEN3_VOICE_CREATE_IMPLEMENTATION = Object.freeze({
  implementationId: 'local.voice.create.qwen3-tts',
  driverId: 'nimi.runtime.driver.qwen3-tts',
  driverDialect: 'qwen3-tts/voice-create/v1',
}) satisfies Readonly<CapabilityImplementationIdentity>;

export const NIMI_AI_PROFILE_QWEN3_ASR_IMPLEMENTATION = Object.freeze({
  implementationId: 'local.audio.transcribe.qwen3-asr',
  driverId: 'nimi.runtime.driver.qwen3-asr',
  driverDialect: 'qwen3-asr/audio-transcribe/v1',
}) satisfies Readonly<CapabilityImplementationIdentity>;

export const NIMI_AI_PROFILE_QWEN3_ASR_TRANSFORMERS_IMPLEMENTATION = Object.freeze({
  implementationId: 'local.audio.transcribe.qwen3-asr-transformers',
  driverId: 'nimi.runtime.driver.qwen3-asr-transformers',
  driverDialect: 'qwen3-asr-transformers/audio-transcribe/v1',
}) satisfies Readonly<CapabilityImplementationIdentity>;

export const NIMI_AI_PROFILE_STABLE_DIFFUSION_IMPLEMENTATION = Object.freeze({
  implementationId: 'local.image.generate.stable-diffusion-cpp',
  driverId: 'nimi.runtime.driver.stable-diffusion-cpp',
  driverDialect: 'stable-diffusion.cpp/image-generate/v1',
}) satisfies Readonly<CapabilityImplementationIdentity>;

/**
 * Mirrors runtime/internal/capabilitydriver/stablediffusion_video.go:19-21;
 * implementationId/driverId alias the image pair at
 * runtime/internal/capabilitydriver/stablediffusion.go:18-19.
 */
export const NIMI_AI_PROFILE_STABLE_DIFFUSION_VIDEO_IMPLEMENTATION = Object.freeze({
  implementationId: 'local.image.generate.stable-diffusion-cpp',
  driverId: 'nimi.runtime.driver.stable-diffusion-cpp',
  driverDialect: 'stable-diffusion.cpp/minimax-h3-video-generate/v1',
}) satisfies Readonly<CapabilityImplementationIdentity>;

/** Mirrors runtime/internal/capabilitydriver/llama.go:464-465. */
export const NIMI_AI_PROFILE_LLAMA_PORTABLE_CONFIG_FIELDS = Object.freeze([
  'mainRequirementPolicy',
  'mainVerifiedContentId',
  'mmprojRequirementPolicy',
  'mmprojVerifiedContentId',
  'contextSize',
  'cacheTypeK',
  'cacheTypeV',
  'flashAttention',
  'gpuLayers',
] as const);

/** Mirrors the non-multimodal portable fields admitted by LlamaEmbedDriver. */
export const NIMI_AI_PROFILE_LLAMA_EMBED_PORTABLE_CONFIG_FIELDS = Object.freeze([
  'mainRequirementPolicy',
  'mainVerifiedContentId',
  'contextSize',
  'cacheTypeK',
  'cacheTypeV',
  'flashAttention',
  'gpuLayers',
] as const);

/** Mirrors runtime/internal/capabilitydriver/stablediffusion.go:715-720. */
export const NIMI_AI_PROFILE_STABLE_DIFFUSION_PORTABLE_CONFIG_FIELDS = Object.freeze([
  'modelFamily',
  'enableInputImage',
  'mainRequirementPolicy',
  'mainVerifiedContentId',
  'textEncoderRequirementPolicy',
  'textEncoderVerifiedContentId',
  'vaeRequirementPolicy',
  'vaeVerifiedContentId',
  'uncondDiffusionRequirementPolicy',
  'uncondDiffusionVerifiedContentId',
  'executionOptions',
] as const);

/** Mirrors runtime/internal/capabilitydriver/stablediffusion.go:862. */
export const NIMI_AI_PROFILE_STABLE_DIFFUSION_EXECUTION_OPTION_FIELDS = Object.freeze([
  'steps',
  'cfgScale',
  'width',
  'height',
  'seed',
  'sampler',
  'scheduler',
  'threads',
  'diffusionFlashAttention',
  'offloadParamsToCPU',
] as const);

/**
 * Mirrors the policyKey/contentIDKey pairs admitted by
 * parseStableDiffusionVideoPortableConfig from stableDiffusionVideoSlots
 * (runtime/internal/capabilitydriver/stablediffusion_video.go:54-80,318-322).
 */
export const NIMI_AI_PROFILE_STABLE_DIFFUSION_VIDEO_PORTABLE_CONFIG_FIELDS = Object.freeze([
  'fl2vaRequirementPolicy',
  'fl2vaVerifiedContentId',
  'ref2vaRequirementPolicy',
  'ref2vaVerifiedContentId',
  'encoderRequirementPolicy',
  'encoderVerifiedContentId',
  'videoVAERequirementPolicy',
  'videoVAEVerifiedContentId',
  'audioVAERequirementPolicy',
  'audioVAEVerifiedContentId',
] as const);

/** Cloud recommendation content is intentionally grantless and connectorless. */
export const NIMI_AI_PROFILE_CLOUD_RECOMMENDATION_FIELDS = Object.freeze([
  'implementation',
  'supportedFeatures',
  'providerModelTarget',
] as const);

/**
 * Actionable Profile digest participation. Profile identity, title,
 * description, provenance, license, and displayMetadata are deliberately
 * excluded; they do not change AIConfig or machine-local portable intent.
 */
export const NIMI_AI_PROFILE_PORTABLE_CONTENT_DIGEST_FIELDS = Object.freeze([
  'capabilities.<CapabilityContract>.route',
  'capabilities.<CapabilityContract>.requiredFeatures',
  'capabilities.<CapabilityContract>.defaults',
  'capabilities.<CapabilityContract>.implementation.{implementationId,driverId,driverDialect,supportedFeatures}',
  'capabilities.<CapabilityContract>.driverPortableConfig',
  'capabilities.<CapabilityContract>.resourceOccurrences',
  'capabilities.<CapabilityContract>.providerModelTarget',
] as const);

/**
 * Exact Local Capability Configuration portable-content participation. These
 * are the portable fields admitted by Runtime's Add request. Runtime-generated
 * id, requirements, bindings, resolution, reasons, display name, provenance,
 * Profile metadata, and machine selection do not participate.
 */
export const NIMI_AI_PROFILE_LOCAL_EQUIVALENCE_DIGEST_FIELDS = Object.freeze([
  'capabilityContract',
  'implementation.{implementationId,driverId,driverDialect}',
  'driverPortableConfig',
  'supportedFeatures',
] as const);

export type NimiAIProfileRequirementPolicy = 'strict' | 'substitutable';

export const NIMI_AI_PROFILE_LLAMA_CACHE_TYPES = Object.freeze([
  'f32',
  'f16',
  'bf16',
  'q8_0',
  'q4_0',
] as const);

export type NimiAIProfileLlamaCacheType =
  typeof NIMI_AI_PROFILE_LLAMA_CACHE_TYPES[number];

export interface NimiAIProfileLlamaPortableConfigInput {
  readonly mainRequirementPolicy?: NimiAIProfileRequirementPolicy;
  readonly mainVerifiedContentId?: string;
  readonly mmprojRequirementPolicy?: NimiAIProfileRequirementPolicy;
  readonly mmprojVerifiedContentId?: string;
  readonly contextSize?: number;
  readonly cacheTypeK?: NimiAIProfileLlamaCacheType;
  readonly cacheTypeV?: NimiAIProfileLlamaCacheType;
  readonly flashAttention?: boolean;
  readonly gpuLayers?: number;
}

export interface NimiAIProfileLlamaEmbedPortableConfigInput {
  readonly mainRequirementPolicy?: NimiAIProfileRequirementPolicy;
  readonly mainVerifiedContentId?: string;
  readonly contextSize?: number;
  readonly cacheTypeK?: NimiAIProfileLlamaCacheType;
  readonly cacheTypeV?: NimiAIProfileLlamaCacheType;
  readonly flashAttention?: boolean;
  readonly gpuLayers?: number;
}

export const NIMI_AI_PROFILE_STABLE_DIFFUSION_MODEL_FAMILIES = Object.freeze([
  'z-image',
  'z-image-turbo',
  'ideogram4',
] as const);

export type NimiAIProfileStableDiffusionModelFamily =
  typeof NIMI_AI_PROFILE_STABLE_DIFFUSION_MODEL_FAMILIES[number];

export interface NimiAIProfileStableDiffusionExecutionOptionsInput {
  readonly steps?: number;
  readonly cfgScale?: number;
  readonly width?: number;
  readonly height?: number;
  readonly seed?: number;
  readonly sampler?: string;
  readonly scheduler?: string;
  readonly threads?: number;
  readonly diffusionFlashAttention?: boolean;
  readonly offloadParamsToCPU?: boolean;
}

export interface NimiAIProfileStableDiffusionPortableConfigInput {
  readonly modelFamily: NimiAIProfileStableDiffusionModelFamily;
  readonly enableInputImage?: boolean;
  readonly mainRequirementPolicy?: NimiAIProfileRequirementPolicy;
  readonly mainVerifiedContentId?: string;
  readonly textEncoderRequirementPolicy?: NimiAIProfileRequirementPolicy;
  readonly textEncoderVerifiedContentId?: string;
  readonly vaeRequirementPolicy?: NimiAIProfileRequirementPolicy;
  readonly vaeVerifiedContentId?: string;
  readonly uncondDiffusionRequirementPolicy?: NimiAIProfileRequirementPolicy;
  readonly uncondDiffusionVerifiedContentId?: string;
  readonly executionOptions?: NimiAIProfileStableDiffusionExecutionOptionsInput;
}

/**
 * MiniMax-H3 video.generate portable config. The ten fields are exactly the
 * policyKey/contentIDKey pairs of the five Driver slots at
 * runtime/internal/capabilitydriver/stablediffusion_video.go:54-80; any other
 * key fails closed (stablediffusion_video.go:323-327). An absent section
 * defaults every slot to substitutable (stablediffusion_video.go:312-317).
 */
export interface NimiAIProfileStableDiffusionVideoPortableConfigInput {
  readonly fl2vaRequirementPolicy?: NimiAIProfileRequirementPolicy;
  readonly fl2vaVerifiedContentId?: string;
  readonly ref2vaRequirementPolicy?: NimiAIProfileRequirementPolicy;
  readonly ref2vaVerifiedContentId?: string;
  readonly encoderRequirementPolicy?: NimiAIProfileRequirementPolicy;
  readonly encoderVerifiedContentId?: string;
  readonly videoVAERequirementPolicy?: NimiAIProfileRequirementPolicy;
  readonly videoVAEVerifiedContentId?: string;
  readonly audioVAERequirementPolicy?: NimiAIProfileRequirementPolicy;
  readonly audioVAEVerifiedContentId?: string;
}

export type NimiAIProfileDriverAuthoringSection =
  | {
    readonly kind: 'llama';
    readonly portableConfig?: NimiAIProfileLlamaPortableConfigInput;
  }
  | {
    readonly kind: 'llama-embed';
    readonly portableConfig?: NimiAIProfileLlamaEmbedPortableConfigInput;
  }
  | {
    readonly kind: 'qwen3-tts';
    readonly portableConfig?: NimiJsonObject;
  }
  | {
    readonly kind: 'qwen3-voice-create';
    readonly portableConfig?: NimiJsonObject;
  }
  | {
    readonly kind: 'qwen3-asr';
    readonly portableConfig?: NimiJsonObject;
  }
  | {
    readonly kind: 'qwen3-asr-transformers';
    readonly portableConfig?: NimiJsonObject;
  }
  | {
    readonly kind: 'stable-diffusion';
    readonly portableConfig: NimiAIProfileStableDiffusionPortableConfigInput;
  }
  | {
    readonly kind: 'stable-diffusion-video';
    readonly portableConfig?: NimiAIProfileStableDiffusionVideoPortableConfigInput;
  };

export interface NimiAIProfileLocalImplementationAuthoringInput {
  readonly implementation: CapabilityImplementationIdentity;
  readonly supportedFeatures?: readonly string[];
  readonly driverSection: NimiAIProfileDriverAuthoringSection;
}

export interface NimiAIProfileCloudRecommendationAuthoringInput {
  readonly implementation: CapabilityImplementationIdentity;
  readonly supportedFeatures?: readonly string[];
  readonly providerModelTarget: NimiJsonObject;
}

export interface NimiAIProfileLocalCapabilityAuthoringInput {
  readonly capabilityContract: string;
  readonly requiredFeatures?: readonly string[];
  readonly defaults?: NimiJsonObject;
  readonly localConfiguration?: NimiAIProfileLocalImplementationAuthoringInput;
}

export interface NimiAIProfileCloudCapabilityAuthoringInput {
  readonly capabilityContract: string;
  readonly requiredFeatures?: readonly string[];
  readonly defaults?: NimiJsonObject;
  readonly recommendation: NimiAIProfileCloudRecommendationAuthoringInput;
}

export interface NimiAIProfileAuthoringBuilderInput {
  readonly profileId: string;
  readonly title: string;
  readonly description?: string;
  readonly provenance?: NimiJsonObject;
  readonly license?: NimiJsonValue;
  readonly displayMetadata?: NimiJsonObject;
}

export interface NimiAIProfileAuthoringValidationOptions {
  /** Defaults to true for publication/export validation. */
  readonly requireProvenance?: boolean;
  /** Defaults to true for publication/export validation. */
  readonly requireLicense?: boolean;
  /** Defaults to true; this checks only top-level structural emptiness. */
  readonly requireNonEmptyProvenance?: boolean;
  /** Defaults to true; this checks only top-level structural emptiness. */
  readonly requireNonEmptyLicense?: boolean;
}

export type NimiAIProfileEquivalenceDigest = `sha256:${string}`;

export interface NimiAIProfileAuthoringValidationResult {
  readonly profile: NimiPortableAIProfile;
  readonly portableContentDigest: NimiAIProfileEquivalenceDigest;
  readonly localConfigurationDigests: Readonly<Record<string, NimiAIProfileEquivalenceDigest>>;
}

export interface NimiAIProfileAuthoringProjectedRequirement {
  readonly requirementId: string;
  readonly role: 'main' | 'companion';
  readonly occurrenceOrdinal: number;
  readonly displayLabel: string;
  readonly resourceKind: string;
  readonly policy: NimiAIProfileRequirementPolicy;
  readonly preferredVerifiedContentId?: string;
}

export interface NimiAIProfileAuthoringRequirementProjection {
  readonly source: 'authoring-preview';
  readonly commitTruth: 'runtime-reproject';
  readonly requirements: readonly NimiAIProfileAuthoringProjectedRequirement[];
}

export interface NimiAIProfileImportPreview {
  readonly action: 'import-profile';
  readonly source: NimiPortableAIProfile;
  readonly artifactJson: string;
  readonly previewOnly: true;
  readonly declaredWrites: {
    readonly profileArtifact: true;
    readonly aiConfig: false;
    readonly localCapabilityConfigurations: false;
    readonly machineSelection: false;
    readonly connectorGrant: false;
  };
}

export type NimiAIProfileApplyTarget =
  | { readonly kind: 'app'; readonly appId: string }
  | { readonly kind: 'shared-local-agent' };

export interface NimiAIProfileAIConfigIntentDiff {
  readonly addedCapabilityContracts: readonly string[];
  readonly removedCapabilityContracts: readonly string[];
  readonly changedCapabilityContracts: readonly string[];
  readonly unchangedCapabilityContracts: readonly string[];
}

export interface NimiAIProfileApplyPreview {
  readonly action: 'apply-to-ai-config';
  readonly target: NimiAIProfileApplyTarget;
  readonly source: NimiPortableAIProfile;
  readonly before: AIConfig | null;
  readonly after: AIConfig;
  readonly identical: boolean;
  readonly intentDiff: NimiAIProfileAIConfigIntentDiff;
  readonly cloudSelections: readonly {
    readonly capabilityContract: string;
    readonly state: 'selection-required';
  }[];
  readonly previewOnly: true;
  readonly writesOnly: 'target-ai-config';
}

export interface NimiAIProfileAuthoringMachineConfigurationProjection {
  readonly configurationId: string;
  readonly capabilityContract: string;
  readonly implementation: CapabilityImplementationIdentity;
  readonly portableConfig?: NimiJsonObject;
  readonly supportedFeatures: readonly string[];
  readonly requirementResolution: 'unresolved' | 'configured';
  readonly provenance?: NimiJsonObject;
  /** Optional source identity projected by the caller; Runtime does not infer it. */
  readonly sourceProfileId?: string;
}

export interface NimiAIProfileAuthoringMachineSelectionProjection {
  readonly capabilityContract: string;
  readonly configurationId: string;
}

export interface NimiAIProfileAuthoringMachineProjection {
  readonly configurations: readonly NimiAIProfileAuthoringMachineConfigurationProjection[];
  readonly selections: readonly NimiAIProfileAuthoringMachineSelectionProjection[];
}

export interface NimiAIProfileLocalConfigurationProposal {
  readonly capabilityContract: string;
  readonly implementation: CapabilityImplementationIdentity;
  readonly portableConfig: NimiJsonObject;
  readonly supportedFeatures: readonly string[];
  readonly displayName: string;
  readonly provenance?: NimiJsonObject;
}

export type NimiAIProfileLocalConfigurationDecision =
  | {
    readonly kind: 'add-new';
    readonly expectedRequirementResolution: 'unresolved';
  }
  | {
    readonly kind: 'reuse-equivalent';
    readonly matches: readonly {
      readonly configurationId: string;
      readonly requirementResolution: 'unresolved' | 'configured';
    }[];
    readonly expectedRequirementResolution: 'unresolved' | 'configured';
    readonly requiresExistingRecordSelection: boolean;
  }
  | {
    readonly kind: 'choose-update-or-add';
    readonly updateCandidateConfigurationIds: readonly string[];
    readonly updateExpectedRequirementResolution: 'unresolved';
    readonly addExpectedRequirementResolution: 'unresolved';
  };

export interface NimiAIProfileLocalConfigurationPreview {
  readonly action: 'add-or-update-local-capability-configuration';
  readonly source: NimiPortableAIProfile;
  readonly proposal: NimiAIProfileLocalConfigurationProposal;
  readonly equivalenceDigest: NimiAIProfileEquivalenceDigest;
  readonly requirementProjection: NimiAIProfileAuthoringRequirementProjection;
  readonly decision: NimiAIProfileLocalConfigurationDecision;
  readonly runtimeMayConfigureExactPreferredContentAtCommit: boolean;
  readonly previewOnly: true;
  readonly writesOnly: 'machine-local-capability-configuration';
  readonly doesNotSelect: true;
}

export interface NimiAIProfileFeatureSubsetResult {
  readonly status: 'compatible' | 'feature-mismatch' | 'unavailable';
  readonly compatible: boolean;
  readonly requiredFeatures: readonly string[];
  readonly supportedFeatures: readonly string[];
  readonly missingFeatures: readonly string[];
}

export interface NimiAIProfileSelectionCloudAlternative {
  readonly implementation: CapabilityImplementationIdentity;
  readonly supportedFeatures: readonly string[];
  readonly providerModelTarget: NimiJsonObject;
}

export interface NimiAIProfileSelectionMismatchPreview {
  readonly action: 'selection-mismatch';
  readonly capabilityContract: string;
  readonly requiredFeatures: readonly string[];
  readonly branches: readonly [
    {
      readonly kind: 'continue-current-selection';
      readonly configurationId: string | null;
      readonly featureSubset: NimiAIProfileFeatureSubsetResult;
      readonly changesSelection: false;
    },
    {
      readonly kind: 'select-recommended-local-configuration';
      readonly configurationIds: readonly string[];
      readonly prerequisite: 'none' | 'add-or-update-local-configuration' | 'local-recommendation-unavailable';
      readonly featureSubset: NimiAIProfileFeatureSubsetResult;
      readonly changesSelection: boolean;
    },
    {
      readonly kind: 'use-cloud';
      readonly implementation: CapabilityImplementationIdentity | null;
      readonly providerModelTarget: NimiJsonObject | null;
      readonly featureSubset: NimiAIProfileFeatureSubsetResult;
      readonly connectorGrantSelection: 'selection-required' | 'unavailable';
      readonly prerequisite: 'apply-cloud-intent' | 'cloud-recommendation-unavailable';
    },
  ];
  readonly mismatchFailsClosed: true;
  readonly previewOnly: true;
  readonly commits: false;
}

export function createNimiAIProfileLlamaPortableConfig(
  input: NimiAIProfileLlamaPortableConfigInput = {},
  supportedFeatures: readonly string[] = [],
): NimiJsonObject {
  const features = normalizeFeatureSet(supportedFeatures, 'llama supportedFeatures');
  const config = normalizeAuthoringJsonObject(input, 'llama portableConfig');
  validateLlamaPortableConfig(config, features);
  return config;
}

export function createNimiAIProfileLlamaEmbedPortableConfig(
  input: NimiAIProfileLlamaEmbedPortableConfigInput = {},
  supportedFeatures: readonly string[] = [],
): NimiJsonObject {
  const features = normalizeFeatureSet(supportedFeatures, 'llama embedding supportedFeatures');
  const config = normalizeAuthoringJsonObject(input, 'llama embedding portableConfig');
  validateLlamaEmbedPortableConfig(config, features);
  return config;
}

function createNimiAIProfileQwen3SpeechPortableConfig(
  input: NimiJsonObject,
  supportedFeatures: readonly string[],
  label: string,
): NimiJsonObject {
  const features = normalizeFeatureSet(supportedFeatures, `${label} supportedFeatures`);
  const config = normalizeAuthoringJsonObject(input, `${label} portableConfig`);
  validateQwen3SpeechPortableConfig(config, features, label);
  return config;
}

export function createNimiAIProfileStableDiffusionPortableConfig(
  input: NimiAIProfileStableDiffusionPortableConfigInput,
  supportedFeatures: readonly string[] = input?.enableInputImage === true
    ? [NIMI_AI_PROFILE_INPUT_IMAGE_FEATURE]
    : [],
): NimiJsonObject {
  const features = normalizeFeatureSet(supportedFeatures, 'stable-diffusion supportedFeatures');
  const config = normalizeAuthoringJsonObject(input, 'stable-diffusion portableConfig');
  validateStableDiffusionPortableConfig(config, features);
  return config;
}

export function createNimiAIProfileStableDiffusionVideoPortableConfig(
  input: NimiAIProfileStableDiffusionVideoPortableConfigInput = {},
  supportedFeatures: readonly string[] = [],
): NimiJsonObject {
  const features = normalizeFeatureSet(
    supportedFeatures,
    'stable-diffusion video supportedFeatures',
  );
  const config = normalizeAuthoringJsonObject(input, 'stable-diffusion video portableConfig');
  validateStableDiffusionVideoPortableConfig(config, features);
  return config;
}

export function createNimiAIProfileLlamaLocalImplementation(input: {
  readonly supportedFeatures?: readonly string[];
  readonly portableConfig?: NimiAIProfileLlamaPortableConfigInput;
} = {}): NimiAIProfileLocalImplementationAuthoringInput {
  assertExactRecord(input, new Set(['supportedFeatures', 'portableConfig']), 'llama implementation input');
  const supportedFeatures = normalizeFeatureSet(input.supportedFeatures ?? [], 'llama supportedFeatures');
  const portableConfig = createNimiAIProfileLlamaPortableConfig(
    input.portableConfig ?? {},
    supportedFeatures,
  );
  return Object.freeze({
    implementation: Object.freeze({ ...NIMI_AI_PROFILE_LLAMA_CPP_IMPLEMENTATION }),
    supportedFeatures,
    driverSection: Object.freeze({ kind: 'llama' as const, portableConfig }),
  });
}

export function createNimiAIProfileLlamaEmbedLocalImplementation(input: {
  readonly supportedFeatures?: readonly string[];
  readonly portableConfig?: NimiAIProfileLlamaEmbedPortableConfigInput;
} = {}): NimiAIProfileLocalImplementationAuthoringInput {
  assertExactRecord(
    input,
    new Set(['supportedFeatures', 'portableConfig']),
    'llama embedding implementation input',
  );
  const supportedFeatures = normalizeFeatureSet(
    input.supportedFeatures ?? [],
    'llama embedding supportedFeatures',
  );
  const portableConfig = createNimiAIProfileLlamaEmbedPortableConfig(
    input.portableConfig ?? {},
    supportedFeatures,
  );
  return Object.freeze({
    implementation: Object.freeze({ ...NIMI_AI_PROFILE_LLAMA_CPP_EMBED_IMPLEMENTATION }),
    supportedFeatures,
    driverSection: Object.freeze({ kind: 'llama-embed' as const, portableConfig }),
  });
}

export function createNimiAIProfileQwen3TTSLocalImplementation(input: {
  readonly supportedFeatures?: readonly string[];
} = {}): NimiAIProfileLocalImplementationAuthoringInput {
  assertExactRecord(input, new Set(['supportedFeatures']), 'Qwen3-TTS implementation input');
  const supportedFeatures = normalizeFeatureSet(
    input.supportedFeatures ?? [],
    'Qwen3-TTS supportedFeatures',
  );
  const portableConfig = createNimiAIProfileQwen3SpeechPortableConfig(
    {},
    supportedFeatures,
    'Qwen3-TTS',
  );
  return Object.freeze({
    implementation: Object.freeze({ ...NIMI_AI_PROFILE_QWEN3_TTS_IMPLEMENTATION }),
    supportedFeatures,
    driverSection: Object.freeze({ kind: 'qwen3-tts' as const, portableConfig }),
  });
}

export function createNimiAIProfileQwen3VoiceCreateLocalImplementation(input: {
  readonly supportedFeatures: readonly string[];
}): NimiAIProfileLocalImplementationAuthoringInput {
  assertExactRecord(input, new Set(['supportedFeatures']), 'Qwen3 voice.create implementation input');
  const supportedFeatures = normalizeFeatureSet(
    input.supportedFeatures,
    'Qwen3 voice.create supportedFeatures',
  );
  validateQwen3VoiceCreateFeatures(supportedFeatures);
  return Object.freeze({
    implementation: Object.freeze({ ...NIMI_AI_PROFILE_QWEN3_VOICE_CREATE_IMPLEMENTATION }),
    supportedFeatures,
    driverSection: Object.freeze({ kind: 'qwen3-voice-create' as const, portableConfig: Object.freeze({}) }),
  });
}

export function createNimiAIProfileQwen3ASRLocalImplementation(input: {
  readonly supportedFeatures?: readonly string[];
} = {}): NimiAIProfileLocalImplementationAuthoringInput {
  assertExactRecord(input, new Set(['supportedFeatures']), 'Qwen3-ASR implementation input');
  const supportedFeatures = normalizeFeatureSet(
    input.supportedFeatures ?? [],
    'Qwen3-ASR supportedFeatures',
  );
  const portableConfig = createNimiAIProfileQwen3SpeechPortableConfig(
    {},
    supportedFeatures,
    'Qwen3-ASR',
  );
  return Object.freeze({
    implementation: Object.freeze({ ...NIMI_AI_PROFILE_QWEN3_ASR_IMPLEMENTATION }),
    supportedFeatures,
    driverSection: Object.freeze({ kind: 'qwen3-asr' as const, portableConfig }),
  });
}

export function createNimiAIProfileQwen3ASRTransformersLocalImplementation(input: {
  readonly supportedFeatures?: readonly string[];
} = {}): NimiAIProfileLocalImplementationAuthoringInput {
  assertExactRecord(input, new Set(['supportedFeatures']), 'Transformers-native Qwen3-ASR implementation input');
  const supportedFeatures = normalizeFeatureSet(
    input.supportedFeatures ?? [],
    'Transformers-native Qwen3-ASR supportedFeatures',
  );
  const portableConfig = createNimiAIProfileQwen3SpeechPortableConfig(
    {},
    supportedFeatures,
    'Transformers-native Qwen3-ASR',
  );
  return Object.freeze({
    implementation: Object.freeze({ ...NIMI_AI_PROFILE_QWEN3_ASR_TRANSFORMERS_IMPLEMENTATION }),
    supportedFeatures,
    driverSection: Object.freeze({ kind: 'qwen3-asr-transformers' as const, portableConfig }),
  });
}

export function createNimiAIProfileStableDiffusionLocalImplementation(input: {
  readonly supportedFeatures?: readonly string[];
  readonly portableConfig: NimiAIProfileStableDiffusionPortableConfigInput;
}): NimiAIProfileLocalImplementationAuthoringInput {
  assertExactRecord(input, new Set(['supportedFeatures', 'portableConfig']), 'stable-diffusion implementation input');
  const supportedFeatures = normalizeFeatureSet(
    input.supportedFeatures ?? (input.portableConfig?.enableInputImage === true
      ? [NIMI_AI_PROFILE_INPUT_IMAGE_FEATURE]
      : []),
    'stable-diffusion supportedFeatures',
  );
  const portableConfig = createNimiAIProfileStableDiffusionPortableConfig(
    input.portableConfig,
    supportedFeatures,
  );
  return Object.freeze({
    implementation: Object.freeze({ ...NIMI_AI_PROFILE_STABLE_DIFFUSION_IMPLEMENTATION }),
    supportedFeatures,
    driverSection: Object.freeze({
      kind: 'stable-diffusion' as const,
      portableConfig: portableConfig as unknown as NimiAIProfileStableDiffusionPortableConfigInput,
    }),
  });
}

export function createNimiAIProfileStableDiffusionVideoLocalImplementation(input: {
  readonly supportedFeatures?: readonly string[];
  readonly portableConfig?: NimiAIProfileStableDiffusionVideoPortableConfigInput;
} = {}): NimiAIProfileLocalImplementationAuthoringInput {
  assertExactRecord(
    input,
    new Set(['supportedFeatures', 'portableConfig']),
    'stable-diffusion video implementation input',
  );
  const supportedFeatures = normalizeFeatureSet(
    input.supportedFeatures ?? [],
    'stable-diffusion video supportedFeatures',
  );
  const portableConfig = createNimiAIProfileStableDiffusionVideoPortableConfig(
    input.portableConfig ?? {},
    supportedFeatures,
  );
  return Object.freeze({
    implementation: Object.freeze({ ...NIMI_AI_PROFILE_STABLE_DIFFUSION_VIDEO_IMPLEMENTATION }),
    supportedFeatures,
    driverSection: Object.freeze({
      kind: 'stable-diffusion-video' as const,
      portableConfig: (
        portableConfig as unknown as NimiAIProfileStableDiffusionVideoPortableConfigInput
      ),
    }),
  });
}

export class NimiAIProfileAuthoringBuilder {
  #profileId: string;
  #title: string;
  #description: string | undefined;
  #capabilities: Record<string, NimiPortableAIProfileCapability> = {};
  #provenance: NimiJsonObject | undefined;
  #license: NimiJsonValue | undefined;
  #displayMetadata: NimiJsonObject | undefined;

  constructor(input: NimiAIProfileAuthoringBuilderInput) {
    assertExactRecord(input, new Set([
      'profileId',
      'title',
      'description',
      'provenance',
      'license',
      'displayMetadata',
    ]), 'AIProfile builder input');
    this.#profileId = requireExactNonEmptyText(input.profileId, 'AIProfile profileId');
    this.#title = requireExactNonEmptyText(input.title, 'AIProfile title');
    this.#description = input.description === undefined
      ? undefined
      : requireExactText(input.description, 'AIProfile description');
    this.#provenance = input.provenance === undefined
      ? undefined
      : normalizeAuthoringJsonObject(input.provenance, 'AIProfile provenance');
    this.#license = input.license === undefined
      ? undefined
      : normalizeAuthoringJsonValue(input.license, 'AIProfile license');
    this.#displayMetadata = input.displayMetadata === undefined
      ? undefined
      : normalizeAuthoringJsonObject(input.displayMetadata, 'AIProfile displayMetadata');
  }

  static import(input: NimiPortableAIProfileInput): NimiAIProfileAuthoringBuilder {
    const profile = parseNimiPortableAIProfile(input);
    const builder = new NimiAIProfileAuthoringBuilder({
      profileId: profile.profileId,
      title: profile.title,
      ...(profile.description !== undefined ? { description: profile.description } : {}),
      ...(profile.provenance !== undefined ? { provenance: profile.provenance } : {}),
      ...(profile.license !== undefined ? { license: profile.license } : {}),
      ...(profile.displayMetadata !== undefined ? { displayMetadata: profile.displayMetadata } : {}),
    });
    builder.#capabilities = Object.fromEntries(
      Object.entries(profile.capabilities).map(([capabilityContract, capability]) => [
        capabilityContract,
        capability,
      ]),
    );
    return builder;
  }

  setProfileId(profileId: string): this {
    this.#profileId = requireExactNonEmptyText(profileId, 'AIProfile profileId');
    return this;
  }

  setTitle(title: string): this {
    this.#title = requireExactNonEmptyText(title, 'AIProfile title');
    return this;
  }

  setDescription(description: string | undefined): this {
    this.#description = description === undefined
      ? undefined
      : requireExactText(description, 'AIProfile description');
    return this;
  }

  setProvenance(provenance: NimiJsonObject | undefined): this {
    this.#provenance = provenance === undefined
      ? undefined
      : normalizeAuthoringJsonObject(provenance, 'AIProfile provenance');
    return this;
  }

  setLicense(license: NimiJsonValue | undefined): this {
    this.#license = license === undefined
      ? undefined
      : normalizeAuthoringJsonValue(license, 'AIProfile license');
    return this;
  }

  setDisplayMetadata(displayMetadata: NimiJsonObject | undefined): this {
    this.#displayMetadata = displayMetadata === undefined
      ? undefined
      : normalizeAuthoringJsonObject(displayMetadata, 'AIProfile displayMetadata');
    return this;
  }

  setLocalCapability(input: NimiAIProfileLocalCapabilityAuthoringInput): this {
    assertExactRecord(
      input,
      new Set(['capabilityContract', 'requiredFeatures', 'defaults', 'localConfiguration']),
      'Local capability input',
    );
    const capabilityContract = requireExactNonEmptyText(
      input.capabilityContract,
      'Local CapabilityContract',
    );
    const requiredFeatures = normalizeFeatureSet(
      input.requiredFeatures ?? [],
      `${capabilityContract} requiredFeatures`,
    );
    const defaults = input.defaults === undefined
      ? undefined
      : normalizeAuthoringJsonObject(input.defaults, `${capabilityContract} defaults`);
    let implementation: NimiPortableAIProfileImplementation | undefined;
    let driverPortableConfig: NimiJsonObject | undefined;
    if (input.localConfiguration !== undefined) {
      const local = normalizeLocalImplementationInput(
        input.localConfiguration,
        capabilityContract,
      );
      assertFeatureSubset(requiredFeatures, local.supportedFeatures, capabilityContract);
      implementation = Object.freeze({
        ...local.implementation,
        supportedFeatures: local.supportedFeatures,
      });
      driverPortableConfig = local.portableConfig;
    }
    this.#capabilities[capabilityContract] = Object.freeze({
      route: 'local' as const,
      requiredFeatures,
      ...(defaults !== undefined ? { defaults } : {}),
      ...(implementation !== undefined ? { implementation } : {}),
      ...(driverPortableConfig !== undefined ? { driverPortableConfig } : {}),
    });
    return this;
  }

  setCloudCapability(input: NimiAIProfileCloudCapabilityAuthoringInput): this {
    assertExactRecord(
      input,
      new Set(['capabilityContract', 'requiredFeatures', 'defaults', 'recommendation']),
      'Cloud capability input',
    );
    const capabilityContract = requireExactNonEmptyText(
      input.capabilityContract,
      'Cloud CapabilityContract',
    );
    const requiredFeatures = normalizeFeatureSet(
      input.requiredFeatures ?? [],
      `${capabilityContract} requiredFeatures`,
    );
    const defaults = input.defaults === undefined
      ? undefined
      : normalizeAuthoringJsonObject(input.defaults, `${capabilityContract} defaults`);
    const recommendation = normalizeCloudRecommendation(input.recommendation);
    assertFeatureSubset(requiredFeatures, recommendation.supportedFeatures, capabilityContract);
    this.#capabilities[capabilityContract] = Object.freeze({
      route: 'cloud' as const,
      requiredFeatures,
      ...(defaults !== undefined ? { defaults } : {}),
      implementation: Object.freeze({
        ...recommendation.implementation,
        supportedFeatures: recommendation.supportedFeatures,
      }),
      providerModelTarget: recommendation.providerModelTarget,
    });
    return this;
  }

  removeCapability(capabilityContract: string): this {
    delete this.#capabilities[requireExactNonEmptyText(capabilityContract, 'CapabilityContract')];
    return this;
  }

  build(
    options: NimiAIProfileAuthoringValidationOptions = {},
  ): NimiPortableAIProfile {
    return validateNimiAIProfileAuthoring(this.#draft(), options).profile;
  }

  export(
    options: NimiAIProfileAuthoringValidationOptions = {},
  ): string {
    return exportNimiAIProfileAuthoring(this.#draft(), options);
  }

  #draft(): NimiPortableAIProfile {
    const capabilities = Object.fromEntries(
      Object.entries(this.#capabilities).sort(([left], [right]) => compareCanonicalText(left, right)),
    );
    return {
      profileId: this.#profileId,
      title: this.#title,
      ...(this.#description !== undefined ? { description: this.#description } : {}),
      capabilities,
      ...(this.#provenance !== undefined ? { provenance: this.#provenance } : {}),
      ...(this.#license !== undefined ? { license: this.#license } : {}),
      ...(this.#displayMetadata !== undefined ? { displayMetadata: this.#displayMetadata } : {}),
    };
  }
}

export function createNimiAIProfileAuthoringBuilder(
  input: NimiAIProfileAuthoringBuilderInput,
): NimiAIProfileAuthoringBuilder {
  return new NimiAIProfileAuthoringBuilder(input);
}

export function importNimiAIProfileAuthoring(
  input: NimiPortableAIProfileInput,
): NimiAIProfileAuthoringBuilder {
  return NimiAIProfileAuthoringBuilder.import(input);
}

export function validateNimiAIProfileAuthoring(
  input: NimiPortableAIProfileInput,
  options: NimiAIProfileAuthoringValidationOptions = {},
): NimiAIProfileAuthoringValidationResult {
  const profile = parseNimiPortableAIProfile(input);
  assertAuthoringPortableValue(profile, 'AIProfile');
  validateAuthoringMetadata(profile, options);
  const localConfigurationDigests: Record<string, NimiAIProfileEquivalenceDigest> = {};
  for (const [capabilityContract, capability] of Object.entries(profile.capabilities)) {
    if (capability.route === 'local' && capability.implementation) {
      validateKnownLocalConfiguration(
        capabilityContract,
        capability.implementation,
        capability.implementation.supportedFeatures,
        capability.driverPortableConfig,
      );
      localConfigurationDigests[capabilityContract] = localConfigurationDigestFromProfile(
        capabilityContract,
        capability,
      );
    }
  }
  return Object.freeze({
    profile,
    portableContentDigest: digestCanonical(
      'nimi.ai-profile.portable-content/v1',
      portableProfileContent(profile),
    ),
    localConfigurationDigests: Object.freeze(localConfigurationDigests),
  });
}

export function exportNimiAIProfileAuthoring(
  input: NimiPortableAIProfileInput,
  options: NimiAIProfileAuthoringValidationOptions = {},
): string {
  const validated = validateNimiAIProfileAuthoring(input, options);
  return serializeNimiPortableAIProfile(validated.profile);
}

export function deriveNimiAIProfilePortableContentDigest(
  input: NimiPortableAIProfileInput,
): NimiAIProfileEquivalenceDigest {
  const profile = validateNimiAIProfileAuthoring(input, OPTIONAL_METADATA_VALIDATION).profile;
  return digestCanonical('nimi.ai-profile.portable-content/v1', portableProfileContent(profile));
}

export function deriveNimiAIProfileLocalConfigurationEquivalenceDigest(
  input: NimiPortableAIProfileInput,
  capabilityContract: string,
): NimiAIProfileEquivalenceDigest {
  const profile = validateNimiAIProfileAuthoring(input, OPTIONAL_METADATA_VALIDATION).profile;
  const contract = requireExactNonEmptyText(capabilityContract, 'CapabilityContract');
  const capability = profile.capabilities[contract];
  if (!capability || capability.route !== 'local' || !capability.implementation) {
    return authoringError(`AIProfile ${contract} has no Local implementation configuration intent`);
  }
  return localConfigurationDigestFromProfile(contract, capability);
}

export function deriveNimiAIProfileRequirementProjection(
  input: NimiPortableAIProfileInput,
  capabilityContract: string,
): NimiAIProfileAuthoringRequirementProjection {
  const profile = validateNimiAIProfileAuthoring(input, OPTIONAL_METADATA_VALIDATION).profile;
  const contract = requireExactNonEmptyText(capabilityContract, 'CapabilityContract');
  const capability = profile.capabilities[contract];
  if (!capability || capability.route !== 'local' || !capability.implementation) {
    return authoringError(`AIProfile ${contract} has no Local implementation configuration intent`);
  }
  return projectKnownDriverRequirements(
    contract,
    capability.implementation,
    capability.driverPortableConfig,
  );
}

export function deriveNimiAIProfileImportPreview(input: {
  readonly profile: NimiPortableAIProfileInput;
  readonly validation?: NimiAIProfileAuthoringValidationOptions;
}): NimiAIProfileImportPreview {
  assertExactRecord(input, new Set(['profile', 'validation']), 'AIProfile Import preview input');
  const source = validateNimiAIProfileAuthoring(input.profile, input.validation ?? {}).profile;
  return Object.freeze({
    action: 'import-profile' as const,
    source,
    artifactJson: serializeNimiPortableAIProfile(source),
    previewOnly: true as const,
    declaredWrites: Object.freeze({
      profileArtifact: true as const,
      aiConfig: false as const,
      localCapabilityConfigurations: false as const,
      machineSelection: false as const,
      connectorGrant: false as const,
    }),
  });
}

export function deriveNimiAIProfileApplyPreview(input: {
  readonly profile: NimiPortableAIProfileInput;
  readonly target: NimiAIProfileApplyTarget;
  readonly before?: AIConfig | null;
  readonly validation?: NimiAIProfileAuthoringValidationOptions;
}): NimiAIProfileApplyPreview {
  assertExactRecord(
    input,
    new Set(['profile', 'target', 'before', 'validation']),
    'AIProfile Apply preview input',
  );
  const source = validateNimiAIProfileAuthoring(input.profile, input.validation ?? {}).profile;
  const target = normalizeApplyTarget(input.target);
  const owner = applyTargetOwner(target);
  const before = input.before ?? null;
  if (before !== null) assertAIConfigOwner(before, target);
  const capabilities = Object.entries(source.capabilities).map(([capabilityContract, capability]) => (
    capability.route === 'local'
      ? createNimiLocalAIConfigCapabilityIntent({
        capabilityContract,
        requiredFeatures: capability.requiredFeatures,
        defaults: capability.defaults,
      })
      : createNimiCloudAIConfigCapabilityIntent({
        capabilityContract,
        requiredFeatures: capability.requiredFeatures,
        defaults: capability.defaults,
        implementation: implementationContent(capability.implementation),
        providerModelTarget: capability.providerModelTarget,
        connectorGrantId: null,
      })
  ));
  const after: AIConfig = { owner, capabilities };
  const intentDiff = deriveAIConfigIntentDiff(before, after);
  const cloudSelections = Object.freeze(after.capabilities
    .filter((intent) => intent.route.oneofKind === 'cloud')
    .map((intent) => Object.freeze({
      capabilityContract: intent.capabilityContract,
      state: 'selection-required' as const,
    })));
  return Object.freeze({
    action: 'apply-to-ai-config' as const,
    target,
    source,
    before,
    after,
    identical: before !== null && canonicalAIConfig(before) === canonicalAIConfig(after),
    intentDiff,
    cloudSelections,
    previewOnly: true as const,
    writesOnly: 'target-ai-config' as const,
  });
}

export function deriveNimiAIProfileLocalConfigurationPreview(input: {
  readonly profile: NimiPortableAIProfileInput;
  readonly capabilityContract: string;
  readonly machine: NimiAIProfileAuthoringMachineProjection;
  readonly validation?: NimiAIProfileAuthoringValidationOptions;
}): NimiAIProfileLocalConfigurationPreview {
  assertExactRecord(
    input,
    new Set(['profile', 'capabilityContract', 'machine', 'validation']),
    'AIProfile Local configuration preview input',
  );
  const source = validateNimiAIProfileAuthoring(input.profile, input.validation ?? {}).profile;
  const capabilityContract = requireExactNonEmptyText(
    input.capabilityContract,
    'CapabilityContract',
  );
  const capability = source.capabilities[capabilityContract];
  if (!capability || capability.route !== 'local' || !capability.implementation) {
    return authoringError(`AIProfile ${capabilityContract} has no Local implementation configuration intent`);
  }
  const machine = normalizeMachineProjection(input.machine);
  const equivalenceDigest = localConfigurationDigestFromProfile(
    capabilityContract,
    capability,
  );
  const equivalent = machine.configurations
    .filter((configuration) => configuration.capabilityContract === capabilityContract)
    .filter((configuration) => sameImplementation(
      configuration.implementation,
      capability.implementation!,
    ))
    .filter((configuration) => localConfigurationDigestFromMachine(configuration) === equivalenceDigest)
    .sort((left, right) => compareCanonicalText(left.configurationId, right.configurationId));
  const sameSource = equivalent.length > 0
    ? []
    : machine.configurations
      .filter((configuration) => configuration.capabilityContract === capabilityContract)
      .filter((configuration) => sameProfileSource(source, configuration))
      .sort((left, right) => compareCanonicalText(left.configurationId, right.configurationId));
  const requirementProjection = projectKnownDriverRequirements(
    capabilityContract,
    capability.implementation,
    capability.driverPortableConfig,
  );
  const decision: NimiAIProfileLocalConfigurationDecision = equivalent.length > 0
    ? Object.freeze({
      kind: 'reuse-equivalent' as const,
      matches: Object.freeze(equivalent.map((configuration) => Object.freeze({
        configurationId: configuration.configurationId,
        requirementResolution: configuration.requirementResolution,
      }))),
      expectedRequirementResolution: equivalent.every(
        (configuration) => configuration.requirementResolution === 'configured',
      ) ? 'configured' as const : 'unresolved' as const,
      requiresExistingRecordSelection: equivalent.length > 1,
    })
    : sameSource.length > 0
      ? Object.freeze({
        kind: 'choose-update-or-add' as const,
        updateCandidateConfigurationIds: Object.freeze(
          sameSource.map((configuration) => configuration.configurationId),
        ),
        updateExpectedRequirementResolution: 'unresolved' as const,
        addExpectedRequirementResolution: 'unresolved' as const,
      })
      : Object.freeze({
        kind: 'add-new' as const,
        expectedRequirementResolution: 'unresolved' as const,
      });
  return Object.freeze({
    action: 'add-or-update-local-capability-configuration' as const,
    source,
    proposal: Object.freeze({
      capabilityContract,
      implementation: Object.freeze({
        implementationId: capability.implementation.implementationId,
        driverId: capability.implementation.driverId,
        driverDialect: capability.implementation.driverDialect,
      }),
      portableConfig: capability.driverPortableConfig ?? Object.freeze({}),
      supportedFeatures: capability.implementation.supportedFeatures,
      displayName: source.title,
      ...(source.provenance !== undefined ? { provenance: source.provenance } : {}),
    }),
    equivalenceDigest,
    requirementProjection,
    decision,
    runtimeMayConfigureExactPreferredContentAtCommit: requirementProjection.requirements.some(
      (requirement) => requirement.preferredVerifiedContentId !== undefined,
    ),
    previewOnly: true as const,
    writesOnly: 'machine-local-capability-configuration' as const,
    doesNotSelect: true as const,
  });
}

export function deriveNimiAIProfileSelectionMismatchPreview(input: {
  readonly profile: NimiPortableAIProfileInput;
  readonly capabilityContract: string;
  readonly machine: NimiAIProfileAuthoringMachineProjection;
  readonly cloudAlternative?: NimiAIProfileSelectionCloudAlternative;
  readonly validation?: NimiAIProfileAuthoringValidationOptions;
}): NimiAIProfileSelectionMismatchPreview {
  assertExactRecord(
    input,
    new Set(['profile', 'capabilityContract', 'machine', 'cloudAlternative', 'validation']),
    'AIProfile selection preview input',
  );
  const source = validateNimiAIProfileAuthoring(input.profile, input.validation ?? {}).profile;
  const capabilityContract = requireExactNonEmptyText(
    input.capabilityContract,
    'CapabilityContract',
  );
  const capability = source.capabilities[capabilityContract];
  if (!capability) return authoringError(`AIProfile does not declare ${capabilityContract}`);
  const requiredFeatures = capability.requiredFeatures;
  const machine = normalizeMachineProjection(input.machine);
  const currentSelection = machine.selections.find(
    (selection) => selection.capabilityContract === capabilityContract,
  );
  const currentConfiguration = currentSelection
    ? machine.configurations.find(
      (configuration) => configuration.configurationId === currentSelection.configurationId,
    )
    : undefined;
  if (currentSelection && !currentConfiguration) {
    return authoringError(`Machine selection for ${capabilityContract} is dangling`);
  }

  const localCapability = capability.route === 'local' && capability.implementation
    ? capability
    : null;
  const equivalentConfigurationIds = localCapability?.implementation
    ? machine.configurations
      .filter((configuration) => configuration.capabilityContract === capabilityContract)
      .filter((configuration) => sameImplementation(
        configuration.implementation,
        localCapability.implementation!,
      ))
      .filter((configuration) => (
        localConfigurationDigestFromMachine(configuration)
          === localConfigurationDigestFromProfile(capabilityContract, localCapability)
      ))
      .map((configuration) => configuration.configurationId)
      .sort()
    : [];

  const cloud = capability.route === 'cloud'
    ? {
      implementation: capability.implementation,
      supportedFeatures: capability.implementation.supportedFeatures,
      providerModelTarget: capability.providerModelTarget,
    }
    : input.cloudAlternative === undefined
      ? null
      : normalizeSelectionCloudAlternative(input.cloudAlternative);

  const currentFeatureSubset = currentConfiguration
    ? deriveFeatureSubset(requiredFeatures, currentConfiguration.supportedFeatures)
    : unavailableFeatureSubset(requiredFeatures);
  const recommendedFeatureSubset = localCapability?.implementation
    ? deriveFeatureSubset(requiredFeatures, localCapability.implementation.supportedFeatures)
    : unavailableFeatureSubset(requiredFeatures);
  const cloudFeatureSubset = cloud
    ? deriveFeatureSubset(requiredFeatures, cloud.supportedFeatures)
    : unavailableFeatureSubset(requiredFeatures);

  return Object.freeze({
    action: 'selection-mismatch' as const,
    capabilityContract,
    requiredFeatures,
    branches: Object.freeze([
      Object.freeze({
        kind: 'continue-current-selection' as const,
        configurationId: currentConfiguration?.configurationId ?? null,
        featureSubset: currentFeatureSubset,
        changesSelection: false as const,
      }),
      Object.freeze({
        kind: 'select-recommended-local-configuration' as const,
        configurationIds: Object.freeze(equivalentConfigurationIds),
        prerequisite: !localCapability
          ? 'local-recommendation-unavailable' as const
          : equivalentConfigurationIds.length > 0
            ? 'none' as const
            : 'add-or-update-local-configuration' as const,
        featureSubset: recommendedFeatureSubset,
        changesSelection: localCapability !== null && (
          equivalentConfigurationIds.length === 0
          || !equivalentConfigurationIds.includes(currentConfiguration?.configurationId ?? '')
        ),
      }),
      Object.freeze({
        kind: 'use-cloud' as const,
        implementation: cloud
          ? Object.freeze({
            implementationId: cloud.implementation.implementationId,
            driverId: cloud.implementation.driverId,
            driverDialect: cloud.implementation.driverDialect,
          })
          : null,
        providerModelTarget: cloud?.providerModelTarget ?? null,
        featureSubset: cloudFeatureSubset,
        connectorGrantSelection: cloud
          ? 'selection-required' as const
          : 'unavailable' as const,
        prerequisite: cloud
          ? 'apply-cloud-intent' as const
          : 'cloud-recommendation-unavailable' as const,
      }),
    ] as const),
    mismatchFailsClosed: true as const,
    previewOnly: true as const,
    commits: false as const,
  });
}

const OPTIONAL_METADATA_VALIDATION: NimiAIProfileAuthoringValidationOptions = Object.freeze({
  requireProvenance: false,
  requireLicense: false,
  requireNonEmptyProvenance: false,
  requireNonEmptyLicense: false,
});

const LLAMA_FIELDS = new Set<string>(NIMI_AI_PROFILE_LLAMA_PORTABLE_CONFIG_FIELDS);
const LLAMA_EMBED_FIELDS = new Set<string>(NIMI_AI_PROFILE_LLAMA_EMBED_PORTABLE_CONFIG_FIELDS);
const STABLE_DIFFUSION_FIELDS = new Set<string>(
  NIMI_AI_PROFILE_STABLE_DIFFUSION_PORTABLE_CONFIG_FIELDS,
);
const STABLE_DIFFUSION_EXECUTION_FIELDS = new Set<string>(
  NIMI_AI_PROFILE_STABLE_DIFFUSION_EXECUTION_OPTION_FIELDS,
);
const STABLE_DIFFUSION_VIDEO_FIELDS = new Set<string>(
  NIMI_AI_PROFILE_STABLE_DIFFUSION_VIDEO_PORTABLE_CONFIG_FIELDS,
);
const LLAMA_CACHE_TYPES = new Set<NimiAIProfileLlamaCacheType>(
  NIMI_AI_PROFILE_LLAMA_CACHE_TYPES,
);
const STABLE_DIFFUSION_FAMILIES = new Set<NimiAIProfileStableDiffusionModelFamily>(
  NIMI_AI_PROFILE_STABLE_DIFFUSION_MODEL_FAMILIES,
);

function normalizeLocalImplementationInput(
  input: NimiAIProfileLocalImplementationAuthoringInput,
  capabilityContract: string,
): {
  readonly implementation: CapabilityImplementationIdentity;
  readonly supportedFeatures: readonly string[];
  readonly portableConfig: NimiJsonObject;
} {
  assertExactRecord(
    input,
    new Set(['implementation', 'supportedFeatures', 'driverSection']),
    `${capabilityContract} Local implementation`,
  );
  const implementation = normalizeImplementation(
    input.implementation,
    `${capabilityContract} implementation`,
  );
  const supportedFeatures = normalizeFeatureSet(
    input.supportedFeatures ?? [],
    `${capabilityContract} supportedFeatures`,
  );
  const section = requireRecord(
    input.driverSection,
    `${capabilityContract} driverSection must be an object`,
  );
  assertExactRecord(
    section,
    new Set(['kind', 'portableConfig']),
    `${capabilityContract} driverSection`,
  );
  if (section.kind === 'llama') {
    assertExactImplementation(
      implementation,
      NIMI_AI_PROFILE_LLAMA_CPP_IMPLEMENTATION,
      'llama',
    );
    if (capabilityContract !== 'text.generate') {
      return authoringError('llama Driver section requires text.generate');
    }
    return Object.freeze({
      implementation,
      supportedFeatures,
      portableConfig: createNimiAIProfileLlamaPortableConfig(
        (section.portableConfig ?? {}) as NimiAIProfileLlamaPortableConfigInput,
        supportedFeatures,
      ),
    });
  }
  if (section.kind === 'llama-embed') {
    assertExactImplementation(
      implementation,
      NIMI_AI_PROFILE_LLAMA_CPP_EMBED_IMPLEMENTATION,
      'llama embedding',
    );
    if (capabilityContract !== 'text.embed') {
      return authoringError('llama embedding Driver section requires text.embed');
    }
    return Object.freeze({
      implementation,
      supportedFeatures,
      portableConfig: createNimiAIProfileLlamaEmbedPortableConfig(
        (section.portableConfig ?? {}) as NimiAIProfileLlamaEmbedPortableConfigInput,
        supportedFeatures,
      ),
    });
  }
  if (section.kind === 'qwen3-tts') {
    assertExactImplementation(
      implementation,
      NIMI_AI_PROFILE_QWEN3_TTS_IMPLEMENTATION,
      'Qwen3-TTS',
    );
    if (capabilityContract !== 'audio.synthesize') {
      return authoringError('Qwen3-TTS Driver section requires audio.synthesize');
    }
    return Object.freeze({
      implementation,
      supportedFeatures,
      portableConfig: createNimiAIProfileQwen3SpeechPortableConfig(
        (section.portableConfig ?? {}) as NimiJsonObject,
        supportedFeatures,
        'Qwen3-TTS',
      ),
    });
  }
  if (section.kind === 'qwen3-voice-create') {
    assertExactImplementation(
      implementation,
      NIMI_AI_PROFILE_QWEN3_VOICE_CREATE_IMPLEMENTATION,
      'Qwen3 voice.create',
    );
    if (capabilityContract !== 'voice.create') {
      return authoringError('Qwen3 voice.create Driver section requires voice.create');
    }
    validateQwen3VoiceCreateFeatures(supportedFeatures);
    return Object.freeze({
      implementation,
      supportedFeatures,
      portableConfig: createNimiAIProfileQwen3SpeechPortableConfig(
        (section.portableConfig ?? {}) as NimiJsonObject,
        [],
        'Qwen3 voice.create',
      ),
    });
  }
  if (section.kind === 'qwen3-asr') {
    assertExactImplementation(
      implementation,
      NIMI_AI_PROFILE_QWEN3_ASR_IMPLEMENTATION,
      'Qwen3-ASR',
    );
    if (capabilityContract !== 'audio.transcribe') {
      return authoringError('Qwen3-ASR Driver section requires audio.transcribe');
    }
    return Object.freeze({
      implementation,
      supportedFeatures,
      portableConfig: createNimiAIProfileQwen3SpeechPortableConfig(
        (section.portableConfig ?? {}) as NimiJsonObject,
        supportedFeatures,
        'Qwen3-ASR',
      ),
    });
  }
  if (section.kind === 'qwen3-asr-transformers') {
    assertExactImplementation(
      implementation,
      NIMI_AI_PROFILE_QWEN3_ASR_TRANSFORMERS_IMPLEMENTATION,
      'Transformers-native Qwen3-ASR',
    );
    if (capabilityContract !== 'audio.transcribe') {
      return authoringError('Transformers-native Qwen3-ASR Driver section requires audio.transcribe');
    }
    return Object.freeze({
      implementation,
      supportedFeatures,
      portableConfig: createNimiAIProfileQwen3SpeechPortableConfig(
        (section.portableConfig ?? {}) as NimiJsonObject,
        supportedFeatures,
        'Transformers-native Qwen3-ASR',
      ),
    });
  }
  if (section.kind === 'stable-diffusion-video') {
    assertExactImplementation(
      implementation,
      NIMI_AI_PROFILE_STABLE_DIFFUSION_VIDEO_IMPLEMENTATION,
      'stable-diffusion video',
    );
    if (capabilityContract !== 'video.generate') {
      return authoringError('stable-diffusion video Driver section requires video.generate');
    }
    return Object.freeze({
      implementation,
      supportedFeatures,
      portableConfig: createNimiAIProfileStableDiffusionVideoPortableConfig(
        (section.portableConfig ?? {}) as NimiAIProfileStableDiffusionVideoPortableConfigInput,
        supportedFeatures,
      ),
    });
  }
  if (section.kind !== 'stable-diffusion') {
    return authoringError(`${capabilityContract} driverSection kind is unsupported`);
  }
  assertExactImplementation(
    implementation,
    NIMI_AI_PROFILE_STABLE_DIFFUSION_IMPLEMENTATION,
    'stable-diffusion',
  );
  if (capabilityContract !== 'image.generate') {
    return authoringError('stable-diffusion Driver section requires image.generate');
  }
  return Object.freeze({
    implementation,
    supportedFeatures,
    portableConfig: createNimiAIProfileStableDiffusionPortableConfig(
      section.portableConfig as unknown as NimiAIProfileStableDiffusionPortableConfigInput,
      supportedFeatures,
    ),
  });
}

function normalizeCloudRecommendation(
  input: NimiAIProfileCloudRecommendationAuthoringInput,
): {
  readonly implementation: CapabilityImplementationIdentity;
  readonly supportedFeatures: readonly string[];
  readonly providerModelTarget: NimiJsonObject;
} {
  assertExactRecord(
    input,
    new Set(NIMI_AI_PROFILE_CLOUD_RECOMMENDATION_FIELDS),
    'Cloud recommendation',
  );
  const providerModelTarget = normalizeAuthoringJsonObject(
    input.providerModelTarget,
    'Cloud providerModelTarget',
  );
  if (Object.keys(providerModelTarget).length === 0) {
    return authoringError('Cloud providerModelTarget cannot be empty');
  }
  return Object.freeze({
    implementation: normalizeImplementation(input.implementation, 'Cloud implementation'),
    supportedFeatures: normalizeFeatureSet(
      input.supportedFeatures ?? [],
      'Cloud supportedFeatures',
    ),
    providerModelTarget,
  });
}

function normalizeSelectionCloudAlternative(
  input: NimiAIProfileSelectionCloudAlternative,
): NimiAIProfileSelectionCloudAlternative {
  assertExactRecord(
    input,
    new Set(['implementation', 'supportedFeatures', 'providerModelTarget']),
    'Cloud selection alternative',
  );
  const providerModelTarget = normalizeAuthoringJsonObject(
    input.providerModelTarget,
    'Cloud selection providerModelTarget',
  );
  if (Object.keys(providerModelTarget).length === 0) {
    return authoringError('Cloud selection providerModelTarget cannot be empty');
  }
  return Object.freeze({
    implementation: normalizeImplementation(input.implementation, 'Cloud selection implementation'),
    supportedFeatures: normalizeFeatureSet(
      input.supportedFeatures,
      'Cloud selection supportedFeatures',
    ),
    providerModelTarget,
  });
}

function validateKnownLocalConfiguration(
  capabilityContract: string,
  implementation: NimiPortableAIProfileImplementation | CapabilityImplementationIdentity,
  supportedFeatures: readonly string[],
  portableConfig: NimiJsonObject | undefined,
): void {
  const identity = normalizeImplementation(
    implementation,
    `${capabilityContract} implementation`,
    'supportedFeatures' in implementation,
  );
  const features = normalizeFeatureSet(supportedFeatures, `${capabilityContract} supportedFeatures`);
  const config = portableConfig === undefined
    ? Object.freeze({})
    : normalizeAuthoringJsonObject(portableConfig, `${capabilityContract} driverPortableConfig`);
  if (sameImplementation(identity, NIMI_AI_PROFILE_LLAMA_CPP_IMPLEMENTATION)) {
    if (capabilityContract !== 'text.generate') {
      return authoringError('llama implementation requires text.generate');
    }
    validateLlamaPortableConfig(config, features);
    return;
  }
  if (sameImplementation(identity, NIMI_AI_PROFILE_LLAMA_CPP_EMBED_IMPLEMENTATION)) {
    if (capabilityContract !== 'text.embed') {
      return authoringError('llama embedding implementation requires text.embed');
    }
    validateLlamaEmbedPortableConfig(config, features);
    return;
  }
  if (sameImplementation(identity, NIMI_AI_PROFILE_QWEN3_TTS_IMPLEMENTATION)) {
    if (capabilityContract !== 'audio.synthesize') {
      return authoringError('Qwen3-TTS implementation requires audio.synthesize');
    }
    validateQwen3SpeechPortableConfig(config, features, 'Qwen3-TTS');
    return;
  }
  if (sameImplementation(identity, NIMI_AI_PROFILE_QWEN3_VOICE_CREATE_IMPLEMENTATION)) {
    if (capabilityContract !== 'voice.create') {
      return authoringError('Qwen3 voice.create implementation requires voice.create');
    }
    validateQwen3VoiceCreateFeatures(features);
    validateQwen3SpeechPortableConfig(config, [], 'Qwen3 voice.create');
    return;
  }
  if (sameImplementation(identity, NIMI_AI_PROFILE_QWEN3_ASR_IMPLEMENTATION)) {
    if (capabilityContract !== 'audio.transcribe') {
      return authoringError('Qwen3-ASR implementation requires audio.transcribe');
    }
    validateQwen3SpeechPortableConfig(config, features, 'Qwen3-ASR');
    return;
  }
  if (sameImplementation(identity, NIMI_AI_PROFILE_QWEN3_ASR_TRANSFORMERS_IMPLEMENTATION)) {
    if (capabilityContract !== 'audio.transcribe') {
      return authoringError('Transformers-native Qwen3-ASR implementation requires audio.transcribe');
    }
    validateQwen3SpeechPortableConfig(config, features, 'Transformers-native Qwen3-ASR');
    return;
  }
  if (sameImplementation(identity, NIMI_AI_PROFILE_STABLE_DIFFUSION_IMPLEMENTATION)) {
    if (capabilityContract !== 'image.generate') {
      return authoringError('stable-diffusion implementation requires image.generate');
    }
    validateStableDiffusionPortableConfig(config, features);
    return;
  }
  if (sameImplementation(identity, NIMI_AI_PROFILE_STABLE_DIFFUSION_VIDEO_IMPLEMENTATION)) {
    if (capabilityContract !== 'video.generate') {
      return authoringError('stable-diffusion video implementation requires video.generate');
    }
    validateStableDiffusionVideoPortableConfig(config, features);
    return;
  }
  return authoringError(
    `AIProfile ${capabilityContract} uses an unsupported Local implementation or Driver dialect`,
  );
}

function validateLlamaPortableConfig(
  config: NimiJsonObject,
  supportedFeatures: readonly string[],
): void {
  assertExactJsonKeys(config, LLAMA_FIELDS, 'llama portableConfig');
  assertOnlyInputImageFeature(supportedFeatures, 'llama supportedFeatures');
  const acceptsImage = supportedFeatures.includes(NIMI_AI_PROFILE_INPUT_IMAGE_FEATURE);
  const mainPolicy = optionalPolicy(config, 'mainRequirementPolicy') ?? 'substitutable';
  const mainContent = optionalVerifiedContentId(config, 'mainVerifiedContentId');
  const mmprojPolicy = optionalPolicy(config, 'mmprojRequirementPolicy') ?? 'substitutable';
  const mmprojContent = optionalVerifiedContentId(config, 'mmprojVerifiedContentId');
  if (mainPolicy === 'strict' && mainContent === undefined) {
    return authoringError('llama mainVerifiedContentId is required for strict policy');
  }
  if (mmprojPolicy === 'strict' && mmprojContent === undefined) {
    return authoringError('llama mmprojVerifiedContentId is required for strict policy');
  }
  if (!acceptsImage && (
    hasOwn(config, 'mmprojRequirementPolicy')
    || hasOwn(config, 'mmprojVerifiedContentId')
  )) {
    return authoringError('llama mmproj fields require input.image support');
  }
  optionalInteger(config, 'contextSize', 1, 2_147_483_647);
  optionalInteger(config, 'gpuLayers', -1, 2_147_483_647);
  for (const key of ['cacheTypeK', 'cacheTypeV'] as const) {
    if (!hasOwn(config, key)) continue;
    const value = config[key];
    if (typeof value !== 'string' || !LLAMA_CACHE_TYPES.has(value as NimiAIProfileLlamaCacheType)) {
      return authoringError(`llama ${key} is unsupported`);
    }
  }
  optionalBoolean(config, 'flashAttention');
}

function validateLlamaEmbedPortableConfig(
  config: NimiJsonObject,
  supportedFeatures: readonly string[],
): void {
  assertExactJsonKeys(config, LLAMA_EMBED_FIELDS, 'llama embedding portableConfig');
  if (supportedFeatures.length !== 0) {
    return authoringError('llama embedding supportedFeatures must be empty');
  }
  const mainPolicy = optionalPolicy(config, 'mainRequirementPolicy') ?? 'substitutable';
  const mainContent = optionalVerifiedContentId(config, 'mainVerifiedContentId');
  if (mainPolicy === 'strict' && mainContent === undefined) {
    return authoringError('llama embedding mainVerifiedContentId is required for strict policy');
  }
  optionalInteger(config, 'contextSize', 1, 2_147_483_647);
  optionalInteger(config, 'gpuLayers', -1, 2_147_483_647);
  for (const key of ['cacheTypeK', 'cacheTypeV'] as const) {
    if (!hasOwn(config, key)) continue;
    const value = config[key];
    if (typeof value !== 'string' || !LLAMA_CACHE_TYPES.has(value as NimiAIProfileLlamaCacheType)) {
      return authoringError(`llama embedding ${key} is unsupported`);
    }
  }
  optionalBoolean(config, 'flashAttention');
}

function validateQwen3SpeechPortableConfig(
  config: NimiJsonObject,
  supportedFeatures: readonly string[],
  label: string,
): void {
  assertExactJsonKeys(config, new Set<string>(), `${label} portableConfig`);
  if (supportedFeatures.length !== 0) {
    return authoringError(`${label} supportedFeatures must be empty`);
  }
}

function validateQwen3VoiceCreateFeatures(features: readonly string[]): void {
  if (features.length !== 1) {
    return authoringError('Qwen3 voice.create supports exactly one selected source feature');
  }
  const feature = features[0];
  if (feature !== NIMI_AI_PROFILE_INPUT_AUDIO_FEATURE && feature !== NIMI_AI_PROFILE_INPUT_TEXT_FEATURE) {
    return authoringError(`Qwen3 voice.create contains unsupported feature ${feature}`);
  }
}

function validateStableDiffusionPortableConfig(
  config: NimiJsonObject,
  supportedFeatures: readonly string[],
): void {
  assertExactJsonKeys(config, STABLE_DIFFUSION_FIELDS, 'stable-diffusion portableConfig');
  assertOnlyInputImageFeature(supportedFeatures, 'stable-diffusion supportedFeatures');
  const modelFamily = config.modelFamily;
  if (
    typeof modelFamily !== 'string'
    || !STABLE_DIFFUSION_FAMILIES.has(modelFamily as NimiAIProfileStableDiffusionModelFamily)
  ) {
    return authoringError('stable-diffusion modelFamily is required and must be canonical');
  }
  if (hasOwn(config, 'enableInputImage') && typeof config.enableInputImage !== 'boolean') {
    return authoringError('stable-diffusion enableInputImage must be a boolean');
  }
  const supportsImage = supportedFeatures.includes(NIMI_AI_PROFILE_INPUT_IMAGE_FEATURE);
  if ((config.enableInputImage === true) !== supportsImage) {
    return authoringError('stable-diffusion enableInputImage must match input.image support');
  }
  validateRequirementIntent(config, 'mainRequirementPolicy', 'mainVerifiedContentId');
  validateRequirementIntent(
    config,
    'textEncoderRequirementPolicy',
    'textEncoderVerifiedContentId',
  );
  validateRequirementIntent(config, 'vaeRequirementPolicy', 'vaeVerifiedContentId');
  validateRequirementIntent(
    config,
    'uncondDiffusionRequirementPolicy',
    'uncondDiffusionVerifiedContentId',
  );
  if (modelFamily !== 'ideogram4' && (
    hasOwn(config, 'uncondDiffusionRequirementPolicy')
    || hasOwn(config, 'uncondDiffusionVerifiedContentId')
  )) {
    return authoringError('stable-diffusion uncondDiffusion fields require ideogram4');
  }
  if (hasOwn(config, 'executionOptions')) {
    validateStableDiffusionExecutionOptions(config.executionOptions);
  }
}

function validateStableDiffusionVideoPortableConfig(
  config: NimiJsonObject,
  supportedFeatures: readonly string[],
): void {
  // Unknown keys fail closed exactly like parseStableDiffusionVideoPortableConfig
  // (runtime/internal/capabilitydriver/stablediffusion_video.go:318-327).
  assertExactJsonKeys(
    config,
    STABLE_DIFFUSION_VIDEO_FIELDS,
    'stable-diffusion video portableConfig',
  );
  // The MiniMax-H3 video Driver admits only input.image
  // (stablediffusion_video.go:35,91-95).
  assertOnlyInputImageFeature(supportedFeatures, 'stable-diffusion video supportedFeatures');
  // Per-slot intent rules mirror stableDiffusionRequirementIntentFromFields
  // (runtime/internal/capabilitydriver/stablediffusion.go:773-792): policy is
  // strict|substitutable (default substitutable), verifiedContentId must be a
  // canonical sha256 identity, and strict requires verifiedContentId.
  validateRequirementIntent(config, 'fl2vaRequirementPolicy', 'fl2vaVerifiedContentId');
  validateRequirementIntent(config, 'ref2vaRequirementPolicy', 'ref2vaVerifiedContentId');
  validateRequirementIntent(config, 'encoderRequirementPolicy', 'encoderVerifiedContentId');
  validateRequirementIntent(config, 'videoVAERequirementPolicy', 'videoVAEVerifiedContentId');
  validateRequirementIntent(config, 'audioVAERequirementPolicy', 'audioVAEVerifiedContentId');
}

function validateRequirementIntent(
  config: NimiJsonObject,
  policyKey: string,
  contentKey: string,
): void {
  const policy = optionalPolicy(config, policyKey) ?? 'substitutable';
  const content = optionalVerifiedContentId(config, contentKey);
  if (policy === 'strict' && content === undefined) {
    return authoringError(`${contentKey} is required for strict policy`);
  }
}

function validateStableDiffusionExecutionOptions(value: NimiJsonValue | undefined): void {
  if (!isJsonRecord(value)) {
    return authoringError('stable-diffusion executionOptions must be an object');
  }
  assertExactJsonKeys(
    value,
    STABLE_DIFFUSION_EXECUTION_FIELDS,
    'stable-diffusion executionOptions',
  );
  optionalInteger(value, 'steps', 1, 150);
  if (hasOwn(value, 'cfgScale')) {
    requireFiniteNumber(value.cfgScale, 0, 30, 'stable-diffusion executionOptions.cfgScale');
  }
  for (const key of ['width', 'height'] as const) {
    if (!hasOwn(value, key)) continue;
    const dimension = requireInteger(
      value[key],
      64,
      4096,
      `stable-diffusion executionOptions.${key}`,
    );
    if (dimension % 8 !== 0) {
      return authoringError(`stable-diffusion executionOptions.${key} must be a multiple of eight`);
    }
  }
  optionalInteger(
    value,
    'seed',
    -2147483648,
    2147483647,
  );
  for (const key of ['sampler', 'scheduler'] as const) {
    if (!hasOwn(value, key)) continue;
    const option = value[key];
    if (
      typeof option !== 'string'
      || option.length === 0
      || option.length > 64
      || option.trim() !== option
      || !/^[A-Za-z0-9+_.-]+$/u.test(option)
    ) {
      return authoringError(`stable-diffusion executionOptions.${key} must be a Driver option token`);
    }
  }
  optionalInteger(value, 'threads', 1, 1024);
  optionalBoolean(value, 'diffusionFlashAttention');
  optionalBoolean(value, 'offloadParamsToCPU');
}

function projectKnownDriverRequirements(
  capabilityContract: string,
  implementation: NimiPortableAIProfileImplementation,
  portableConfig: NimiJsonObject | undefined,
): NimiAIProfileAuthoringRequirementProjection {
  const config: NimiJsonObject = portableConfig ?? Object.freeze({});
  validateKnownLocalConfiguration(
    capabilityContract,
    implementation,
    implementation.supportedFeatures,
    config,
  );
  if (sameImplementation(implementation, NIMI_AI_PROFILE_LLAMA_CPP_IMPLEMENTATION)) {
    const requirements: NimiAIProfileAuthoringProjectedRequirement[] = [
      requirementPreview(
        'main.gguf',
        'main',
        0,
        'Main model',
        'gguf',
        optionalPolicy(config, 'mainRequirementPolicy') ?? 'substitutable',
        optionalVerifiedContentId(config, 'mainVerifiedContentId'),
      ),
    ];
    if (implementation.supportedFeatures.includes(NIMI_AI_PROFILE_INPUT_IMAGE_FEATURE)) {
      requirements.push(requirementPreview(
        'companion.mmproj',
        'companion',
        0,
        'Vision projector',
        'mmproj',
        optionalPolicy(config, 'mmprojRequirementPolicy') ?? 'substitutable',
        optionalVerifiedContentId(config, 'mmprojVerifiedContentId'),
      ));
    }
    return Object.freeze({
      source: 'authoring-preview' as const,
      commitTruth: 'runtime-reproject' as const,
      requirements: Object.freeze(requirements),
    });
  }

  if (sameImplementation(implementation, NIMI_AI_PROFILE_LLAMA_CPP_EMBED_IMPLEMENTATION)) {
    return Object.freeze({
      source: 'authoring-preview' as const,
      commitTruth: 'runtime-reproject' as const,
      requirements: Object.freeze([
        requirementPreview(
          'embedding.gguf',
          'main',
          0,
          'Embedding model',
          'gguf',
          optionalPolicy(config, 'mainRequirementPolicy') ?? 'substitutable',
          optionalVerifiedContentId(config, 'mainVerifiedContentId'),
        ),
      ]),
    });
  }

  if (sameImplementation(implementation, NIMI_AI_PROFILE_QWEN3_TTS_IMPLEMENTATION)) {
    return Object.freeze({
      source: 'authoring-preview' as const,
      commitTruth: 'runtime-reproject' as const,
      requirements: Object.freeze([
        requirementPreview(
          'tts.model',
          'main',
          0,
          'TTS model',
          'tts',
          'substitutable',
          undefined,
        ),
      ]),
    });
  }

  if (sameImplementation(implementation, NIMI_AI_PROFILE_QWEN3_VOICE_CREATE_IMPLEMENTATION)) {
    return Object.freeze({
      source: 'authoring-preview' as const,
      commitTruth: 'runtime-reproject' as const,
      requirements: Object.freeze([
        requirementPreview(
          'voice.model',
          'main',
          0,
          'Voice creation model',
          'tts',
          'substitutable',
          undefined,
        ),
      ]),
    });
  }

  if (sameImplementation(implementation, NIMI_AI_PROFILE_QWEN3_ASR_IMPLEMENTATION)
    || sameImplementation(implementation, NIMI_AI_PROFILE_QWEN3_ASR_TRANSFORMERS_IMPLEMENTATION)) {
    return Object.freeze({
      source: 'authoring-preview' as const,
      commitTruth: 'runtime-reproject' as const,
      requirements: Object.freeze([
        requirementPreview(
          'stt.model',
          'main',
          0,
          'STT model',
          'stt',
          'substitutable',
          undefined,
        ),
      ]),
    });
  }

  if (sameImplementation(implementation, NIMI_AI_PROFILE_STABLE_DIFFUSION_VIDEO_IMPLEMENTATION)) {
    // Slot order and facts mirror stableDiffusionVideoSlots
    // (runtime/internal/capabilitydriver/stablediffusion_video.go:54-80).
    return Object.freeze({
      source: 'authoring-preview' as const,
      commitTruth: 'runtime-reproject' as const,
      requirements: Object.freeze([
        requirementPreview(
          'diffusion.fl2va',
          'main',
          0,
          'MiniMax-H3 FL2VA transformer',
          'video',
          optionalPolicy(config, 'fl2vaRequirementPolicy') ?? 'substitutable',
          optionalVerifiedContentId(config, 'fl2vaVerifiedContentId'),
        ),
        requirementPreview(
          'diffusion.ref2va',
          'companion',
          0,
          'MiniMax-H3 Ref2VA transformer',
          'video',
          optionalPolicy(config, 'ref2vaRequirementPolicy') ?? 'substitutable',
          optionalVerifiedContentId(config, 'ref2vaVerifiedContentId'),
        ),
        requirementPreview(
          'encoder.h3-combined',
          'companion',
          0,
          'MiniMax-H3 combined Qwen3-VL encoder',
          'chat',
          optionalPolicy(config, 'encoderRequirementPolicy') ?? 'substitutable',
          optionalVerifiedContentId(config, 'encoderVerifiedContentId'),
        ),
        requirementPreview(
          'vae.video',
          'companion',
          0,
          'MiniMax-H3 video VAE',
          'vae',
          optionalPolicy(config, 'videoVAERequirementPolicy') ?? 'substitutable',
          optionalVerifiedContentId(config, 'videoVAEVerifiedContentId'),
        ),
        requirementPreview(
          'vae.audio',
          'companion',
          0,
          'MiniMax-H3 audio VAE',
          'vae',
          optionalPolicy(config, 'audioVAERequirementPolicy') ?? 'substitutable',
          optionalVerifiedContentId(config, 'audioVAEVerifiedContentId'),
        ),
      ]),
    });
  }

  const modelFamily = config.modelFamily as NimiAIProfileStableDiffusionModelFamily;
  const requirements: NimiAIProfileAuthoringProjectedRequirement[] = [
    requirementPreview(
      'main.diffusion',
      'main',
      0,
      'Diffusion model',
      'image',
      optionalPolicy(config, 'mainRequirementPolicy') ?? 'substitutable',
      optionalVerifiedContentId(config, 'mainVerifiedContentId'),
    ),
    requirementPreview(
      'companion.text-encoder',
      'companion',
      0,
      'Text encoder',
      'chat',
      optionalPolicy(config, 'textEncoderRequirementPolicy') ?? 'substitutable',
      optionalVerifiedContentId(config, 'textEncoderVerifiedContentId'),
    ),
    requirementPreview(
      'companion.vae',
      'companion',
      0,
      'VAE',
      'vae',
      optionalPolicy(config, 'vaeRequirementPolicy') ?? 'substitutable',
      optionalVerifiedContentId(config, 'vaeVerifiedContentId'),
    ),
  ];
  if (modelFamily === 'ideogram4') {
    requirements.push(requirementPreview(
      'companion.uncond-diffusion',
      'companion',
      0,
      'Unconditional diffusion model',
      'image',
      optionalPolicy(config, 'uncondDiffusionRequirementPolicy') ?? 'substitutable',
      optionalVerifiedContentId(config, 'uncondDiffusionVerifiedContentId'),
    ));
  }
  return Object.freeze({
    source: 'authoring-preview' as const,
    commitTruth: 'runtime-reproject' as const,
    requirements: Object.freeze(requirements),
  });
}

function requirementPreview(
  requirementId: string,
  role: 'main' | 'companion',
  occurrenceOrdinal: number,
  displayLabel: string,
  resourceKind: string,
  policy: NimiAIProfileRequirementPolicy,
  preferredVerifiedContentId: string | undefined,
): NimiAIProfileAuthoringProjectedRequirement {
  return Object.freeze({
    requirementId,
    role,
    occurrenceOrdinal,
    displayLabel,
    resourceKind,
    policy,
    ...(preferredVerifiedContentId !== undefined ? { preferredVerifiedContentId } : {}),
  });
}

function validateAuthoringMetadata(
  profile: NimiPortableAIProfile,
  options: NimiAIProfileAuthoringValidationOptions,
): void {
  assertExactRecord(
    options,
    new Set([
      'requireProvenance',
      'requireLicense',
      'requireNonEmptyProvenance',
      'requireNonEmptyLicense',
    ]),
    'AIProfile validation options',
  );
  for (const [name, value] of Object.entries(options)) {
    if (value !== undefined && typeof value !== 'boolean') {
      return authoringError(`AIProfile validation option ${name} must be a boolean`);
    }
  }
  const requireProvenance = options.requireProvenance ?? true;
  const requireLicense = options.requireLicense ?? true;
  const requireNonEmptyProvenance = options.requireNonEmptyProvenance ?? true;
  const requireNonEmptyLicense = options.requireNonEmptyLicense ?? true;
  if (requireProvenance && profile.provenance === undefined) {
    return authoringError('AIProfile provenance is required for authoring export');
  }
  if (
    profile.provenance !== undefined
    && requireNonEmptyProvenance
    && Object.keys(profile.provenance).length === 0
  ) {
    return authoringError('AIProfile provenance cannot be empty');
  }
  if (requireLicense && profile.license === undefined) {
    return authoringError('AIProfile license is required for authoring export');
  }
  if (
    profile.license !== undefined
    && requireNonEmptyLicense
    && !isStructurallyNonEmpty(profile.license)
  ) {
    return authoringError('AIProfile license cannot be empty');
  }
}

function isStructurallyNonEmpty(value: NimiJsonValue): boolean {
  if (value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number' || typeof value === 'boolean') return true;
  if (Array.isArray(value)) return value.length > 0;
  return Object.keys(value).length > 0;
}

function portableProfileContent(profile: NimiPortableAIProfile): unknown {
  return {
    capabilities: Object.entries(profile.capabilities).map(([capabilityContract, capability]) => ({
      capabilityContract,
      route: capability.route,
      requiredFeatures: [...capability.requiredFeatures],
      ...(capability.defaults !== undefined ? { defaults: capability.defaults } : {}),
      ...(capability.implementation !== undefined
        ? { implementation: capability.implementation }
        : {}),
      ...(capability.route === 'local'
        ? {
          ...(capability.driverPortableConfig !== undefined
            ? { driverPortableConfig: capability.driverPortableConfig }
            : {}),
          ...(capability.resourceOccurrences !== undefined
            ? { resourceOccurrences: capability.resourceOccurrences }
            : {}),
        }
        : { providerModelTarget: capability.providerModelTarget }),
    })),
  };
}

function localConfigurationDigestFromProfile(
  capabilityContract: string,
  capability: Extract<NimiPortableAIProfileCapability, { readonly route: 'local' }>,
): NimiAIProfileEquivalenceDigest {
  if (!capability.implementation) {
    return authoringError(`AIProfile ${capabilityContract} has no Local implementation`);
  }
  return digestCanonical(
    'nimi.local-capability-configuration.portable-content/v1',
    {
      capabilityContract,
      implementation: implementationContent(capability.implementation),
      driverPortableConfig: capability.driverPortableConfig ?? {},
      supportedFeatures: [...capability.implementation.supportedFeatures],
    },
  );
}

function localConfigurationDigestFromMachine(
  configuration: NimiAIProfileAuthoringMachineConfigurationProjection,
): NimiAIProfileEquivalenceDigest {
  validateKnownLocalConfiguration(
    configuration.capabilityContract,
    configuration.implementation,
    configuration.supportedFeatures,
    configuration.portableConfig,
  );
  return digestCanonical(
    'nimi.local-capability-configuration.portable-content/v1',
    {
      capabilityContract: configuration.capabilityContract,
      implementation: implementationContent(configuration.implementation),
      driverPortableConfig: configuration.portableConfig ?? {},
      supportedFeatures: [...configuration.supportedFeatures].sort(),
    },
  );
}

function implementationContent(
  implementation: CapabilityImplementationIdentity,
): CapabilityImplementationIdentity {
  return {
    implementationId: implementation.implementationId,
    driverId: implementation.driverId,
    driverDialect: implementation.driverDialect,
  };
}

function digestCanonical(domain: string, value: unknown): NimiAIProfileEquivalenceDigest {
  const encoded = new TextEncoder().encode(`${domain}\n${canonicalJson(value)}`);
  return `sha256:${sha256Hex(encoded)}`;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return authoringError('canonical digest input contains a non-finite number');
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => compareCanonicalText(left, right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return authoringError('canonical digest input is not portable JSON');
}

function normalizeMachineProjection(
  input: NimiAIProfileAuthoringMachineProjection,
): NimiAIProfileAuthoringMachineProjection {
  if (!input || !Array.isArray(input.configurations) || !Array.isArray(input.selections)) {
    return authoringError('Machine Local AI Configuration projection is invalid');
  }
  const configurations = input.configurations.map((configuration, index) => {
    if (!configuration || typeof configuration !== 'object') {
      return authoringError(`Machine configuration[${index}] is invalid`);
    }
    const normalized = Object.freeze({
      configurationId: requireExactNonEmptyText(
        configuration.configurationId,
        `Machine configuration[${index}].configurationId`,
      ),
      capabilityContract: requireExactNonEmptyText(
        configuration.capabilityContract,
        `Machine configuration[${index}].capabilityContract`,
      ),
      implementation: normalizeImplementation(
        configuration.implementation,
        `Machine configuration[${index}].implementation`,
      ),
      ...(configuration.portableConfig !== undefined
        ? {
          portableConfig: normalizeJsonObject(
            configuration.portableConfig,
            `Machine configuration[${index}].portableConfig`,
          ),
        }
        : {}),
      supportedFeatures: normalizeFeatureSet(
        configuration.supportedFeatures,
        `Machine configuration[${index}].supportedFeatures`,
      ),
      requirementResolution: requireRequirementResolution(
        configuration.requirementResolution,
        `Machine configuration[${index}].requirementResolution`,
      ),
      ...(configuration.provenance !== undefined
        ? {
          provenance: normalizeJsonObject(
            configuration.provenance,
            `Machine configuration[${index}].provenance`,
          ),
        }
        : {}),
      ...(configuration.sourceProfileId !== undefined
        ? {
          sourceProfileId: requireExactNonEmptyText(
            configuration.sourceProfileId,
            `Machine configuration[${index}].sourceProfileId`,
          ),
        }
        : {}),
    });
    return normalized;
  });
  assertUnique(
    configurations.map((configuration) => configuration.configurationId),
    'Machine configuration ids',
  );
  const byId = new Map(
    configurations.map((configuration) => [configuration.configurationId, configuration] as const),
  );
  const selections = input.selections.map((selection, index) => {
    if (!selection || typeof selection !== 'object') {
      return authoringError(`Machine selection[${index}] is invalid`);
    }
    const normalized = Object.freeze({
      capabilityContract: requireExactNonEmptyText(
        selection.capabilityContract,
        `Machine selection[${index}].capabilityContract`,
      ),
      configurationId: requireExactNonEmptyText(
        selection.configurationId,
        `Machine selection[${index}].configurationId`,
      ),
    });
    const configuration = byId.get(normalized.configurationId);
    if (!configuration || configuration.capabilityContract !== normalized.capabilityContract) {
      return authoringError(`Machine selection[${index}] is dangling or mismatched`);
    }
    return normalized;
  });
  assertUnique(
    selections.map((selection) => selection.capabilityContract),
    'Machine selection capability contracts',
  );
  return Object.freeze({
    configurations: Object.freeze(configurations),
    selections: Object.freeze(selections),
  });
}

function sameProfileSource(
  profile: NimiPortableAIProfile,
  configuration: NimiAIProfileAuthoringMachineConfigurationProjection,
): boolean {
  if (configuration.sourceProfileId === profile.profileId) return true;
  if (profile.provenance === undefined || configuration.provenance === undefined) return false;
  if (Object.keys(profile.provenance).length === 0) return false;
  return canonicalJson(profile.provenance) === canonicalJson(configuration.provenance);
}

function deriveFeatureSubset(
  requiredFeatures: readonly string[],
  supportedFeatures: readonly string[],
): NimiAIProfileFeatureSubsetResult {
  const required = normalizeFeatureSet(requiredFeatures, 'requiredFeatures');
  const supported = normalizeFeatureSet(supportedFeatures, 'supportedFeatures');
  const supportedSet = new Set(supported);
  const missingFeatures = Object.freeze(required.filter((feature) => !supportedSet.has(feature)));
  return Object.freeze({
    status: missingFeatures.length === 0 ? 'compatible' as const : 'feature-mismatch' as const,
    compatible: missingFeatures.length === 0,
    requiredFeatures: required,
    supportedFeatures: supported,
    missingFeatures,
  });
}

function unavailableFeatureSubset(
  requiredFeatures: readonly string[],
): NimiAIProfileFeatureSubsetResult {
  return Object.freeze({
    status: 'unavailable' as const,
    compatible: false,
    requiredFeatures: normalizeFeatureSet(requiredFeatures, 'requiredFeatures'),
    supportedFeatures: Object.freeze([]),
    missingFeatures: Object.freeze([...requiredFeatures]),
  });
}

function normalizeApplyTarget(target: NimiAIProfileApplyTarget): NimiAIProfileApplyTarget {
  const record = requireRecord(target, 'AIConfig Apply target must be an object');
  if (record.kind === 'app') {
    assertExactRecord(record, new Set(['kind', 'appId']), 'App AIConfig Apply target');
    return Object.freeze({
      kind: 'app' as const,
      appId: requireExactNonEmptyText(record.appId, 'App AIConfig target appId'),
    });
  }
  if (record.kind === 'shared-local-agent') {
    assertExactRecord(record, new Set(['kind']), 'shared LocalAgent AIConfig Apply target');
    return Object.freeze({ kind: 'shared-local-agent' as const });
  }
  return authoringError('AIConfig Apply target kind is unsupported');
}

function applyTargetOwner(target: NimiAIProfileApplyTarget): AIConfigOwner {
  return target.kind === 'app'
    ? { owner: { oneofKind: 'app', app: { appId: target.appId } } }
    : {
      owner: {
        oneofKind: 'runtimeLocalAgentSubsystem',
        runtimeLocalAgentSubsystem: {},
      },
    };
}

function assertAIConfigOwner(config: AIConfig, target: NimiAIProfileApplyTarget): void {
  const owner = config?.owner?.owner;
  if (
    target.kind === 'app'
      ? owner?.oneofKind !== 'app' || owner.app.appId !== target.appId
      : owner?.oneofKind !== 'runtimeLocalAgentSubsystem'
  ) {
    return authoringError('AIConfig Apply preview before projection has a mismatched owner');
  }
}

function deriveAIConfigIntentDiff(
  before: AIConfig | null,
  after: AIConfig,
): NimiAIProfileAIConfigIntentDiff {
  const beforeByContract = indexAIConfigIntents(before?.capabilities ?? [], 'before AIConfig');
  const afterByContract = indexAIConfigIntents(after.capabilities, 'after AIConfig');
  const contracts = [...new Set([...beforeByContract.keys(), ...afterByContract.keys()])].sort();
  const addedCapabilityContracts: string[] = [];
  const removedCapabilityContracts: string[] = [];
  const changedCapabilityContracts: string[] = [];
  const unchangedCapabilityContracts: string[] = [];
  for (const capabilityContract of contracts) {
    const beforeIntent = beforeByContract.get(capabilityContract);
    const afterIntent = afterByContract.get(capabilityContract);
    if (!beforeIntent) addedCapabilityContracts.push(capabilityContract);
    else if (!afterIntent) removedCapabilityContracts.push(capabilityContract);
    else if (canonicalAIConfigIntent(beforeIntent) === canonicalAIConfigIntent(afterIntent)) {
      unchangedCapabilityContracts.push(capabilityContract);
    } else {
      changedCapabilityContracts.push(capabilityContract);
    }
  }
  return Object.freeze({
    addedCapabilityContracts: Object.freeze(addedCapabilityContracts),
    removedCapabilityContracts: Object.freeze(removedCapabilityContracts),
    changedCapabilityContracts: Object.freeze(changedCapabilityContracts),
    unchangedCapabilityContracts: Object.freeze(unchangedCapabilityContracts),
  });
}

function indexAIConfigIntents(
  intents: readonly AIConfigCapabilityIntent[],
  label: string,
): Map<string, AIConfigCapabilityIntent> {
  if (!Array.isArray(intents)) return authoringError(`${label} capabilities must be an array`);
  const result = new Map<string, AIConfigCapabilityIntent>();
  for (const intent of intents) {
    const capabilityContract = requireExactNonEmptyText(
      intent?.capabilityContract,
      `${label} CapabilityContract`,
    );
    if (result.has(capabilityContract)) {
      return authoringError(`${label} contains duplicate ${capabilityContract} intent`);
    }
    result.set(capabilityContract, intent);
  }
  return result;
}

function canonicalAIConfig(config: AIConfig): string {
  return canonicalJson({
    owner: config.owner,
    capabilities: [...indexAIConfigIntents(config.capabilities, 'AIConfig').values()]
      .map(canonicalAIConfigIntentValue)
      .sort((left, right) => compareCanonicalText(left.capabilityContract, right.capabilityContract)),
  });
}

function canonicalAIConfigIntent(intent: AIConfigCapabilityIntent): string {
  return canonicalJson(canonicalAIConfigIntentValue(intent));
}

function canonicalAIConfigIntentValue(intent: AIConfigCapabilityIntent): {
  readonly capabilityContract: string;
  readonly requiredFeatures: readonly string[];
  readonly defaults?: NimiJsonObject;
  readonly route: unknown;
} {
  const capabilityContract = requireExactNonEmptyText(
    intent.capabilityContract,
    'AIConfig CapabilityContract',
  );
  const requiredFeatures = normalizeFeatureSet(
    intent.requiredFeatures,
    `${capabilityContract} requiredFeatures`,
  );
  if (intent.route.oneofKind === 'local') {
    return {
      capabilityContract,
      requiredFeatures,
      ...(intent.defaults !== undefined
        ? { defaults: runtimeAIConfigStructToJson(intent.defaults) }
        : {}),
      route: { kind: 'local' },
    };
  }
  if (intent.route.oneofKind === 'cloud') {
    return {
      capabilityContract,
      requiredFeatures,
      ...(intent.defaults !== undefined
        ? { defaults: runtimeAIConfigStructToJson(intent.defaults) }
        : {}),
      route: {
        kind: 'cloud',
        implementation: normalizeImplementation(
          intent.route.cloud.implementation,
          `${capabilityContract} Cloud implementation`,
        ),
        providerModelTarget: runtimeAIConfigStructToJson(
          intent.route.cloud.providerModelTarget,
        ),
        connectorGrantId: intent.route.cloud.connectorGrantId,
      },
    };
  }
  return authoringError(`AIConfig ${capabilityContract} route is missing`);
}

function normalizeImplementation(
  value: unknown,
  label: string,
  allowSupportedFeatures = false,
): CapabilityImplementationIdentity {
  const record = requireRecord(value, `${label} must be an object`);
  assertExactRecord(
    record,
    new Set([
      'implementationId',
      'driverId',
      'driverDialect',
      ...(allowSupportedFeatures ? ['supportedFeatures'] : []),
    ]),
    label,
  );
  return Object.freeze({
    implementationId: requireExactNonEmptyText(record.implementationId, `${label}.implementationId`),
    driverId: requireExactNonEmptyText(record.driverId, `${label}.driverId`),
    driverDialect: requireExactNonEmptyText(record.driverDialect, `${label}.driverDialect`),
  });
}

function assertExactImplementation(
  actual: CapabilityImplementationIdentity,
  expected: CapabilityImplementationIdentity,
  label: string,
): void {
  if (!sameImplementation(actual, expected)) {
    return authoringError(`${label} Driver section requires its exact implementation identity`);
  }
}

function sameImplementation(
  left: CapabilityImplementationIdentity,
  right: CapabilityImplementationIdentity,
): boolean {
  return left.implementationId === right.implementationId
    && left.driverId === right.driverId
    && left.driverDialect === right.driverDialect;
}

function assertFeatureSubset(
  requiredFeatures: readonly string[],
  supportedFeatures: readonly string[],
  capabilityContract: string,
): void {
  const supported = new Set(supportedFeatures);
  const missing = requiredFeatures.find((feature) => !supported.has(feature));
  if (missing) {
    return authoringError(`${capabilityContract} implementation does not support required feature ${missing}`);
  }
}

function assertOnlyInputImageFeature(
  features: readonly string[],
  label: string,
): void {
  const unsupported = features.find((feature) => feature !== NIMI_AI_PROFILE_INPUT_IMAGE_FEATURE);
  if (unsupported) return authoringError(`${label} contains unsupported feature ${unsupported}`);
}

function normalizeFeatureSet(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value)) return authoringError(`${label} must be an array`);
  const features = value
    .map((feature, index) => requireExactNonEmptyText(feature, `${label}[${index}]`))
    .sort();
  if (new Set(features).size !== features.length) {
    return authoringError(`${label} must not contain duplicates`);
  }
  return Object.freeze(features);
}

function normalizeAuthoringJsonObject(value: unknown, label: string): NimiJsonObject {
  const normalized = normalizeJsonObject(value, label);
  assertAuthoringPortableValue(normalized, label);
  return normalized;
}

function normalizeAuthoringJsonValue(value: unknown, label: string): NimiJsonValue {
  const normalized = normalizeJsonValue(value, label);
  assertAuthoringPortableValue(normalized, label);
  return normalized;
}

function normalizeJsonObject(value: unknown, label: string): NimiJsonObject {
  const record = requireRecord(value, `${label} must be an object`);
  const normalized: Record<string, NimiJsonValue> = {};
  for (const key of Object.keys(record).sort()) {
    if (UNSAFE_KEYS.has(key)) return authoringError(`${label} contains unsafe key ${key}`);
    normalized[key] = normalizeJsonValue(record[key], `${label}.${key}`);
  }
  return Object.freeze(normalized);
}

function normalizeJsonValue(value: unknown, label: string): NimiJsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    return Object.freeze(value.map((entry, index) => normalizeJsonValue(entry, `${label}[${index}]`)));
  }
  if (value && typeof value === 'object') return normalizeJsonObject(value, label);
  return authoringError(`${label} is not portable JSON`);
}

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const FORBIDDEN_EXACT_KEYS = new Set([
  'account',
  'accountid',
  'assetid',
  'connector',
  'connectorid',
  'credential',
  'credentials',
  'deviceid',
  'grant',
  'grantid',
  'hostid',
  'localassetid',
  'machine',
  'machineid',
  'ownerid',
  'owneruserid',
  'password',
  'path',
  'privatekey',
  'secret',
  'secrets',
  'subjectid',
  'subjectuserid',
  'token',
  'userid',
]);

function assertAuthoringPortableValue(value: unknown, label: string): void {
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'string') {
    if (isAbsoluteOrFilePath(value)) return authoringError(`${label} contains a non-portable path`);
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return authoringError(`${label} contains a non-finite number`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertAuthoringPortableValue(entry, `${label}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      if (UNSAFE_KEYS.has(key)) return authoringError(`${label} contains unsafe key ${key}`);
      const normalized = normalizeIdentityKey(key);
      if (isForbiddenIdentityKey(normalized)) {
        return authoringError(`${label}.${key} is forbidden in portable AIProfile authoring`);
      }
      assertAuthoringPortableValue(entry, `${label}.${key}`);
    }
    return;
  }
  return authoringError(`${label} contains unsupported portable JSON`);
}

function normalizeIdentityKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/gu, '');
}

function isForbiddenIdentityKey(key: string): boolean {
  return FORBIDDEN_EXACT_KEYS.has(key)
    || key.startsWith('machine')
    || key.endsWith('machineid')
    || key.endsWith('machineref')
    || key.startsWith('account')
    || key.endsWith('account')
    || key.endsWith('accountid')
    || key.endsWith('accountref')
    || key.endsWith('userid')
    || key.startsWith('connector')
    || key.endsWith('connectorid')
    || key.endsWith('connectorref')
    || key.startsWith('grant')
    || key.endsWith('grantid')
    || key.endsWith('grantref')
    || key.includes('connectorgrant')
    || key.includes('credential')
    || key.includes('secret')
    || key.endsWith('privatekey')
    || key === 'apikey'
    || key.endsWith('accesstoken')
    || key.endsWith('refreshtoken')
    || key.endsWith('oauthtoken')
    || key.endsWith('path')
    || key.endsWith('assetid')
    || key.endsWith('artifactid')
    || key.includes('localasset');
}

function isAbsoluteOrFilePath(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith('/')
    || trimmed.startsWith('\\\\')
    || trimmed.startsWith('~/')
    || trimmed.toLowerCase().startsWith('file://')
    || /^[A-Za-z]:[\\/]/u.test(trimmed);
}

function optionalPolicy(
  value: NimiJsonObject,
  key: string,
): NimiAIProfileRequirementPolicy | undefined {
  if (!hasOwn(value, key)) return undefined;
  const policy = value[key];
  if (policy !== 'strict' && policy !== 'substitutable') {
    return authoringError(`${key} must be strict or substitutable`);
  }
  return policy;
}

function optionalVerifiedContentId(
  value: NimiJsonObject,
  key: string,
): string | undefined {
  if (!hasOwn(value, key)) return undefined;
  const contentId = value[key];
  if (typeof contentId !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(contentId)) {
    return authoringError(`${key} must be a canonical sha256 content identity`);
  }
  return contentId;
}

function optionalInteger(
  value: NimiJsonObject,
  key: string,
  minimum: number,
  maximum: number,
): number | undefined {
  if (!hasOwn(value, key)) return undefined;
  return requireInteger(value[key], minimum, maximum, key);
}

function optionalBoolean(value: NimiJsonObject, key: string): boolean | undefined {
  if (!hasOwn(value, key)) return undefined;
  const field = value[key];
  if (typeof field !== 'boolean') return authoringError(`${key} must be a boolean`);
  return field;
}

function requireInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  label: string,
): number {
  const number = requireFiniteNumber(value, minimum, maximum, label);
  if (!Number.isInteger(number)) return authoringError(`${label} must be an integer`);
  return number;
}

function requireFiniteNumber(
  value: unknown,
  minimum: number,
  maximum: number,
  label: string,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    return authoringError(`${label} must be a finite number from ${minimum} through ${maximum}`);
  }
  return value;
}

function requireRequirementResolution(
  value: unknown,
  label: string,
): 'unresolved' | 'configured' {
  if (value !== 'unresolved' && value !== 'configured') {
    return authoringError(`${label} must be unresolved or configured`);
  }
  return value;
}

function assertExactJsonKeys(
  value: NimiJsonObject,
  allowed: ReadonlySet<string>,
  label: string,
): void {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key)).sort();
  if (unknown.length > 0) return authoringError(`${label} contains unsupported field ${unknown[0]}`);
}

function assertExactRecord(
  value: unknown,
  allowed: ReadonlySet<string>,
  label: string,
): void {
  const record = requireRecord(value, `${label} must be an object`);
  const unknown = Object.keys(record).filter((key) => !allowed.has(key)).sort();
  if (unknown.length > 0) return authoringError(`${label} contains unsupported field ${unknown[0]}`);
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return authoringError(message);
  return value as Record<string, unknown>;
}

function isJsonRecord(value: unknown): value is NimiJsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireExactNonEmptyText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    return authoringError(`${label} must be exact non-empty text`);
  }
  return value;
}

function requireExactText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() !== value) {
    return authoringError(`${label} must be exact text`);
  }
  return value;
}

function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) return authoringError(`${label} must be unique`);
}

function compareCanonicalText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function authoringError(message: string): never {
  throw createNimiError({
    message,
    reasonCode: 'AI_PROFILE_AUTHORING_INVALID',
    actionHint: 'provide_valid_portable_ai_profile_authoring_input',
    source: 'sdk',
  });
}
