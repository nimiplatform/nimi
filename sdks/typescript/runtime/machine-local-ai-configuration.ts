import {
  LocalCapabilityInterpretability,
  LocalCapabilityReason,
  LocalCapabilityRequirementPolicy,
  LocalCapabilityRequirementResolution,
  LocalCapabilityRequirementRole,
  type AIConfig,
  type CapabilityImplementationIdentity,
  type LocalAssetExactBinding,
  type LocalCapabilityConfiguration,
  type LocalCapabilityRequirement,
  type LocalCapabilitySelection,
  type MachineLocalAIConfiguration,
  type RuntimeTypedCallOptions,
  type RuntimeTypedClient,
} from '../core-generated/runtime-typed-client.js';
import {
  createNimiClientId,
  createNimiError,
  isJsonObject,
  ReasonCode,
  type JsonObject,
  type JsonValue,
} from '../types/index.js';
import {
  listNimiRuntimeLocalAssetEntries,
  type NimiRuntimeLocalAssetEntry,
  type NimiRuntimeLocalAssetListInput,
} from './runtime-local-assets.js';
import {
  fromNimiRuntimeProtoStruct,
  toNimiRuntimeProtoStruct,
} from './runtime-agent-values.js';
import { withNimiRuntimeIdempotencyMetadata } from './scenario-jobs.js';

export const NIMI_MACHINE_LOCAL_TEXT_GENERATE_CAPABILITY_CONTRACT = 'text.generate';
export const NIMI_MACHINE_LOCAL_TEXT_EMBED_CAPABILITY_CONTRACT = 'text.embed';
export const NIMI_MACHINE_LOCAL_AUDIO_SYNTHESIZE_CAPABILITY_CONTRACT = 'audio.synthesize';
export const NIMI_MACHINE_LOCAL_AUDIO_TRANSCRIBE_CAPABILITY_CONTRACT = 'audio.transcribe';
export const NIMI_MACHINE_LOCAL_IMAGE_GENERATE_CAPABILITY_CONTRACT = 'image.generate';
/** Mirrors runtime/internal/capabilitydriver/stablediffusion_video.go:22. */
export const NIMI_MACHINE_LOCAL_VIDEO_GENERATE_CAPABILITY_CONTRACT = 'video.generate';
export const NIMI_MACHINE_LOCAL_VOICE_CREATE_CAPABILITY_CONTRACT = 'voice.create';
export const NIMI_MACHINE_LOCAL_INPUT_IMAGE_FEATURE = 'input.image';
export const NIMI_MACHINE_LOCAL_INPUT_AUDIO_FEATURE = 'input.audio';
export const NIMI_MACHINE_LOCAL_INPUT_TEXT_FEATURE = 'input.text';

export const NIMI_MACHINE_LOCAL_LLAMA_CPP_TEXT_IMPLEMENTATION = Object.freeze({
  implementationId: 'local.text.generate.llama-cpp',
  driverId: 'nimi.runtime.driver.llama-cpp',
  driverDialect: 'llama.cpp/text-generate/v1',
}) satisfies Readonly<CapabilityImplementationIdentity>;

export const NIMI_MACHINE_LOCAL_LLAMA_CPP_EMBED_IMPLEMENTATION = Object.freeze({
  implementationId: 'local.text.embed.llama-cpp',
  driverId: 'nimi.runtime.driver.llama-cpp',
  driverDialect: 'llama.cpp/text-embed/v1',
}) satisfies Readonly<CapabilityImplementationIdentity>;

export const NIMI_MACHINE_LOCAL_QWEN3_TTS_IMPLEMENTATION = Object.freeze({
  implementationId: 'local.audio.synthesize.qwen3-tts',
  driverId: 'nimi.runtime.driver.qwen3-tts',
  driverDialect: 'qwen3-tts/audio-synthesize/v1',
}) satisfies Readonly<CapabilityImplementationIdentity>;

export const NIMI_MACHINE_LOCAL_VOXCPM_IMPLEMENTATION = Object.freeze({
  implementationId: 'local.audio.synthesize.voxcpm',
  driverId: 'nimi.runtime.driver.voxcpm',
  driverDialect: 'voxcpm/audio-synthesize/v1',
}) satisfies Readonly<CapabilityImplementationIdentity>;

export const NIMI_MACHINE_LOCAL_QWEN3_VOICE_CREATE_IMPLEMENTATION = Object.freeze({
  implementationId: 'local.voice.create.qwen3-tts',
  driverId: 'nimi.runtime.driver.qwen3-tts',
  driverDialect: 'qwen3-tts/voice-create/v1',
}) satisfies Readonly<CapabilityImplementationIdentity>;

export type NimiMachineLocalVoiceCreateSource = 'reference-audio' | 'text-description';

export const NIMI_MACHINE_LOCAL_QWEN3_ASR_IMPLEMENTATION = Object.freeze({
  implementationId: 'local.audio.transcribe.qwen3-asr',
  driverId: 'nimi.runtime.driver.qwen3-asr',
  driverDialect: 'qwen3-asr/audio-transcribe/v1',
}) satisfies Readonly<CapabilityImplementationIdentity>;

export const NIMI_MACHINE_LOCAL_QWEN3_ASR_TRANSFORMERS_IMPLEMENTATION = Object.freeze({
  implementationId: 'local.audio.transcribe.qwen3-asr-transformers',
  driverId: 'nimi.runtime.driver.qwen3-asr-transformers',
  driverDialect: 'qwen3-asr-transformers/audio-transcribe/v1',
}) satisfies Readonly<CapabilityImplementationIdentity>;

export const NIMI_MACHINE_LOCAL_STABLE_DIFFUSION_IMAGE_IMPLEMENTATION = Object.freeze({
  implementationId: 'local.image.generate.stable-diffusion-cpp',
  driverId: 'nimi.runtime.driver.stable-diffusion-cpp',
  driverDialect: 'stable-diffusion.cpp/image-generate/v1',
}) satisfies Readonly<CapabilityImplementationIdentity>;

/**
 * Mirrors runtime/internal/capabilitydriver/stablediffusion_video.go:19-21;
 * implementationId/driverId alias the image pair at
 * runtime/internal/capabilitydriver/stablediffusion.go:18-19.
 */
export const NIMI_MACHINE_LOCAL_STABLE_DIFFUSION_VIDEO_IMPLEMENTATION = Object.freeze({
  implementationId: 'local.image.generate.stable-diffusion-cpp',
  driverId: 'nimi.runtime.driver.stable-diffusion-cpp',
  driverDialect: 'stable-diffusion.cpp/minimax-h3-video-generate/v1',
}) satisfies Readonly<CapabilityImplementationIdentity>;

export type NimiMachineLocalCapabilityInterpretability =
  | 'interpretable'
  | 'unavailable';

export type NimiMachineLocalCapabilityRequirementResolution =
  | 'unresolved'
  | 'configured';

export type NimiMachineLocalCapabilityRequirementRole = 'main' | 'companion';
export type NimiMachineLocalCapabilityRequirementPolicy = 'strict' | 'substitutable';

export type NimiMachineLocalCapabilityReason =
  | 'driver_not_found'
  | 'driver_dialect_unsupported'
  | 'implementation_unsupported'
  | 'portable_config_invalid'
  | 'feature_unsupported'
  | 'required_binding_missing'
  | 'binding_ambiguous'
  | 'local_asset_not_found'
  | 'local_asset_content_unverified'
  | 'local_asset_content_mismatch'
  | 'local_asset_incompatible';

export interface NimiMachineLocalCapabilityImplementation {
  readonly implementationId: string;
  readonly driverId: string;
  readonly driverDialect: string;
}

export interface NimiMachineLocalCapabilityRequirement {
  readonly requirementId: string;
  readonly role: NimiMachineLocalCapabilityRequirementRole;
  readonly resourceKind: string;
  readonly policy: NimiMachineLocalCapabilityRequirementPolicy;
  readonly preferredVerifiedContentId?: string;
  readonly compatibilityConstraints?: Readonly<JsonObject>;
  /** Zero is the Driver-declared unordered/singleton occurrence fact. */
  readonly occurrenceOrdinal: number;
  readonly displayLabel: string;
}

export interface NimiMachineLocalAssetExactBinding {
  readonly requirementId: string;
  readonly localAssetId: string;
  readonly verifiedContentId: string;
  readonly entrySha256: string;
}

