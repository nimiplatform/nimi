import type { LocalProviderAdapter, LocalProviderHints } from './types/llm.js';
import { asRecord } from './json-utils';

export type RuntimeRouteSource = 'local' | 'cloud';
export type RuntimeRouteModelProfileContextSource = 'provider-api' | 'template' | 'default' | 'unknown';
export type RuntimeCanonicalCapability =
  | 'text.generate'
  | 'text.embed'
  | 'image.generate'
  | 'video.generate'
  | 'audio.synthesize'
  | 'audio.transcribe'
  | 'voice_workflow.tts_v2v'
  | 'voice_workflow.tts_t2v';

export type RuntimeRouteBinding = {
  source: RuntimeRouteSource;
  connectorId: string;
  model: string;
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
  selected: RuntimeRouteBinding;
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
    || normalized === 'voice_workflow.tts_v2v'
    || normalized === 'voice_workflow.tts_t2v'
  ) {
    return normalized;
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

export function parseRuntimeRouteOptions(
  value: unknown,
  options?: { includeResolvedDefault?: boolean },
): RuntimeRouteOptionsSnapshot | null {
  const record = asRecord(value);
  const capability = parseRuntimeCanonicalCapability(record.capability) || undefined;
  const selected = parseRuntimeRouteBinding(record.selected);
  if (!selected) return null;

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
    ...(options?.includeResolvedDefault ? { resolvedDefault: resolvedDefault || selected } : {}),
    local: {
      models: localModels,
      defaultEndpoint: String(local.defaultEndpoint || '').trim() || undefined,
    },
    connectors,
  };
}
