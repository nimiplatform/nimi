import type { JsonObject } from '../types';
import {
  isNimiRuntimeLocalRunnableAssetKindId,
  parseNimiRuntimeLocalRunnableAssetKindId,
  type NimiRuntimeLocalRunnableAssetKindId,
} from './local-asset-vocabulary';

export const NIMI_RUNTIME_CONFIG_DEFAULT_LOCAL_ENDPOINT = '';
export const NIMI_RUNTIME_CONFIG_DEFAULT_CONNECTOR_ENDPOINT = NIMI_RUNTIME_CONFIG_DEFAULT_LOCAL_ENDPOINT;

export const NIMI_RUNTIME_LOCAL_PROVIDER_ADAPTER_IDS = [
  'openai_compat_adapter',
  'llama_native_adapter',
  'media_native_adapter',
  'speech_native_adapter',
  'sidecar_music_adapter',
] as const;

export type NimiRuntimeConfigProviderStatus = 'idle' | 'healthy' | 'unreachable' | 'unsupported' | 'degraded';
export type NimiRuntimeConfigLocalModelStatus = 'installed' | 'active' | 'unhealthy' | 'removed';
export type NimiRuntimeConfigLocalModelIntegrityMode = 'verified' | 'local_unverified';
export type NimiRuntimeConnectorAuthMode = 'api_key' | 'oauth_managed';
export type NimiRuntimeConnectorScope = 'user' | 'machine-global' | 'runtime-system';
export type NimiRuntimeLocalProviderAdapterId = (typeof NIMI_RUNTIME_LOCAL_PROVIDER_ADAPTER_IDS)[number];

export interface NimiRuntimeConnectorProjection {
  readonly id: string;
  readonly label: string;
  readonly vendor: string;
  readonly provider: string;
  readonly authMode: NimiRuntimeConnectorAuthMode;
  readonly providerAuthProfile?: string;
  readonly endpoint: string;
  readonly scope: NimiRuntimeConnectorScope;
  readonly hasCredential: boolean;
  readonly isSystemOwned: boolean;
  readonly models: readonly string[];
}

export interface NimiRuntimeConfigConnectorProjection extends NimiRuntimeConnectorProjection {
  readonly status: NimiRuntimeConfigProviderStatus;
  readonly lastCheckedAt: string | null;
  readonly lastDetail: string;
  readonly modelCapabilities?: Record<string, readonly string[]>;
  readonly isDraft?: boolean;
}

export interface NimiRuntimeConfigConnectorProjectionInput {
  readonly id?: unknown;
  readonly label?: unknown;
  readonly vendor?: unknown;
  readonly provider?: unknown;
  readonly authMode?: unknown;
  readonly providerAuthProfile?: unknown;
  readonly endpoint?: unknown;
  readonly scope?: unknown;
  readonly hasCredential?: unknown;
  readonly isSystemOwned?: unknown;
  readonly models?: unknown;
  readonly modelCapabilities?: unknown;
  readonly status?: unknown;
  readonly lastCheckedAt?: unknown;
  readonly lastDetail?: unknown;
  readonly isDraft?: unknown;
}

export interface NimiRuntimeConfigLocalModelProjection {
  readonly localModelId: string;
  readonly engine: string;
  readonly model: string;
  readonly endpoint: string;
  readonly capabilities: readonly NimiRuntimeLocalRunnableAssetKindId[];
  readonly status: NimiRuntimeConfigLocalModelStatus;
  readonly integrityMode?: NimiRuntimeConfigLocalModelIntegrityMode;
  readonly hash?: string;
  readonly installedAt?: string;
  readonly updatedAt?: string;
  readonly recommendation?: unknown;
}

export type NimiRuntimeConfigLocalNodeCapability =
  | NimiRuntimeLocalRunnableAssetKindId
  | 'rerank'
  | 'cv'
  | 'diarize';

export type NimiRuntimeConfigLocalProviderHints = JsonObject;

