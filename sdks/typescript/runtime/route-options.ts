import { createNimiError } from '../types';

export type NimiRuntimeRouteSource = 'local' | 'cloud';
export type NimiRuntimeCanonicalCapability = string;
export type NimiRuntimeRouteModelProfileContextSource =
  | 'provider-api'
  | 'model-card'
  | 'runtime-metadata'
  | string;

export interface NimiRuntimeRouteBinding {
  readonly source: NimiRuntimeRouteSource;
  readonly connectorId: string;
  readonly model: string;
  readonly modelLabel?: string;
  readonly modelId?: string;
  readonly provider?: string;
  readonly localModelId?: string;
  readonly engine?: string;
  readonly endpoint?: string;
  readonly localProviderEndpoint?: string;
  readonly localOpenAiEndpoint?: string;
  readonly goRuntimeLocalModelId?: string;
  readonly goRuntimeStatus?: 'installed' | 'active' | 'unhealthy' | 'removed' | string;
  readonly maxContextTokens?: number;
  readonly maxOutputTokens?: number;
}

export interface NimiRuntimeRouteConnectorOption {
  readonly id: string;
  readonly label: string;
  readonly vendor?: string;
  readonly provider?: string;
  readonly models: readonly string[];
  readonly modelCapabilities?: Record<string, readonly string[]>;
  readonly modelProfiles?: readonly NimiRuntimeRouteModelProfile[];
}

export interface NimiRuntimeRouteModelProfile {
  readonly model: string;
  readonly maxContextTokens?: number;
  readonly maxOutputTokens?: number;
  readonly contextSource?: NimiRuntimeRouteModelProfileContextSource;
}

export interface NimiRuntimeRouteLocalOption {
  readonly localModelId: string;
  readonly label?: string;
  readonly engine?: string;
  readonly model: string;
  readonly modelId?: string;
  readonly provider?: string;
  readonly endpoint?: string;
  readonly status?: 'installed' | 'active' | 'unhealthy' | 'removed' | string;
  readonly goRuntimeLocalModelId?: string;
  readonly goRuntimeStatus?: 'installed' | 'active' | 'unhealthy' | 'removed' | string;
  readonly capabilities?: readonly string[];
}

export interface NimiRuntimeRouteOptionsSnapshot {
  readonly capability?: NimiRuntimeCanonicalCapability;
  readonly selected: NimiRuntimeRouteBinding | null;
  readonly local: {
    readonly models: readonly NimiRuntimeRouteLocalOption[];
    readonly defaultEndpoint?: string;
  };
  readonly connectors: readonly NimiRuntimeRouteConnectorOption[];
}

export interface NimiListRuntimeRouteOptionsInput {
  readonly capability: NimiRuntimeCanonicalCapability;
  readonly targetId?: string;
  readonly selectedBinding?: NimiRuntimeRouteBinding | null;
}

export interface NimiRuntimeRouteOptionsClient {
  listRuntimeRouteOptions(
    input: NimiListRuntimeRouteOptionsInput,
  ): Promise<NimiRuntimeRouteOptionsSnapshot> | NimiRuntimeRouteOptionsSnapshot;
}

export function normalizeNimiRuntimeRouteCapabilityToken(value: unknown): NimiRuntimeCanonicalCapability | null {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized || null;
}

export function runtimeNimiRouteCapabilitiesMatch(
  capabilities: readonly string[] | undefined,
  capability: unknown,
): boolean {
  const required = normalizeNimiRuntimeRouteCapabilityToken(capability);
  if (!required) {
    return false;
  }
  return (capabilities || []).some((item) => normalizeNimiRuntimeRouteCapabilityToken(item) === required);
}

export async function listNimiRuntimeRouteOptions(
  client: NimiRuntimeRouteOptionsClient,
  input: NimiListRuntimeRouteOptionsInput,
): Promise<NimiRuntimeRouteOptionsSnapshot> {
  const capability = normalizeNimiRuntimeRouteCapabilityToken(input.capability);
  if (!capability) {
    throw createNimiError({
      message: 'Runtime route capability is required.',
      reasonCode: 'SDK_RUNTIME_ROUTE_INPUT_INVALID',
      actionHint: 'provide_runtime_route_capability',
      source: 'sdk',
    });
  }
  if (!client || typeof client.listRuntimeRouteOptions !== 'function') {
    throw createNimiError({
      message: 'Runtime route options require an explicit route options client.',
      reasonCode: 'SDK_RUNTIME_ROUTE_CLIENT_REQUIRED',
      actionHint: 'provide_runtime_route_options_client',
      source: 'sdk',
    });
  }
  return client.listRuntimeRouteOptions({
    ...input,
    capability,
  });
}

function normalizeNimiRuntimeRouteText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeNimiRuntimeRouteModelRoot(value: unknown): string {
  const normalized = normalizeNimiRuntimeRouteText(value);
  if (!normalized) return '';
  const lower = normalized.toLowerCase();
  for (const prefix of ['llama/', 'media/', 'speech/', 'sidecar/', 'local/', 'cloud/', 'token/']) {
    if (lower.startsWith(prefix)) {
      return normalized.slice(prefix.length);
    }
  }
  return normalized;
}

