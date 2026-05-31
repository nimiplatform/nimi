import { asRecord } from '../internal/utils.js';
import {
  DEFAULT_LOCAL_PROVIDER_ADAPTER_ID,
  normalizeLocalProviderAdapterId,
  type LocalProviderAdapter,
  type LocalProviderHints,
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

function normalizeRuntimeRouteEngineEvidence(value: unknown): string {
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

function routeBindingKey(input: RuntimeRouteBinding | null | undefined): string {
  if (!input) return '';
  return [
    String(input.source || '').trim(),
    String(input.connectorId || '').trim(),
    String(input.modelId || input.model || '').trim(),
    String(input.localModelId || input.goRuntimeLocalModelId || '').trim(),
    String(input.engine || input.provider || '').trim(),
  ].join('|');
}

function sameRuntimeLocalBindingRoute(left: RuntimeRouteBinding, right: RuntimeRouteBinding): boolean {
  if (left.source !== 'local' || right.source !== 'local') {
    return false;
  }
  const leftLocalModelId = String(left.localModelId || left.goRuntimeLocalModelId || '').trim();
  const rightLocalModelId = String(right.localModelId || right.goRuntimeLocalModelId || '').trim();
  if (leftLocalModelId && rightLocalModelId) {
    return leftLocalModelId === rightLocalModelId;
  }
  const leftModel = normalizeRuntimeRouteModelRoot(left.modelId || left.model);
  const rightModel = normalizeRuntimeRouteModelRoot(right.modelId || right.model);
  if (!leftModel || !rightModel || leftModel !== rightModel) {
    return false;
  }
  const leftEngine = normalizeRuntimeRouteEngineEvidence(left.engine || left.provider);
  const rightEngine = normalizeRuntimeRouteEngineEvidence(right.engine || right.provider);
  return Boolean(leftEngine && rightEngine && leftEngine === rightEngine);
}

function sameRuntimeCloudBindingRoute(left: RuntimeRouteBinding, right: RuntimeRouteBinding): boolean {
  if (left.source !== 'cloud' || right.source !== 'cloud') {
    return false;
  }
  const leftConnectorId = String(left.connectorId || '').trim();
  const rightConnectorId = String(right.connectorId || '').trim();
  const leftModel = String(left.modelId || left.model || '').trim();
  const rightModel = String(right.modelId || right.model || '').trim();
  return Boolean(leftConnectorId && rightConnectorId && leftConnectorId === rightConnectorId && leftModel && rightModel && leftModel === rightModel);
}

function sameRuntimeBindingRoute(left: RuntimeRouteBinding, right: RuntimeRouteBinding): boolean {
  return sameRuntimeLocalBindingRoute(left, right) || sameRuntimeCloudBindingRoute(left, right);
}

function localOptionToBinding(option: RuntimeRouteLocalOption): RuntimeRouteBinding {
  const modelId = String(option.modelId || option.model || '').trim();
  return {
    source: 'local',
    connectorId: '',
    model: modelId,
    modelId: modelId || undefined,
    provider: String(option.provider || option.engine || '').trim() || undefined,
    localModelId: String(option.localModelId || '').trim() || undefined,
    engine: String(option.engine || '').trim() || undefined,
    adapter: option.adapter,
    providerHints: option.providerHints,
    endpoint: String(option.endpoint || '').trim() || undefined,
    goRuntimeLocalModelId: String(option.goRuntimeLocalModelId || '').trim() || undefined,
    goRuntimeStatus: String(option.goRuntimeStatus || '').trim() || undefined,
  };
}

function findRuntimeLocalEvidence(
  binding: RuntimeRouteBinding,
  localModels: RuntimeRouteLocalOption[],
): RuntimeRouteBinding | null {
  const bindingLocalModelId = String(binding.localModelId || binding.goRuntimeLocalModelId || '').trim();
  if (bindingLocalModelId) {
    const byLocalModelId = localModels.find((item) => (
      String(item.localModelId || item.goRuntimeLocalModelId || '').trim() === bindingLocalModelId
    )) || null;
    if (byLocalModelId) return localOptionToBinding(byLocalModelId);
  }

  const bindingModelRoot = normalizeRuntimeRouteModelRoot(binding.modelId || binding.model);
  const bindingEngine = normalizeRuntimeRouteEngineEvidence(binding.engine || binding.provider);
  if (!bindingModelRoot || !bindingEngine) return null;

  const byModelAndEngine = localModels.find((item) => (
    normalizeRuntimeRouteModelRoot(item.modelId || item.model) === bindingModelRoot
    && normalizeRuntimeRouteEngineEvidence(item.engine || item.provider) === bindingEngine
  )) || null;
  return byModelAndEngine ? localOptionToBinding(byModelAndEngine) : null;
}

function findRuntimeCloudEvidence(
  binding: RuntimeRouteBinding,
  connectors: RuntimeRouteConnectorOption[],
): RuntimeRouteBinding | null {
  const connectorId = String(binding.connectorId || '').trim();
  const model = String(binding.modelId || binding.model || '').trim();
  if (!connectorId || !model) return null;
  const connector = connectors.find((item) => String(item.id || '').trim() === connectorId) || null;
  if (!connector || !connector.models.includes(model)) return null;
  return {
    ...binding,
    source: 'cloud',
    connectorId,
    model,
    modelId: model,
    provider: String(binding.provider || connector.provider || '').trim() || undefined,
  };
}

function runtimeResolvedBindingRefFor(
  capability: RuntimeCanonicalCapability,
  binding: RuntimeRouteBinding,
): string {
  if (binding.source === 'cloud') {
    return [
      'cloud',
      capability,
      encodeURIComponent(String(binding.connectorId || '').trim()),
      encodeURIComponent(String(binding.modelId || binding.model || '').trim()),
    ].join(':');
  }
  return [
    'local',
    capability,
    encodeURIComponent(normalizeRuntimeRouteEngineEvidence(binding.engine || binding.provider)),
    encodeURIComponent(String(binding.localModelId || binding.goRuntimeLocalModelId || binding.modelId || binding.model || '').trim()),
  ].join(':');
}

function resolveRuntimeLocalBinding(
  capability: RuntimeCanonicalCapability,
  binding: RuntimeRouteBinding,
): RuntimeResolvedBinding {
  const modelId = normalizeRuntimeRouteModelRoot(binding.modelId || binding.model || binding.localModelId || '');
  const engine = normalizeRuntimeRouteEngineEvidence(binding.engine || binding.provider);
  if (!modelId) {
    throw new Error('RUNTIME_ROUTE_BINDING_MODEL_REQUIRED');
  }
  if (!engine) {
    throw new Error('RUNTIME_ROUTE_BINDING_ENGINE_REQUIRED');
  }
  const localModelId = String(binding.localModelId || binding.goRuntimeLocalModelId || '').trim();
  if (!localModelId) {
    throw new Error('RUNTIME_ROUTE_BINDING_LOCAL_MODEL_REQUIRED');
  }
  return {
    ...binding,
    capability,
    source: 'local',
    connectorId: '',
    provider: String(binding.provider || '').trim() || engine,
    engine,
    model: modelId,
    modelId,
    localModelId,
    endpoint: String(binding.endpoint || binding.localProviderEndpoint || binding.localOpenAiEndpoint || '').trim() || undefined,
    localProviderEndpoint: String(binding.localProviderEndpoint || binding.endpoint || '').trim() || undefined,
    localOpenAiEndpoint: String(binding.localOpenAiEndpoint || binding.endpoint || '').trim() || undefined,
    goRuntimeLocalModelId: String(binding.goRuntimeLocalModelId || binding.localModelId || '').trim() || undefined,
    goRuntimeStatus: String(binding.goRuntimeStatus || '').trim() || undefined,
    resolvedBindingRef: runtimeResolvedBindingRefFor(capability, binding),
  } as RuntimeResolvedBinding;
}

function resolveRuntimeCloudBinding(
  capability: RuntimeCanonicalCapability,
  binding: RuntimeRouteBinding,
): RuntimeResolvedBinding {
  const connectorId = String(binding.connectorId || '').trim();
  const provider = String(binding.provider || '').trim();
  const modelId = String(binding.modelId || binding.model || '').trim();
  if (!connectorId) {
    throw new Error('RUNTIME_ROUTE_BINDING_CONNECTOR_REQUIRED');
  }
  if (!provider) {
    throw new Error('RUNTIME_ROUTE_BINDING_PROVIDER_REQUIRED');
  }
  if (!modelId) {
    throw new Error('RUNTIME_ROUTE_BINDING_MODEL_REQUIRED');
  }
  return {
    ...binding,
    capability,
    source: 'cloud',
    connectorId,
    provider,
    model: modelId,
    modelId,
    endpoint: String(binding.endpoint || '').trim() || undefined,
    resolvedBindingRef: runtimeResolvedBindingRefFor(capability, binding),
  } as RuntimeResolvedBinding;
}

export function resolveRuntimeRouteBindingFromSnapshot(input: {
  capability: RuntimeCanonicalCapability;
  binding: RuntimeRouteBinding | null | undefined;
  snapshot: RuntimeRouteOptionsSnapshot;
}): RuntimeResolvedBinding {
  const binding = input.binding;
  if (!binding) {
    throw new Error('RUNTIME_ROUTE_BINDING_REQUIRED');
  }
  const selected = input.snapshot.selected && sameRuntimeBindingRoute(binding, input.snapshot.selected)
    ? input.snapshot.selected
    : null;
  const candidate = selected || binding;
  const evidence = candidate.source === 'cloud'
    ? findRuntimeCloudEvidence(candidate, input.snapshot.connectors)
    : findRuntimeLocalEvidence(candidate, input.snapshot.local.models);
  if (!evidence) {
    throw new Error(candidate.source === 'cloud'
      ? 'RUNTIME_ROUTE_CLOUD_EVIDENCE_REQUIRED'
      : 'RUNTIME_ROUTE_LOCAL_EVIDENCE_REQUIRED');
  }
  return evidence.source === 'cloud'
    ? resolveRuntimeCloudBinding(input.capability, evidence)
    : resolveRuntimeLocalBinding(input.capability, evidence);
}

function ensureRuntimeRoutePrefixedModelId(prefix: string, model: unknown): string {
  const modelRoot = normalizeRuntimeRouteModelRoot(model);
  if (!modelRoot) {
    throw new Error('RUNTIME_ROUTE_BINDING_MODEL_REQUIRED');
  }
  return `${prefix}/${modelRoot}`;
}

export function runtimeRouteCallTargetFromResolvedBinding(
  resolved: RuntimeResolvedBinding,
): RuntimeRouteExecutionCallTarget {
  if (resolved.source === 'cloud') {
    const connectorId = String(resolved.connectorId || '').trim();
    const provider = String(resolved.provider || '').trim();
    if (!connectorId) throw new Error('RUNTIME_ROUTE_BINDING_CONNECTOR_REQUIRED');
    if (!provider) throw new Error('RUNTIME_ROUTE_BINDING_PROVIDER_REQUIRED');
    return {
      source: 'cloud',
      routePolicy: 2,
      modelId: ensureRuntimeRoutePrefixedModelId('cloud', resolved.modelId || resolved.model),
      provider,
      adapter: resolved.adapter || DEFAULT_LOCAL_PROVIDER_ADAPTER_ID,
      endpoint: String(resolved.endpoint || '').trim(),
      connectorId,
    };
  }

  const engine = normalizeRuntimeRouteEngineEvidence(resolved.engine || resolved.provider);
  if (!engine) throw new Error('RUNTIME_ROUTE_BINDING_ENGINE_REQUIRED');
  const localModelId = String(resolved.localModelId || '').trim();
  const goRuntimeLocalModelId = String(resolved.goRuntimeLocalModelId || resolved.localModelId || '').trim();
  if (!localModelId && !goRuntimeLocalModelId) {
    throw new Error('RUNTIME_ROUTE_BINDING_LOCAL_MODEL_REQUIRED');
  }
  return {
    source: 'local',
    routePolicy: 1,
    modelId: ensureRuntimeRoutePrefixedModelId(engine, resolved.modelId || resolved.model || resolved.localModelId),
    provider: String(resolved.provider || '').trim() || engine,
    adapter: resolved.adapter || DEFAULT_LOCAL_PROVIDER_ADAPTER_ID,
    endpoint: String(resolved.localProviderEndpoint || resolved.localOpenAiEndpoint || resolved.endpoint || '').trim(),
    localModelId: localModelId || undefined,
    goRuntimeLocalModelId: goRuntimeLocalModelId || undefined,
    engine,
  };
}

export function selectRuntimeLocalWarmCandidateFromResolvedBinding(input: {
  resolved: RuntimeResolvedBinding;
  assets: RuntimeRouteLocalWarmAssetEvidence[];
}): RuntimeRouteLocalWarmCandidate | null {
  if (input.resolved.source !== 'local') {
    return null;
  }
  const targetLocalModelId = String(input.resolved.goRuntimeLocalModelId || input.resolved.localModelId || '').trim();
  const targetModelRoot = normalizeRuntimeRouteModelRoot(input.resolved.modelId || input.resolved.model);
  const targetEndpoint = String(input.resolved.localProviderEndpoint || input.resolved.localOpenAiEndpoint || input.resolved.endpoint || '').trim();
  const targetEngine = normalizeRuntimeRouteEngineEvidence(input.resolved.engine || input.resolved.provider);
  if (!targetLocalModelId && (!targetModelRoot || !targetEngine)) {
    throw new Error('RUNTIME_ROUTE_BINDING_LOCAL_EVIDENCE_REQUIRED');
  }

  const candidates = input.assets
    .map((item) => ({
      localAssetId: String(item.localAssetId || '').trim(),
      assetId: String(item.assetId || '').trim(),
      engine: String(item.engine || '').trim(),
      endpoint: String(item.endpoint || '').trim(),
      updatedAt: String(item.updatedAt || '').trim(),
      status: Number(item.status || 0),
    }))
    .filter((item) => item.localAssetId && item.assetId && item.status !== 4);

  if (targetLocalModelId) {
    const direct = candidates.find((item) => item.localAssetId === targetLocalModelId) || null;
    if (direct) return direct;
  }

  const scored = candidates
    .filter((item) => normalizeRuntimeRouteModelRoot(item.assetId) === targetModelRoot)
    .filter((item) => normalizeRuntimeRouteEngineEvidence(item.engine) === targetEngine)
    .map((item) => {
      let score = 0;
      if (targetEndpoint && item.endpoint === targetEndpoint) score += 4;
      if (item.status === 2) score += 1;
      return { item, score };
    })
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return left.item.localAssetId.localeCompare(right.item.localAssetId);
    });

  return scored[0]?.item || null;
}