export interface NimiRuntimeConfigLocalNodeMatrixEntryProjection {
  readonly nodeId: string;
  readonly capability: NimiRuntimeConfigLocalNodeCapability;
  readonly serviceId: string;
  readonly provider: string;
  readonly adapter?: NimiRuntimeLocalProviderAdapterId;
  readonly backend?: string;
  readonly backendSource?: string;
  readonly available: boolean;
  readonly reasonCode?: string;
  readonly policyGate?: string;
  readonly providerHints?: NimiRuntimeConfigLocalProviderHints;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function createNimiRuntimeProjectionId(prefix: string): string {
  const normalizedPrefix = normalizeText(prefix).replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'id';
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) {
    return `${normalizedPrefix}_${uuid}`;
  }
  return `${normalizedPrefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function dedupeProjectionStrings(values: readonly unknown[]): string[] {
  return Array.from(new Set(values.map((item) => normalizeText(item)).filter(Boolean)));
}

function normalizeNimiRuntimeLocalModelStatus(value: unknown): NimiRuntimeConfigLocalModelStatus {
  if (value === 'active' || value === 'unhealthy' || value === 'removed') {
    return value;
  }
  return 'installed';
}

function normalizeNimiRuntimeConfigLocalNodeCapability(value: unknown): NimiRuntimeConfigLocalNodeCapability {
  const capability = normalizeText(value).toLowerCase();
  if (
    isNimiRuntimeLocalRunnableAssetKindId(capability)
    || capability === 'rerank'
    || capability === 'cv'
    || capability === 'diarize'
  ) {
    return capability;
  }
  return 'chat';
}

export function normalizeNimiRuntimeLocalProviderAdapterId(
  value: unknown,
): NimiRuntimeLocalProviderAdapterId | undefined {
  const normalized = normalizeText(value);
  return (NIMI_RUNTIME_LOCAL_PROVIDER_ADAPTER_IDS as readonly string[]).includes(normalized)
    ? normalized as NimiRuntimeLocalProviderAdapterId
    : undefined;
}

function normalizeNimiRuntimeConfigLocalProviderHints(
  value: unknown,
): NimiRuntimeConfigLocalProviderHints | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as NimiRuntimeConfigLocalProviderHints;
}

export function normalizeNimiRuntimeConfigEndpoint(
  value: unknown,
  fallback = NIMI_RUNTIME_CONFIG_DEFAULT_LOCAL_ENDPOINT,
): string {
  return (normalizeText(value) || fallback).replace(/\/+$/, '');
}

export function normalizeNimiRuntimeConfigStringList(values: readonly unknown[]): string[] {
  return dedupeProjectionStrings(values);
}

export function nimiRuntimeConfigConnectorVendorLabel(vendor: string): string {
  const normalized = normalizeText(vendor);
  if (!normalized) {
    return 'Custom';
  }
  return normalized
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (segment) => segment.toUpperCase());
}

export function normalizeNimiRuntimeConfigConnectorVendor(value: unknown): string {
  const normalized = normalizeText(value).toLowerCase();
  return normalized || 'custom';
}

export function normalizeNimiRuntimeConfigConnectorAuthMode(value: unknown): NimiRuntimeConnectorAuthMode {
  return value === 'oauth_managed' ? 'oauth_managed' : 'api_key';
}

export function normalizeNimiRuntimeConfigConnectorScope(value: unknown): NimiRuntimeConnectorScope {
  if (value === 'machine-global' || value === 'runtime-system') {
    return value;
  }
  return 'user';
}

export function normalizeNimiRuntimeConfigConnectorStatus(value: unknown): NimiRuntimeConfigProviderStatus {
  if (value === 'healthy' || value === 'unreachable' || value === 'unsupported' || value === 'degraded') {
    return value;
  }
  return 'idle';
}

export function normalizeNimiRuntimeConfigConnectorModels(rawModels: unknown): string[] {
  return normalizeNimiRuntimeConfigStringList(Array.isArray(rawModels) ? rawModels : []);
}

export function normalizeNimiRuntimeConfigConnectorModelCapabilities(
  value: unknown,
): Record<string, readonly string[]> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const normalized: Record<string, readonly string[]> = {};
  for (const [modelId, rawCapabilities] of Object.entries(value)) {
    const normalizedModelId = normalizeText(modelId);
    const capabilities = normalizeNimiRuntimeConfigStringList(
      Array.isArray(rawCapabilities) ? rawCapabilities : [],
    );
    if (normalizedModelId && capabilities.length > 0) {
      normalized[normalizedModelId] = capabilities;
    }
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function createNimiRuntimeConfigConnectorDraft(input: {
  readonly vendor?: unknown;
  readonly label?: unknown;
  readonly id?: unknown;
} = {}): NimiRuntimeConfigConnectorProjection {
  const vendor = normalizeNimiRuntimeConfigConnectorVendor(input.vendor);
  return {
    id: normalizeText(input.id) || createNimiRuntimeProjectionId('connector'),
    label: normalizeText(input.label) || `${nimiRuntimeConfigConnectorVendorLabel(vendor)} Connector`,
    vendor,
    provider: '',
    authMode: 'api_key',
    providerAuthProfile: undefined,
    endpoint: NIMI_RUNTIME_CONFIG_DEFAULT_CONNECTOR_ENDPOINT,
    scope: 'user',
    hasCredential: false,
    isSystemOwned: false,
    models: [],
    status: 'idle',
    lastCheckedAt: null,
    lastDetail: '',
  };
}

export function normalizeNimiRuntimeConfigConnectorProjection(
  raw: NimiRuntimeConfigConnectorProjectionInput,
): NimiRuntimeConfigConnectorProjection {
  const vendor = normalizeNimiRuntimeConfigConnectorVendor(raw.vendor);
  const scope = normalizeNimiRuntimeConfigConnectorScope(raw.scope);
  return {
    id: normalizeText(raw.id) || createNimiRuntimeProjectionId('connector'),
    label: normalizeText(raw.label) || `${nimiRuntimeConfigConnectorVendorLabel(vendor)} Connector`,
    vendor,
    provider: normalizeText(raw.provider),
    authMode: normalizeNimiRuntimeConfigConnectorAuthMode(raw.authMode),
    providerAuthProfile: normalizeText(raw.providerAuthProfile) || undefined,
    endpoint: normalizeNimiRuntimeConfigEndpoint(raw.endpoint, NIMI_RUNTIME_CONFIG_DEFAULT_CONNECTOR_ENDPOINT),
    scope,
    hasCredential: Boolean(raw.hasCredential),
    isSystemOwned: scope !== 'user' || Boolean(raw.isSystemOwned),
    models: normalizeNimiRuntimeConfigConnectorModels(raw.models),
    modelCapabilities: normalizeNimiRuntimeConfigConnectorModelCapabilities(raw.modelCapabilities),
    status: normalizeNimiRuntimeConfigConnectorStatus(raw.status),
    lastCheckedAt: normalizeText(raw.lastCheckedAt) || null,
    lastDetail: normalizeText(raw.lastDetail),
    isDraft: raw.isDraft === true ? true : undefined,
  };
}

export function runtimeConnectorProjectionToNimiRuntimeConfigConnector(
  connector: NimiRuntimeConnectorProjection,
): NimiRuntimeConfigConnectorProjection {
  return normalizeNimiRuntimeConfigConnectorProjection({
    ...connector,
    status: 'idle',
    lastCheckedAt: null,
    lastDetail: '',
  });
}

export function normalizeNimiRuntimeConfigLocalModelProjection(
  raw: Partial<NimiRuntimeConfigLocalModelProjection>,
): NimiRuntimeConfigLocalModelProjection {
  const localModelId = normalizeText(raw.localModelId)
    || normalizeText(raw.model)
    || createNimiRuntimeProjectionId('local-model');
  const capabilities = (Array.isArray(raw.capabilities) ? raw.capabilities : [])
    .map(parseNimiRuntimeLocalRunnableAssetKindId)
    .filter((capability): capability is NimiRuntimeLocalRunnableAssetKindId => capability !== undefined);
  return {
    localModelId,
    engine: normalizeText(raw.engine),
    model: normalizeText(raw.model) || localModelId,
    endpoint: normalizeNimiRuntimeConfigEndpoint(raw.endpoint),
    capabilities: capabilities.length > 0 ? capabilities : ['chat'],
    status: normalizeNimiRuntimeLocalModelStatus(raw.status),
    integrityMode: raw.integrityMode === 'local_unverified' ? 'local_unverified' : 'verified',
    hash: normalizeText(raw.hash) || undefined,
    installedAt: normalizeText(raw.installedAt) || undefined,
    updatedAt: normalizeText(raw.updatedAt) || undefined,
    recommendation: raw.recommendation,
  };
}

export function normalizeNimiRuntimeConfigLocalNodeMatrixEntryProjection(
  raw: Partial<NimiRuntimeConfigLocalNodeMatrixEntryProjection>,
): NimiRuntimeConfigLocalNodeMatrixEntryProjection {
  return {
    nodeId: normalizeText(raw.nodeId) || createNimiRuntimeProjectionId('node'),
    capability: normalizeNimiRuntimeConfigLocalNodeCapability(raw.capability),
    serviceId: normalizeText(raw.serviceId),
    provider: normalizeText(raw.provider).toLowerCase(),
    adapter: normalizeNimiRuntimeLocalProviderAdapterId(raw.adapter),
    backend: normalizeText(raw.backend) || undefined,
    backendSource: normalizeText(raw.backendSource) || undefined,
    available: Boolean(raw.available),
    reasonCode: normalizeText(raw.reasonCode) || undefined,
    policyGate: normalizeText(raw.policyGate) || undefined,
    providerHints: normalizeNimiRuntimeConfigLocalProviderHints(raw.providerHints),
  };
}
