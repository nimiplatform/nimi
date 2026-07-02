import type { ExecuteScenarioRequest } from '../core-generated/runtime-typed-client';
import type { CoreMetadata, CoreResponseMetadataObserver, JsonObject } from '../types';
import type {
  NimiRuntimeCanonicalCapability,
  NimiRuntimeRouteOptionsSnapshot,
  NimiRuntimeRouteSource,
  NimiRuntimeRouteTargetRef,
} from './route-options';

export const NIMI_RUNTIME_ROUTE_DESCRIBE_RESULT_RESPONSE_METADATA_KEY = 'x-nimi-route-describe-result';
export const NIMI_RUNTIME_ROUTE_DESCRIBE_TIMEOUT_MS = 30_000;

export type NimiRuntimeRouteResolvedBindingRef = string;
export type NimiRuntimeRouteMetadataVersion = 'v1';

export interface NimiRuntimeResolvedBinding {
  readonly capability: NimiRuntimeCanonicalCapability;
  readonly source: NimiRuntimeRouteSource;
  readonly targetRef: NimiRuntimeRouteTargetRef;
  readonly resolvedBindingRef: NimiRuntimeRouteResolvedBindingRef;
  readonly routeMetadataRef?: string;
  readonly provider?: string;
  readonly model?: string;
  readonly modelId?: string;
  readonly endpoint?: string;
  readonly engine?: string;
  readonly localAssetId?: string;
  readonly localProviderEndpoint?: string;
  readonly localOpenAiEndpoint?: string;
  readonly localRuntimeStatus?: string;
  readonly connectorId?: string;
  readonly remoteModelCatalogId?: string;
  readonly providerModelId?: string;
  readonly endpointProfileId?: string;
  readonly connectorSnapshotId?: string;
}

export interface NimiRuntimeRouteHealthInput {
  readonly provider: string;
  readonly capability?: string;
  readonly localProviderEndpoint?: string;
  readonly localProviderModel?: string;
  readonly localOpenAiEndpoint?: string;
  readonly localAssetId?: string;
  readonly connectorId?: string;
}

export interface NimiRuntimeRouteHostProviderHealth {
  readonly provider?: string;
  readonly endpoint?: string | null;
  readonly model?: string;
  readonly status?: 'healthy' | 'degraded' | 'unsupported' | 'unreachable' | 'unavailable' | string;
  readonly detail?: string;
  readonly reasonCode?: string;
  readonly actionHint?: string;
}

export interface NimiRuntimeRouteHealthResult {
  readonly healthy: boolean;
  readonly status: 'healthy' | 'degraded' | 'unsupported' | 'unreachable' | 'unavailable' | string;
  readonly provider: string;
  readonly detail: string;
  readonly reasonCode?: string;
  readonly actionHint: string;
}

export type NimiRuntimeRouteMetadataKind =
  | 'text.generate'
  | 'text.embed'
  | 'image.generate'
  | 'audio.synthesize'
  | 'audio.transcribe'
  | 'voice_workflow.voice_clone'
  | 'voice_workflow.voice_design';

export type NimiRuntimeRouteTextGenerateTraceModeSupport = 'none' | 'hide' | 'separate';
export type NimiRuntimeRouteSpeechTimingMode = 'none' | 'word' | 'char';
export type NimiRuntimeRouteVoiceWorkflowTextMode = 'unsupported' | 'optional' | 'required';

export interface NimiRuntimeRouteTextGenerateMetadata {
  readonly supportsThinking: boolean;
  readonly traceModeSupport: NimiRuntimeRouteTextGenerateTraceModeSupport;
  readonly supportsImageInput: boolean;
  readonly supportsAudioInput: boolean;
  readonly supportsVideoInput: boolean;
  readonly supportsArtifactRefInput: boolean;
}

export interface NimiRuntimeRouteTextEmbedMetadata {
  readonly dimensions?: number;
  readonly maxInputsPerRequest: number;
  readonly supportsBatch: boolean;
}