export function parseRuntimeCanonicalCapability(value: unknown): RuntimeCanonicalCapability | null {
  const normalized = String(value || '').trim();
  if (
    normalized === 'text.generate'
    || normalized === 'text.embed'
    || normalized === 'image.generate'
    || normalized === 'video.generate'
    || normalized === 'world.generate'
    || normalized === 'audio.synthesize'
    || normalized === 'audio.transcribe'
    || normalized === 'music.generate'
    || normalized === 'voice_workflow.voice_clone'
    || normalized === 'voice_workflow.voice_design'
  ) {
    return normalized;
  }
  // Runtime keeps `music` as a coarse runtime-only token until the music
  // product surface gets its own canonical identity.
  if (normalized === 'music') return 'music.generate';
  return null;
}

export function parseRuntimeRouteMetadataKind(value: unknown): RuntimeRouteMetadataKind | null {
  const capability = parseRuntimeCanonicalCapability(value);
  if (
    capability === 'text.generate'
    || capability === 'audio.synthesize'
    || capability === 'audio.transcribe'
    || capability === 'voice_workflow.voice_clone'
    || capability === 'voice_workflow.voice_design'
  ) {
    return capability;
  }
  return null;
}

export function parseRuntimeRouteBinding(value: unknown): RuntimeRouteBinding | null {
  if (!value || typeof value !== 'object') return null;
  const record = asRecord(value);
  return {
    source: normalizeRuntimeRouteSource(record.source),
    connectorId: String(record.connectorId || ''),
    model: String(record.model || ''),
    modelLabel: String(record.modelLabel || '').trim() || undefined,
    modelId: String(record.modelId || '').trim() || undefined,
    provider: String(record.provider || '').trim() || undefined,
    localModelId: String(record.localModelId || '').trim() || undefined,
    engine: String(record.engine || '').trim() || undefined,
    adapter: normalizeLocalProviderAdapterId(record.adapter),
    providerHints: record.providerHints && typeof record.providerHints === 'object' && !Array.isArray(record.providerHints)
      ? record.providerHints as LocalProviderHints
      : undefined,
    endpoint: String(record.endpoint || '').trim() || undefined,
    goRuntimeLocalModelId: String(record.goRuntimeLocalModelId || '').trim() || undefined,
    goRuntimeStatus: String(record.goRuntimeStatus || '').trim() || undefined,
  };
}