export interface NimiMachineLocalCapabilityConfiguration {
  readonly configurationId: string;
  readonly capabilityContract: string;
  readonly implementation: NimiMachineLocalCapabilityImplementation;
  readonly portableConfig?: Readonly<JsonObject>;
  readonly projectedRequirements: readonly NimiMachineLocalCapabilityRequirement[];
  readonly exactBindings: readonly NimiMachineLocalAssetExactBinding[];
  readonly supportedFeatures: readonly string[];
  readonly interpretability: NimiMachineLocalCapabilityInterpretability;
  readonly requirementResolution: NimiMachineLocalCapabilityRequirementResolution;
  readonly reasons: readonly NimiMachineLocalCapabilityReason[];
  readonly displayName: string;
  readonly provenance?: Readonly<JsonObject>;
}

export interface NimiMachineLocalCapabilitySelection {
  readonly capabilityContract: string;
  readonly configurationId: string;
  readonly effectiveDefaults: Readonly<Record<string, string>> | null;
}

export interface NimiMachineLocalAIConfiguration {
  readonly configurations: readonly NimiMachineLocalCapabilityConfiguration[];
  readonly selections: readonly NimiMachineLocalCapabilitySelection[];
}

export interface NimiMachineLocalAIConfigurationAddInput {
  readonly capabilityContract: string;
  readonly implementation: NimiMachineLocalCapabilityImplementation;
  readonly portableConfig?: Readonly<JsonObject>;
  readonly supportedFeatures?: readonly string[];
  readonly displayName: string;
  readonly provenance?: Readonly<JsonObject>;
}

export interface NimiMachineLocalAIConfigurationUpdateInput {
  readonly configurationId: string;
  readonly portableConfig?: Readonly<JsonObject>;
  readonly supportedFeatures?: readonly string[];
  readonly displayName: string;
  readonly provenance?: Readonly<JsonObject>;
}

export interface NimiMachineLocalAIConfigurationBindingTarget {
  readonly localAssetId: string;
  readonly expectedVerifiedContentId: string;
}

export interface NimiMachineLocalAIConfigurationBindInput {
  readonly configurationId: string;
  readonly requirementId: string;
  readonly target: NimiMachineLocalAIConfigurationBindingTarget;
}

export interface NimiMachineLocalAIConfigurationRebindInput
  extends NimiMachineLocalAIConfigurationBindInput {
  readonly expectedCurrentBinding: NimiMachineLocalAssetExactBinding;
}

export interface NimiMachineLocalAIConfigurationUnbindInput {
  readonly configurationId: string;
  readonly requirementId: string;
  readonly expectedCurrentBinding: NimiMachineLocalAssetExactBinding;
}

