import type {
  LocalProviderAdapter,
  LocalProviderHints,
} from './runtime-route-types.js';

export type RuntimeRouteSource = 'local' | 'cloud';
export type RuntimeRouteModelProfileContextSource = 'provider-api' | 'template' | 'default' | 'unknown';
export type RuntimeRouteResolvedBindingRef = string;
export type RuntimeRouteMetadataVersion = 'v1';
export type RuntimeCanonicalCapability =
  | 'text.generate'
  | 'text.embed'
  | 'image.generate'
  | 'video.generate'
  | 'world.generate'
  | 'audio.synthesize'
  | 'audio.transcribe'
  | 'music.generate'
  | 'voice_workflow.voice_clone'
  | 'voice_workflow.voice_design';

export type RuntimeRouteBinding = {
  source: RuntimeRouteSource;
  connectorId: string;
  model: string;
  modelLabel?: string;
  modelId?: string;
  provider?: string;
  localModelId?: string;
  engine?: string;
  adapter?: LocalProviderAdapter;
  providerHints?: LocalProviderHints;
  maxContextTokens?: number;
  maxOutputTokens?: number;
  endpoint?: string;
  localProviderEndpoint?: string;
  localOpenAiEndpoint?: string;
  goRuntimeLocalModelId?: string;
  goRuntimeStatus?: 'installed' | 'active' | 'unhealthy' | 'removed' | string;
};

export type RuntimeResolvedBinding = RuntimeRouteBinding & {
  capability: RuntimeCanonicalCapability;
  resolvedBindingRef?: RuntimeRouteResolvedBindingRef;
};

export type RuntimeRouteMetadataKind =
  | 'text.generate'
  | 'audio.synthesize'
  | 'audio.transcribe'
  | 'voice_workflow.voice_clone'
  | 'voice_workflow.voice_design';

export type TextGenerateRouteMetadata = {
  supportsThinking: boolean;
  traceModeSupport: 'none' | 'hide' | 'separate';
  supportsImageInput: boolean;
  supportsAudioInput: boolean;
  supportsVideoInput: boolean;
  supportsArtifactRefInput: boolean;
};

export type RuntimeNumericRange = {
  min: number;
  max: number;
};

export type SpeechSynthesizeVoiceRenderHintsRouteMetadata = {
  stability?: RuntimeNumericRange;
  similarityBoost?: RuntimeNumericRange;
  style?: RuntimeNumericRange;
  speed?: RuntimeNumericRange;
  useSpeakerBoost?: boolean;
};

export type SpeechSynthesizeRouteMetadata = {
  supportedAudioFormats: string[];
  defaultAudioFormat?: string;
  supportedTimingModes: Array<'none' | 'word' | 'char'>;
  supportsLanguage: boolean;
  supportsEmotion: boolean;
  voiceRenderHints?: SpeechSynthesizeVoiceRenderHintsRouteMetadata;
  providerExtensionNamespace?: string;
  providerExtensionSchemaVersion?: string;
};

export type SpeechTranscribeRouteMetadata = {
  tiers: string[];
  supportedResponseFormats: string[];
  supportsLanguage: boolean;
  supportsPrompt: boolean;
  supportsTimestamps: boolean;
  supportsDiarization: boolean;
  maxSpeakerCount?: number;
  providerExtensionNamespace?: string;
  providerExtensionSchemaVersion?: string;
};

export type VoiceWorkflowFieldMode = 'unsupported' | 'optional' | 'required';

export type VoiceWorkflowVoiceCloneRouteMetadata = {
  workflowType: 'voice_clone';
  requiresTargetSynthesisBinding: boolean;
  textPromptMode: VoiceWorkflowFieldMode;
  supportsLanguageHints: boolean;
  supportsPreferredName: boolean;
  referenceAudioUriInput: boolean;
  referenceAudioBytesInput: boolean;
  allowedReferenceAudioMimeTypes: string[];
  providerExtensionNamespace?: string;
  providerExtensionSchemaVersion?: string;
};

export type VoiceWorkflowVoiceDesignRouteMetadata = {
  workflowType: 'voice_design';
  requiresTargetSynthesisBinding: boolean;
  instructionTextMode: VoiceWorkflowFieldMode;
  previewTextMode: VoiceWorkflowFieldMode;
  supportsLanguage: boolean;
  supportsPreferredName: boolean;
  providerExtensionNamespace?: string;
  providerExtensionSchemaVersion?: string;
};