function toPositiveInt(value: unknown): number | undefined {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return undefined;
  const rounded = Math.floor(numeric);
  return rounded > 0 ? rounded : undefined;
}

function normalizeContextSource(value: unknown): RuntimeRouteModelProfileContextSource | undefined {
  const normalized = String(value || '').trim();
  if (
    normalized === 'provider-api'
    || normalized === 'template'
    || normalized === 'default'
    || normalized === 'unknown'
  ) {
    return normalized;
  }
  return undefined;
}

function parseRuntimeRouteModelProfiles(value: unknown): RuntimeRouteModelProfile[] {
  if (!Array.isArray(value)) return [];
  const deduped = new Set<string>();
  const parsed: RuntimeRouteModelProfile[] = [];
  for (const item of value) {
    const record = asRecord(item);
    const model = String(record.model || record.id || '').trim();
    if (!model) continue;
    const dedupeKey = model.toLowerCase();
    if (deduped.has(dedupeKey)) continue;
    deduped.add(dedupeKey);
    const maxContextTokens = toPositiveInt(record.maxContextTokens);
    const maxOutputTokens = toPositiveInt(record.maxOutputTokens);
    const contextSource = normalizeContextSource(record.contextSource);
    parsed.push({
      model,
      ...(typeof maxContextTokens === 'number' ? { maxContextTokens } : {}),
      ...(typeof maxOutputTokens === 'number' ? { maxOutputTokens } : {}),
      ...(contextSource ? { contextSource } : {}),
    });
  }
  return parsed;
}