export interface NimiMachineLocalStableDiffusionExecutionOptionsInput {
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

export type NimiMachineLocalStableDiffusionModelFamily = 'z-image' | 'ideogram4';

export interface NimiMachineLocalStableDiffusionImageConfigurationInput {
  readonly displayName: string;
  /** Exact Driver family; Z-Image models use z-image rather than a model identifier. */
  readonly modelFamily: NimiMachineLocalStableDiffusionModelFamily;
  readonly enableInputImage?: boolean;
  readonly executionOptions?: NimiMachineLocalStableDiffusionExecutionOptionsInput;
}

/**
 * MiniMax-H3 video.generate configuration input. The ten portable keys are
 * exactly the policyKey/contentIDKey pairs of the five Driver slots at
 * runtime/internal/capabilitydriver/stablediffusion_video.go:54-80, admitted
 * by parseStableDiffusionVideoPortableConfig at stablediffusion_video.go:310-336.
 */
export interface NimiMachineLocalStableDiffusionVideoConfigurationInput {
  readonly displayName: string;
  readonly enableInputImage?: boolean;
  readonly fl2vaRequirementPolicy?: NimiMachineLocalCapabilityRequirementPolicy;
  readonly fl2vaVerifiedContentId?: string;
  readonly ref2vaRequirementPolicy?: NimiMachineLocalCapabilityRequirementPolicy;
  readonly ref2vaVerifiedContentId?: string;
  readonly encoderRequirementPolicy?: NimiMachineLocalCapabilityRequirementPolicy;
  readonly encoderVerifiedContentId?: string;
  readonly videoVAERequirementPolicy?: NimiMachineLocalCapabilityRequirementPolicy;
  readonly videoVAEVerifiedContentId?: string;
  readonly audioVAERequirementPolicy?: NimiMachineLocalCapabilityRequirementPolicy;
  readonly audioVAEVerifiedContentId?: string;
}

export type NimiMachineLocalAIConfigurationImpactOperation = 'select' | 'update' | 'delete';

export interface NimiMachineLocalAIConfigurationImpactOwner {
  readonly kind: 'app' | 'shared-local-agent';
  readonly ownerId: string;
  readonly requiredFeatures: readonly string[];
}

export interface NimiMachineLocalAIConfigurationImpact {
  readonly operation: NimiMachineLocalAIConfigurationImpactOperation;
  readonly capabilityContract: string;
  readonly configurationId: string;
  readonly affectedOwners: readonly NimiMachineLocalAIConfigurationImpactOwner[];
}

export interface NimiMachineLocalAIConfigurationImpactAIConfigReader {
  get(options?: RuntimeTypedCallOptions): Promise<AIConfig>;
}

export type NimiMachineLocalAIConfigurationRpcClient = Pick<
  RuntimeTypedClient,
  | 'getMachineLocalAIConfiguration'
  | 'getLocalCapabilityConfiguration'
  | 'addLocalCapabilityConfiguration'
  | 'updateLocalCapabilityConfiguration'
  | 'selectLocalCapabilityConfiguration'
  | 'clearLocalCapabilitySelection'
  | 'deleteLocalCapabilityConfiguration'
  | 'reprojectLocalCapabilityRequirements'
  | 'bindLocalCapabilityRequirement'
  | 'rebindLocalCapabilityRequirement'
  | 'unbindLocalCapabilityRequirement'
  | 'listLocalAssets'
>;

export interface NimiMachineLocalAIConfigurationClient {
  get(options?: RuntimeTypedCallOptions): Promise<NimiMachineLocalAIConfiguration>;
  addConfiguration(
    input: NimiMachineLocalAIConfigurationAddInput,
    options?: RuntimeTypedCallOptions,
  ): Promise<NimiMachineLocalCapabilityConfiguration>;
  updateConfiguration(
    input: NimiMachineLocalAIConfigurationUpdateInput,
    options?: RuntimeTypedCallOptions,
  ): Promise<NimiMachineLocalCapabilityConfiguration>;
  deleteConfiguration(
    configurationId: string,
    options?: RuntimeTypedCallOptions,
  ): Promise<void>;
  getConfiguration(
    configurationId: string,
    options?: RuntimeTypedCallOptions,
  ): Promise<NimiMachineLocalCapabilityConfiguration>;
  reprojectRequirements(
    configurationId: string,
    options?: RuntimeTypedCallOptions,
  ): Promise<NimiMachineLocalCapabilityConfiguration>;
  select(
    capabilityContract: string,
    configurationId: string,
    options?: RuntimeTypedCallOptions,
  ): Promise<NimiMachineLocalCapabilitySelection>;
  clearSelection(
    capabilityContract: string,
    options?: RuntimeTypedCallOptions,
  ): Promise<void>;
  bindRequirement(
    input: NimiMachineLocalAIConfigurationBindInput,
    options?: RuntimeTypedCallOptions,
  ): Promise<NimiMachineLocalCapabilityConfiguration>;
  rebindRequirement(
    input: NimiMachineLocalAIConfigurationRebindInput,
    options?: RuntimeTypedCallOptions,
  ): Promise<NimiMachineLocalCapabilityConfiguration>;
  unbindRequirement(
    input: NimiMachineLocalAIConfigurationUnbindInput,
    options?: RuntimeTypedCallOptions,
  ): Promise<NimiMachineLocalCapabilityConfiguration>;
  listLocalAssets(
    filter?: NimiRuntimeLocalAssetListInput,
  ): Promise<readonly NimiRuntimeLocalAssetEntry[]>;
}

export function createNimiMachineLocalLlamaCppTextConfigurationInput(input: {
  readonly displayName: string;
  readonly acceptsImageInput?: boolean;
  /** Omit for model-authored automatic capacity; positive values are advanced fixed overrides. */
  readonly contextSize?: number;
}): NimiMachineLocalAIConfigurationAddInput {
  assertExactRecord(input, new Set(['displayName', 'acceptsImageInput', 'contextSize']), 'llama.cpp configuration input');
  const displayName = requireInputText(input.displayName, 'displayName');
  if (input.acceptsImageInput !== undefined && typeof input.acceptsImageInput !== 'boolean') {
    return inputError('acceptsImageInput must be a boolean when provided');
  }
  const acceptsImageInput = input.acceptsImageInput === true;
  const contextSize = input.contextSize === undefined
    ? undefined
    : requireIntegerInRange(input.contextSize, 1, 2_147_483_647, 'contextSize');
  const portableConfig: JsonObject = acceptsImageInput
    ? {
      mainRequirementPolicy: 'substitutable',
      mmprojRequirementPolicy: 'substitutable',
    }
    : { mainRequirementPolicy: 'substitutable' };
  if (contextSize !== undefined) portableConfig.contextSize = contextSize;
  return {
    capabilityContract: NIMI_MACHINE_LOCAL_TEXT_GENERATE_CAPABILITY_CONTRACT,
    implementation: { ...NIMI_MACHINE_LOCAL_LLAMA_CPP_TEXT_IMPLEMENTATION },
    portableConfig,
    supportedFeatures: acceptsImageInput
      ? [NIMI_MACHINE_LOCAL_INPUT_IMAGE_FEATURE]
      : [],
    displayName,
  };
}

export function createNimiMachineLocalLlamaCppEmbedConfigurationInput(input: {
  readonly displayName: string;
  /** Omit for model-authored automatic capacity; positive values are advanced fixed overrides. */
  readonly contextSize?: number;
}): NimiMachineLocalAIConfigurationAddInput {
  assertExactRecord(input, new Set(['displayName', 'contextSize']), 'llama.cpp embedding configuration input');
  const displayName = requireInputText(input.displayName, 'displayName');
  const contextSize = input.contextSize === undefined
    ? undefined
    : requireIntegerInRange(input.contextSize, 1, 2_147_483_647, 'contextSize');
  const portableConfig: JsonObject = { mainRequirementPolicy: 'substitutable' };
  if (contextSize !== undefined) portableConfig.contextSize = contextSize;
  return {
    capabilityContract: NIMI_MACHINE_LOCAL_TEXT_EMBED_CAPABILITY_CONTRACT,
    implementation: { ...NIMI_MACHINE_LOCAL_LLAMA_CPP_EMBED_IMPLEMENTATION },
    portableConfig,
    supportedFeatures: [],
    displayName,
  };
}

export function createNimiMachineLocalQwen3TTSConfigurationInput(input: {
  readonly displayName: string;
}): NimiMachineLocalAIConfigurationAddInput {
  assertExactRecord(input, new Set(['displayName']), 'Qwen3-TTS configuration input');
  return {
    capabilityContract: NIMI_MACHINE_LOCAL_AUDIO_SYNTHESIZE_CAPABILITY_CONTRACT,
    implementation: { ...NIMI_MACHINE_LOCAL_QWEN3_TTS_IMPLEMENTATION },
    portableConfig: {},
    supportedFeatures: [],
    displayName: requireInputText(input.displayName, 'displayName'),
  };
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r112
export function createNimiMachineLocalVoxCPMConfigurationInput(input: {
  readonly displayName: string;
}): NimiMachineLocalAIConfigurationAddInput {
  assertExactRecord(input, new Set(['displayName']), 'VoxCPM configuration input');
  return {
    capabilityContract: NIMI_MACHINE_LOCAL_AUDIO_SYNTHESIZE_CAPABILITY_CONTRACT,
    implementation: { ...NIMI_MACHINE_LOCAL_VOXCPM_IMPLEMENTATION },
    portableConfig: {},
    supportedFeatures: [],
    displayName: requireInputText(input.displayName, 'displayName'),
  };
}

/**
 * Builds one concrete Qwen3-TTS implementation of the implementation-neutral
 * voice.create contract. A configuration admits exactly one typed source;
 * selection remains capability-wide and never falls back by feature.
 */
export function createNimiMachineLocalQwen3VoiceCreateConfigurationInput(input: {
  readonly displayName: string;
  readonly source: NimiMachineLocalVoiceCreateSource;
}): NimiMachineLocalAIConfigurationAddInput {
  assertExactRecord(input, new Set(['displayName', 'source']), 'Qwen3-TTS voice.create configuration input');
  const source = input.source;
  if (source !== 'reference-audio' && source !== 'text-description') {
    return inputError('source must be reference-audio or text-description');
  }
  return {
    capabilityContract: NIMI_MACHINE_LOCAL_VOICE_CREATE_CAPABILITY_CONTRACT,
    implementation: { ...NIMI_MACHINE_LOCAL_QWEN3_VOICE_CREATE_IMPLEMENTATION },
    portableConfig: {},
    supportedFeatures: [source === 'reference-audio'
      ? NIMI_MACHINE_LOCAL_INPUT_AUDIO_FEATURE
      : NIMI_MACHINE_LOCAL_INPUT_TEXT_FEATURE],
    displayName: requireInputText(input.displayName, 'displayName'),
  };
}

export function createNimiMachineLocalQwen3ASRConfigurationInput(input: {
  readonly displayName: string;
}): NimiMachineLocalAIConfigurationAddInput {
  assertExactRecord(input, new Set(['displayName']), 'Qwen3-ASR configuration input');
  return {
    capabilityContract: NIMI_MACHINE_LOCAL_AUDIO_TRANSCRIBE_CAPABILITY_CONTRACT,
    implementation: { ...NIMI_MACHINE_LOCAL_QWEN3_ASR_IMPLEMENTATION },
    portableConfig: {},
    supportedFeatures: [],
    displayName: requireInputText(input.displayName, 'displayName'),
  };
}

export function createNimiMachineLocalQwen3ASRTransformersConfigurationInput(input: {
  readonly displayName: string;
}): NimiMachineLocalAIConfigurationAddInput {
  assertExactRecord(input, new Set(['displayName']), 'Transformers-native Qwen3-ASR configuration input');
  return {
    capabilityContract: NIMI_MACHINE_LOCAL_AUDIO_TRANSCRIBE_CAPABILITY_CONTRACT,
    implementation: { ...NIMI_MACHINE_LOCAL_QWEN3_ASR_TRANSFORMERS_IMPLEMENTATION },
    portableConfig: {},
    supportedFeatures: [],
    displayName: requireInputText(input.displayName, 'displayName'),
  };
}

/**
 * Builds the stable-diffusion.cpp image.generate portable configuration.
 * Every emitted portable key is accepted by parseStableDiffusionPortableConfig;
 * unknown constructor fields and out-of-range Driver values fail before transport.
 */
// nimi-authority: rule.nimi.runtime.ai-provider.r064
// nimi-authority: rule.nimi.runtime.local-compute.r102
export function createNimiMachineLocalStableDiffusionImageConfigurationInput(
  input: NimiMachineLocalStableDiffusionImageConfigurationInput,
): NimiMachineLocalAIConfigurationAddInput {
  assertExactRecord(input, new Set([
    'displayName',
    'modelFamily',
    'enableInputImage',
    'executionOptions',
  ]), 'stable-diffusion configuration input');
  const displayName = requireInputText(input.displayName, 'displayName');
  const modelFamily = requireInputText(input.modelFamily, 'modelFamily');
  if (modelFamily !== 'z-image' && modelFamily !== 'ideogram4') {
    return inputError('modelFamily must be an exact stable-diffusion Driver family');
  }
  if (input.enableInputImage !== undefined && typeof input.enableInputImage !== 'boolean') {
    return inputError('enableInputImage must be a boolean when provided');
  }

  const portableConfig: JsonObject = {
    modelFamily,
    enableInputImage: input.enableInputImage === true,
  };
  if (input.executionOptions !== undefined) {
    portableConfig.executionOptions = buildStableDiffusionExecutionOptions(input.executionOptions);
  }

  return {
    capabilityContract: NIMI_MACHINE_LOCAL_IMAGE_GENERATE_CAPABILITY_CONTRACT,
    implementation: { ...NIMI_MACHINE_LOCAL_STABLE_DIFFUSION_IMAGE_IMPLEMENTATION },
    portableConfig,
    supportedFeatures: input.enableInputImage === true
      ? [NIMI_MACHINE_LOCAL_INPUT_IMAGE_FEATURE]
      : [],
    displayName,
  };
}

/**
 * Builds the stable-diffusion.cpp MiniMax-H3 video.generate portable
 * configuration. Every emitted portable key is accepted by
 * parseStableDiffusionVideoPortableConfig
 * (runtime/internal/capabilitydriver/stablediffusion_video.go:310-336);
 * unknown constructor fields and out-of-range Driver values fail before
 * transport. A nil/empty portable config defaults every slot to substitutable
 * (stablediffusion_video.go:312-317). The only admitted feature is
 * input.image (stablediffusion_video.go:35,91-95).
 */
export function createNimiMachineLocalStableDiffusionVideoConfigurationInput(
  input: NimiMachineLocalStableDiffusionVideoConfigurationInput,
): NimiMachineLocalAIConfigurationAddInput {
  assertExactRecord(input, new Set([
    'displayName',
    'enableInputImage',
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
  ]), 'stable-diffusion video configuration input');
  const displayName = requireInputText(input.displayName, 'displayName');
  if (input.enableInputImage !== undefined && typeof input.enableInputImage !== 'boolean') {
    return inputError('enableInputImage must be a boolean when provided');
  }

  // Slot order mirrors stableDiffusionVideoSlots
  // (runtime/internal/capabilitydriver/stablediffusion_video.go:54-80).
  const portableConfig: JsonObject = {};
  appendStableDiffusionRequirementIntent(
    portableConfig,
    'fl2vaRequirementPolicy',
    'fl2vaVerifiedContentId',
    input.fl2vaRequirementPolicy,
    input.fl2vaVerifiedContentId,
  );
  appendStableDiffusionRequirementIntent(
    portableConfig,
    'ref2vaRequirementPolicy',
    'ref2vaVerifiedContentId',
    input.ref2vaRequirementPolicy,
    input.ref2vaVerifiedContentId,
  );
  appendStableDiffusionRequirementIntent(
    portableConfig,
    'encoderRequirementPolicy',
    'encoderVerifiedContentId',
    input.encoderRequirementPolicy,
    input.encoderVerifiedContentId,
  );
  appendStableDiffusionRequirementIntent(
    portableConfig,
    'videoVAERequirementPolicy',
    'videoVAEVerifiedContentId',
    input.videoVAERequirementPolicy,
    input.videoVAEVerifiedContentId,
  );
  appendStableDiffusionRequirementIntent(
    portableConfig,
    'audioVAERequirementPolicy',
    'audioVAEVerifiedContentId',
    input.audioVAERequirementPolicy,
    input.audioVAEVerifiedContentId,
  );

  return {
    capabilityContract: NIMI_MACHINE_LOCAL_VIDEO_GENERATE_CAPABILITY_CONTRACT,
    implementation: { ...NIMI_MACHINE_LOCAL_STABLE_DIFFUSION_VIDEO_IMPLEMENTATION },
    portableConfig,
    supportedFeatures: input.enableInputImage === true
      ? [NIMI_MACHINE_LOCAL_INPUT_IMAGE_FEATURE]
      : [],
    displayName,
  };
}

export function deriveNimiMachineLocalAIConfigurationImpact(input: {
  readonly operation: NimiMachineLocalAIConfigurationImpactOperation;
  readonly capabilityContract: string;
  readonly configurationId: string;
  readonly machine: NimiMachineLocalAIConfiguration;
  readonly aiConfigs: readonly AIConfig[];
}): NimiMachineLocalAIConfigurationImpact {
  assertExactRecord(input, new Set([
    'operation',
    'capabilityContract',
    'configurationId',
    'machine',
    'aiConfigs',
  ]), 'Machine Local AI Configuration impact input');
  const operation = requireImpactOperation(input.operation);
  const capabilityContract = requireInputText(input.capabilityContract, 'capabilityContract');
  const configurationId = requireInputText(input.configurationId, 'configurationId');
  const configuration = input.machine.configurations.find(
    (item) => item.configurationId === configurationId,
  );
  if (!configuration || configuration.capabilityContract !== capabilityContract) {
    return responseError('Machine Local AI Configuration impact target is missing or mismatched');
  }
  if (!Array.isArray(input.aiConfigs)) {
    return inputError('Machine Local AI Configuration impact aiConfigs must be an array');
  }
  const affectedOwners = input.aiConfigs
    .map((config) => projectMatchingLocalAIConfigOwner(
      config,
      capabilityContract,
      configuration.supportedFeatures,
    ))
    .filter((owner): owner is NimiMachineLocalAIConfigurationImpactOwner => owner !== null);
  const uniqueOwners = new Map<string, NimiMachineLocalAIConfigurationImpactOwner>();
  for (const owner of affectedOwners) {
    const key = `${owner.kind}\u0000${owner.ownerId}`;
    if (uniqueOwners.has(key)) {
      return responseError('Machine Local AI Configuration impact contains a duplicate AIConfig owner');
    }
    uniqueOwners.set(key, owner);
  }
  return Object.freeze({
    operation,
    capabilityContract,
    configurationId,
    affectedOwners: Object.freeze([...uniqueOwners.values()].sort(compareImpactOwners)),
  });
}

/**
 * Reads current machine and canonical owner AIConfigs for one ephemeral impact
 * derivation. AI_CONFIG_NOT_FOUND is canonical absence; no result is persisted.
 */
export async function loadNimiMachineLocalAIConfigurationImpact(input: {
  readonly operation: NimiMachineLocalAIConfigurationImpactOperation;
  readonly capabilityContract: string;
  readonly configurationId: string;
  readonly machine: Pick<NimiMachineLocalAIConfigurationClient, 'get'>;
  readonly aiConfigs: readonly NimiMachineLocalAIConfigurationImpactAIConfigReader[];
  readonly callOptions?: RuntimeTypedCallOptions;
}): Promise<NimiMachineLocalAIConfigurationImpact> {
  assertExactRecord(input, new Set([
    'operation',
    'capabilityContract',
    'configurationId',
    'machine',
    'aiConfigs',
    'callOptions',
  ]), 'Machine Local AI Configuration impact readers');
  if (!input.machine || typeof input.machine.get !== 'function' || !Array.isArray(input.aiConfigs)) {
    return inputError('Machine Local AI Configuration impact requires canonical readers');
  }
  if (input.aiConfigs.some((reader) => !reader || typeof reader.get !== 'function')) {
    return inputError('Machine Local AI Configuration impact contains an invalid AIConfig reader');
  }
  const [machine, configs] = await Promise.all([
    input.machine.get(input.callOptions),
    Promise.all(input.aiConfigs.map((reader) => readOptionalImpactAIConfig(
      reader,
      input.callOptions,
    ))),
  ]);
  return deriveNimiMachineLocalAIConfigurationImpact({
    operation: input.operation,
    capabilityContract: input.capabilityContract,
    configurationId: input.configurationId,
    machine,
    aiConfigs: configs.filter((config): config is AIConfig => config !== null),
  });
}

export function createNimiMachineLocalAIConfigurationClient(input: {
  readonly runtime: NimiMachineLocalAIConfigurationRpcClient;
  readonly callOptions?: RuntimeTypedCallOptions;
}): NimiMachineLocalAIConfigurationClient {
  const runtime = requireRpcClient(input?.runtime);
  const defaultCallOptions = input.callOptions;
  const readOptions = (options?: RuntimeTypedCallOptions) => options ?? defaultCallOptions;
  const writeOptions = (operation: string, options?: RuntimeTypedCallOptions) => (
    withNimiRuntimeIdempotencyMetadata(
      readOptions(options),
      createNimiClientId(`machine-local-ai-${operation}`),
    )
  );

  return Object.freeze({
    async get(options?: RuntimeTypedCallOptions) {
      const response = await runtime.getMachineLocalAIConfiguration({}, readOptions(options));
      if (!response.aggregate) {
        return responseError('GetMachineLocalAIConfiguration returned no aggregate');
      }
      return projectNimiMachineLocalAIConfiguration(response.aggregate);
    },

    async addConfiguration(
      value: NimiMachineLocalAIConfigurationAddInput,
      options?: RuntimeTypedCallOptions,
    ) {
      const request = buildAddRequest(value);
      const response = await runtime.addLocalCapabilityConfiguration(
        request,
        writeOptions('add', options),
      );
      const configuration = requireConfigurationResponse(
        response.configuration,
        'AddLocalCapabilityConfiguration',
      );
      if (configuration.capabilityContract !== request.capabilityContract) {
        return responseError('AddLocalCapabilityConfiguration returned a mismatched capability contract');
      }
      return configuration;
    },

    async updateConfiguration(
      value: NimiMachineLocalAIConfigurationUpdateInput,
      options?: RuntimeTypedCallOptions,
    ) {
      const request = buildUpdateRequest(value);
      const response = await runtime.updateLocalCapabilityConfiguration(
        request,
        writeOptions('update', options),
      );
      return requireConfigurationIdentity(
        requireConfigurationResponse(response.configuration, 'UpdateLocalCapabilityConfiguration'),
        request.configurationId,
        'UpdateLocalCapabilityConfiguration',
      );
    },

    async deleteConfiguration(configurationId: string, options?: RuntimeTypedCallOptions) {
      await runtime.deleteLocalCapabilityConfiguration(
        { configurationId: requireInputText(configurationId, 'configurationId') },
        writeOptions('delete', options),
      );
    },

    async getConfiguration(configurationId: string, options?: RuntimeTypedCallOptions) {
      const expectedId = requireInputText(configurationId, 'configurationId');
      const response = await runtime.getLocalCapabilityConfiguration(
        { configurationId: expectedId },
        readOptions(options),
      );
      return requireConfigurationIdentity(
        requireConfigurationResponse(response.configuration, 'GetLocalCapabilityConfiguration'),
        expectedId,
        'GetLocalCapabilityConfiguration',
      );
    },

    async reprojectRequirements(configurationId: string, options?: RuntimeTypedCallOptions) {
      const expectedId = requireInputText(configurationId, 'configurationId');
      const response = await runtime.reprojectLocalCapabilityRequirements(
        { configurationId: expectedId },
        writeOptions('reproject', options),
      );
      return requireConfigurationIdentity(
        requireConfigurationResponse(response.configuration, 'ReprojectLocalCapabilityRequirements'),
        expectedId,
        'ReprojectLocalCapabilityRequirements',
      );
    },

    async select(
      capabilityContract: string,
      configurationId: string,
      options?: RuntimeTypedCallOptions,
    ) {
      const expectedCapability = requireInputText(capabilityContract, 'capabilityContract');
      const expectedConfigurationId = requireInputText(configurationId, 'configurationId');
      const response = await runtime.selectLocalCapabilityConfiguration({
        capabilityContract: expectedCapability,
        configurationId: expectedConfigurationId,
      }, writeOptions('select', options));
      const selection = projectSelection(response.selection, 'SelectLocalCapabilityConfiguration');
      if (
        selection.capabilityContract !== expectedCapability
        || selection.configurationId !== expectedConfigurationId
      ) {
        return responseError('SelectLocalCapabilityConfiguration returned a mismatched selection');
      }
      return selection;
    },

    async clearSelection(capabilityContract: string, options?: RuntimeTypedCallOptions) {
      await runtime.clearLocalCapabilitySelection(
        { capabilityContract: requireInputText(capabilityContract, 'capabilityContract') },
        writeOptions('clear-selection', options),
      );
    },

    async bindRequirement(
      value: NimiMachineLocalAIConfigurationBindInput,
      options?: RuntimeTypedCallOptions,
    ) {
      const request = buildBindRequest(value);
      const response = await runtime.bindLocalCapabilityRequirement(
        request,
        writeOptions('bind', options),
      );
      return requireConfigurationIdentity(
        requireConfigurationResponse(response.configuration, 'BindLocalCapabilityRequirement'),
        request.configurationId,
        'BindLocalCapabilityRequirement',
      );
    },

    async rebindRequirement(
      value: NimiMachineLocalAIConfigurationRebindInput,
      options?: RuntimeTypedCallOptions,
    ) {
      assertExactRecord(
        value,
        new Set(['configurationId', 'requirementId', 'expectedCurrentBinding', 'target']),
        'rebindRequirement input',
      );
      const request = {
        ...buildBindingIdentity(value),
        expectedCurrentBinding: buildExpectedBinding(value.expectedCurrentBinding),
        target: buildBindingTarget(value.target),
      };
      const response = await runtime.rebindLocalCapabilityRequirement(
        request,
        writeOptions('rebind', options),
      );
      return requireConfigurationIdentity(
        requireConfigurationResponse(response.configuration, 'RebindLocalCapabilityRequirement'),
        request.configurationId,
        'RebindLocalCapabilityRequirement',
      );
    },

    async unbindRequirement(
      value: NimiMachineLocalAIConfigurationUnbindInput,
      options?: RuntimeTypedCallOptions,
    ) {
      assertExactRecord(
        value,
        new Set(['configurationId', 'requirementId', 'expectedCurrentBinding']),
        'unbindRequirement input',
      );
      const request = {
        ...buildBindingIdentity(value),
        expectedCurrentBinding: buildExpectedBinding(value.expectedCurrentBinding),
      };
      const response = await runtime.unbindLocalCapabilityRequirement(
        request,
        writeOptions('unbind', options),
      );
      return requireConfigurationIdentity(
        requireConfigurationResponse(response.configuration, 'UnbindLocalCapabilityRequirement'),
        request.configurationId,
        'UnbindLocalCapabilityRequirement',
      );
    },

    async listLocalAssets(filter: NimiRuntimeLocalAssetListInput = {}) {
      return listNimiRuntimeLocalAssetEntries(
        { local: runtime },
        {
          ...filter,
          callOptions: filter.callOptions ?? defaultCallOptions,
        },
      );
    },
  });
}

export function projectNimiMachineLocalAIConfiguration(
  aggregate: MachineLocalAIConfiguration,
): NimiMachineLocalAIConfiguration {
  if (!aggregate || !Array.isArray(aggregate.configurations) || !Array.isArray(aggregate.selections)) {
    return responseError('Machine Local AI Configuration aggregate is invalid');
  }
  const configurations = aggregate.configurations.map((configuration) => (
    projectNimiMachineLocalCapabilityConfiguration(configuration)
  ));
  assertUniqueResponseValues(
    configurations.map((configuration) => configuration.configurationId),
    'configuration ids',
  );
  const configurationById = new Map(
    configurations.map((configuration) => [configuration.configurationId, configuration] as const),
  );
  const selections = aggregate.selections.map((selection) => projectSelection(selection, 'aggregate'));
  assertUniqueResponseValues(
    selections.map((selection) => selection.capabilityContract),
    'selection capability contracts',
  );
  for (const selection of selections) {
    const configuration = configurationById.get(selection.configurationId);
    if (!configuration || configuration.capabilityContract !== selection.capabilityContract) {
      return responseError('Machine Local AI Configuration contains a dangling or mismatched selection');
    }
  }
  return { configurations, selections };
}

export function projectNimiMachineLocalCapabilityConfiguration(
  value: LocalCapabilityConfiguration,
): NimiMachineLocalCapabilityConfiguration {
  if (!value || typeof value !== 'object') {
    return responseError('Local Capability Configuration is missing');
  }
  const configurationId = requireResponseText(value.configurationId, 'configurationId');
  const capabilityContract = requireResponseText(value.capabilityContract, 'capabilityContract');
  const implementation = projectImplementation(value.implementation);
  if (!Array.isArray(value.projectedRequirements) || !Array.isArray(value.exactBindings)
    || !Array.isArray(value.supportedFeatures) || !Array.isArray(value.reasons)) {
    return responseError(`Local Capability Configuration ${configurationId} has invalid repeated fields`);
  }
  const projectedRequirements = value.projectedRequirements.map(projectRequirement);
  const exactBindings = value.exactBindings.map(projectExactBinding);
  const requirementIds = projectedRequirements.map((requirement) => requirement.requirementId);
  assertUniqueResponseValues(requirementIds, `requirements for ${configurationId}`);
  assertUniqueResponseValues(
    exactBindings.map((binding) => binding.requirementId),
    `bindings for ${configurationId}`,
  );
  const requirementIdSet = new Set(requirementIds);
  if (exactBindings.some((binding) => !requirementIdSet.has(binding.requirementId))) {
    return responseError(`Local Capability Configuration ${configurationId} binds an unknown requirement`);
  }
  const supportedFeatures = value.supportedFeatures.map((feature) => (
    requireResponseText(feature, 'supportedFeature')
  ));
  assertUniqueResponseValues(supportedFeatures, `supported features for ${configurationId}`);
  const reasons = value.reasons.map(projectReason);
  assertUniqueResponseValues(reasons, `reasons for ${configurationId}`);
  const displayName = requireResponseText(value.displayName, 'displayName', true);
  return {
    configurationId,
    capabilityContract,
    implementation,
    ...(value.portableConfig
      ? { portableConfig: fromNimiRuntimeProtoStruct(value.portableConfig) }
      : {}),
    projectedRequirements,
    exactBindings,
    supportedFeatures,
    interpretability: projectInterpretability(value.interpretability),
    requirementResolution: projectRequirementResolution(value.requirementResolution),
    reasons,
    displayName,
    ...(value.provenance
      ? { provenance: fromNimiRuntimeProtoStruct(value.provenance) }
      : {}),
  };
}

function appendStableDiffusionRequirementIntent(
  output: JsonObject,
  policyKey: string,
  contentKey: string,
  policy: NimiMachineLocalCapabilityRequirementPolicy | undefined,
  verifiedContentId: string | undefined,
): void {
  if (policy !== undefined) {
    output[policyKey] = requireStableDiffusionRequirementPolicy(policy, policyKey);
  }
  if (verifiedContentId !== undefined) {
    output[contentKey] = requireCanonicalVerifiedContentId(
      verifiedContentId,
      contentKey,
      inputError,
    );
  }
  if (policy === 'strict' && verifiedContentId === undefined) {
    inputError(`${contentKey} is required when ${policyKey} is strict`);
  }
}

function buildStableDiffusionExecutionOptions(
  value: NimiMachineLocalStableDiffusionExecutionOptionsInput,
): JsonObject {
  assertExactRecord(value, new Set([
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
  ]), 'executionOptions');
  const output: JsonObject = {};
  if (value.steps !== undefined) {
    output.steps = requireIntegerInRange(value.steps, 1, 150, 'executionOptions.steps');
  }
  if (value.cfgScale !== undefined) {
    output.cfgScale = requireFiniteNumberInRange(
      value.cfgScale,
      0,
      30,
      'executionOptions.cfgScale',
    );
  }
  for (const [key, fieldValue] of [
    ['width', value.width],
    ['height', value.height],
  ] as const) {
    if (fieldValue === undefined) continue;
    const dimension = requireIntegerInRange(
      fieldValue,
      64,
      4096,
      `executionOptions.${key}`,
    );
    if (dimension % 8 !== 0) {
      inputError(`executionOptions.${key} must be a multiple of eight`);
    }
    output[key] = dimension;
  }
  if (value.seed !== undefined) {
    output.seed = requireIntegerInRange(
      value.seed,
      -2147483648,
      2147483647,
      'executionOptions.seed',
    );
  }
  for (const [key, fieldValue] of [
    ['sampler', value.sampler],
    ['scheduler', value.scheduler],
  ] as const) {
    if (fieldValue === undefined) continue;
    const token = requireInputText(fieldValue, `executionOptions.${key}`);
    if (token.length > 64 || !/^[A-Za-z0-9+_.-]+$/u.test(token)) {
      inputError(`executionOptions.${key} must be a Driver option token`);
    }
    output[key] = token;
  }
  if (value.threads !== undefined) {
    output.threads = requireIntegerInRange(
      value.threads,
      1,
      1024,
      'executionOptions.threads',
    );
  }
  for (const [key, fieldValue] of [
    ['diffusionFlashAttention', value.diffusionFlashAttention],
    ['offloadParamsToCPU', value.offloadParamsToCPU],
  ] as const) {
    if (fieldValue === undefined) continue;
    if (typeof fieldValue !== 'boolean') {
      inputError(`executionOptions.${key} must be a boolean`);
    }
    output[key] = fieldValue;
  }
  return output;
}

function requireStableDiffusionRequirementPolicy(
  value: unknown,
  field: string,
): NimiMachineLocalCapabilityRequirementPolicy {
  if (value !== 'strict' && value !== 'substitutable') {
    return inputError(`${field} must be strict or substitutable`);
  }
  return value;
}

function requireFiniteNumberInRange(
  value: unknown,
  minimum: number,
  maximum: number,
  field: string,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    return inputError(`${field} must be a finite number from ${minimum} through ${maximum}`);
  }
  return value;
}

function requireIntegerInRange(
  value: unknown,
  minimum: number,
  maximum: number,
  field: string,
): number {
  const number = requireFiniteNumberInRange(value, minimum, maximum, field);
  if (!Number.isInteger(number)) {
    return inputError(`${field} must be an integer`);
  }
  return number;
}

function requireImpactOperation(
  value: unknown,
): NimiMachineLocalAIConfigurationImpactOperation {
  if (value !== 'select' && value !== 'update' && value !== 'delete') {
    return inputError('impact operation must be select, update, or delete');
  }
  return value;
}

async function readOptionalImpactAIConfig(
  reader: NimiMachineLocalAIConfigurationImpactAIConfigReader,
  options?: RuntimeTypedCallOptions,
): Promise<AIConfig | null> {
  try {
    return await reader.get(options);
  } catch (error) {
    if (isAIConfigNotFound(error)) return null;
    throw error;
  }
}

function isAIConfigNotFound(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const value = error as { readonly reasonCode?: unknown; readonly code?: unknown };
  const reason = typeof value.reasonCode === 'string'
    ? value.reasonCode
    : typeof value.code === 'string'
      ? value.code
      : '';
  return reason.trim().toUpperCase().replaceAll('-', '_') === 'AI_CONFIG_NOT_FOUND';
}

function projectMatchingLocalAIConfigOwner(
  config: AIConfig,
  capabilityContract: string,
  supportedFeatures: readonly string[],
): NimiMachineLocalAIConfigurationImpactOwner | null {
  if (!config || !Array.isArray(config.capabilities)) {
    return responseError('Machine Local AI Configuration impact received an invalid AIConfig');
  }
  const owner = projectImpactOwnerIdentity(config);
  const intents = config.capabilities.filter(
    (intent) => intent?.capabilityContract === capabilityContract,
  );
  if (intents.length > 1) {
    return responseError('Machine Local AI Configuration impact received duplicate capability intent');
  }
  const intent = intents[0];
  if (!intent) return null;
  if (!Array.isArray(intent.requiredFeatures)) {
    return responseError('Machine Local AI Configuration impact received invalid required features');
  }
  const requiredFeatures = intent.requiredFeatures.map((feature) => (
    requireResponseText(feature, 'AIConfig requiredFeature')
  ));
  assertUniqueResponseValues(requiredFeatures, 'AIConfig required features');
  // Defaults remain opaque owner intent. Impact matching reads no model,
  // implementation, asset, binding, health, or readiness facts from them.
  void intent.defaults;
  if (intent.route?.oneofKind !== 'local') return null;
  const supported = new Set(supportedFeatures);
  if (requiredFeatures.some((feature) => !supported.has(feature))) return null;
  return Object.freeze({
    ...owner,
    requiredFeatures: Object.freeze([...requiredFeatures]),
  });
}

function projectImpactOwnerIdentity(
  config: AIConfig,
): Pick<NimiMachineLocalAIConfigurationImpactOwner, 'kind' | 'ownerId'> {
  const owner = config.owner?.owner;
  if (owner?.oneofKind === 'app') {
    return {
      kind: 'app',
      ownerId: requireResponseText(owner.app.appId, 'AIConfig app owner'),
    };
  }
  if (owner?.oneofKind === 'runtimeLocalAgentSubsystem') {
    return { kind: 'shared-local-agent', ownerId: 'shared-local-agent' };
  }
  return responseError('Machine Local AI Configuration impact received an invalid AIConfig owner');
}

function compareImpactOwners(
  left: NimiMachineLocalAIConfigurationImpactOwner,
  right: NimiMachineLocalAIConfigurationImpactOwner,
): number {
  const leftKey = `${left.kind}\u0000${left.ownerId}`;
  const rightKey = `${right.kind}\u0000${right.ownerId}`;
  return leftKey.localeCompare(rightKey);
}

function buildAddRequest(value: NimiMachineLocalAIConfigurationAddInput) {
  assertExactRecord(
    value,
    new Set([
      'capabilityContract',
      'implementation',
      'portableConfig',
      'supportedFeatures',
      'displayName',
      'provenance',
    ]),
    'addConfiguration input',
  );
  const implementation = buildImplementation(value.implementation);
  const supportedFeatures = value.supportedFeatures === undefined
    ? []
    : buildCanonicalTextList(value.supportedFeatures, 'supportedFeatures');
  return {
    capabilityContract: requireInputText(value.capabilityContract, 'capabilityContract'),
    implementation,
    ...(value.portableConfig === undefined
      ? {}
      : { portableConfig: buildProtoStruct(value.portableConfig, 'portableConfig') }),
    supportedFeatures,
    displayName: requireInputText(value.displayName, 'displayName'),
    ...(value.provenance === undefined
      ? {}
      : { provenance: buildProtoStruct(value.provenance, 'provenance') }),
  };
}

function buildUpdateRequest(value: NimiMachineLocalAIConfigurationUpdateInput) {
  assertExactRecord(
    value,
    new Set([
      'configurationId',
      'portableConfig',
      'supportedFeatures',
      'displayName',
      'provenance',
    ]),
    'updateConfiguration input',
  );
  const supportedFeatures = value.supportedFeatures === undefined
    ? []
    : buildCanonicalTextList(value.supportedFeatures, 'supportedFeatures');
  return {
    configurationId: requireInputText(value.configurationId, 'configurationId'),
    ...(value.portableConfig === undefined
      ? {}
      : { portableConfig: buildProtoStruct(value.portableConfig, 'portableConfig') }),
    supportedFeatures,
    displayName: requireInputText(value.displayName, 'displayName'),
    ...(value.provenance === undefined
      ? {}
      : { provenance: buildProtoStruct(value.provenance, 'provenance') }),
  };
}

function buildBindRequest(value: NimiMachineLocalAIConfigurationBindInput) {
  assertExactRecord(
    value,
    new Set(['configurationId', 'requirementId', 'target']),
    'bindRequirement input',
  );
  return {
    ...buildBindingIdentity(value),
    target: buildBindingTarget(value.target),
  };
}

function buildBindingIdentity(value: {
  readonly configurationId: string;
  readonly requirementId: string;
}) {
  return {
    configurationId: requireInputText(value.configurationId, 'configurationId'),
    requirementId: requireInputText(value.requirementId, 'requirementId'),
  };
}

function buildBindingTarget(
  value: NimiMachineLocalAIConfigurationBindingTarget,
) {
  assertExactRecord(
    value,
    new Set(['localAssetId', 'expectedVerifiedContentId']),
    'binding target',
  );
  return {
    localAssetId: requireInputText(value.localAssetId, 'target.localAssetId'),
    expectedVerifiedContentId: requireCanonicalVerifiedContentId(
      value.expectedVerifiedContentId,
      'target.expectedVerifiedContentId',
      inputError,
    ),
  };
}

function buildExpectedBinding(value: NimiMachineLocalAssetExactBinding): LocalAssetExactBinding {
  assertExactRecord(
    value,
    new Set(['requirementId', 'localAssetId', 'verifiedContentId', 'entrySha256']),
    'expectedCurrentBinding',
  );
  return {
    requirementId: requireInputText(value.requirementId, 'expectedCurrentBinding.requirementId'),
    localAssetId: requireInputText(value.localAssetId, 'expectedCurrentBinding.localAssetId'),
    verifiedContentId: requireCanonicalVerifiedContentId(
      value.verifiedContentId,
      'expectedCurrentBinding.verifiedContentId',
      inputError,
    ),
    entrySha256: requireCanonicalSha256(
      value.entrySha256,
      'expectedCurrentBinding.entrySha256',
      inputError,
    ),
  };
}

function buildImplementation(
  value: NimiMachineLocalCapabilityImplementation,
): CapabilityImplementationIdentity {
  assertExactRecord(
    value,
    new Set(['implementationId', 'driverId', 'driverDialect']),
    'implementation',
  );
  return {
    implementationId: requireInputText(value.implementationId, 'implementation.implementationId'),
    driverId: requireInputText(value.driverId, 'implementation.driverId'),
    driverDialect: requireInputText(value.driverDialect, 'implementation.driverDialect'),
  };
}

function projectImplementation(
  value: CapabilityImplementationIdentity | undefined,
): NimiMachineLocalCapabilityImplementation {
  if (!value) {
    return responseError('Local Capability Configuration is missing implementation identity');
  }
  return {
    implementationId: requireResponseText(value.implementationId, 'implementationId'),
    driverId: requireResponseText(value.driverId, 'driverId'),
    driverDialect: requireResponseText(value.driverDialect, 'driverDialect'),
  };
}

function projectRequirement(
  value: LocalCapabilityRequirement,
): NimiMachineLocalCapabilityRequirement {
  if (!value || typeof value !== 'object') {
    return responseError('Local Capability Requirement is missing');
  }
  const preferredVerifiedContentId = requireResponseText(
    value.preferredVerifiedContentId,
    'preferredVerifiedContentId',
    true,
  );
  if (preferredVerifiedContentId) {
    requireCanonicalVerifiedContentId(
      preferredVerifiedContentId,
      'preferredVerifiedContentId',
      responseError,
    );
  }
  return {
    requirementId: requireResponseText(value.requirementId, 'requirementId'),
    role: projectRequirementRole(value.role),
    resourceKind: requireResponseText(value.resourceKind, 'resourceKind'),
    policy: projectRequirementPolicy(value.policy),
    ...(preferredVerifiedContentId ? { preferredVerifiedContentId } : {}),
    ...(value.compatibilityConstraints
      ? { compatibilityConstraints: fromNimiRuntimeProtoStruct(value.compatibilityConstraints) }
      : {}),
    occurrenceOrdinal: requireResponseOrdinal(
      value.occurrenceOrdinal,
      'occurrenceOrdinal',
    ),
    displayLabel: requireResponseText(value.displayLabel, 'displayLabel'),
  };
}

function projectExactBinding(value: LocalAssetExactBinding): NimiMachineLocalAssetExactBinding {
  if (!value || typeof value !== 'object') {
    return responseError('Local Asset exact binding is missing');
  }
  return {
    requirementId: requireResponseText(value.requirementId, 'binding.requirementId'),
    localAssetId: requireResponseText(value.localAssetId, 'binding.localAssetId'),
    verifiedContentId: requireCanonicalVerifiedContentId(
      value.verifiedContentId,
      'binding.verifiedContentId',
      responseError,
    ),
    entrySha256: requireCanonicalSha256(
      value.entrySha256,
      'binding.entrySha256',
      responseError,
    ),
  };
}

function projectSelection(
  value: LocalCapabilitySelection | undefined,
  operation: string,
): NimiMachineLocalCapabilitySelection {
  if (!value) {
    return responseError(`${operation} returned no selection`);
  }
  return {
    capabilityContract: requireResponseText(value.capabilityContract, 'selection.capabilityContract'),
    configurationId: requireResponseText(value.configurationId, 'selection.configurationId'),
    effectiveDefaults: value.effectiveDefaults
      ? projectEffectiveDefaults(value.effectiveDefaults, operation)
      : null,
  };
}

function projectEffectiveDefaults(
  value: NonNullable<LocalCapabilitySelection['effectiveDefaults']>,
  operation: string,
): Readonly<Record<string, string>> {
  const projected = fromNimiRuntimeProtoStruct(value);
  const entries = Object.entries(projected);
  if (entries.length === 0 || entries.length > 64) {
    return responseError(`${operation} returned invalid effective request defaults`);
  }
  const result: Record<string, string> = {};
  for (const [key, item] of entries) {
    if (!key || key.trim() !== key || typeof item !== 'string' || !item || item.trim() !== item) {
      return responseError(`${operation} returned invalid effective request defaults`);
    }
    result[key] = item;
  }
  return Object.freeze(result);
}

function projectInterpretability(
  value: LocalCapabilityInterpretability,
): NimiMachineLocalCapabilityInterpretability {
  switch (value) {
    case LocalCapabilityInterpretability.INTERPRETABLE:
      return 'interpretable';
    case LocalCapabilityInterpretability.UNAVAILABLE:
      return 'unavailable';
    default:
      return responseError(`unsupported Local Capability interpretability: ${String(value)}`);
  }
}

function projectRequirementResolution(
  value: LocalCapabilityRequirementResolution,
): NimiMachineLocalCapabilityRequirementResolution {
  switch (value) {
    case LocalCapabilityRequirementResolution.UNRESOLVED:
      return 'unresolved';
    case LocalCapabilityRequirementResolution.CONFIGURED:
      return 'configured';
    default:
      return responseError(`unsupported Local Capability requirement resolution: ${String(value)}`);
  }
}

function projectRequirementRole(
  value: LocalCapabilityRequirementRole,
): NimiMachineLocalCapabilityRequirementRole {
  switch (value) {
    case LocalCapabilityRequirementRole.MAIN:
      return 'main';
    case LocalCapabilityRequirementRole.COMPANION:
      return 'companion';
    default:
      return responseError(`unsupported Local Capability requirement role: ${String(value)}`);
  }
}

function projectRequirementPolicy(
  value: LocalCapabilityRequirementPolicy,
): NimiMachineLocalCapabilityRequirementPolicy {
  switch (value) {
    case LocalCapabilityRequirementPolicy.STRICT:
      return 'strict';
    case LocalCapabilityRequirementPolicy.SUBSTITUTABLE:
      return 'substitutable';
    default:
      return responseError(`unsupported Local Capability requirement policy: ${String(value)}`);
  }
}

function projectReason(value: LocalCapabilityReason): NimiMachineLocalCapabilityReason {
  switch (value) {
    case LocalCapabilityReason.DRIVER_NOT_FOUND:
      return 'driver_not_found';
    case LocalCapabilityReason.DRIVER_DIALECT_UNSUPPORTED:
      return 'driver_dialect_unsupported';
    case LocalCapabilityReason.IMPLEMENTATION_UNSUPPORTED:
      return 'implementation_unsupported';
    case LocalCapabilityReason.PORTABLE_CONFIG_INVALID:
      return 'portable_config_invalid';
    case LocalCapabilityReason.FEATURE_UNSUPPORTED:
      return 'feature_unsupported';
    case LocalCapabilityReason.REQUIRED_BINDING_MISSING:
      return 'required_binding_missing';
    case LocalCapabilityReason.BINDING_AMBIGUOUS:
      return 'binding_ambiguous';
    case LocalCapabilityReason.LOCAL_ASSET_NOT_FOUND:
      return 'local_asset_not_found';
    case LocalCapabilityReason.LOCAL_ASSET_CONTENT_UNVERIFIED:
      return 'local_asset_content_unverified';
    case LocalCapabilityReason.LOCAL_ASSET_CONTENT_MISMATCH:
      return 'local_asset_content_mismatch';
    case LocalCapabilityReason.LOCAL_ASSET_INCOMPATIBLE:
      return 'local_asset_incompatible';
    default:
      return responseError(`unsupported Local Capability reason: ${String(value)}`);
  }
}

function requireConfigurationResponse(
  value: LocalCapabilityConfiguration | undefined,
  operation: string,
): NimiMachineLocalCapabilityConfiguration {
  if (!value) {
    return responseError(`${operation} returned no configuration`);
  }
  return projectNimiMachineLocalCapabilityConfiguration(value);
}

function requireConfigurationIdentity(
  configuration: NimiMachineLocalCapabilityConfiguration,
  expectedId: string,
  operation: string,
): NimiMachineLocalCapabilityConfiguration {
  if (configuration.configurationId !== expectedId) {
    return responseError(`${operation} returned a mismatched configuration`);
  }
  return configuration;
}

function requireRpcClient(
  value: NimiMachineLocalAIConfigurationRpcClient | undefined,
): NimiMachineLocalAIConfigurationRpcClient {
  const methods: readonly (keyof NimiMachineLocalAIConfigurationRpcClient)[] = [
    'getMachineLocalAIConfiguration',
    'getLocalCapabilityConfiguration',
    'addLocalCapabilityConfiguration',
    'selectLocalCapabilityConfiguration',
    'clearLocalCapabilitySelection',
    'deleteLocalCapabilityConfiguration',
    'reprojectLocalCapabilityRequirements',
    'bindLocalCapabilityRequirement',
    'rebindLocalCapabilityRequirement',
    'unbindLocalCapabilityRequirement',
    'listLocalAssets',
  ];
  if (!value || methods.some((method) => typeof value[method] !== 'function')) {
    return inputError('Machine Local AI Configuration client requires the complete typed Runtime carrier');
  }
  return value;
}

function buildCanonicalTextList(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    return inputError(`${field} must be an array`);
  }
  const result = value.map((item, index) => requireInputText(item, `${field}[${index}]`));
  if (new Set(result).size !== result.length) {
    return inputError(`${field} must not contain duplicates`);
  }
  return result;
}

