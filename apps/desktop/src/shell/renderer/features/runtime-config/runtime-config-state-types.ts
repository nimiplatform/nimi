import type { LocalRuntimeCatalogRecommendation } from '@runtime/local-runtime';
import {
  normalizeLocalProviderAdapterId,
  type LocalProviderAdapterId,
  LOCAL_RUNTIME_RUNNABLE_ASSET_KIND_IDS,
  isLocalRuntimeRunnableAssetKindId,
  normalizeLocalRuntimeRunnableAssetKindId,
  type LocalRuntimeRunnableAssetKindId,
  createNimiClientId,
} from '@nimiplatform/sdk/runtime';

type JsonObject = Record<string, unknown>;

export const CAPABILITIES_V11 = LOCAL_RUNTIME_RUNNABLE_ASSET_KIND_IDS;
export type CapabilityV11 = LocalRuntimeRunnableAssetKindId;

export type SourceIdV11 = 'local' | 'cloud';
/**
 * Canonical six-section Runtime IA (product manual "Runtime / AI Environment").
 * Section merges from the Runtime Surface Cleanup table:
 *  - recommend + local (Local Models) + catalog  -> models
 *  - data-management + runtime (Operations)      -> environment
 *  - performance + developer-gated tools         -> advanced
 */
export type RuntimePageIdV11 =
  | 'overview'
  | 'profiles'
  | 'models'
  | 'cloud'
  | 'environment'
  | 'advanced';
/**
 * Sub-navigation targets used inside a section (e.g. the Models section's
 * recommend/installed/catalog sub-tabs, or cross-section "open Cloud Connectors"
 * deep links). Not top-level IA entries.
 */
export type RuntimeSetupPageIdV11 = 'models' | 'cloud';
export type UiModeV11 = 'simple' | 'advanced';
export type ProviderStatusV11 = 'idle' | 'healthy' | 'unreachable' | 'unsupported' | 'degraded';
export type ApiConnectorScopeV11 = 'user' | 'machine-global' | 'runtime-system';
export type ApiVendor = string;
export type ApiConnectorAuthModeV11 = 'api_key' | 'oauth_managed';

export type LocalModelOptionV11 = {
  localModelId: string;
  engine: string;
  model: string;
  endpoint: string;
  capabilities: CapabilityV11[];
  status: 'installed' | 'active' | 'unhealthy' | 'removed';
  integrityMode?: 'verified' | 'local_unverified';
  hash?: string;
  installedAt?: string;
  updatedAt?: string;
  recommendation?: LocalRuntimeCatalogRecommendation;
};

export type NodeCapabilityV11 = CapabilityV11 | 'rerank' | 'cv' | 'diarize';

export type LocalProviderHintsV11 = {
  llama?: {
    backend?: string;
    preferredAdapter?: LocalProviderAdapterId | string;
    whisperVariant?: string;
  };
  media?: {
    preferredAdapter?: LocalProviderAdapterId | string;
    driver?: string;
    family?: string;
  };
  speech?: {
    preferredAdapter?: LocalProviderAdapterId | string;
    backend?: string;
    family?: string;
  };
  extra?: JsonObject;
} & JsonObject;

export type LocalNodeMatrixEntryV11 = {
  nodeId: string;
  capability: NodeCapabilityV11;
  serviceId: string;
  provider: string;
  adapter?: LocalProviderAdapterId;
  backend?: string;
  backendSource?: string;
  available: boolean;
  reasonCode?: string;
  policyGate?: string;
  providerHints?: LocalProviderHintsV11;
};

export type LocalStateV11 = {
  endpoint: string;
  models: LocalModelOptionV11[];
  nodeMatrix: LocalNodeMatrixEntryV11[];
  status: ProviderStatusV11;
  lastCheckedAt: string | null;
  lastDetail: string;
};

export type ApiConnector = {
  id: string;
  label: string;
  vendor: ApiVendor;
  provider: string;
  authMode?: ApiConnectorAuthModeV11;
  providerAuthProfile?: string;
  endpoint: string;
  scope: ApiConnectorScopeV11;
  hasCredential: boolean;
  isSystemOwned: boolean;
  models: string[];
  modelCapabilities?: Record<string, string[]>;
  status: ProviderStatusV11;
  lastCheckedAt: string | null;
  lastDetail: string;
  isDraft?: boolean;
};