function parseRuntimeRouteConnectorModelCapabilities(value: unknown): Record<string, string[]> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const rawRecord = asRecord(value);
  const normalized: Record<string, string[]> = {};
  for (const [rawModelId, rawCapabilities] of Object.entries(rawRecord)) {
    const modelId = String(rawModelId || '').trim();
    if (!modelId) continue;
    const capabilities = Array.isArray(rawCapabilities)
      ? rawCapabilities.map((capability) => String(capability || '').trim()).filter(Boolean)
      : [];
    if (capabilities.length === 0) continue;
    normalized[modelId] = capabilities;
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function parseLocalModels(value: unknown): RuntimeRouteLocalOption[] {
  if (!Array.isArray(value)) return [];
  const deduped = new Set<string>();
  const models: RuntimeRouteLocalOption[] = [];
  for (const item of value) {
    const record = asRecord(item);
    const localModelId = String(record.localModelId || record.id || '').trim();
    if (!localModelId) continue;
    const dedupeKey = localModelId.toLowerCase();
    if (deduped.has(dedupeKey)) continue;
    deduped.add(dedupeKey);

    const model = String(record.model || record.name || '').trim() || localModelId;
    models.push({
      localModelId,
      label: String(record.label || '').trim() || undefined,
      engine: String(record.engine || '').trim() || undefined,
      model,
      modelId: String(record.modelId || '').trim() || undefined,
      provider: String(record.provider || '').trim() || undefined,
      adapter: normalizeLocalProviderAdapterId(record.adapter),
      providerHints: record.providerHints && typeof record.providerHints === 'object' && !Array.isArray(record.providerHints)
        ? record.providerHints as LocalProviderHints
        : undefined,
      endpoint: String(record.endpoint || '').trim() || undefined,
      status: String(record.status || '').trim() || undefined,
      goRuntimeLocalModelId: String(record.goRuntimeLocalModelId || '').trim() || undefined,
      goRuntimeStatus: String(record.goRuntimeStatus || '').trim() || undefined,
      capabilities: Array.isArray(record.capabilities)
        ? record.capabilities.map((capability) => String(capability || '').trim()).filter(Boolean)
        : undefined,
    });
  }
  return models;
}

function parseTextGenerateRouteMetadata(value: unknown): TextGenerateRouteMetadata | null {
  const record = asRecord(value);
  const traceModeSupport = String(record.traceModeSupport || '').trim();
  if (
    typeof record.supportsThinking !== 'boolean'
    || typeof record.supportsImageInput !== 'boolean'
    || typeof record.supportsAudioInput !== 'boolean'
    || typeof record.supportsVideoInput !== 'boolean'
    || typeof record.supportsArtifactRefInput !== 'boolean'
    || (
      traceModeSupport !== 'none'
      && traceModeSupport !== 'hide'
      && traceModeSupport !== 'separate'
    )
  ) {
    return null;
  }
  return {
    supportsThinking: record.supportsThinking,
    traceModeSupport,
    supportsImageInput: record.supportsImageInput,
    supportsAudioInput: record.supportsAudioInput,
    supportsVideoInput: record.supportsVideoInput,
    supportsArtifactRefInput: record.supportsArtifactRefInput,
  };
}

function parseRuntimeNumericRange(value: unknown): RuntimeNumericRange | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const record = asRecord(value);
  const min = Number(record.min);
  const max = Number(record.max);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) {
    return undefined;
  }
  return { min, max };
}