export function isNimiRuntimeRouteLocalOptionSelectable(option: NimiRuntimeRouteLocalOption): boolean {
  return Boolean(normalizeNimiRuntimeRouteText(option.localModelId))
    && normalizeNimiRuntimeRouteText(option.status).toLowerCase() !== 'removed';
}

export function nimiRuntimeRouteLocalOptionToBinding(
  option: NimiRuntimeRouteLocalOption,
  input?: {
    readonly defaultEndpoint?: string;
  },
): NimiRuntimeRouteBinding {
  const modelId = normalizeNimiRuntimeRouteText(option.modelId || option.model);
  return {
    source: 'local',
    connectorId: '',
    model: modelId,
    modelId: modelId || undefined,
    provider: normalizeNimiRuntimeRouteText(option.provider || option.engine) || undefined,
    localModelId: normalizeNimiRuntimeRouteText(option.localModelId) || undefined,
    engine: normalizeNimiRuntimeRouteText(option.engine) || undefined,
    endpoint: normalizeNimiRuntimeRouteText(option.endpoint || input?.defaultEndpoint) || undefined,
    goRuntimeLocalModelId: normalizeNimiRuntimeRouteText(option.goRuntimeLocalModelId) || undefined,
    goRuntimeStatus: normalizeNimiRuntimeRouteText(option.goRuntimeStatus) || undefined,
  };
}

function nimiRuntimeRouteBindingModelToken(binding: NimiRuntimeRouteBinding): string {
  return normalizeNimiRuntimeRouteText(binding.modelId) || normalizeNimiRuntimeRouteText(binding.model);
}

function nimiRuntimeRouteEngineToken(binding: NimiRuntimeRouteBinding): string {
  return normalizeNimiRuntimeRouteText(binding.engine || binding.provider)
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function nimiRuntimeRouteBindingsMatch(
  left: NimiRuntimeRouteBinding | null | undefined,
  right: NimiRuntimeRouteBinding | null | undefined,
): boolean {
  if (!left || !right || left.source !== right.source) {
    return false;
  }
  if (left.source === 'local') {
    const leftLocalModelId = normalizeNimiRuntimeRouteText(left.localModelId || left.goRuntimeLocalModelId);
    const rightLocalModelId = normalizeNimiRuntimeRouteText(right.localModelId || right.goRuntimeLocalModelId);
    if (leftLocalModelId && rightLocalModelId) {
      return leftLocalModelId === rightLocalModelId;
    }
    const leftModel = normalizeNimiRuntimeRouteModelRoot(nimiRuntimeRouteBindingModelToken(left));
    const rightModel = normalizeNimiRuntimeRouteModelRoot(nimiRuntimeRouteBindingModelToken(right));
    if (!leftModel || !rightModel || leftModel !== rightModel) {
      return false;
    }
    const leftEngine = nimiRuntimeRouteEngineToken(left);
    const rightEngine = nimiRuntimeRouteEngineToken(right);
    if (!leftEngine || !rightEngine) {
      return true;
    }
    return leftEngine === rightEngine;
  }
  const leftConnectorId = normalizeNimiRuntimeRouteText(left.connectorId);
  const rightConnectorId = normalizeNimiRuntimeRouteText(right.connectorId);
  const leftModel = normalizeNimiRuntimeRouteText(left.modelId || left.model);
  const rightModel = normalizeNimiRuntimeRouteText(right.modelId || right.model);
  return Boolean(
    leftConnectorId
    && rightConnectorId
    && leftConnectorId === rightConnectorId
    && leftModel
    && rightModel
    && leftModel === rightModel,
  );
}

export function findNimiRuntimeRouteModelProfile(
  snapshot: NimiRuntimeRouteOptionsSnapshot | null | undefined,
  binding: NimiRuntimeRouteBinding | null | undefined,
): NimiRuntimeRouteModelProfile | null {
  if (!snapshot || !binding) {
    return null;
  }
  if (
    Number.isFinite(Number(binding.maxContextTokens))
    || Number.isFinite(Number(binding.maxOutputTokens))
  ) {
    return {
      model: normalizeNimiRuntimeRouteText(binding.modelId) || normalizeNimiRuntimeRouteText(binding.model),
      ...(Number.isFinite(Number(binding.maxContextTokens)) && Number(binding.maxContextTokens) > 0
        ? { maxContextTokens: Math.floor(Number(binding.maxContextTokens)) }
        : {}),
      ...(Number.isFinite(Number(binding.maxOutputTokens)) && Number(binding.maxOutputTokens) > 0
        ? { maxOutputTokens: Math.floor(Number(binding.maxOutputTokens)) }
        : {}),
    };
  }
  if (binding.source !== 'cloud') {
    return null;
  }
  const connector = snapshot.connectors.find((item) => (
    normalizeNimiRuntimeRouteText(item.id) === normalizeNimiRuntimeRouteText(binding.connectorId)
  )) || null;
  if (!connector) {
    return null;
  }
  const targetModel = normalizeNimiRuntimeRouteText(binding.modelId) || normalizeNimiRuntimeRouteText(binding.model);
  if (!targetModel) {
    return null;
  }
  return connector.modelProfiles?.find((profile) => (
    normalizeNimiRuntimeRouteText(profile.model) === targetModel
  )) || null;
}