export type RuntimeConfigStateV11 = {
  version: 11 | 12;
  initializedByV11: boolean;
  activePage: RuntimePageIdV11;
  diagnosticsCollapsed: boolean;
  selectedSource: SourceIdV11;
  activeCapability: CapabilityV11;
  uiMode: UiModeV11;
  local: LocalStateV11;
  connectors: ApiConnector[];
  selectedConnectorId: string;
};

export const DEFAULT_LOCAL_ENDPOINT_V11 = '';
export const DEFAULT_CONNECTOR_ENDPOINT_V11 = '';

function humanizeVendorId(value: string): string {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return 'Custom';
  }
  return normalized
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (segment) => segment.toUpperCase());
}

export function normalizeSourceV11(value: unknown): SourceIdV11 {
  return value === 'cloud' ? 'cloud' : 'local';
}

export function normalizePageIdV11(value: unknown): RuntimePageIdV11 {
  if (
    value === 'overview'
    || value === 'profiles'
    || value === 'models'
    || value === 'cloud'
    || value === 'environment'
    || value === 'advanced'
  ) {
    return value;
  }
  return 'overview';
}

export function normalizeCapabilityV11(value: unknown): CapabilityV11 {
  return normalizeLocalRuntimeRunnableAssetKindId(value);
}

export function normalizeUiModeV11(value: unknown): UiModeV11 {
  return value === 'advanced' ? 'advanced' : 'simple';
}

export function normalizeVendorV11(value: unknown): ApiVendor {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized || 'custom';
}

export function normalizeStatusV11(value: unknown): ProviderStatusV11 {
  if (value === 'healthy' || value === 'unreachable' || value === 'unsupported' || value === 'degraded') return value;
  return 'idle';
}

export function normalizeConnectorScopeV11(value: unknown): ApiConnectorScopeV11 {
  if (value === 'machine-global' || value === 'runtime-system') return value;
  return 'user';
}

export function statusTextV11(status: ProviderStatusV11): string {
  if (status === 'healthy') return 'Healthy';
  if (status === 'degraded') return 'Degraded';
  if (status === 'unreachable') return 'Unreachable';
  if (status === 'unsupported') return 'Unsupported';
  return 'Not checked';
}

export function statusClassV11(status: ProviderStatusV11): string {
  if (status === 'healthy') return 'bg-[color-mix(in_srgb,var(--nimi-status-success)_12%,transparent)] text-[var(--nimi-status-success)]';
  if (status === 'degraded') return 'bg-[color-mix(in_srgb,var(--nimi-status-warning)_12%,transparent)] text-[var(--nimi-status-warning)]';
  if (status === 'unreachable') return 'bg-[color-mix(in_srgb,var(--nimi-status-danger)_12%,transparent)] text-[var(--nimi-status-danger)]';
  if (status === 'unsupported') return 'bg-[color-mix(in_srgb,var(--nimi-status-warning)_12%,transparent)] text-[var(--nimi-status-warning)]';
  return 'bg-[color-mix(in_srgb,var(--nimi-surface-card)_78%,var(--nimi-surface-panel))] text-[var(--nimi-text-secondary)]';
}

export function dedupeStringsV11(values: string[]): string[] {
  return Array.from(new Set(values.map((item) => String(item || '').trim()).filter(Boolean)));
}

export function getVendorLabelV11(vendor: ApiVendor): string {
  return humanizeVendorId(vendor);
}

export function normalizeEndpointV11(value: string, fallback: string): string {
  return (String(value || '').trim() || fallback).replace(/\/+$/, '');
}

export function randomIdV11(prefix: string): string {
  return createNimiClientId(prefix);
}

export function createConnectorV11(vendor: ApiVendor = 'custom', label?: string): ApiConnector {
  return {
    id: randomIdV11('connector'),
    label: label || `${getVendorLabelV11(vendor)} Connector`,
    vendor,
    provider: '',
    authMode: 'api_key',
    providerAuthProfile: undefined,
    endpoint: DEFAULT_CONNECTOR_ENDPOINT_V11,
    scope: 'user',
    hasCredential: false,
    isSystemOwned: false,
    models: [],
    status: 'idle',
    lastCheckedAt: null,
    lastDetail: '',
  };
}

export function normalizeConnectorModelsV11(vendor: ApiVendor, rawModels: unknown): string[] {
  void vendor;
  return dedupeStringsV11(Array.isArray(rawModels) ? rawModels : []);
}