function parseSpeechSynthesizeRouteMetadata(value: unknown): SpeechSynthesizeRouteMetadata | null {
  const record = asRecord(value);
  const supportedAudioFormats = Array.isArray(record.supportedAudioFormats)
    ? record.supportedAudioFormats.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  const supportedTimingModesRaw = Array.isArray(record.supportedTimingModes)
    ? record.supportedTimingModes.map((item) => String(item || '').trim())
    : [];
  const supportedTimingModes = supportedTimingModesRaw.filter((mode): mode is 'none' | 'word' | 'char' => (
    mode === 'none' || mode === 'word' || mode === 'char'
  ));
  if (
    supportedAudioFormats.length === 0
    || supportedTimingModes.length !== supportedTimingModesRaw.length
    || supportedTimingModes.length === 0
    || typeof record.supportsLanguage !== 'boolean'
    || typeof record.supportsEmotion !== 'boolean'
  ) {
    return null;
  }
  const hintsRecord = asRecord(record.voiceRenderHints);
  const voiceRenderHints: SpeechSynthesizeVoiceRenderHintsRouteMetadata = {};
  const stability = parseRuntimeNumericRange(hintsRecord.stability);
  const similarityBoost = parseRuntimeNumericRange(hintsRecord.similarityBoost);
  const style = parseRuntimeNumericRange(hintsRecord.style);
  const speed = parseRuntimeNumericRange(hintsRecord.speed);
  if (stability) {
    voiceRenderHints.stability = stability;
  }
  if (similarityBoost) {
    voiceRenderHints.similarityBoost = similarityBoost;
  }
  if (style) {
    voiceRenderHints.style = style;
  }
  if (speed) {
    voiceRenderHints.speed = speed;
  }
  if (typeof hintsRecord.useSpeakerBoost === 'boolean') {
    voiceRenderHints.useSpeakerBoost = hintsRecord.useSpeakerBoost;
  }
  return {
    supportedAudioFormats,
    defaultAudioFormat: String(record.defaultAudioFormat || '').trim() || undefined,
    supportedTimingModes,
    supportsLanguage: record.supportsLanguage,
    supportsEmotion: record.supportsEmotion,
    ...(Object.keys(voiceRenderHints).length > 0 ? { voiceRenderHints } : {}),
    providerExtensionNamespace: String(record.providerExtensionNamespace || '').trim() || undefined,
    providerExtensionSchemaVersion: String(record.providerExtensionSchemaVersion || '').trim() || undefined,
  };
}