export type RuntimeRouteDescribeResult =
  | {
    capability: 'text.generate';
    metadataVersion: RuntimeRouteMetadataVersion;
    resolvedBindingRef: RuntimeRouteResolvedBindingRef;
    metadataKind: 'text.generate';
    metadata: TextGenerateRouteMetadata;
  }
  | {
    capability: 'audio.synthesize';
    metadataVersion: RuntimeRouteMetadataVersion;
    resolvedBindingRef: RuntimeRouteResolvedBindingRef;
    metadataKind: 'audio.synthesize';
    metadata: SpeechSynthesizeRouteMetadata;
  }
  | {
    capability: 'audio.transcribe';
    metadataVersion: RuntimeRouteMetadataVersion;
    resolvedBindingRef: RuntimeRouteResolvedBindingRef;
    metadataKind: 'audio.transcribe';
    metadata: SpeechTranscribeRouteMetadata;
  }
  | {
    capability: 'voice_workflow.voice_clone';
    metadataVersion: RuntimeRouteMetadataVersion;
    resolvedBindingRef: RuntimeRouteResolvedBindingRef;
    metadataKind: 'voice_workflow.voice_clone';
    metadata: VoiceWorkflowVoiceCloneRouteMetadata;
  }
  | {
    capability: 'voice_workflow.voice_design';
    metadataVersion: RuntimeRouteMetadataVersion;
    resolvedBindingRef: RuntimeRouteResolvedBindingRef;
    metadataKind: 'voice_workflow.voice_design';
    metadata: VoiceWorkflowVoiceDesignRouteMetadata;
  };

export const RUNTIME_ROUTE_DESCRIBE_RESULT_RESPONSE_METADATA_KEY = 'x-nimi-route-describe-result';

export type RuntimeRouteModelProfile = {
  model: string;
  maxContextTokens?: number;
  maxOutputTokens?: number;
  contextSource?: RuntimeRouteModelProfileContextSource;
};

export type RuntimeRouteConnectorOption = {
  id: string;
  label: string;
  vendor?: string;
  provider?: string;
  models: string[];
  modelCapabilities?: Record<string, string[]>;
  modelProfiles?: RuntimeRouteModelProfile[];
};

export type RuntimeRouteLocalOption = {
  localModelId: string;
  label?: string;
  engine?: string;
  model: string;
  modelId?: string;
  provider?: string;
  adapter?: LocalProviderAdapter;
  providerHints?: LocalProviderHints;
  endpoint?: string;
  status?: 'installed' | 'active' | 'unhealthy' | 'removed' | string;
  goRuntimeLocalModelId?: string;
  goRuntimeStatus?: 'installed' | 'active' | 'unhealthy' | 'removed' | string;
  capabilities?: string[];
};

export type RuntimeRouteOptionsSnapshot = {
  capability?: RuntimeCanonicalCapability;
  selected: RuntimeRouteBinding | null;
  local: {
    models: RuntimeRouteLocalOption[];
    defaultEndpoint?: string;
  };
  connectors: RuntimeRouteConnectorOption[];
};

export type RuntimeRouteExecutionCallTarget = {
  source: RuntimeRouteSource;
  routePolicy: 1 | 2;
  modelId: string;
  provider: string;
  adapter: LocalProviderAdapter;
  endpoint: string;
  connectorId?: string;
  localModelId?: string;
  goRuntimeLocalModelId?: string;
  engine?: string;
};

export type RuntimeRouteLocalWarmCandidate = {
  localAssetId: string;
  assetId: string;
  engine: string;
  endpoint: string;
  updatedAt: string;
  status: number;
};

export type RuntimeRouteLocalWarmAssetEvidence = {
  localAssetId?: unknown;
  assetId?: unknown;
  engine?: unknown;
  endpoint?: unknown;
  updatedAt?: unknown;
  status?: unknown;
};

export function normalizeRuntimeRouteSource(value: unknown): RuntimeRouteSource {
  return String(value || '').trim() === 'cloud' ? 'cloud' : 'local';
}

export function normalizeRuntimeRouteModelRoot(model: unknown): string {
  const normalized = String(model || '').trim();
  if (!normalized) return '';
  const lower = normalized.toLowerCase();
  for (const prefix of ['llama/', 'media/', 'speech/', 'sidecar/', 'local/', 'cloud/', 'token/']) {
    if (lower.startsWith(prefix)) {
      return normalized.slice(prefix.length).trim();
    }
  }
  return normalized;
}

export function normalizeRuntimeRouteEngineEvidence(value: unknown): string {
  const normalized = String(value || '').trim().toLowerCase();
  if (
    normalized === 'llama'
    || normalized === 'media'
    || normalized === 'speech'
    || normalized === 'sidecar'
  ) {
    return normalized;
  }
  return '';
}