function normalizeConnectorModelCapabilitiesV11(value: unknown): Record<string, string[]> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const normalized: Record<string, string[]> = {};
  for (const [modelId, rawCapabilities] of Object.entries(value)) {
    const normalizedModelId = String(modelId || '').trim();
    const capabilities = dedupeStringsV11(Array.isArray(rawCapabilities) ? rawCapabilities.map((item) => String(item || '').trim()) : []);
    if (normalizedModelId && capabilities.length > 0) {
      normalized[normalizedModelId] = capabilities;
    }
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function normalizeConnectorV11(raw: Partial<ApiConnector>): ApiConnector {
  const vendor = normalizeVendorV11(raw.vendor);
  const scope = normalizeConnectorScopeV11(raw.scope);
  return {
    id: String(raw.id || randomIdV11('connector')),
    label: String(raw.label || `${getVendorLabelV11(vendor)} Connector`),
    vendor,
    provider: String(raw.provider || ''),
    authMode: raw.authMode === 'oauth_managed' ? 'oauth_managed' : 'api_key',
    providerAuthProfile: String(raw.providerAuthProfile || '').trim() || undefined,
    endpoint: normalizeEndpointV11(String(raw.endpoint || DEFAULT_CONNECTOR_ENDPOINT_V11), DEFAULT_CONNECTOR_ENDPOINT_V11),
    scope,
    hasCredential: Boolean(raw.hasCredential),
    isSystemOwned: scope !== 'user' || Boolean(raw.isSystemOwned),
    models: normalizeConnectorModelsV11(vendor, raw.models),
    modelCapabilities: normalizeConnectorModelCapabilitiesV11(raw.modelCapabilities),
    status: normalizeStatusV11(raw.status),
    lastCheckedAt: raw.lastCheckedAt || null,
    lastDetail: String(raw.lastDetail || ''),
  };
}

export function normalizeLocalModelV11(raw: Partial<LocalModelOptionV11>): LocalModelOptionV11 {
  const localModelId = String(raw.localModelId || raw.model || randomIdV11('local-model')).trim();
  const capabilities = (Array.isArray(raw.capabilities) ? raw.capabilities : [])
    .map((value) => String(value || '').trim())
    .filter(isLocalRuntimeRunnableAssetKindId);
  const engine = String(raw.engine || '').trim();
  return {
    localModelId,
    engine,
    model: String(raw.model || localModelId).trim() || localModelId,
    endpoint: normalizeEndpointV11(String(raw.endpoint || DEFAULT_LOCAL_ENDPOINT_V11), DEFAULT_LOCAL_ENDPOINT_V11),
    capabilities: capabilities.length > 0 ? capabilities : ['chat'],
    status: raw.status === 'active' || raw.status === 'unhealthy' || raw.status === 'removed' ? raw.status : 'installed',
    integrityMode: raw.integrityMode === 'local_unverified' ? 'local_unverified' : 'verified',
    hash: String(raw.hash || '').trim() || undefined,
    installedAt: String(raw.installedAt || '').trim() || undefined,
    updatedAt: String(raw.updatedAt || '').trim() || undefined,
    recommendation: raw.recommendation,
  };
}

export function normalizeLocalNodeMatrixEntryV11(
  raw: Partial<LocalNodeMatrixEntryV11>,
): LocalNodeMatrixEntryV11 {
  const capability = String(raw.capability || '').trim().toLowerCase();
  const normalizedCapability: NodeCapabilityV11 = (
    isLocalRuntimeRunnableAssetKindId(capability)
    || capability === 'rerank'
    || capability === 'cv'
    || capability === 'diarize'
  ) ? capability : 'chat';
  const normalizedProvider = String(raw.provider || '').trim().toLowerCase();
  const adapterRaw = String(raw.adapter || '').trim().toLowerCase();
  const normalizedAdapter = normalizeLocalProviderAdapterId(adapterRaw);
  const hints = (
    raw.providerHints
    && typeof raw.providerHints === 'object'
    && !Array.isArray(raw.providerHints)
  )
    ? raw.providerHints as LocalProviderHintsV11
    : undefined;
  return {
    nodeId: String(raw.nodeId || '').trim() || randomIdV11('node'),
    capability: normalizedCapability,
    serviceId: String(raw.serviceId || '').trim(),
    provider: normalizedProvider,
    adapter: normalizedAdapter,
    backend: String(raw.backend || '').trim() || undefined,
    backendSource: String(raw.backendSource || '').trim() || undefined,
    available: Boolean(raw.available),
    reasonCode: String(raw.reasonCode || '').trim() || undefined,
    policyGate: String(raw.policyGate || '').trim() || undefined,
    providerHints: hints,
  };
}