function parseSpeechTranscribeRouteMetadata(value: unknown): SpeechTranscribeRouteMetadata | null {
  const record = asRecord(value);
  const tiers = Array.isArray(record.tiers)
    ? record.tiers.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  const supportedResponseFormats = Array.isArray(record.supportedResponseFormats)
    ? record.supportedResponseFormats.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  const maxSpeakerCountNumeric = Number(record.maxSpeakerCount);
  if (
    tiers.length === 0
    || supportedResponseFormats.length === 0
    || typeof record.supportsLanguage !== 'boolean'
    || typeof record.supportsPrompt !== 'boolean'
    || typeof record.supportsTimestamps !== 'boolean'
    || typeof record.supportsDiarization !== 'boolean'
    || (
      String(record.maxSpeakerCount || '').trim() !== ''
      && (!Number.isFinite(maxSpeakerCountNumeric) || maxSpeakerCountNumeric < 0)
    )
  ) {
    return null;
  }
  return {
    tiers,
    supportedResponseFormats,
    supportsLanguage: record.supportsLanguage,
    supportsPrompt: record.supportsPrompt,
    supportsTimestamps: record.supportsTimestamps,
    supportsDiarization: record.supportsDiarization,
    ...(Number.isFinite(maxSpeakerCountNumeric) && maxSpeakerCountNumeric > 0 ? { maxSpeakerCount: maxSpeakerCountNumeric } : {}),
    providerExtensionNamespace: String(record.providerExtensionNamespace || '').trim() || undefined,
    providerExtensionSchemaVersion: String(record.providerExtensionSchemaVersion || '').trim() || undefined,
  };
}