function buildProtoStruct(value: unknown, field: string) {
  if (!isJsonObject(value) || !isPlainRecord(value)) {
    return inputError(`${field} must be a JSON object`);
  }
  assertJsonValue(value, field, new Set<object>(), 0);
  try {
    return toNimiRuntimeProtoStruct(value);
  } catch {
    return inputError(`${field} could not be encoded as a Runtime Struct`);
  }
}

function assertJsonValue(
  value: unknown,
  field: string,
  ancestors: Set<object>,
  depth: number,
): asserts value is JsonValue {
  if (depth > 64) {
    return inputError(`${field} exceeds the supported JSON nesting depth`);
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return inputError(`${field} contains a non-finite number`);
    return;
  }
  if (!value || typeof value !== 'object') {
    return inputError(`${field} contains a non-JSON value`);
  }
  if (ancestors.has(value)) {
    return inputError(`${field} contains a cycle`);
  }
  ancestors.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!(index in value)) return inputError(`${field} contains a sparse array`);
      assertJsonValue(value[index], `${field}[${index}]`, ancestors, depth + 1);
    }
  } else {
    if (!isPlainRecord(value)) return inputError(`${field} contains a non-plain object`);
    for (const [key, item] of Object.entries(value)) {
      assertJsonValue(item, `${field}.${key}`, ancestors, depth + 1);
    }
  }
  ancestors.delete(value);
}

