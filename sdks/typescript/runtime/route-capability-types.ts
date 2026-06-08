import type { ExecuteScenarioRequest } from '../core-generated/runtime-typed-client';
import type { CoreMetadata, CoreResponseMetadataObserver, JsonObject } from '../types';
import type {
  NimiRuntimeCanonicalCapability,
  NimiRuntimeRouteBinding,
  NimiRuntimeRouteOptionsSnapshot,
  NimiRuntimeRouteSource,
} from './route-options';

export const NIMI_RUNTIME_ROUTE_DESCRIBE_RESULT_RESPONSE_METADATA_KEY = 'x-nimi-route-describe-result';
export const NIMI_RUNTIME_ROUTE_DESCRIBE_TIMEOUT_MS = 30_000;

export type NimiRuntimeRouteResolvedBindingRef = string;
export type NimiRuntimeRouteMetadataVersion = 'v1';

export interface NimiRuntimeResolvedBinding extends NimiRuntimeRouteBinding {
  readonly capability: NimiRuntimeCanonicalCapability;
  readonly resolvedBindingRef?: NimiRuntimeRouteResolvedBindingRef;
}

export interface NimiRuntimeRouteHealthInput {
  readonly provider: string;
  readonly capability?: string;
  readonly localProviderEndpoint?: string;
  readonly localProviderModel?: string;
  readonly localOpenAiEndpoint?: string;
  readonly localModelId?: string;
  readonly goRuntimeLocalModelId?: string;
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
  readonly selectedBinding?: NimiRuntimeRouteBinding | null;
}) => Promise<NimiRuntimeRouteOptionsSnapshot> | NimiRuntimeRouteOptionsSnapshot;

export interface NimiRuntimeRouteCapabilityDescribeHost {
  readonly appId: string;
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
    readonly binding?: NimiRuntimeRouteBinding;
  }): Promise<NimiRuntimeResolvedBinding>;
  checkHealth(input: {
    readonly capability: NimiRuntimeCanonicalCapability;
    readonly binding?: NimiRuntimeRouteBinding;
  }): Promise<NimiRuntimeRouteHealthResult>;
  describe(input: {
    readonly capability: NimiRuntimeCanonicalCapability;
    readonly resolvedBindingRef: string;
  }): Promise<NimiRuntimeRouteDescribeResult>;
}