function parseVoiceWorkflowVoiceCloneRouteMetadata(value: unknown): VoiceWorkflowVoiceCloneRouteMetadata | null {
  const record = asRecord(value);
  const textPromptMode = String(record.textPromptMode || '').trim();
  const allowedReferenceAudioMimeTypes = Array.isArray(record.allowedReferenceAudioMimeTypes)
    ? record.allowedReferenceAudioMimeTypes.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  if (
    record.workflowType !== 'voice_clone'
    || (textPromptMode !== 'unsupported' && textPromptMode !== 'optional' && textPromptMode !== 'required')
    || typeof record.requiresTargetSynthesisBinding !== 'boolean'
    || typeof record.supportsLanguageHints !== 'boolean'
    || typeof record.supportsPreferredName !== 'boolean'
    || typeof record.referenceAudioUriInput !== 'boolean'
    || typeof record.referenceAudioBytesInput !== 'boolean'
    || allowedReferenceAudioMimeTypes.length === 0
  ) {
    return null;
  }
  return {
    workflowType: 'voice_clone',
    requiresTargetSynthesisBinding: record.requiresTargetSynthesisBinding,
    textPromptMode,
    supportsLanguageHints: record.supportsLanguageHints,
    supportsPreferredName: record.supportsPreferredName,
    referenceAudioUriInput: record.referenceAudioUriInput,
    referenceAudioBytesInput: record.referenceAudioBytesInput,
    allowedReferenceAudioMimeTypes,
    providerExtensionNamespace: String(record.providerExtensionNamespace || '').trim() || undefined,
    providerExtensionSchemaVersion: String(record.providerExtensionSchemaVersion || '').trim() || undefined,
  };
}

function parseVoiceWorkflowVoiceDesignRouteMetadata(value: unknown): VoiceWorkflowVoiceDesignRouteMetadata | null {
  const record = asRecord(value);
  const instructionTextMode = String(record.instructionTextMode || '').trim();
  const previewTextMode = String(record.previewTextMode || '').trim();
  if (
    record.workflowType !== 'voice_design'
    || typeof record.requiresTargetSynthesisBinding !== 'boolean'
    || (instructionTextMode !== 'unsupported' && instructionTextMode !== 'optional' && instructionTextMode !== 'required')
    || (previewTextMode !== 'unsupported' && previewTextMode !== 'optional' && previewTextMode !== 'required')
    || typeof record.supportsLanguage !== 'boolean'
    || typeof record.supportsPreferredName !== 'boolean'
  ) {
    return null;
  }
  return {
    workflowType: 'voice_design',
    requiresTargetSynthesisBinding: record.requiresTargetSynthesisBinding,
    instructionTextMode,
    previewTextMode,
    supportsLanguage: record.supportsLanguage,
    supportsPreferredName: record.supportsPreferredName,
    providerExtensionNamespace: String(record.providerExtensionNamespace || '').trim() || undefined,
    providerExtensionSchemaVersion: String(record.providerExtensionSchemaVersion || '').trim() || undefined,
  };
}

export function parseRuntimeRouteOptions(value: unknown): RuntimeRouteOptionsSnapshot | null {
  const record = asRecord(value);
  const capability = parseRuntimeCanonicalCapability(record.capability) || undefined;
  const selected = record.selected === null
    ? null
    : (parseRuntimeRouteBinding(record.selected) || null);

  const local = asRecord(record.local);
  const localModels = parseLocalModels(local.models);

  const connectors = (Array.isArray(record.connectors) ? record.connectors : [])
    .filter((item) => item && typeof item === 'object')
    .map((item) => {
      const connector = asRecord(item);
      const modelProfiles = parseRuntimeRouteModelProfiles(connector.modelProfiles);
      return {
        id: String(connector.id || ''),
        label: String(connector.label || ''),
        vendor: String(connector.vendor || '').trim() || undefined,
        provider: String(connector.provider || '').trim() || undefined,
        models: Array.isArray(connector.models)
          ? connector.models.map((model) => String(model || '').trim()).filter(Boolean)
          : [],
        modelCapabilities: parseRuntimeRouteConnectorModelCapabilities(connector.modelCapabilities),
        ...(modelProfiles.length > 0 ? { modelProfiles } : {}),
      };
    })
    .filter((item) => item.id);

  return {
    ...(capability ? { capability } : {}),
    selected,
    local: {
      models: localModels,
      defaultEndpoint: String(local.defaultEndpoint || '').trim() || undefined,
    },
    connectors,
  };
}