export interface NimiRuntimeRouteImageGenerateMetadata {
  readonly supportedResponseFormats: readonly string[];
  readonly maxImagesPerRequest: number;
  readonly supportsNegativePrompt: boolean;
  readonly supportsReferenceImages: boolean;
  readonly supportsMask: boolean;
  readonly supportsSeed: boolean;
  readonly supportsSize: boolean;
  readonly supportsAspectRatio: boolean;
  readonly supportsQuality: boolean;
  readonly supportsStyle: boolean;
  readonly defaultResponseFormat?: string;
  readonly providerExtensionNamespace?: string;
  readonly providerExtensionSchemaVersion?: string;
}

export interface NimiRuntimeRouteSpeechSynthesizeMetadata {
  readonly supportedAudioFormats: readonly string[];
  readonly supportedTimingModes: readonly NimiRuntimeRouteSpeechTimingMode[];
  readonly supportsLanguage: boolean;
  readonly supportsEmotion: boolean;
  readonly defaultAudioFormat?: string;
  readonly voiceRenderHints?: JsonObject;
  readonly providerExtensionNamespace?: string;
  readonly providerExtensionSchemaVersion?: string;
}

export interface NimiRuntimeRouteSpeechTranscribeMetadata {
  readonly tiers: readonly string[];
  readonly supportedResponseFormats: readonly string[];
  readonly supportsLanguage: boolean;
  readonly supportsPrompt: boolean;
  readonly supportsTimestamps: boolean;
  readonly supportsDiarization: boolean;
  readonly maxSpeakerCount?: number;
  readonly providerExtensionNamespace?: string;
  readonly providerExtensionSchemaVersion?: string;
}

export interface NimiRuntimeRouteVoiceWorkflowVoiceCloneMetadata {
  readonly workflowType: 'voice_clone';
  readonly requiresTargetSynthesisBinding: boolean;
  readonly textPromptMode: NimiRuntimeRouteVoiceWorkflowTextMode;
  readonly supportsLanguageHints: boolean;
  readonly supportsPreferredName: boolean;
  readonly referenceAudioUriInput: boolean;
  readonly referenceAudioBytesInput: boolean;
  readonly allowedReferenceAudioMimeTypes: readonly string[];
  readonly providerExtensionNamespace?: string;
  readonly providerExtensionSchemaVersion?: string;
}

export interface NimiRuntimeRouteVoiceWorkflowVoiceDesignMetadata {
  readonly workflowType: 'voice_design';
  readonly requiresTargetSynthesisBinding: boolean;
  readonly instructionTextMode: NimiRuntimeRouteVoiceWorkflowTextMode;
  readonly previewTextMode: NimiRuntimeRouteVoiceWorkflowTextMode;
  readonly supportsLanguage: boolean;
  readonly supportsPreferredName: boolean;
  readonly providerExtensionNamespace?: string;
  readonly providerExtensionSchemaVersion?: string;
}

export type NimiRuntimeRouteDescribeResult =
  | (NimiRuntimeRouteDescribeResultBase & {
      readonly metadataKind: 'text.generate';
      readonly metadata: NimiRuntimeRouteTextGenerateMetadata;
    })
  | (NimiRuntimeRouteDescribeResultBase & {
      readonly metadataKind: 'text.embed';
      readonly metadata: NimiRuntimeRouteTextEmbedMetadata;
    })
  | (NimiRuntimeRouteDescribeResultBase & {
      readonly metadataKind: 'image.generate';
      readonly metadata: NimiRuntimeRouteImageGenerateMetadata;
    })
  | (NimiRuntimeRouteDescribeResultBase & {
      readonly metadataKind: 'audio.synthesize';
      readonly metadata: NimiRuntimeRouteSpeechSynthesizeMetadata;
    })
  | (NimiRuntimeRouteDescribeResultBase & {
      readonly metadataKind: 'audio.transcribe';
      readonly metadata: NimiRuntimeRouteSpeechTranscribeMetadata;
    })
  | (NimiRuntimeRouteDescribeResultBase & {
      readonly metadataKind: 'voice_workflow.voice_clone';
      readonly metadata: NimiRuntimeRouteVoiceWorkflowVoiceCloneMetadata;
    })
  | (NimiRuntimeRouteDescribeResultBase & {
      readonly metadataKind: 'voice_workflow.voice_design';
      readonly metadata: NimiRuntimeRouteVoiceWorkflowVoiceDesignMetadata;
    });