function assertExactRecord(
  value: unknown,
  allowed: ReadonlySet<string>,
  field: string,
): asserts value is Record<string, unknown> {
  if (!isPlainRecord(value)) {
    return inputError(`${field} must be an object`);
  }
  const unknownKeys = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknownKeys.length > 0) {
    return inputError(`${field} contains unsupported fields: ${unknownKeys.join(', ')}`);
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireInputText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value || value.trim() !== value) {
    return inputError(`${field} must be a non-empty canonical string`);
  }
  return value;
}

function requireResponseText(value: unknown, field: string, allowEmpty = false): string {
  if (typeof value !== 'string' || value.trim() !== value || (!allowEmpty && !value)) {
    return responseError(`${field} is not a canonical string`);
  }
  return value;
}

function requireResponseOrdinal(value: unknown, field: string): number {
  if (
    typeof value !== 'number'
    || !Number.isInteger(value)
    || value < 0
    || value > 0xffff_ffff
  ) {
    return responseError(`${field} is not a canonical uint32 ordinal`);
  }
  return value;
}

function requireCanonicalVerifiedContentId(
  value: unknown,
  field: string,
  fail: (message: string) => never,
): string {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(value)) {
    return fail(`${field} must be a canonical sha256 content identity`);
  }
  return value;
}

function requireCanonicalSha256(
  value: unknown,
  field: string,
  fail: (message: string) => never,
): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
    return fail(`${field} must be a canonical sha256 digest`);
  }
  return value;
}

function assertUniqueResponseValues(values: readonly string[], field: string): void {
  if (new Set(values).size !== values.length) {
    responseError(`Machine Local AI Configuration contains duplicate ${field}`);
  }
}

function inputError(message: string): never {
  throw createNimiError({
    message,
    code: ReasonCode.SDK_AI_INPUT_INVALID,
    reasonCode: ReasonCode.SDK_AI_INPUT_INVALID,
    actionHint: 'provide_canonical_machine_local_ai_configuration_input',
    source: 'sdk',
  });
}

function responseError(message: string): never {
  throw createNimiError({
    message,
    code: ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
    reasonCode: ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
    actionHint: 'inspect_machine_local_ai_configuration_response',
    source: 'runtime',
  });
}