export function parseRuntimeRouteDescribeResult(value: unknown): RuntimeRouteDescribeResult | null {
  const record = asRecord(value);
  const capability = parseRuntimeCanonicalCapability(record.capability);
  const metadataVersion = String(record.metadataVersion || '').trim();
  const resolvedBindingRef = String(record.resolvedBindingRef || '').trim();
  const metadataKind = parseRuntimeRouteMetadataKind(record.metadataKind);
  if (!capability || metadataVersion !== 'v1' || !resolvedBindingRef || !metadataKind) {
    return null;
  }

  if (capability !== metadataKind) {
    return null;
  }

  if (capability === 'text.generate') {
    const metadata = parseTextGenerateRouteMetadata(record.metadata);
    if (!metadata) return null;
    return {
      capability: 'text.generate',
      metadataVersion: 'v1',
      resolvedBindingRef,
      metadataKind: 'text.generate',
      metadata,
    };
  }

  if (capability === 'audio.synthesize') {
    const metadata = parseSpeechSynthesizeRouteMetadata(record.metadata);
    if (!metadata) return null;
    return {
      capability: 'audio.synthesize',
      metadataVersion: 'v1',
      resolvedBindingRef,
      metadataKind: 'audio.synthesize',
      metadata,
    };
  }

  if (capability === 'audio.transcribe') {
    const metadata = parseSpeechTranscribeRouteMetadata(record.metadata);
    if (!metadata) return null;
    return {
      capability: 'audio.transcribe',
      metadataVersion: 'v1',
      resolvedBindingRef,
      metadataKind: 'audio.transcribe',
      metadata,
    };
  }

  if (capability === 'voice_workflow.voice_clone') {
    const metadata = parseVoiceWorkflowVoiceCloneRouteMetadata(record.metadata);
    if (!metadata) return null;
    return {
      capability: 'voice_workflow.voice_clone',
      metadataVersion: 'v1',
      resolvedBindingRef,
      metadataKind: 'voice_workflow.voice_clone',
      metadata,
    };
  }

  const metadata = parseVoiceWorkflowVoiceDesignRouteMetadata(record.metadata);
  if (!metadata) return null;
  return {
    capability: 'voice_workflow.voice_design',
    metadataVersion: 'v1',
    resolvedBindingRef,
    metadataKind: 'voice_workflow.voice_design',
    metadata,
  };
}

function createRouteDescribeDecodeError(code: string): Error {
  const error = new Error(code);
  error.name = code;
  return error;
}

function decodeBase64Text(value: string): string {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw createRouteDescribeDecodeError('RUNTIME_ROUTE_DESCRIBE_METADATA_HEADER_MISSING');
  }
  const globalBuffer = globalThis as { Buffer?: { from(input: string, encoding: string): { toString(encoding: string): string } } };
  if (globalBuffer.Buffer) {
    return globalBuffer.Buffer.from(normalized, 'base64').toString('utf8');
  }
  if (typeof globalThis.atob === 'function') {
    return globalThis.atob(normalized);
  }
  throw createRouteDescribeDecodeError('RUNTIME_ROUTE_DESCRIBE_METADATA_BASE64_UNAVAILABLE');
}

export function decodeRuntimeRouteDescribeResultFromMetadata(input: {
  metadata: Record<string, string> | null | undefined;
  expectedCapability?: RuntimeCanonicalCapability;
  expectedResolvedBindingRef?: RuntimeRouteResolvedBindingRef;
}): RuntimeRouteDescribeResult {
  const encoded = String(input.metadata?.[RUNTIME_ROUTE_DESCRIBE_RESULT_RESPONSE_METADATA_KEY] || '').trim();
  if (!encoded) {
    throw createRouteDescribeDecodeError('RUNTIME_ROUTE_DESCRIBE_METADATA_HEADER_MISSING');
  }

  let parsedValue: unknown;
  try {
    parsedValue = JSON.parse(decodeBase64Text(encoded)) as unknown;
  } catch {
    throw createRouteDescribeDecodeError('RUNTIME_ROUTE_DESCRIBE_METADATA_DECODE_FAILED');
  }

  const parsed = parseRuntimeRouteDescribeResult(parsedValue);
  if (!parsed) {
    throw createRouteDescribeDecodeError('RUNTIME_ROUTE_DESCRIBE_METADATA_SCHEMA_INVALID');
  }
  if (input.expectedCapability && parsed.capability !== input.expectedCapability) {
    throw createRouteDescribeDecodeError('RUNTIME_ROUTE_DESCRIBE_METADATA_CAPABILITY_MISMATCH');
  }
  if (
    input.expectedResolvedBindingRef
    && parsed.resolvedBindingRef !== input.expectedResolvedBindingRef
  ) {
    throw createRouteDescribeDecodeError('RUNTIME_ROUTE_DESCRIBE_METADATA_BINDING_REF_MISMATCH');
  }
  return parsed;
}
