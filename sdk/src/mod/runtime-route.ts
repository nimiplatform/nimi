import type { LocalProviderAdapter, LocalProviderHints } from './types/llm.js';
import { asRecord } from './json-utils';

export type RuntimeRouteSource = 'local' | 'cloud';
export type RuntimeRouteModelProfileContextSource = 'provider-api' | 'template' | 'default' | 'unknown';
export type RuntimeRouteResolvedBindingRef = string;
export type RuntimeRouteMetadataVersion = 'v1';
export type RuntimeCanonicalCapability =
  | 'text.generate'
  | 'text.embed'
  | 'image.generate'
  | 'video.generate'
  | 'audio.synthesize'
  | 'audio.transcribe'
  | 'music.generate'
  | 'voice_workflow.tts_v2v'
  | 'voice_workflow.tts_t2v';

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
  endpoint?: string;
  goRuntimeLocalModelId?: string;
  goRuntimeStatus?: 'installed' | 'active' | 'unhealthy' | 'removed' | string;
};

export type RuntimeRouteMetadataKind =
  | 'text.generate'
  | 'voice_workflow.tts_v2v'
  | 'voice_workflow.tts_t2v';

export type TextGenerateRouteMetadata = {
  supportsThinking: boolean;
  traceModeSupport: 'none' | 'hide' | 'separate';
  supportsImageInput: boolean;
  supportsAudioInput: boolean;
  supportsVideoInput: boolean;
  supportsArtifactRefInput: boolean;
};

export type VoiceWorkflowTtsV2vRouteMetadata = {
  workflowType: 'tts_v2v';
  supportsReferenceAudioInput: true;
  supportsTextPromptInput: boolean;
  requiresTargetSynthesisBinding: boolean;
};

export type VoiceWorkflowTtsT2vRouteMetadata = {
  workflowType: 'tts_t2v';
  supportsReferenceAudioInput: false;
  supportsTextPromptInput: true;
  requiresTargetSynthesisBinding: boolean;
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
    capability: 'voice_workflow.tts_v2v';
    metadataVersion: RuntimeRouteMetadataVersion;
    resolvedBindingRef: RuntimeRouteResolvedBindingRef;
    metadataKind: 'voice_workflow.tts_v2v';
    metadata: VoiceWorkflowTtsV2vRouteMetadata;
  }
  | {
    capability: 'voice_workflow.tts_t2v';
    metadataVersion: RuntimeRouteMetadataVersion;
    resolvedBindingRef: RuntimeRouteResolvedBindingRef;
    metadataKind: 'voice_workflow.tts_t2v';
    metadata: VoiceWorkflowTtsT2vRouteMetadata;
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
  resolvedDefault?: RuntimeRouteBinding;
  local: {
    models: RuntimeRouteLocalOption[];
    defaultEndpoint?: string;
  };
  connectors: RuntimeRouteConnectorOption[];
};

export function normalizeRuntimeRouteSource(value: unknown): RuntimeRouteSource {
  return String(value || '').trim() === 'cloud' ? 'cloud' : 'local';
}

export function parseRuntimeCanonicalCapability(value: unknown): RuntimeCanonicalCapability | null {
  const normalized = String(value || '').trim();
  if (
    normalized === 'text.generate'
    || normalized === 'text.embed'
    || normalized === 'image.generate'
    || normalized === 'video.generate'
    || normalized === 'audio.synthesize'
    || normalized === 'audio.transcribe'
    || normalized === 'music.generate'
    || normalized === 'voice_workflow.tts_v2v'
    || normalized === 'voice_workflow.tts_t2v'
  ) {
    return normalized;
  }
  // Aliases — backward compatibility only, not canonical tokens
  if (normalized === 'music') return 'music.generate';
  return null;
}

export function parseRuntimeRouteMetadataKind(value: unknown): RuntimeRouteMetadataKind | null {
  const capability = parseRuntimeCanonicalCapability(value);
  if (
    capability === 'text.generate'
    || capability === 'voice_workflow.tts_v2v'
    || capability === 'voice_workflow.tts_t2v'
  ) {
    return capability;
  }
  return null;
}

function parseLocalProviderAdapter(value: unknown): LocalProviderAdapter | undefined {
  const normalized = String(value || '').trim();
  if (
    normalized === 'openai_compat_adapter'
    || normalized === 'llama_native_adapter'
    || normalized === 'media_native_adapter'
    || normalized === 'speech_native_adapter'
    || normalized === 'sidecar_music_adapter'
  ) {
    return normalized;
  }
  return undefined;
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
    adapter: parseLocalProviderAdapter(record.adapter),
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
      adapter: parseLocalProviderAdapter(record.adapter),
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

function parseVoiceWorkflowTtsV2vRouteMetadata(value: unknown): VoiceWorkflowTtsV2vRouteMetadata | null {
  const record = asRecord(value);
  if (
    record.workflowType !== 'tts_v2v'
    || record.supportsReferenceAudioInput !== true
    || typeof record.supportsTextPromptInput !== 'boolean'
    || typeof record.requiresTargetSynthesisBinding !== 'boolean'
  ) {
    return null;
  }
  return {
    workflowType: 'tts_v2v',
    supportsReferenceAudioInput: true,
    supportsTextPromptInput: record.supportsTextPromptInput,
    requiresTargetSynthesisBinding: record.requiresTargetSynthesisBinding,
  };
}

function parseVoiceWorkflowTtsT2vRouteMetadata(value: unknown): VoiceWorkflowTtsT2vRouteMetadata | null {
  const record = asRecord(value);
  if (
    record.workflowType !== 'tts_t2v'
    || record.supportsReferenceAudioInput !== false
    || record.supportsTextPromptInput !== true
    || typeof record.requiresTargetSynthesisBinding !== 'boolean'
  ) {
    return null;
  }
  return {
    workflowType: 'tts_t2v',
    supportsReferenceAudioInput: false,
    supportsTextPromptInput: true,
    requiresTargetSynthesisBinding: record.requiresTargetSynthesisBinding,
  };
}

export function parseRuntimeRouteOptions(
  value: unknown,
  options?: { includeResolvedDefault?: boolean },
): RuntimeRouteOptionsSnapshot | null {
  const record = asRecord(value);
  const capability = parseRuntimeCanonicalCapability(record.capability) || undefined;
  const selected = record.selected === null
    ? null
    : (parseRuntimeRouteBinding(record.selected) || null);

  const resolvedDefault = parseRuntimeRouteBinding(record.resolvedDefault) || undefined;
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
    ...(options?.includeResolvedDefault ? { resolvedDefault: resolvedDefault || selected || undefined } : {}),
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

  if (capability === 'voice_workflow.tts_v2v') {
    const metadata = parseVoiceWorkflowTtsV2vRouteMetadata(record.metadata);
    if (!metadata) return null;
    return {
      capability: 'voice_workflow.tts_v2v',
      metadataVersion: 'v1',
      resolvedBindingRef,
      metadataKind: 'voice_workflow.tts_v2v',
      metadata,
    };
  }

  const metadata = parseVoiceWorkflowTtsT2vRouteMetadata(record.metadata);
  if (!metadata) return null;
  return {
    capability: 'voice_workflow.tts_t2v',
    metadataVersion: 'v1',
    resolvedBindingRef,
    metadataKind: 'voice_workflow.tts_t2v',
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