interface NimiRuntimeRouteDescribeResultBase {
  readonly capability: NimiRuntimeCanonicalCapability;
  readonly metadataVersion: NimiRuntimeRouteMetadataVersion;
  readonly resolvedBindingRef: NimiRuntimeRouteResolvedBindingRef;
}

export interface NimiRuntimeRouteDescribeCallOptions {
  readonly metadata?: CoreMetadata;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly responseMetadataObserver?: CoreResponseMetadataObserver;
}

export interface NimiRuntimeRouteDescribeCallOptionsInput {
  readonly targetId: string;
  readonly timeoutMs: number;
  readonly source: NimiRuntimeRouteSource;
  readonly connectorId?: string;
  readonly providerEndpoint?: string;
}

export type NimiRuntimeRouteDescribeCallOptionsBuilder = (
  input: NimiRuntimeRouteDescribeCallOptionsInput,
) => Promise<NimiRuntimeRouteDescribeCallOptions> | NimiRuntimeRouteDescribeCallOptions;

export type NimiRuntimeRouteExecuteScenario = (
  request: ExecuteScenarioRequest,
  options: NimiRuntimeRouteDescribeCallOptions,
) => Promise<unknown>;

export type NimiRuntimeRouteCapabilityOptionsLoader = (input: {
  readonly capability: NimiRuntimeCanonicalCapability;
  readonly targetId?: string;
  readonly selectedTargetRef?: NimiRuntimeRouteTargetRef | null;
}) => Promise<NimiRuntimeRouteOptionsSnapshot> | NimiRuntimeRouteOptionsSnapshot;

export interface NimiRuntimeRouteCapabilityDescribeHost {
  readonly appId: string;
  readonly subjectUserId?: string;
  readonly executeScenario: NimiRuntimeRouteExecuteScenario;
}

export interface NimiRuntimeRouteCapabilityHostRuntimeDeps {
  readonly loadRuntimeRouteOptions: NimiRuntimeRouteCapabilityOptionsLoader;
  readonly checkHealth: (
    request: NimiRuntimeRouteHealthInput,
  ) => Promise<NimiRuntimeRouteHostProviderHealth> | NimiRuntimeRouteHostProviderHealth;
  readonly getDescribeHost: () => NimiRuntimeRouteCapabilityDescribeHost;
  readonly buildDescribeCallOptions: NimiRuntimeRouteDescribeCallOptionsBuilder;
  readonly describeTargetId: string;
  readonly routeOptionsTargetId?: string;
  readonly describeTimeoutMs?: number;
}

export interface NimiRuntimeRouteCapabilityRuntime {
  resolve(input: {
    readonly capability: NimiRuntimeCanonicalCapability;
    readonly targetRef?: NimiRuntimeRouteTargetRef;
  }): Promise<NimiRuntimeResolvedBinding>;
  checkHealth(input: {
    readonly capability: NimiRuntimeCanonicalCapability;
    readonly targetRef?: NimiRuntimeRouteTargetRef;
  }): Promise<NimiRuntimeRouteHealthResult>;
  describe(input: {
    readonly capability: NimiRuntimeCanonicalCapability;
    readonly resolvedBindingRef: string;
  }): Promise<NimiRuntimeRouteDescribeResult>;
}
