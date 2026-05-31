import type { LocalRuntimeCatalogRecommendation } from '@runtime/local-runtime';
import {
  LOCAL_RUNTIME_RUNNABLE_ASSET_KIND_IDS,
  normalizeLocalRuntimeRunnableAssetKindId,
  type LocalRuntimeRunnableAssetKindId,
  createNimiClientId,
  createRuntimeConfigConnectorDraft,
  normalizeRuntimeConfigConnectorAuthMode,
  normalizeRuntimeConfigConnectorModels,
  normalizeRuntimeConfigConnectorProjection,
  normalizeRuntimeConfigConnectorScope,
  normalizeRuntimeConfigConnectorStatus,
  normalizeRuntimeConfigConnectorVendor,
  RUNTIME_CONFIG_DEFAULT_LOCAL_ENDPOINT,
  RUNTIME_CONFIG_DEFAULT_CONNECTOR_ENDPOINT,
  runtimeConfigConnectorVendorLabel,
  normalizeRuntimeConfigEndpoint,
  normalizeRuntimeConfigLocalModelProjection,
  normalizeRuntimeConfigLocalNodeMatrixEntryProjection,
  normalizeRuntimeConfigStringList,
  type RuntimeConfigConnectorProjection,
  type LocalProviderAdapterId,
  type RuntimeConfigProviderStatus,
  type RuntimeConnectorAuthMode,
  type RuntimeConnectorScope,
  type RuntimeConfigLocalModelProjection,
  type RuntimeConfigLocalNodeCapability,
  type RuntimeConfigLocalNodeMatrixEntryProjection,
  type RuntimeConfigLocalProviderHints,
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
export type ProviderStatusV11 = RuntimeConfigProviderStatus;
export type ApiConnectorScopeV11 = 'user' | 'machine-global' | 'runtime-system';
export type ApiVendor = string;
export type ApiConnectorAuthModeV11 = 'api_key' | 'oauth_managed';

export type LocalModelOptionV11 = RuntimeConfigLocalModelProjection & {
  recommendation?: LocalRuntimeCatalogRecommendation;
};

export type NodeCapabilityV11 = RuntimeConfigLocalNodeCapability;

export type LocalProviderHintsV11 = RuntimeConfigLocalProviderHints & JsonObject;

export type LocalNodeMatrixEntryV11 = RuntimeConfigLocalNodeMatrixEntryProjection & {
  capability: NodeCapabilityV11;
  adapter?: LocalProviderAdapterId;
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

export type ApiConnector = RuntimeConfigConnectorProjection;

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

export const DEFAULT_LOCAL_ENDPOINT_V11 = RUNTIME_CONFIG_DEFAULT_LOCAL_ENDPOINT;
export const DEFAULT_CONNECTOR_ENDPOINT_V11 = RUNTIME_CONFIG_DEFAULT_CONNECTOR_ENDPOINT;

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
  return normalizeRuntimeConfigConnectorVendor(value) as ApiVendor;
}

export function normalizeStatusV11(value: unknown): ProviderStatusV11 {
  return normalizeRuntimeConfigConnectorStatus(value);
}

export function normalizeConnectorScopeV11(value: unknown): ApiConnectorScopeV11 {
  return normalizeRuntimeConfigConnectorScope(value) as ApiConnectorScopeV11;
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
  return normalizeRuntimeConfigStringList(values);
}

export function getVendorLabelV11(vendor: ApiVendor): string {
  return runtimeConfigConnectorVendorLabel(vendor);
}

export function normalizeEndpointV11(value: string, fallback: string): string {
  return normalizeRuntimeConfigEndpoint(value, fallback);
}

export function randomIdV11(prefix: string): string {
  return createNimiClientId(prefix);
}

export function createConnectorV11(vendor: ApiVendor = 'custom', label?: string): ApiConnector {
  return createRuntimeConfigConnectorDraft({ id: randomIdV11('connector'), vendor, label });
}

export function normalizeConnectorModelsV11(vendor: ApiVendor, rawModels: unknown): string[] {
  void vendor;
  return normalizeRuntimeConfigConnectorModels(rawModels);
}

export function normalizeConnectorV11(raw: Partial<ApiConnector>): ApiConnector {
  return normalizeRuntimeConfigConnectorProjection({
    ...raw,
    id: raw.id || randomIdV11('connector'),
    authMode: normalizeRuntimeConfigConnectorAuthMode(raw.authMode) as RuntimeConnectorAuthMode,
    scope: normalizeRuntimeConfigConnectorScope(raw.scope) as RuntimeConnectorScope,
  });
}

export function normalizeLocalModelV11(raw: Partial<LocalModelOptionV11>): LocalModelOptionV11 {
  return normalizeRuntimeConfigLocalModelProjection(raw) as LocalModelOptionV11;
}

export function normalizeLocalNodeMatrixEntryV11(
  raw: Partial<LocalNodeMatrixEntryV11>,
): LocalNodeMatrixEntryV11 {
  return normalizeRuntimeConfigLocalNodeMatrixEntryProjection(raw) as LocalNodeMatrixEntryV11;
}
